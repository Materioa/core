// ─────────────────────────────────────────────────────
//  Materio MCP Tools — Course Material Operations
// ─────────────────────────────────────────────────────

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  exploreLibrary,
  listResources,
  resolvePdfUrl,
  generateMaskedUrl,
} from "../services/resources.js";
import { findResources } from "../services/finder.js";
import { queryDeepThinkRAG, queryVectorlessRAG } from "../services/rag.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { lookupExternalSources } from "../services/external-lookup.js";
import {
  type MaterioProtectedUser,
  type AccessTier,
  validateToken,
  checkToolAccess,
} from "../services/materio-auth.js";
import fs from "fs";
import { fileURLToPath } from "url";

const PROMPT_FILES: Array<{ name: string; title: string; description: string; file: string }> = [];

function readPromptFile(fileName: string): string {
  try {
    if (typeof import.meta.url === "string" && import.meta.url.startsWith("file:")) {
      const p = fileURLToPath(new URL(`../../prompts/${fileName}`, import.meta.url));
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
    }
  } catch {
    // ignore in environments without local file access (e.g. Cloudflare Workers)
  }
  return "";
}

function registerPromptFiles(server: McpServer): void {
  for (const prompt of PROMPT_FILES) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
      },
      () => {
        const text = readPromptFile(prompt.file);
        return {
          description: prompt.description,
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: text || `Prompt file not found: prompts/${prompt.file}`,
              },
            },
          ],
        };
      }
    );
  }
}


const DIAGRAM_INTENT_PATTERN = /(?:^|\b)(draw|diagram|visualize|render|flowchart|mermaid|graphviz|dot|svg|dfa|fsm|automaton|state machine|circuit|gantt|timeline|logic gate|schemdraw|matplotlib|plot|chart)(?:\b|$)/i;

function isDiagramIntent(query: string): boolean {
  return DIAGRAM_INTENT_PATTERN.test(query);
}

// ────────── Schemas ──────────

const ResourceLibrarySchema = {
  semester: z
    .string()
    .optional()
    .describe("Optional semester number (e.g. '1', '2', '3', '4', '5', '6', '7', '9')."),
  subject: z
    .string()
    .optional()
    .describe("Optional subject name or partial match (e.g. 'Operating System', 'DBMS'). If semester is omitted, auto-locates the subject across all semesters."),
  topic: z
    .string()
    .optional()
    .describe("Optional topic or chapter name to locate. Returns its section type, subject, semester, and related sibling topics."),
  search: z
    .string()
    .optional()
    .describe("Optional keyword query to search across all semesters, subjects, sections, and topics in the library."),
};

const FinderSchema = {
  query: z
    .string()
    .min(2, "Query must be at least 2 characters")
    .describe(
      "Concept, keyword, or question to find matching course resources for (e.g. 'cpu scheduling algorithms', 'deadlocks', 'fode matrices')."
    ),
  semester: z
    .string()
    .optional()
    .describe("Optional semester number (e.g. '4', '7') to prioritize or narrow results."),
};

const DeepThinkSchema = {
  query: z.string().describe("The user's specific question that requires deep RAG search"),
  semester: z.string().describe("Semester number"),
  subject: z.string().describe("Subject name to scope the search context"),
  authToken: z
    .string()
    .optional()
    .describe(
      "Optional Materio ID token or handoff code if not provided via HTTP Authorization header."
    ),
};

const VectorlessSearchSchema = {
  query: z.string().describe("Search keywords or query string. MANDATORY: You MUST run this tool to retrieve real context before answering ANY course/content query. DO NOT self-answer from weights."),
  semester: z.string().optional().describe("Optional semester number (e.g. '7') to limit results and improve precision."),
  subject: z.string().optional().describe("Optional subject name (e.g. 'Information and Network Security') to scope the search context."),
  page: z.number().int().min(1).optional().describe("Result page number. Start at 1, increment to fetch more results if needed."),
  results_per_page: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Number of chunk results to return per page. Prefer <= 5; max 20."),
  max_words: z.number().int().min(100).max(500).optional().describe("Maximum total words to return across the page of chunk content."),
};

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function truncateToWordLimit(text: string, wordLimit: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= wordLimit) return text.trim();
  return `${words.slice(0, wordLimit).join(" ")} ...`;
}

