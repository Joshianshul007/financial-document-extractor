import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(req: NextRequest) {
    try {
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

        // Parse the PDF
        let text = "";
        try {
            const pdfData = await pdfParse(buffer);
            text = pdfData.text;
        } catch (parseError: any) {
            console.error("PDF Parse Error Detail:", parseError.message || parseError);
            console.error("Buffer length:", buffer.length);
            return NextResponse.json(
                { error: "Failed to parse PDF document. Please ensure it is a valid text-based PDF.", details: parseError.message },
                { status: 400 }
            );
        }

        if (!text || text.trim() === "") {
            return NextResponse.json(
                { error: "No text could be extracted from the PDF." },
                { status: 400 }
            );
        }

        // Call Gemini for structured extraction
        const prompt = `You are a financial statement extraction engine.

Your job is to extract income statement data from the provided document text.

STRICT RULES (VERY IMPORTANT):
- Extract ONLY numbers that are explicitly present in the document.
- DO NOT calculate, estimate, infer, or derive any value.
- DO NOT guess missing values.
- If a value is not clearly found, return null.
- Do NOT merge multiple rows or numbers.
- Output MUST be valid JSON only (no text, no explanation).

CANONICAL FIELDS TO EXTRACT:
- Revenue
- Expenses
- Net Profit

SYNONYM / MAPPING RULES:
- Revenue may appear as:
  "Total Income",
  "Income from Operations",
  "Total Revenue"

- Expenses may appear as:
  "Total Expenditure",
  "Total Expenditure (excluding provisions and contingencies)",
  "Operating Expenses",
  "Operating costs"

- Net Profit may appear as:
  "Net Profit",
  "Net Profit for the period",
  "Net profit from ordinary activities after tax"

TIME RULES:
- If multiple years or periods exist, extract ALL of them.
- Use the year as the key (example: 2024, 2025).

CURRENCY & UNITS:
- Detect currency (e.g. INR, USD) if mentioned.
- Detect units (e.g. crore, million) if mentioned.
- If not found, return null.

OUTPUT FORMAT (STRICT):
{
  "currency": "<string or null>",
  "units": "<string or null>",
  "data": {
    "<year>": {
      "revenue": <number or null>,
      "expenses": <number or null>,
      "net_profit": <number or null>
    }
  }
}

Document Text:
"""
${text.substring(0, 15000)} // Limit text to avoid token limits
"""`;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: "You are a financial data extraction assistant. Always respond with valid JSON matching the exact strict output format requested.",
        });

        const completion = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0,
            }
        });

        const resultString = completion.response.text();
        if (!resultString) {
            throw new Error("No response from Gemini");
        }

        const result = JSON.parse(resultString) as {
            currency: string | null;
            units: string | null;
            data: Record<string, {
                revenue: number | null;
                expenses: number | null;
                net_profit: number | null;
            }>;
        };

        // --- Validation logic (Crucial step) ---
        // Check if extracted strings actually exist in the raw text.
        // This prevents hallucinations.
        const normalizedText = text.replace(/\s+/g, ' '); // Normalize spaces for easier checking

        const validateValue = (value: number | string | null): number | null => {
            if (value === null || value === undefined) return null;
            const strValue = String(value).trim();
            if (strValue === "") return null;

            // If the exact string is in the text, it's valid.
            if (normalizedText.includes(strValue)) {
                return Number(strValue.replace(/[$,]/g, ""));
            }

            // Secondary check: sometimes an LLM might return "12345" when text had "12,345"
            // Let's check if stripping non-digits from original text contains the purely numeric value
            const justDigitsText = text.replace(/[^0-9]/g, "");
            const justDigitsVal = strValue.replace(/[^0-9]/g, "");
            if (justDigitsVal && justDigitsText.includes(justDigitsVal)) {
                return Number(strValue.replace(/[$,]/g, ""));
            }

            // If we still can't find it, consider it a hallucination or ambiguous
            return null;
        };

        const validatedData: Record<string, any> = {};
        for (const [year, financials] of Object.entries(result.data || {})) {
            validatedData[year] = {
                revenue: validateValue(financials.revenue),
                expenses: validateValue(financials.expenses),
                net_profit: validateValue(financials.net_profit)
            };
        }

        const finalData = {
            currency: result.currency || null,
            units: result.units || null,
            data: validatedData,
        };

        return NextResponse.json({ data: finalData });
    } catch (error) {
        console.error("Extraction error:", error);
        return NextResponse.json(
            { error: "An error occurred during extraction.", details: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
            { status: 500 }
        );
    }
}
