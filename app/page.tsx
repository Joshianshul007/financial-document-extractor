"use client";

import { useState } from "react";
import Papa from "papaparse";

type FinancialData = Record<string, number | null>;
type ExtractedData = { currency: string | null; units: string | null; data: Record<string, FinancialData> };

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ExtractedData | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setResults(null);
    }
  };

  const handleExtract = async () => {
    if (!file) {
      setError("Please select a PDF file first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      // 1. Fetch API Key securely from local backend
      const keyRes = await fetch("/api/env");
      const { apiKey } = await keyRes.json();
      if (!apiKey) throw new Error("API configuration missing. Check backend environment variables.");

      // 2. Direct upload to Gemini REST API to bypass Vercel 4.5MB Serverless Limit
      const uploadRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "raw",
          "X-Goog-Upload-Command": "start, upload, finalize",
          "X-Goog-Upload-Header-Content-Length": file.size.toString(),
          "X-Goog-Upload-Header-Content-Type": file.type || "application/pdf",
          "Content-Type": file.type || "application/pdf"
        },
        body: file
      });

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new Error(uploadData.error?.message || "Failed to upload file to Gemini directly");
      }

      // 3. Send the lightweight file URI reference to our Next.js backend for generative extraction
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileUri: uploadData.file.uri,
          mimeType: uploadData.file.mimeType
        })
      });

      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const textError = await response.text();
        throw new Error(`Server returned a non-JSON error (Status ${response.status}). This might be a Vercel Timeout (504): ${textError.substring(0, 100)}`);
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to extract data");
      }

      setResults(data.data);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  // Dynamically compute the columns (years) and rows (particulars) based on the actual result
  const years = results ? Object.keys(results.data || {}).sort((a, b) => Number(b) - Number(a)) : [];

  const allOrderedParticulars = (() => {
    if (!results) return [];
    const actualKeys = new Set<string>();
    for (const year of years) {
      Object.keys(results.data[year] || {}).forEach(k => actualKeys.add(k));
    }
    return Array.from(actualKeys);
  })();

  const handleDownloadCsv = () => {
    if (!results) return;

    // Create the header row: ["", "Particulars", "FY 25", "FY 24", ...]
    const headerRow = ["", "Particulars", ...years.map(y => `FY ${y.slice(-2)}`)];

    // Construct the data rows matching the example format
    const emptyTopRow = new Array(headerRow.length).fill("");
    const csvDataArray: any[] = [
      emptyTopRow, // Empty top row like in example
      headerRow
    ];

    for (const p of allOrderedParticulars) {
      const row = ["", p];
      let hasData = false;
      for (const year of years) {
        const val = results.data[year][p];
        if (val !== undefined && val !== null) {
          row.push(String(val));
          hasData = true;
        } else {
          row.push("");
        }
      }

      // Only add the row if there is at least one non-null value across all years
      if (hasData) {
        csvDataArray.push(row);
      }
    }

    // Add metadata at the bottom
    csvDataArray.push([]);
    csvDataArray.push(["", "Metadata", "Value"]);
    csvDataArray.push(["", "Currency", results.currency || "N/A"]);
    csvDataArray.push(["", "Units", results.units || "N/A"]);

    const csvData = Papa.unparse(csvDataArray);

    // Create a blob and download link
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "financial_data.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6 sm:p-12 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <div className={`w-full transition-all duration-500 ease-in-out ${results && !loading ? 'max-w-5xl' : 'max-w-xl'}`}>
        {/* Header Section */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center p-3 mb-5 bg-indigo-100 rounded-2xl shadow-sm">
            <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2">Document Extractor</h1>
          <p className="text-slate-500 text-lg">Upload business PDFs to instantly extract structural financial data.</p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100 transition-all duration-300 hover:shadow-2xl hover:shadow-slate-200/60">

          {/* Upload Area */}
          <div className="mb-8">
            <label
              className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-2xl cursor-pointer transition-colors duration-200 ease-in-out
                ${file ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400'}
              `}
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <svg className={`w-10 h-10 mb-3 ${file ? 'text-indigo-600' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="mb-2 text-sm text-slate-500">
                  <span className="font-semibold text-slate-700">{file ? file.name : "Click to upload"}</span> {file ? "" : "or drag and drop"}
                </p>
                <p className="text-xs text-slate-400">PDF documents only</p>
              </div>
              <input
                type="file"
                className="hidden"
                accept="application/pdf"
                onChange={handleFileChange}
              />
            </label>
          </div>

          {/* Action Button */}
          <button
            onClick={handleExtract}
            disabled={!file || loading}
            className={`w-full py-4 px-6 rounded-xl font-semibold text-white text-lg transition-all duration-300 transform
              ${loading
                ? 'bg-slate-400 cursor-not-allowed'
                : !file
                  ? 'bg-slate-300 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 hover:-translate-y-1 hover:shadow-lg focus:ring-4 focus:ring-indigo-100'
              }
            `}
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Extracting Financials...
              </span>
            ) : "Extract Financials"}
          </button>

          {/* Error Message */}
          {error && (
            <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start text-sm border border-red-100 animate-in fade-in slide-in-from-top-2 duration-300">
              <svg className="w-5 h-5 mr-3 flex-shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Results Area */}
          {results && !loading && (
            <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800">Extracted Results</h3>
                <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full flex items-center">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5"></span>
                  Verified
                </span>
              </div>

              <div className="mb-4 text-sm text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between">
                <div><span className="font-semibold">Currency:</span> {results.currency || "N/A"}</div>
                <div><span className="font-semibold">Units:</span> {results.units || "N/A"}</div>
              </div>

              <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Particulars</th>
                      {years.map(year => (
                        <th key={year} className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{year}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {allOrderedParticulars.map(p => {
                      // Check if there is data for this particular across all years before rendering
                      const hasData = years.some(year => {
                        const val = results.data[year]?.[p];
                        return val !== undefined && val !== null;
                      });

                      if (!hasData) return null;

                      return (
                        <tr key={p} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 whitespace-normal min-w-[200px] max-w-[400px] text-sm font-medium text-slate-900">{p}</td>
                          {years.map(year => {
                            const val = results.data[year]?.[p];
                            return (
                              <td key={year} className="px-6 py-4 whitespace-nowrap text-right font-mono text-sm text-slate-600">
                                {val !== undefined && val !== null ? val.toLocaleString() : "-"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <button
                onClick={handleDownloadCsv}
                className="w-full py-3 px-4 bg-white border-2 border-slate-200 text-slate-700 font-semibold rounded-xl text-md hover:border-slate-300 hover:bg-slate-50 transition-colors focus:ring-4 focus:ring-slate-100 flex items-center justify-center gap-2 group"
              >
                <svg className="w-5 h-5 text-slate-400 group-hover:text-slate-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download CSV
              </button>
            </div>
          )}

        </div>

        <p className="text-center mt-8 text-slate-400 text-sm">
          Built with Next.js, Tailwind CSS, & Gemini API
        </p>
      </div>
    </main>
  );
}
