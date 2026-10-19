// ─────────────────────────────────────────────────────
//  Materio MCP Server — Direct Document Retrieval & In-PDF Answering Service
//  Directly fetches PDF documents from Materio CDN/API and extracts text
//  to ground answers when RAG / SnapSearch cannot locate the content.
// ─────────────────────────────────────────────────────

import { extractText } from "unpdf";
import {
  listResources,
  searchResources,
  buildPdfUrl,
  resolvePdfUrl,
  generateMaskedUrl,
} from "./resources.js";
import { CDN_BASE, CHARACTER_LIMIT, POINTER_THRESHOLD } from "../constants.js";

export interface DocumentQueryOptions {
  query?: string;
  topic?: string;
  subject?: string;
  semester?: string;
  page?: number;
  max_pages?: number;
  url?: string;
}

export interface DocumentPageResult {
  pageNumber: number;
  score?: number;
  text: string;
  matchedKeywords?: string[];
}

export interface DocumentQueryResult {
  found: boolean;
  semester?: string;
  subject?: string;
  topic?: string;
  totalPages: number;
  pdfUrl: string;
  shareLink?: string;
  mode: "query_match" | "specific_page" | "overview";
  query?: string;
  page?: number;
  pagesReturned: DocumentPageResult[];
  summaryText: string;
  errorMessage?: string;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "up", "about", "into", "over", "after",
  "what", "is", "are", "was", "were", "which", "how", "why", "when", "where",
  "who", "can", "could", "would", "should", "does", "do", "did", "explain",
  "describe", "detail", "definition", "state", "give", "write", "note", "between"
]);

function extractKeywords(query: string): string[] {
  const clean = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const words = clean.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return words.length > 0 ? words : clean.split(/\s+/).filter((w) => w.length > 1);
}

async function resolveMaskedShareUrl(shareUrl: string): Promise<string | null> {
  try {
    const parsed = new URL(shareUrl);
    const maskId = parsed.searchParams.get("share");
    if (!maskId) return null;
    const res = await fetch(
      `https://getmaterio.app/api/v2/features?action=pdf-share&subAction=resolve&maskId=${encodeURIComponent(maskId)}`
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data && (data.actualUrl || data.pdfPath)) {
        return data.actualUrl || data.pdfPath;
      }
    }
  } catch (err) {
    console.warn("[DocumentService] Failed to resolve masked share URL:", err);
  }
  return null;
}

