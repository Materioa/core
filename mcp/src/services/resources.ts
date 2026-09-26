// ─────────────────────────────────────────────────────
//  Resource Library Service
//  Fetches, caches, and queries the resource index
// ─────────────────────────────────────────────────────

import {
  CDN_BASE,
  API_BASE,
  RESOURCE_LIB_URL,
  POINTER_THRESHOLD,
  CACHE_TTL,
} from "../constants.js";
import type { ResourceLibrary, ResourceItem } from "../types.js";

let cachedLib: ResourceLibrary | null = null;
let cacheTimestamp = 0;

/**
 * Slugify a topic name to be used in the URL path.
 * Strips special characters and replaces spaces with hyphens or URL encodes.
 */
function slugify(text: string): string {
  return encodeURIComponent(text.trim());
}

/**
 * Fetch the resource library index with in-memory caching.
 */
export async function getResourceLibrary(): Promise<ResourceLibrary> {
  const now = Date.now();
  if (cachedLib && now - cacheTimestamp < CACHE_TTL) {
    return cachedLib;
  }

  const res = await fetch(RESOURCE_LIB_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch resource library: ${res.status} ${res.statusText}`
    );
  }
  cachedLib = (await res.json()) as ResourceLibrary;
  cacheTimestamp = now;
  return cachedLib;
}

/**
 * Build the correct PDF URL for a given resource item.
 * – Direct CDN path:  /pdfs/{sem}/{subject}/{topic}.pdf
 * – API proxy path:   /api/pdfs/{sem}/{subject}/{topic}.pdf  (for pointers / small files)
 *
 * We do a lightweight HEAD request to detect pointer files.
 */
export function buildPdfUrl(
  semester: string,
  subject: string,
  topic: string,
  useApi: boolean = false
): string {
  const base = useApi ? API_BASE : CDN_BASE;
  const prefix = useApi ? "/api/pdfs" : "/pdfs";
  if (semester === "9999") {
    return `${base}${prefix}/${semester}/${slugify(subject)}/vault/${slugify(topic)}.pdf`;
  }
  return `${base}${prefix}/${slugify(semester)}/${slugify(subject)}/${slugify(topic)}.pdf`;
}

export async function generateMaskedUrl(actualUrl: string): Promise<string> {
  const trimmed = (actualUrl || "").trim();

  // HARD GUARDRAIL: Never accept an empty URL
  if (!trimmed) {
    throw new Error("HARD GUARDRAIL: actualUrl is required to generate a masked share link.");
  }

  // HARD GUARDRAIL: Reject already-masked share links to prevent recursion / invalid links
  if (
    trimmed.includes("?share=") ||
    trimmed.includes("getmaterio.app/?share=") ||
    trimmed.includes("materioa.vercel.app/?share=")
  ) {
    throw new Error(
      "HARD GUARDRAIL: Cannot generate a share link from an existing masked share link (contains '?share='). " +
      "Masked share links are end-user web pages, not raw PDF assets. Provide the real PDF document URL or semester, subject, and topic instead."
    );
  }

  // HARD GUARDRAIL: Validate URL structure (must be http/https, reject fake/placeholder protocols)
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Protocol must be http or https");
    }
  } catch {
    throw new Error(
      `HARD GUARDRAIL: Invalid URL provided for share link generation: "${trimmed}". Do NOT hallucinate or guess fake URLs.`
    );
  }

  // HARD GUARDRAIL: Must actually call the canonical API
  const apiUrl = "https://getmaterio.app/api/v2/features?action=pdf-share&subAction=create";
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actualUrl: trimmed }),
    });
  } catch (netErr: any) {
    throw new Error(
      `HARD GUARDRAIL: Network failure connecting to share link API: ${netErr?.message || netErr}. Do NOT guess or hallucinate pseudo links.`
    );
  }

  if (!response.ok) {
    throw new Error(
      `HARD GUARDRAIL: Share link API returned error status ${response.status} (${response.statusText}). ` +
      `Failed to generate verified share link. Do NOT hallucinate or guess pseudo links.`
    );
  }

  const data = (await response.json()) as any;
  if (!data || typeof data.maskId !== "string" || !data.maskId.trim()) {
    throw new Error(
      "HARD GUARDRAIL: Share link API response did not return a valid maskId. " +
      "Cannot construct verified share link. Do NOT hallucinate or guess pseudo links."
    );
  }

  const maskId = data.maskId.trim();
  // Strictly construct the verified masked share link
  return `https://getmaterio.app/?share=${encodeURIComponent(maskId)}`;
}

/**
 * Try direct CDN first; if the file is a pointer (≤ 1 KB), fall back to the API proxy.
 */
export async function resolvePdfUrl(
  semester: string,
  subject: string,
  topic: string
): Promise<string> {
  const directUrl = buildPdfUrl(semester, subject, topic, false);
  try {
    const head = await fetch(directUrl, { method: "HEAD" });
    const contentLength = Number(head.headers.get("content-length") ?? 0);
    if (!head.ok || contentLength <= POINTER_THRESHOLD) {
      return buildPdfUrl(semester, subject, topic, true);
    }
    return directUrl;
  } catch {
    // Network error — fall back to API proxy
    return buildPdfUrl(semester, subject, topic, true);
  }
}

/**
 * List all semesters available in the library.
 */
export async function listSemesters(): Promise<string[]> {
  const lib = await getResourceLibrary();
  return Object.keys(lib).sort((a, b) => Number(a) - Number(b));
}

/**
 * List all subjects for a given semester.
 */
export async function listSubjects(semester: string): Promise<string[]> {
  const lib = await getResourceLibrary();
  const sem = lib[semester];
  if (!sem) return [];
  return Object.keys(sem);
}

/**
 * List all resource sections for a given semester + subject.
 */
export async function listResources(
  semester: string,
  subject: string
): Promise<ResourceItem[]> {
  const lib = await getResourceLibrary();
  const sem = lib[semester];
  if (!sem) return [];

  // Fuzzy-match the subject name (case-insensitive, partial)
  const subKey = Object.keys(sem).find(
    (k) =>
      k.toLowerCase() === subject.toLowerCase() ||
      k.toLowerCase().includes(subject.toLowerCase())
  );
  if (!subKey) return [];

  const sections = sem[subKey];
  const items: ResourceItem[] = [];

  for (const section of sections) {
    for (const topic of section.content) {
      items.push({
        semester,
        subject: subKey,
        sectionType: section.type,
        topic,
        pdfUrl: buildPdfUrl(semester, subKey, topic, false),
      });
    }
  }
  return items;
}

/**
 * Search across ALL semesters / subjects / topics for a query string.
 */
export async function searchResources(query: string): Promise<ResourceItem[]> {
  const lib = await getResourceLibrary();
  const q = query.toLowerCase();
  const results: ResourceItem[] = [];

  for (const [semester, subjects] of Object.entries(lib)) {
    for (const [subject, sections] of Object.entries(subjects)) {
      // Match subject name
      const subjectMatch = subject.toLowerCase().includes(q);

      for (const section of sections) {
        // Match section type
        const typeMatch = section.type.toLowerCase().includes(q);

        for (const topic of section.content) {
          const topicMatch = topic.toLowerCase().includes(q);

          if (subjectMatch || typeMatch || topicMatch) {
            results.push({
              semester,
              subject,
              sectionType: section.type,
              topic,
              pdfUrl: buildPdfUrl(semester, subject, topic, false),
            });
          }
        }
      }
    }
  }
  return results;
}

/**
 * Get a flattened index of everything in the library.
 */
export async function getFullIndex(): Promise<
  Array<{
    semester: string;
    subject: string;
    sections: Array<{ type: string; count: number }>;
  }>
> {
  const lib = await getResourceLibrary();
  const result: Array<{
    semester: string;
    subject: string;
    sections: Array<{ type: string; count: number }>;
  }> = [];

  for (const [semester, subjects] of Object.entries(lib)) {
    for (const [subject, sections] of Object.entries(subjects)) {
      result.push({
        semester,
        subject,
        sections: sections.map((s) => ({ type: s.type, count: s.content.length })),
      });
    }
  }
  return result;
}

export interface ExploreLibraryParams {
  semester?: string;
  subject?: string;
  topic?: string;
  search?: string;
}

/**
 * Unified library exploration service powering the consolidated ResourceLibrary tool.
 * Evaluates options hierarchically and returns structured curriculum data.
 */
export async function exploreLibrary(params: ExploreLibraryParams = {}) {
  const lib = await getResourceLibrary();
  const { semester, subject, topic, search } = params;

  // 1. Search mode: match query across all semesters, subjects, sections, topics
  if (search && search.trim().length >= 2) {
    const q = search.trim().toLowerCase();
    const matches: Array<{ semester: string; subject: string; sectionType: string; topic: string }> = [];

    for (const [sem, subjects] of Object.entries(lib)) {
      if (semester && sem !== semester.trim()) continue;
      for (const [sub, sections] of Object.entries(subjects)) {
        if (subject && !sub.toLowerCase().includes(subject.trim().toLowerCase())) continue;
        const subMatch = sub.toLowerCase().includes(q);

        for (const sec of sections) {
          const typeMatch = sec.type.toLowerCase().includes(q);
          for (const top of sec.content) {
            const topMatch = top.toLowerCase().includes(q);
            if (subMatch || typeMatch || topMatch) {
              matches.push({ semester: sem, subject: sub, sectionType: sec.type, topic: top });
            }
          }
        }
      }
    }

    return {
      mode: "search" as const,
      query: search,
      totalMatches: matches.length,
      matches: matches.slice(0, 30),
      truncated: matches.length > 30,
      hint: "Use subject and topic names with SnapSearch or DeepThink to retrieve study content.",
    };
  }

  // 2. Topic inspection mode: locate a specific topic and return its context
  if (topic && topic.trim()) {
    const q = topic.trim().toLowerCase();
    let foundMatch: {
      semester: string;
      subject: string;
      sectionType: string;
      topic: string;
      siblingTopics: string[];
      availableSections: string[];
    } | null = null;

    for (const [sem, subjects] of Object.entries(lib)) {
      if (semester && sem !== semester.trim()) continue;
      for (const [sub, sections] of Object.entries(subjects)) {
        if (subject && !sub.toLowerCase().includes(subject.trim().toLowerCase())) continue;

        for (const sec of sections) {
          const exact = sec.content.find((t) => t.toLowerCase() === q);
          const partial = sec.content.find((t) => t.toLowerCase().includes(q));
          const matchedTopic = exact || partial;

          if (matchedTopic) {
            foundMatch = {
              semester: sem,
              subject: sub,
              sectionType: sec.type,
              topic: matchedTopic,
              siblingTopics: sec.content.filter((t) => t !== matchedTopic),
              availableSections: sections.map((s) => s.type),
            };
            break;
          }
        }
        if (foundMatch) break;
      }
      if (foundMatch) break;
    }

    if (foundMatch) {
      return {
        mode: "topic" as const,
        found: true,
        ...foundMatch,
        hint: "Use SnapSearch or DeepThink for content text. Use ShareLinkGenerator for a user share link.",
      };
    }

    return {
      mode: "topic" as const,
      found: false,
      query: topic,
      message: `Topic "${topic}" was not found in the library. Try searching with a shorter keyword using the 'search' parameter.`,
    };
  }

  // 3. Subject mode: return all categorized sections and topics for a subject
  if (subject && subject.trim()) {
    const q = subject.trim().toLowerCase();
    let matchedSem = semester?.trim();
    let matchedSub: string | null = null;
    let sectionsList: Array<{ type: string; content: string[] }> | null = null;

    if (matchedSem && lib[matchedSem]) {
      const foundKey = Object.keys(lib[matchedSem]).find(
        (k) => k.toLowerCase() === q || k.toLowerCase().includes(q)
      );
      if (foundKey) {
        matchedSub = foundKey;
        sectionsList = lib[matchedSem][foundKey];
      }
    } else {
      // Auto-detect semester across all semesters
      for (const [sem, subjects] of Object.entries(lib)) {
        const foundKey = Object.keys(subjects).find(
          (k) => k.toLowerCase() === q || k.toLowerCase().includes(q)
        );
        if (foundKey) {
          matchedSem = sem;
          matchedSub = foundKey;
          sectionsList = subjects[foundKey];
          break;
        }
      }
    }

    if (matchedSem && matchedSub && sectionsList) {
      const grouped: Record<string, string[]> = {};
      let totalTopics = 0;
      for (const sec of sectionsList) {
        grouped[sec.type] = sec.content;
        totalTopics += sec.content.length;
      }

      return {
        mode: "subject" as const,
        semester: matchedSem,
        subject: matchedSub,
        totalResources: totalTopics,
        sections: grouped,
        hint: "To read course material for any topic, call SnapSearch or DeepThink with the exact topic name.",
      };
    }

    return {
      mode: "subject" as const,
      found: false,
      message: `Subject "${subject}" was not found${semester ? ` in semester ${semester}` : ""}. Call ResourceLibrary without parameters to see all available subjects.`,
    };
  }

  // 4. Semester mode: list all subjects in that semester
  if (semester && semester.trim()) {
    const sem = semester.trim();
    const semData = lib[sem];

    if (!semData) {
      const available = Object.keys(lib).sort((a, b) => Number(a) - Number(b));
      return {
        mode: "semester" as const,
        found: false,
        message: `Semester "${semester}" was not found. Available semesters: ${available.join(", ")}`,
      };
    }

    const subjects = Object.entries(semData).map(([name, sections]) => ({
      name,
      sectionTypes: sections.map((s) => s.type),
      totalTopics: sections.reduce((acc, s) => acc + s.content.length, 0),
    }));

    return {
      mode: "semester" as const,
      semester: sem,
      totalSubjects: subjects.length,
      subjects,
      hint: `Pass { semester: "${sem}", subject: "<subject_name>" } to view all chapters and question banks.`,
    };
  }

  // 5. Overview mode: list all available semesters and their subjects
  const sortedSemesters = Object.keys(lib).sort((a, b) => Number(a) - Number(b));
  const curriculum = sortedSemesters.map((sem) => ({
    semester: sem,
    subjectCount: Object.keys(lib[sem] || {}).length,
    subjects: Object.keys(lib[sem] || {}),
  }));

  return {
    mode: "overview" as const,
    totalSemesters: sortedSemesters.length,
    availableSemesters: sortedSemesters,
    curriculum,
    hint: "Pass { semester: '...' } to view a semester, { subject: '...' } to view chapters, or { search: '...' } to find a specific topic.",
  };
}