const GenerateShareLinkSchema = {
  url: z.string().optional().describe("Direct raw internal PDF URL. DO NOT guess or hallucinate. If not known, supply semester, subject, and topic instead."),
  semester: z.string().optional().describe("Semester number (e.g. '7'). Must match the document's semester."),
  subject: z.string().optional().describe("Subject name (e.g. 'Information and Network Security'). Must match the document's subject."),
  topic: z.string().optional().describe("Topic / file name (e.g. 'practical 2 lab manual'). Must match the topic/chapter name exactly."),
};

const LookupExternalSourcesSchema = {
  topic: z.string().describe("The educational or technical topic, algorithm, concept, or question to look up."),
};

// ────────── Register all tools ──────────

export function registerMaterioTools(server: McpServer, context?: { user?: MaterioProtectedUser | null; accessTier?: AccessTier; token?: string }): void {
  registerPromptFiles(server);

  const isPlusOrAdmin =
    context?.accessTier === "plus" ||
    context?.accessTier === "super" ||
    (context?.accessTier as string) === "admin";
  // ──── 1. resource_library (Unified Course Catalog & Curriculum Explorer) ────
  server.registerTool(
    "resource_library",
    {
      title: "Explore Course Library (Semesters, Subjects, Topics)",
      description: `Unified navigation tool for discovering courses, subjects, chapters, and materials in the Materio library.
Powered by the live catalog (resource.lib.json).

Usage Modes:
1. Overview: Call with no arguments ({}) to see all available semesters and their subjects.
2. Semester: Pass semester (e.g. semester="4") to see all subjects in that semester.
3. Subject: Pass subject (e.g. subject="Operating System") with or without semester to view all categorized sections (Chapters, Question Banks, Papers) and exact topic names.
4. Topic Inspection: Pass topic (e.g. topic="Deadlocks") to find which semester, subject, and section it belongs to, plus related sibling topics.
5. Search: Pass search (e.g. search="deadlock") to search across all semesters, subjects, and topics.

Args:
  - semester: (Optional) Semester number, e.g. "1", "2", "3", "4", "5", "6", "7", "9".
  - subject: (Optional) Subject name or partial match. If semester is omitted, auto-locates the subject across all semesters.
  - topic: (Optional) Topic/chapter name to locate and inspect.
  - search: (Optional) Keyword query to search across the entire library.
`,
      inputSchema: ResourceLibrarySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ semester, subject, topic, search }) => {
      try {
        const result = await exploreLibrary({ semester, subject, topic, search });
        let text = JSON.stringify(result, null, 2);

        if (text.length > CHARACTER_LIMIT) {
          if (result.mode === "search" && (result as any).matches) {
            (result as any).matches = (result as any).matches.slice(0, 20);
            (result as any).truncated = true;
          }
          text = JSON.stringify(result, null, 2);
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error exploring resource library: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ──── 2. finder (Intelligent Resource Discovery & Jev System 1 Decision Ranking) ────
  server.registerTool(
    "finder",
    {
      title: "Find Relevant Course Materials (Search & Topic Discovery)",
      description: `Intelligent search engine to discover which syllabus topic, chapter, or question bank matches a user's question or concept.
Powered by Materio's Search API with TypeSafe AI Jev System 1 decision ranking.

CRITICAL DISTINCTION — READ CAREFULLY:
- This tool discovers the LOCATION of relevant material (semester, subject, section, topic name), NOT the full text content.
- DO NOT answer the user's content question based on this tool alone.
- Once Finder identifies the exact topic and subject, you MUST call SnapSearch (or DeepThink) with that subject and topic to read the actual textbook content.

Args:
  - query: (string) The concept, keyword, or question to find materials for (e.g. 'cpu scheduling algorithms', 'deadlocks', 'fode matrices').
  - semester: (Optional string) Limit search to a specific semester (e.g. '4', '7').

Returns:
  - bestMatch: The highest-scoring topic, subject, and semester.
  - candidates: Other top candidate matches.
  - mandatoryNextStep: Explicit instruction directing you to call SnapSearch/DeepThink.
`,
      inputSchema: FinderSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, semester }) => {
      try {
        const result = await findResources(query, semester);
        const text = JSON.stringify(result, null, 2);

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Finder error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // ──── 3. snap_search ────
  server.registerTool(
    "snap_search",
    {
      title: "Primary Vectorless Search (FTS)",
      description: `Primary tool for extremely fast, non-semantic keyword matching across course material text chunks.
Uses Postgres Full-Text Search (TSVECTOR) to instantly find documents containing specific keywords or topics.
CRITICAL: If you are searching for a specific chapter (e.g. "chapter 1") but don't know its actual name, you MUST use ResourceLibrary FIRST to get the list of chapters and find the exact name. Do NOT search for generic terms like "chapter 1" here.
Use this first for most content lookups. Keep responses short, then request the next page if the first chunk set is not enough by repeating the same filters and incrementing \`page\`.
DeepThink is available when semantic understanding across complex or distributed concepts is needed.
Never use this tool for diagram generation or any non-content task.

Args:
  - query: Keywords to search for.
  - semester: (Optional) Limit search to semester.
  - subject: (Optional) Limit search to subject.
  - page: Result page number, starting at 1.
  - results_per_page: Number of chunk results to include per page.
  - max_words: Maximum total words to return on the page.
`,
      inputSchema: VectorlessSearchSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, semester, subject, page, results_per_page, max_words }) => {
      try {
        if (
          query.includes("?share=") ||
          query.includes("getmaterio.app/?share=") ||
          (subject && subject.includes("?share=")) ||
          (semester && semester.includes("?share="))
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "HARD GUARDRAIL VIOLATION: Masked share links (https://getmaterio.app/?share=...) cannot be used for search or context retrieval. They are web view pages for users. Search by topic name, keywords, or concepts instead.",
              },
            ],
          };
        }

        if (isDiagramIntent(query)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Diagram requests are not allowed in SnapSearch. Use diagram tools (GenerateDiagramFromRequest, DiagramGenerator, DiagramValidator) and render via the sandbox/image pipeline.",
              },
            ],
          };
        }

        const currentPage = page ?? 1;
        const resultsPerPage = Math.min(results_per_page ?? 3, 20);
        const maxWords = max_words ?? 350;
        const fetchCount = Math.max(currentPage * resultsPerPage, 10);
        const results = await queryVectorlessRAG(query, semester, subject, fetchCount);
        
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No results found. Try broader terminology, a different semester/subject filter, or move to DeepThink/external lookup if needed."
              }
            ]
          };
        }

        const startIndex = (currentPage - 1) * resultsPerPage;
        const pageResults = results.slice(startIndex, startIndex + resultsPerPage);

        if (pageResults.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                  query,
                  semester: semester ?? null,
                  subject: subject ?? null,
                  page: currentPage,
                  resultsPerPage,
                  maxWords,
                  items: [],
                  hasMore: false,
                  nextPage: null,
                  nextCallExample: null,
                  message: "No more results on this page.",
                },
                null,
                2
                )
              }
            ]
          };
        }

        let remainingWords = maxWords;
        const items = pageResults.map((r, i) => {
          const remainingItems = pageResults.length - i;
          const available = remainingItems > 0
            ? Math.max(25, Math.floor(remainingWords / remainingItems))
            : remainingWords;
          const clipped = truncateToWordLimit(r.content, available);
          const used = Math.min(countWords(clipped), remainingWords);
          remainingWords = Math.max(0, remainingWords - used);
          return {
            index: startIndex + i + 1,
            topic: r.topic,
            subject: r.subject,
            similarity: r.similarity,
            excerpt: clipped,
          };
        });

        const hasMore = startIndex + resultsPerPage < results.length;
        const nextPage = hasMore ? currentPage + 1 : null;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  query,
                  semester: semester ?? null,
                  subject: subject ?? null,
                  page: currentPage,
                  resultsPerPage,
                  maxWords,
                  hasMore,
                  nextPage,
                  nextCallExample: hasMore
                    ? {
                        query,
                        semester: semester ?? null,
                        subject: subject ?? null,
                        page: nextPage,
                        results_per_page: resultsPerPage,
                        max_words: maxWords,
                      }
                    : null,
                  items,
                  usageHint: "Use these excerpts as primary grounding context. If this page is not enough, call SnapSearch again with the same filters and the next page number shown below.",
                },
                null,
                2
              )
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Vectorless Search error: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ──── 9. deep_think (Pro & Admin Tier Only) ────
  if (isPlusOrAdmin) {
    server.registerTool(
      "deep_think",
      {
        title: "Deep Think RAG Tool",
        description: `Power tool for complex conceptual questions requiring multi-document vector synthesis.
Performs semantic Deep RAG over the Materio vector database (pgvector).
Reserved for Materio Pro and Admin members. Free users can use SnapSearch.

Args:
  - query: Exact question being asked.
  - semester: The semester.
  - subject: The specific subject context.
  - authToken: (Optional) Materio ID token if not passed in HTTP Authorization header.
`,
        inputSchema: DeepThinkSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ query, semester, subject, authToken }) => {
        try {
          let effectiveTier: AccessTier = context?.accessTier ?? "guest";
          let effectiveUser = context?.user ?? null;
          const effectiveToken = authToken || context?.token;

          if (effectiveToken) {
            const validated = await validateToken(effectiveToken);
            if (validated.user) {
              effectiveUser = validated.user;
              effectiveTier = validated.accessTier;
            }
          }

          const access = checkToolAccess(effectiveTier, "plus");
          if (!access.allowed) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `DeepThink Access Restricted: ${access.message}

How to unlock:
1. Sign in or upgrade to Materio Pro at https://auth.getmaterio.app
2. Provide your Materio ID token in the authorization header or 'authToken' parameter.

Alternative for General Users:
Use 'SnapSearch' immediately to search course content, chapters, and textbook excerpts without a Pro subscription.`,
                },
              ],
            };
          }

        const trimmedQuery = query.trim();
        if (
          trimmedQuery.includes("?share=") ||
          trimmedQuery.includes("getmaterio.app/?share=") ||
          subject.includes("?share=") ||
          semester.includes("?share=")
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "HARD GUARDRAIL VIOLATION: Masked share links (https://getmaterio.app/?share=...) cannot be used for deep think analysis. Provide subject and topic/concept query instead.",
              },
            ],
          };
        }

        if (!trimmedQuery || !semester.trim() || !subject.trim()) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Deep Think requires non-empty query, semester, and subject values.",
              },
            ],
          };
        }

        if (isDiagramIntent(trimmedQuery)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Diagram requests are not allowed in DeepThink. Use diagram tools (GenerateDiagramFromRequest, DiagramGenerator, DiagramValidator) and render via the sandbox/image pipeline.",
              },
            ],
          };
        }

        const results = await queryDeepThinkRAG(trimmedQuery, semester.trim(), subject.trim(), 5);
        
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Deep Think failed to find any relevant context for the query based on the subject and semester provided."
              }
            ]
          };
        }

        const contextText = results.map((r, i) => `[Context ${i + 1}] Topic: ${r.topic} (Similarity: ${r.similarity?.toFixed(2) ?? 'N/A'})
${r.content}`).join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Deep Think Context Received:\n\n${contextText}\n\nUse this context to formulate a response to the user's question: "${query}"`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Deep Think Tool error: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );
  }

  // ──── 10. share_link_generator ────
  server.registerTool(
    "share_link_generator",
    {
      title: "Generate Secure Share Link",
      description: `Generates a user-facing share link (https://getmaterio.app/?share=...) for a document.
Call this tool whenever the user asks for a link, share link, or download link to course material.

Args:
  - semester: (Optional) Semester number
  - subject: (Optional) Subject name
  - topic: (Optional) Topic / file name
  - url: (Optional) Internal document URL if already known`,
      inputSchema: GenerateShareLinkSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, semester, subject, topic }) => {
      try {
        let rawUrl = (url || "").trim();

        // HARD GUARDRAIL 3: Reject if input URL is already a masked share link
        if (
          rawUrl.includes("?share=") ||
          rawUrl.includes("getmaterio.app/?share=") ||
          rawUrl.includes("materioa.vercel.app/?share=")
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "HARD GUARDRAIL VIOLATION: The provided URL is already a masked share link (contains '?share='). Masked share links are end-user web pages and cannot be re-masked or used as PDF sources. To generate a share link for a document, provide the semester, subject, and topic instead."
              }
            ]
          };
        }

        // HARD GUARDRAIL 2: Reject invalid, fake, or placeholder URLs
        if (rawUrl) {
          if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "HARD GUARDRAIL VIOLATION: Invalid URL format. Provide a valid HTTP/HTTPS URL or provide semester, subject, and topic."
                }
              ]
            };
          }
          if (
            rawUrl.includes("example.com") ||
            rawUrl.includes("placeholder") ||
            rawUrl.includes("fake") ||
            rawUrl.includes("sample.pdf")
          ) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "HARD GUARDRAIL VIOLATION: Placeholder or fake URL detected. Do not guess or hallucinate URLs. Provide semester, subject, and topic instead."
                }
              ]
            };
          }
        }

        let resolvedSubject = subject;
        let resolvedTopic = topic;

        if (!rawUrl) {
          if (!semester || !subject || !topic) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: You must provide either a valid 'url' OR all three of 'semester', 'subject', and 'topic'."
                }
              ]
            };
          }

          const items = await listResources(semester, subject);
          const match = items.find(
            (i) =>
              i.topic.toLowerCase() === topic.toLowerCase() ||
              i.topic.toLowerCase().includes(topic.toLowerCase())
          );

          if (match) {
            resolvedSubject = match.subject;
            resolvedTopic = match.topic;
            rawUrl = await resolvePdfUrl(match.semester, match.subject, match.topic);
          } else {
            rawUrl = await resolvePdfUrl(semester, subject, topic);
          }
        }

        if (!rawUrl) {
          return {
            content: [
              {
                type: "text" as const,
                text: `HARD GUARDRAIL: Could not resolve a valid PDF document for semester='${semester || ""}', subject='${subject || ""}', topic='${topic || ""}'. Verify the names using ResourceLibrary. Do NOT guess or hallucinate share links.`
              }
            ]
          };
        }

        // Call canonical API to generate verified masked share link
        const shareLink = await generateMaskedUrl(rawUrl);

        // HARD GUARDRAIL 1: Guarantee raw internal CDN URLs are never exposed in output
        const outputPayload = {
          status: "success",
          shareLink,
          subject: resolvedSubject,
          topic: resolvedTopic,
          guardrails: [
            "DO NOT expose internal CDN URLs (cdn.getmaterio.app/pdfs/...) in chat.",
            "Present ONLY this verified masked share link to the user.",
            "NEVER try to fetch, search, or read PDF contents using this masked share link (it is a web UI page, not a raw PDF file)."
          ]
        };

        let outputText = JSON.stringify(outputPayload, null, 2);
        // Hard sanitize: strip any accidental CDN link from the response
        if (outputText.includes("cdn.getmaterio.app/pdfs") || outputText.includes("/api/pdfs/")) {
          outputText = JSON.stringify({
            status: "success",
            shareLink,
            guardrails: "Present ONLY this verified masked share link to the user. Do NOT expose direct CDN URLs."
          }, null, 2);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Verified Secure Share Link:\n${shareLink}\n\n${outputText}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error generating share link: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ──── 11. lookup_external_sources ────
  server.registerTool(
    "lookup_external_sources",
    {
      title: "Lookup External Sources (GeeksforGeeks, MDN, TutorialsPoint, W3Schools)",
      description: "Look up educational, algorithmic, or programming topics in verified external sources (GeeksforGeeks, TutorialsPoint, W3Schools, MDN, official documentation) using Firecrawl keyless search and crawling. Avoids low-credibility sources.",
      inputSchema: LookupExternalSourcesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ topic }) => {
      try {
        const result = await lookupExternalSources(topic);

        if (!result.found || !result.content) {
          return {
            content: [{ type: "text" as const, text: result.prompt || "No relevant external source found for the topic." }]
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Source: ${result.source}\nProvider: ${result.provider ?? "external"}\n\nExtracted Content:\n${result.content}\n\nUse this context to answer the user's question.`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `External lookup error: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );
}
