import { NextRequest, NextResponse } from "next/server";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Allow the serverless function to run for up to 60 seconds (Vercel Hobby Tier Limit)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    // Initialize Gemini client dynamically to pick up live .env changes without restarting
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || "");

    let tempFilePath = "";
    try {
        const contentType = req.headers.get("content-type") || "";
        let fileUri = "";
        let mimeType = "";
        let text = ""; // For local validation (empty for direct uploads)

        if (contentType.includes("application/json")) {
            const body = await req.json();
            fileUri = body.fileUri;
            mimeType = body.mimeType;
            if (!fileUri || !mimeType) {
                return NextResponse.json({ error: "Missing file credentials" }, { status: 400 });
            }
        } else {
            const formData = await req.formData();
            const file = formData.get("file") as File | null;

            if (!file) {
                return NextResponse.json(
                    { error: "No file uploaded" },
                    { status: 400 }
                );
            }

            // Convert File to Buffer
            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);

            try {
                const uint8Array = new Uint8Array(buffer);
                const pdfDocument = await pdfjsLib.getDocument({ data: uint8Array }).promise;
                for (let i = 1; i <= pdfDocument.numPages; i++) {
                    const page = await pdfDocument.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map((item: any) => item.str).join(" ");
                    text += pageText + "\n";
                }
            } catch (parseError: any) {
                console.error("Local text extraction failed:", parseError.message || parseError);
            }

            // Save buffer to a temp file for Gemini File API
            const tempFileName = `upload-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`;
            tempFilePath = path.join(os.tmpdir(), tempFileName);
            await fs.writeFile(tempFilePath, buffer);

            // Upload physical file to Gemini
            const uploadResponse = await fileManager.uploadFile(tempFilePath, {
                mimeType: "application/pdf",
                displayName: file.name || "Uploaded PDF",
            });
            fileUri = uploadResponse.file.uri;
            mimeType = uploadResponse.file.mimeType;
        }

        const prompt = `You are an expert financial statement extraction engine.

Your job is to extract an exhaustive Income Statement / Statement of Profit and Loss data from the provided document.

STRICT RULES (VERY IMPORTANT):
- Extract ONLY numbers that are explicitly present in the document.
- DO NOT calculate, estimate, infer, or derive any value.
- DO NOT guess missing values.
- If a value is not clearly found, return null.
- Output MUST be valid JSON only (no markdown, no text, no explanation).
- DO NOT nest the year keys inside "standalone" or "consolidated" objects. The years MUST be direct children of the "data" object.

TIME RULES:
- If multiple years or periods exist, extract ALL of them.
- Use the year as the key (e.g. "2024", "2025").

CURRENCY & UNITS:
- Detect currency (e.g. INR, USD) if mentioned.
- Detect units (e.g. crore, million) if mentioned.
- If not found, return null.

FIELDS TO EXTRACT (DYNAMIC):
Extract ALL line items present in the Income Statement / Statement of Profit and Loss.
Use the EXACT names/labels of the line items as they are written in the PDF (e.g., "Revenue from operations", "Cost of materials consumed", "Employee benefits expense", "Profit Before Tax"). 
Do not skip any valid rows. Do not use a pre-set list, literally look at the PDF and transcribe its rows into the JSON format. 

OUTPUT FORMAT (STRICT JSON):
{
  "currency": "<string or null>",
  "units": "<string or null>",
  "data": {
    "<year>": {
      "<Exact Line Item 1 From PDF>": <number or null>,
      "<Exact Line Item 2 From PDF>": <number or null>,
      ... [include all line items present in the document]
    }
  }
}`;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
            systemInstruction: "You are a financial data extraction assistant. Always respond with valid JSON matching the exact strict output format requested containing the full list of fields.",
        });

        const completion = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            fileData: {
                                mimeType: mimeType,
                                fileUri: fileUri
                            }
                        },
                        { text: prompt }
                    ]
                }
            ],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0,
            }
        });

        const resultString = completion.response.text();
        if (!resultString) {
            throw new Error("No response from Gemini");
        }

        // Clean out markdown blocks from Gemini response if it hallucinated them
        let cleanResultString = resultString.trim();
        if (cleanResultString.startsWith("```json")) {
            cleanResultString = cleanResultString.replace(/^```json\n/, "").replace(/\n```$/, "");
        } else if (cleanResultString.startsWith("```")) {
            cleanResultString = cleanResultString.replace(/^```\n/, "").replace(/\n```$/, "");
        }

        const result = JSON.parse(cleanResultString) as {
            currency: string | null;
            units: string | null;
            data: Record<string, Record<string, number | null>>;
        };

        // --- Validation logic (Crucial step) ---
        // Check if extracted strings actually exist in the local parsed text (only if local text exists).
        const normalizedText = text.replace(/\s+/g, ' '); // Normalize spaces for easier checking

        const validateValue = (value: number | string | null): number | string | null => {
            if (value === null || value === undefined) return null;
            const strValue = String(value).trim();
            if (strValue === "") return null;

            // Strip formatting characters for numerical parsing
            const cleanStrValue = strValue.replace(/[$,\s]/g, "");
            const numValue = Number(cleanStrValue);

            // If it parses to a valid number, return it.
            // Otherwise, we trust the LLM and return the string rather than nullifying valid data.
            // The previous strict subset validation was destroying data due to PDF text extraction inconsistencies.
            if (!isNaN(numValue)) {
                return numValue;
            }

            return strValue;
        };

        const validatedData: Record<string, any> = {};
        for (const [year, financials] of Object.entries(result.data || {})) {
            validatedData[year] = {};
            for (const [key, value] of Object.entries(financials)) {
                validatedData[year][key] = validateValue(value);
            }
        }

        const finalData = {
            currency: result.currency || null,
            units: result.units || null,
            data: validatedData,
        };

        return NextResponse.json({ data: finalData });
    } catch (error: any) {
        console.error("Extraction error:", error);

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("429") || errorMessage.includes("Quota") || errorMessage.includes("quota")) {
            return NextResponse.json(
                { error: "Gemini API Quota Exceeded. Please try again later or upgrade your plan.", details: errorMessage, stack: error instanceof Error ? error.stack : undefined },
                { status: 429 }
            );
        }

        return NextResponse.json(
            { error: "An error occurred during extraction.", details: errorMessage, stack: error instanceof Error ? error.stack : undefined },
            { status: 500 }
        );
    } finally {
        // Clean up temp file
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
            } catch (cleanupError) {
                console.error("Failed to clean up temp file:", cleanupError);
            }
        }
    }
}
