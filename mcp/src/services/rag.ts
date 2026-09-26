import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { searchResources } from "./resources.js";

let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (supabase) return supabase;

  const supabaseUrl =
    process.env.RAG_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "https://qtoahtjjjoahjgfqydsg.supabase.co";
  const supabaseKey =
    process.env.RAG_SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0b2FodGpqam9haGpnZnF5ZHNnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkwMzU5NiwiZXhwIjoyMDg5NDc5NTk2fQ.td7PklZm3joPdlIJH31C7wh4VAnM47MssbfenhXe-MA";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials (SUPABASE_URL and SUPABASE_SERVICE_KEY) are not set.");
  }

  supabase = createClient(supabaseUrl, supabaseKey);
  return supabase;
}

function getPerplexityKey(): string {
  const key = process.env.PERPLEXITY_API_KEY || "";
  if (!key) {
    throw new Error("PERPLEXITY_API_KEY environment variable is not set.");
  }
  return key;
}

function getSemanticMatchThreshold(): number {
  const value = Number(process.env.SEMANTIC_MATCH_THRESHOLD ?? 0.3);
  if (!Number.isFinite(value)) {
    throw new Error("SEMANTIC_MATCH_THRESHOLD must be a valid number.");
  }
  return value;
}

function normalizeSemester(semester: string): string {
  const match = semester.trim().match(/\d+/);
  return match ? match[0] : semester.trim();
}

async function resolveCanonicalSubject(
  client: SupabaseClient,
  semester: string,
  subject: string
): Promise<string> {
  const trimmedSubject = subject.trim();
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const requested = normalize(trimmedSubject);

  const { data, error } = await client
    .from("materio_chunks")
    .select("subject")
    .eq("semester", semester)
    .limit(1000);

  if (error || !data) {
    return trimmedSubject;
  }

  const subjects = [...new Set(data.map((row: any) => String(row.subject)))];
  return (
    subjects.find((candidate) => normalize(candidate) === requested) ||
    subjects.find((candidate) => normalize(candidate).includes(requested)) ||
    subjects.find((candidate) => requested.includes(normalize(candidate))) ||
    trimmedSubject
  );
}

export interface RagResult {
  content: string;
  topic: string;
  subject: string;
  similarity: number;
}

/**
 * Gets embeddings from Perplexity API
 */
async function getPerplexityEmbedding(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Perplexity embedding input is empty.");
  }
  const apiKey = getPerplexityKey();
  const url = "https://api.perplexity.ai/v1/contextualizedembeddings";

  const isValidNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

  const coerceEmbedding = (embedding: unknown): number[] | null => {
    if (Array.isArray(embedding)) {
      if (!embedding.every(isValidNumber)) return null;
      return embedding as number[];
    }

    if (typeof embedding === "string") {
      const buffer = Buffer.from(embedding, "base64");
      return Array.from(new Int8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    }

    return null;
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [[trimmed]],
      model: "pplx-embed-context-v1-0.6b",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as any;
  const embedding = coerceEmbedding(result?.data?.[0]?.data?.[0]?.embedding);
  if (embedding) {
    return embedding;
  }

  throw new Error("Could not extract embedding from Perplexity API response. Unexpected response format.");
}

/**
 * Performs a vector search against Supabase pgvector with fallback to resource library
 */
export async function queryDeepThinkRAG(
  query: string,
  semester: string,
  subject: string,
  matchCount: number = 5
): Promise<RagResult[]> {
  try {
    const client = getSupabaseClient();
    const normalizedSemester = normalizeSemester(semester);
    const canonicalSubject = await resolveCanonicalSubject(client, normalizedSemester, subject);

    // 1. Generate embedding for user query
    const queryEmbedding = await getPerplexityEmbedding(query);

    // 2. Perform vector search in Supabase using pgvector
    const { data, error } = await client.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: getSemanticMatchThreshold(),
      match_count: matchCount,
      filter_semester: normalizedSemester,
      filter_subject: canonicalSubject
    });

    if (!error && data && data.length > 0) {
      return data.map((row: any) => ({
        content: row.chunk_text,
        topic: row.topic,
        subject: row.subject,
        similarity: row.similarity
      }));
    }
  } catch (err) {
    console.warn("[DeepThinkRAG] Supabase vector search unavailable, falling back to vectorless/resource library:", err);
  }

  // Graceful fallback: Vectorless / Resource library search
  return queryVectorlessRAG(query, semester, subject, matchCount);
}

/**
 * Performs a fast text-based search using Supabase Full-Text Search (tsvector) with fallback to resource library
 */
export async function queryVectorlessRAG(
  query: string,
  semester?: string,
  subject?: string,
  matchCount: number = 10
): Promise<RagResult[]> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client.rpc("search_vectorless", {
      query_text: query,
      filter_semester: semester || null,
      filter_subject: subject || null,
      match_count: matchCount
    });

    if (!error && data && data.length > 0) {
      return data.map((row: any) => ({
        content: row.chunk_text,
        topic: row.topic,
        subject: row.subject,
        similarity: row.similarity
      }));
    }

    if (semester || subject) {
      const { data: fallbackData, error: fallbackError } = await client.rpc("search_vectorless", {
        query_text: query,
        filter_semester: null,
        filter_subject: null,
        match_count: matchCount
      });

      if (!fallbackError && fallbackData && fallbackData.length > 0) {
        return fallbackData.map((row: any) => ({
          content: row.chunk_text,
          topic: row.topic,
          subject: row.subject,
          similarity: row.similarity
        }));
      }
    }
  } catch (err) {
    console.warn("[VectorlessRAG] Supabase search_vectorless unavailable, falling back to resource index:", err);
  }

  // Fallback: search in-memory resource library index directly
  try {
    const matches = await searchResources(query);
    const filtered = matches.filter((m) => {
      if (semester && !m.semester.toLowerCase().includes(semester.toLowerCase())) return false;
      if (subject && !m.subject.toLowerCase().includes(subject.toLowerCase())) return false;
      return true;
    });
    const pool = filtered.length > 0 ? filtered : matches;
    return pool.slice(0, matchCount).map((item, idx) => ({
      content: `[Resource Library Match]\nSubject: ${item.subject}\nTopic: ${item.topic}\nSemester: ${item.semester}\nSection: ${item.sectionType}\nPDF Document Link: ${item.pdfUrl}`,
      topic: item.topic,
      subject: item.subject,
      similarity: Number((0.95 - idx * 0.05).toFixed(2)),
    }));
  } catch (fallbackErr) {
    console.error("[VectorlessRAG] Resource library search fallback error:", fallbackErr);
    return [];
  }
}
