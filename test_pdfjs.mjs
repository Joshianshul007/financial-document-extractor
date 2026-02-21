import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function testPdf() {
    try {
        const buffer = fs.readFileSync('../multi_year_financial_report.pdf');
        const uint8Array = new Uint8Array(buffer);
        const doc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
        let text = '';
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ');
        }
        console.log('SUCCESS! Extracted length:', text.length);
        console.log('Snippet:', text.substring(0, 100));
    } catch (e) {
        console.error('FAIL:', e.message);
    }
}

testPdf();
