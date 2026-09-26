import { z } from "zod";
import htmlToDocx from "html-to-docx";
import { marked } from "marked";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export const generateDocumentTool = {
  name: "generate_document",
  description: `Generates a PDF, DOCX, or MD file from Markdown content and uploads it to Supabase.
Use this tool when the user requests a downloadable file.
For basic PDF/DOCX generation, use this tool. For highly customized styling, use the execute_js sandbox instead.
Returns a markdown link in the format: [Document: <format> | <title>](<url>) which the frontend will parse into a Document Card.`,
  inputSchema: {
    content: z.string().describe("The Markdown content of the document."),
    format: z.enum(["pdf", "docx", "md"]).describe("The desired output format."),
    title: z.string().describe("The title of the document (used for filename)."),
  },
};

export async function handleGenerateDocument(args: { content: string; format: string; title: string }) {
  const { content, format, title } = args;

  if (!supabase) {
    return {
      content: [{ type: "text" as const, text: "Error: Supabase is not configured on this server." }],
      isError: true,
    };
  }

  try {
    let buffer: Buffer;
    let contentType: string;
    
    // clean title for filename
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
    const filename = `${safeTitle}-${Date.now()}.${format}`;

    if (format === "md") {
      buffer = Buffer.from(content, "utf-8");
      contentType = "text/markdown";
    } else if (format === "docx") {
      const html = await marked(content);
      const docxBuffer = await htmlToDocx(html);
      if (!docxBuffer) throw new Error("Failed to generate DOCX.");
      buffer = Buffer.from(docxBuffer as ArrayBuffer);
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (format === "pdf") {
      // Basic PDF generation fallback if they didn't use execute_js
      // We'll use pdfkit for a very basic rendering of the text since we don't have md-to-pdf here
      const PDFDocument = require('pdfkit');
      buffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument();
        const chunks: any[] = [];
        doc.on('data', (chunk: any) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        
        doc.fontSize(18).text(title, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(content); // Note: PDFKit doesn't parse markdown natively
        doc.end();
      });
      contentType = "application/pdf";
    } else {
      throw new Error("Unsupported format");
    }

    let res = await supabase.storage.from("artifacts").upload(filename, buffer, { contentType, upsert: true });
    
    if (res.error && res.error.message.includes("Bucket not found")) {
      await supabase.storage.createBucket("artifacts", { public: true });
      res = await supabase.storage.from("artifacts").upload(filename, buffer, { contentType, upsert: true });
    }
    
    if (res.error) {
      throw res.error;
    }

    const { data } = supabase.storage.from("artifacts").getPublicUrl(filename);
    
    return {
      content: [{ type: "text" as const, text: `[Document: ${format} | ${title}](${data.publicUrl})` }],
    };
  } catch (err: any) {
    return {
      content: [{ type: "text" as const, text: `Error generating document: ${err.message}` }],
      isError: true,
    };
  }
}