async function locateDocument(opts: DocumentQueryOptions): Promise<{
  semester: string;
  subject: string;
  topic: string;
  resolvedPdfUrl: string;
} | null> {
  let targetUrl = opts.url?.trim();
  if (targetUrl) {
    if (targetUrl.includes("?share=")) {
      const resolved = await resolveMaskedShareUrl(targetUrl);
      if (resolved) targetUrl = resolved;
    }

    try {
      const u = new URL(targetUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      const pdfIdx = parts.indexOf("pdfs");
      if (pdfIdx !== -1 && parts.length >= pdfIdx + 3) {
        const sem = parts[pdfIdx + 1];
        const sub = decodeURIComponent(parts[pdfIdx + 2]).replace(/[-_]/g, " ");
        const top = decodeURIComponent(parts[parts.length - 1]).replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
        return {
          semester: sem,
          subject: sub,
          topic: top,
          resolvedPdfUrl: targetUrl,
        };
      }
    } catch {}

    return {
      semester: opts.semester || "unknown",
      subject: opts.subject || "unknown",
      topic: opts.topic || "Document",
      resolvedPdfUrl: targetUrl,
    };
  }

  const topicQuery = opts.topic?.trim() || "";
  const subjectQuery = opts.subject?.trim() || "";
  const semQuery = opts.semester?.trim() || "";

  if (!topicQuery && !subjectQuery) {
    return null;
  }

  // 1. If both semester and subject are provided, match resource topic
  if (semQuery && subjectQuery) {
    const items = await listResources(semQuery, subjectQuery);
    if (items.length > 0) {
      if (topicQuery) {
        const match = items.find(
          (i) =>
            i.topic.toLowerCase() === topicQuery.toLowerCase() ||
            i.topic.toLowerCase().includes(topicQuery.toLowerCase()) ||
            topicQuery.toLowerCase().includes(i.topic.toLowerCase())
        );
        if (match) {
          const resolvedPdfUrl = await resolvePdfUrl(match.semester, match.subject, match.topic);
          return { semester: match.semester, subject: match.subject, topic: match.topic, resolvedPdfUrl };
        }
      } else {
        const first = items[0];
        const resolvedPdfUrl = await resolvePdfUrl(first.semester, first.subject, first.topic);
        return { semester: first.semester, subject: first.subject, topic: first.topic, resolvedPdfUrl };
      }
    }
  }

  // 2. Search library for the topic name
  if (topicQuery) {
    const matches = await searchResources(topicQuery);
    const filtered = matches.filter((m) => {
      if (semQuery && m.semester !== semQuery) return false;
      if (subjectQuery && !m.subject.toLowerCase().includes(subjectQuery.toLowerCase())) return false;
      return true;
    });

    const candidate = filtered.length > 0 ? filtered[0] : matches[0];
    if (candidate) {
      const resolvedPdfUrl = await resolvePdfUrl(candidate.semester, candidate.subject, candidate.topic);
      return { semester: candidate.semester, subject: candidate.subject, topic: candidate.topic, resolvedPdfUrl };
    }
  }

  // 3. Fallback: search with subject
  if (subjectQuery) {
    const matches = await searchResources(subjectQuery);
    const candidate = semQuery ? matches.find((m) => m.semester === semQuery) : matches[0];
    if (candidate) {
      const resolvedPdfUrl = await resolvePdfUrl(candidate.semester, candidate.subject, candidate.topic);
      return { semester: candidate.semester, subject: candidate.subject, topic: candidate.topic, resolvedPdfUrl };
    }
  }

  return null;
}

async function fetchPdfBuffer(
  pdfUrl: string,
  semester?: string,
  subject?: string,
  topic?: string
): Promise<{ buffer: ArrayBuffer; finalUrl: string }> {
  let currentUrl = pdfUrl;
  let res = await fetch(currentUrl);

  if (!res.ok || res.headers.get("content-type")?.includes("text/html")) {
    if (semester && subject && topic && semester !== "unknown" && subject !== "unknown") {
      currentUrl = buildPdfUrl(semester, subject, topic, true);
      res = await fetch(currentUrl);
    } else if (currentUrl.includes("/pdfs/") && !currentUrl.includes("/api/pdfs/")) {
      currentUrl = currentUrl.replace(/\/pdfs\//, "/api/pdfs/");
      res = await fetch(currentUrl);
    }
  }

  if (!res.ok) {
    throw new Error(
      `Failed to download PDF document from ${currentUrl}: HTTP ${res.status} ${res.statusText}`
    );
  }

  let buffer = await res.arrayBuffer();

  // Handle Git LFS pointers (<= 2048 bytes or text/plain pointer)
  if (buffer.byteLength <= 2048) {
    const textSample = new TextDecoder().decode(buffer.slice(0, 100));
    if (textSample.includes("git-lfs") || textSample.includes("oid sha256")) {
      let apiUrl = "";
      if (semester && subject && topic && semester !== "unknown" && subject !== "unknown") {
        apiUrl = buildPdfUrl(semester, subject, topic, true);
      } else if (currentUrl.includes("/pdfs/") && !currentUrl.includes("/api/pdfs/")) {
        apiUrl = currentUrl.replace(/\/pdfs\//, "/api/pdfs/");
      }
      if (apiUrl && apiUrl !== currentUrl) {
        const apiRes = await fetch(apiUrl);
        if (apiRes.ok) {
          const apiBuf = await apiRes.arrayBuffer();
          if (apiBuf.byteLength > 2048) {
            return { buffer: apiBuf, finalUrl: apiUrl };
          }
        }
      }
    }
  }

  return { buffer, finalUrl: currentUrl };
}

export async function fetchAndAnalyzeDocument(
  opts: DocumentQueryOptions
): Promise<DocumentQueryResult> {
  const located = await locateDocument(opts);

  if (!located) {
    return {
      found: false,
      totalPages: 0,
      pdfUrl: "",
      mode: "overview",
      pagesReturned: [],
      summaryText: "",
      errorMessage: `Could not locate document. Please provide a valid 'topic', 'subject', or direct 'url'. Try using 'resource_library' or 'finder' to explore available chapters and topics.`,
    };
  }

  const { semester, subject, topic, resolvedPdfUrl } = located;

  // 1. Fetch the PDF binary buffer with pointer resolution
  const { buffer, finalUrl } = await fetchPdfBuffer(
    resolvedPdfUrl,
    semester,
    subject,
    topic
  );

  // 2. Extract text from the PDF using unpdf
  const { totalPages, text } = await extractText(buffer);
  const pageTexts: string[] = Array.isArray(text) ? text : [text];

  // 3. Generate verified share link for the user
  let shareLink = "";
  try {
    shareLink = await generateMaskedUrl(finalUrl);
  } catch {
    shareLink = "";
  }

  const requestedPage = opts.page;
  const query = opts.query?.trim();
  const maxPages = Math.min(Math.max(opts.max_pages ?? 4, 1), 10);

  // Mode A: User requested a specific 1-based page
  if (typeof requestedPage === "number" && requestedPage > 0) {
    if (requestedPage > totalPages) {
      return {
        found: true,
        semester,
        subject,
        topic,
        totalPages,
        pdfUrl: finalUrl,
        shareLink,
        mode: "specific_page",
        page: requestedPage,
        pagesReturned: [],
        summaryText: `Requested page ${requestedPage} exceeds total document pages (${totalPages}).`,
      };
    }

    const pageContent = (pageTexts[requestedPage - 1] || "").trim();
    const pageResult: DocumentPageResult = {
      pageNumber: requestedPage,
      text: pageContent || "(Blank or scanned image page - no raw text detected)",
    };

    let summaryText = `## Document: ${topic} (${subject}, Semester ${semester})\n` +
      `**Page:** ${requestedPage} of ${totalPages}\n` +
      (shareLink ? `**Share Link:** ${shareLink}\n\n` : "\n") +
      `### Page ${requestedPage} Content:\n\n${pageResult.text}`;

    if (summaryText.length > CHARACTER_LIMIT) {
      summaryText = summaryText.slice(0, CHARACTER_LIMIT - 100) + "\n\n... (content truncated)";
    }

    return {
      found: true,
      semester,
      subject,
      topic,
      totalPages,
      pdfUrl: finalUrl,
      shareLink,
      mode: "specific_page",
      page: requestedPage,
      pagesReturned: [pageResult],
      summaryText,
    };
  }

  // Mode B: Keyword / Concept In-Document Search
  if (query) {
    const keywords = extractKeywords(query);
    const exactQuery = query.toLowerCase();

    interface ScoredPage {
      pageNumber: number;
      score: number;
      matchedKeywords: string[];
      text: string;
    }

    const scoredPages: ScoredPage[] = [];

    pageTexts.forEach((pText, idx) => {
      const pageNum = idx + 1;
      const cleanText = (pText || "").trim();
      if (!cleanText) return;

      const lower = cleanText.toLowerCase();
      let score = 0;
      const matchedKw: string[] = [];

      // Check exact query match
      if (lower.includes(exactQuery)) {
        score += 20;
      }

      // Check individual keywords
      for (const kw of keywords) {
        const matches = lower.split(kw).length - 1;
        if (matches > 0) {
          score += matches * 3;
          matchedKw.push(kw);
        }
      }

      // Bonus if all distinct keywords are present on the same page
      if (keywords.length > 1 && matchedKw.length === keywords.length) {
        score += 15;
      }

      if (score > 0) {
        scoredPages.push({
          pageNumber: pageNum,
          score,
          matchedKeywords: matchedKw,
          text: cleanText,
        });
      }
    });

    scoredPages.sort((a, b) => b.score - a.score);

    const topPages = scoredPages.slice(0, maxPages);

    if (topPages.length > 0) {
      let formattedPages = topPages.map((p) => {
        return `### Page ${p.pageNumber} of ${totalPages} (Relevance Score: ${p.score}, Matched: ${p.matchedKeywords.join(", ")})\n\n${p.text}`;
      }).join("\n\n---\n\n");

      let summaryText = `## Document Grounding: ${topic} (${subject}, Semester ${semester})\n` +
        `**Query:** "${query}"\n` +
        `**Matched Pages:** ${topPages.map((p) => `Page ${p.pageNumber}`).join(", ")} (out of ${totalPages} total pages)\n` +
        (shareLink ? `**Share Link:** ${shareLink}\n\n` : "\n") +
        `Use the authentic text excerpts below from the official course PDF to formulate an accurate answer:\n\n${formattedPages}`;

      if (summaryText.length > CHARACTER_LIMIT) {
        summaryText = summaryText.slice(0, CHARACTER_LIMIT - 100) + "\n\n... (content truncated)";
      }

      return {
        found: true,
        semester,
        subject,
        topic,
        totalPages,
        pdfUrl: finalUrl,
        shareLink,
        mode: "query_match",
        query,
        pagesReturned: topPages.map((p) => ({
          pageNumber: p.pageNumber,
          score: p.score,
          text: p.text,
          matchedKeywords: p.matchedKeywords,
        })),
        summaryText,
      };
    } else {
      // No exact keyword matches found across the document
      const fallbackPages = pageTexts.slice(0, 3).map((t, idx) => ({
        pageNumber: idx + 1,
        text: (t || "").trim() || "(Blank page)",
      }));

      const summaryText = `## Document: ${topic} (${subject}, Semester ${semester})\n` +
        `**Query:** "${query}"\n` +
        `**Notice:** No direct keyword matches for "${query}" were found in this document (${totalPages} pages total).\n` +
        (shareLink ? `**Share Link:** ${shareLink}\n\n` : "\n") +
        `### First ${fallbackPages.length} Pages Overview:\n\n` +
        fallbackPages.map((p) => `#### Page ${p.pageNumber}\n${p.text.slice(0, 800)}...`).join("\n\n");

      return {
        found: true,
        semester,
        subject,
        topic,
        totalPages,
        pdfUrl: finalUrl,
        shareLink,
        mode: "query_match",
        query,
        pagesReturned: fallbackPages,
        summaryText,
      };
    }
  }

  // Mode C: Document Overview / First Few Pages
  const previewPagesCount = Math.min(3, totalPages);
  const previewPages = pageTexts.slice(0, previewPagesCount).map((t, idx) => ({
    pageNumber: idx + 1,
    text: (t || "").trim() || "(Blank page)",
  }));

  let summaryText = `## Document: ${topic} (${subject}, Semester ${semester})\n` +
    `**Total Pages:** ${totalPages}\n` +
    (shareLink ? `**Share Link:** ${shareLink}\n\n` : "\n") +
    `### Overview (Pages 1–${previewPagesCount}):\n\n` +
    previewPages.map((p) => `#### Page ${p.pageNumber}\n${p.text}`).join("\n\n---\n\n") +
    `\n\n*Tip: Call 'get_document' with a specific 'query' or 'page' number to inspect targeted sections.*`;

  if (summaryText.length > CHARACTER_LIMIT) {
    summaryText = summaryText.slice(0, CHARACTER_LIMIT - 100) + "\n\n... (content truncated)";
  }

  return {
    found: true,
    semester,
    subject,
    topic,
    totalPages,
    pdfUrl: finalUrl,
    shareLink,
    mode: "overview",
    pagesReturned: previewPages,
    summaryText,
  };
}
