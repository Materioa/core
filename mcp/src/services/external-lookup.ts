// ─────────────────────────────────────────────────────
//  Materio MCP Services — External Knowledge Lookup
//  Powered by Firecrawl Keyless with Educational Domain Priority
// ─────────────────────────────────────────────────────

import { lookupGfG } from "../tools/gfg.js";

export interface ExternalLookupResult {
  topic: string;
  source: string | null;
  content: string;
  found: boolean;
  provider: "firecrawl" | "gfg" | "official_docs" | "educational" | null;
  shouldAskUser?: boolean;
  prompt?: string;
}

const TRUSTED_DOMAINS = [
  "geeksforgeeks.org",
  "tutorialspoint.com",
  "w3schools.com",
  "developer.mozilla.org",
  "docs.python.org",
  "docs.oracle.com",
  "nodejs.org",
  "dev.mysql.com",
  "en.cppreference.com",
  "learn.microsoft.com",
  "wikipedia.org",
];

const BLOCKED_DOMAINS = [
  "quora.com",
  "reddit.com",
  "pinterest.com",
  "blogspot.com",
  "medium.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "instagram.com",
];

function isTrustedDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_DOMAINS.some((b) => host.includes(b))) return false;
    return TRUSTED_DOMAINS.some((d) => host.includes(d));
  } catch {
    return false;
  }
}

function getDomainRank(urlStr: string): number {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    if (host.includes("geeksforgeeks.org")) return 1;
    if (host.includes("developer.mozilla.org")) return 2;
    if (host.includes("tutorialspoint.com")) return 3;
    if (host.includes("w3schools.com")) return 4;
    if (host.includes("docs.") || host.includes("learn.microsoft.com")) return 5;
    if (host.includes("wikipedia.org")) return 6;
    return 10;
  } catch {
    return 99;
  }
}

/**
 * Searches and crawls using Firecrawl (keyless by default, or with FIRECRAWL_API_KEY if configured).
 */
async function searchWithFirecrawl(topic: string): Promise<ExternalLookupResult | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  // Focus search query on prioritized educational resources
  const targetedQuery = `${topic} (site:geeksforgeeks.org OR site:developer.mozilla.org OR site:tutorialspoint.com OR site:w3schools.com)`;

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: targetedQuery,
        limit: 5,
        scrapeOptions: {
          formats: ["markdown"],
        },
      }),
    });

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as any;
    const rawResults = json?.data || json?.results || [];
    if (!Array.isArray(rawResults) || rawResults.length === 0) {
      return null;
    }

    // Filter and sort by educational domain trust
    const sorted = rawResults
      .filter((item: any) => item?.url && !BLOCKED_DOMAINS.some((b) => item.url.includes(b)))
      .sort((a: any, b: any) => getDomainRank(a.url) - getDomainRank(b.url));

    const best = sorted[0];
    if (!best) return null;

    const content =
      (typeof best.markdown === "string" ? best.markdown.trim() : "") ||
      (typeof best.description === "string" ? best.description.trim() : "") ||
      (typeof best.content === "string" ? best.content.trim() : "");

    if (!content) return null;

    // Cap output length to avoid context overflow
    const trimmedContent = content.length > 4000 ? content.slice(0, 4000) + "\n\n...(truncated for brevity)" : content;

    return {
      topic,
      source: best.url,
      content: trimmedContent,
      found: true,
      provider: "firecrawl",
    };
  } catch {
    return null;
  }
}

/**
 * Keyless fallback crawler using reader proxy for high-priority educational sources
 */
async function scrapeFallbackReader(url: string, topic: string): Promise<ExternalLookupResult | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: {
        "Accept": "text/markdown, text/plain",
      },
    });
    if (!res.ok) return null;

    const text = await res.text();
    if (!text || text.length < 50) return null;

    const trimmed = text.length > 4000 ? text.slice(0, 4000) + "\n\n...(truncated for brevity)" : text;

    return {
      topic,
      source: url,
      content: trimmed,
      found: true,
      provider: "educational",
    };
  } catch {
    return null;
  }
}

/**
 * Main external source lookup:
 * Prioritizes GeeksforGeeks, TutorialsPoint, W3Schools, MDN, and official documentation.
 */
export async function lookupExternalSources(topic: string): Promise<ExternalLookupResult> {
  const cleanTopic = topic.trim();
  if (!cleanTopic) {
    return {
      topic,
      source: null,
      content: "",
      found: false,
      provider: null,
    };
  }

  // 1. Primary: Firecrawl keyless / API search
  const firecrawlResult = await searchWithFirecrawl(cleanTopic);
  if (firecrawlResult && firecrawlResult.found) {
    return firecrawlResult;
  }

  // 2. High Priority Fallback: GeeksforGeeks Direct Parser
  try {
    const gfgResult = await lookupGfG(cleanTopic);
    if (gfgResult.found && gfgResult.content) {
      return {
        topic: gfgResult.topic,
        source: gfgResult.source,
        content: gfgResult.content,
        found: true,
        provider: "gfg",
      };
    }
  } catch {
    // Ignore and proceed to reader fallback
  }

  // 3. Fallback: Search common educational documentation pages via reader
  const educationalSeeds = [
    `https://www.geeksforgeeks.org/${encodeURIComponent(cleanTopic.toLowerCase().replace(/\s+/g, "-"))}/`,
    `https://developer.mozilla.org/en-US/docs/Glossary/${encodeURIComponent(cleanTopic)}`,
  ];

  for (const url of educationalSeeds) {
    const scraped = await scrapeFallbackReader(url, cleanTopic);
    if (scraped && scraped.found) {
      return scraped;
    }
  }

  return {
    topic: cleanTopic,
    source: null,
    content: "",
    found: false,
    provider: null,
    shouldAskUser: false,
    prompt: "No verified educational source found for this topic.",
  };
}