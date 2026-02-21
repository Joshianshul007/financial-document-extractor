# Financial Document Extractor

An enterprise-grade, Next.js application that leverages the power of the Google Gemini AI (2.5 Flash) to instantly process, extract, and format complex financial data from large business PDFs (Income Statements, Profit & Loss etc.) into structured, downloadable CSV formats.

## 🚀 Key Features
- **Instant AI Extraction:** Uses `gemini-2.5-flash` to intelligently identify canonical financial fields (Revenue, EBITDA, Net Income, etc.) across multiple years.
- **Large File Handling (~20MB+):** Engineered with a custom direct-to-Google browser upload pipeline, completely bypassing the Vercel 4.5MB Serverless Function payload limit.
- **Dynamic Table Rendering:** Automatically generates flexible UI tables based on whatever years and data points the AI extracts from the uploaded document.
- **CSV Export:** One-click download of the extracted financial structured data into a pristine CSV format.
- **Edge Optimized:** Built with Next.js App Router and optimized for Vercel's global Serverless Edge Network with extended timeout configurations.

---

## 🏗️ Architecture & Vercel Payload Bypass
Typically, Vercel kills any `POST` request to an `/api/*` route that exceeds 4.5 MB with a `413 Payload Too Large` error. Because business PDFs can easily exceed 20 MB, this application utilizes a custom architecture:
1. **Secure Key Exchange:** The frontend cleanly fetches the `GEMINI_API_KEY` from a securely isolated, force-dynamic Next.js route (`/api/env`).
2. **Direct REST Upload:** The React client bypasses Vercel entirely, creating a raw HTTPS multiplex stream directly to `generativelanguage.googleapis.com` to safely transfer the 20MB file.
3. **Lightweight Edge Trigger:** Google responds to the browser with a `<100 byte` URI string. The browser passes *only* this string to the Next.js `route.ts`. 
4. **Serverless Extraction:** The Vercel Serverless Function (configured with `maxDuration: 60` and explicit CORS `OPTIONS` preflight headers) triggers the Gemini AI prompt natively using the URI.

---

## 💻 Tech Stack
- **Framework:** [Next.js 14](https://nextjs.org/) (App Router, Serverless API Routes)
- **Language:** TypeScript (.tsx, .ts)
- **Styling:** Tailwind CSS (Modern Glassmorphism UI)
- **AI Core:** Google Generative AI (`@google/generative-ai`)
- **CSV Parsing:** PapaParse

---

## 🛠️ Local Development Setup

### 1. Clone the repository
\`\`\`bash
git clone https://github.com/Joshianshul007/financial-document-extractor.git
cd webapp
\`\`\`

### 2. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 3. Configure Environment Variables
Create a `.env.local` file in the root of the `webapp` directory:
\`\`\`env
# You need an API Key from Google AI Studio
GEMINI_API_KEY="AIzaSyYourGeneratedGeminiKeyHere..."
\`\`\`

### 4. Run the Development Server
\`\`\`bash
npm run dev
\`\`\`
Navigate to `http://localhost:3000` to view the application.

---

## 🌐 Production Deployment (Vercel)

This project is fully optimized for 1-click Vercel deployments.

1. Push your code to GitHub.
2. Import the repository in the Vercel Dashboard.
3. **CRITICAL:** Under the **Environment Variables** section, add your `GEMINI_API_KEY`.
4. Deploy! Next.js will automatically utilize the configured `maxDuration` and `force-dynamic` settings mapped in the codebase to prevent 504 Timeouts and 405 Method errors.
