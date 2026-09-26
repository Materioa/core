export interface GfGLookupResult {
  topic: string;
  source: string | null;
  content: string;
  found: boolean;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",
];

function getRandomIP() {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 255)).join('.');
}

async function fetchText(url: string) {
  const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const randomIP = getRandomIP();

  const headers: Record<string, string> = {
    "User-Agent": randomUA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Forwarded-For": randomIP,
    "X-Real-IP": randomIP,
    "Client-IP": randomIP,
    "Via": randomIP
  };

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return await res.text();
}

export async function searchGfGTopic(topic: string): Promise<string | null> {
  const yahooUrl =
    "https://search.yahoo.com/search?p=site:geeksforgeeks.org+" + encodeURIComponent(topic);
  let html = "";
  try {
    html = await fetchText(yahooUrl);
  } catch (e) {
    return null;
  }

  const links: string[] = [];

  // Yahoo search results usually have RU= encoded URL in the href of search results
  const regex = /RU=([^/&]+)/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      let decoded = decodeURIComponent(m[1]);
      if (
        decoded.includes("geeksforgeeks.org") &&
        decoded.startsWith("http") &&
        !decoded.includes("yahoo.com")
      ) {
        links.push(decoded);
      }
    } catch (e) { }
  }

  // Fallback: regular hrefs just in case Yahoo stops using RU=
  if (links.length === 0) {
    const fallbackRegex = /href="([^"]+)"/gi;
    let mFallback;
    while ((mFallback = fallbackRegex.exec(html)) !== null) {
      let href = mFallback[1];
      if (href.includes("geeksforgeeks.org") && href.startsWith("http") && !href.includes("yahoo.com")) {
        links.push(href);
      }
    }
  }

  if (links.length === 0) return null;

  const uniqueLinks = Array.from(new Set(links));
  const queryWords = topic.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 0);

  let bestLink = uniqueLinks[0];
  let maxScore = -1000;

  for (let i = 0; i < uniqueLinks.length; i++) {
    const link = uniqueLinks[i];
    let score = 0;
    const urlLower = link.toLowerCase();

    for (const word of queryWords) {
      if (urlLower.includes(word)) {
        score += 2;
      }
    }

    // Slightly penalize results further down the page to act as a tie-breaker
    score -= (i * 0.1);

    if (score > maxScore) {
      maxScore = score;
      bestLink = link;
    }
  }

  return bestLink;
}

function extractMainContent(html: string): string {
  const classRegex = /(?:class="[^\"]*(?:MainArticleContent_articleMainContentCss__b_1_R|article--viewer_content)[^\"]*")/i;
  const match = html.match(
    new RegExp(
      `<div[^>]*${classRegex.source}[^>]*>([\\s\\S]*?)<div[^>]*class="[^\"]*article-right-sidebar[^\"]*"`,
      "i"
    )
  );

  let contentHtml = html;
  if (match && match[1]) {
    contentHtml = match[1];
  } else {
    const divIndex = html.search(classRegex);
    if (divIndex !== -1) {
      contentHtml = html.slice(divIndex, divIndex + 30000);
    }
  }

  const cleanText = contentHtml
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(div|p|h[1-6]|br|li|td|th|ul)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, 8000);

  return cleanText;
}

async function lookupWikipedia(topic: string): Promise<GfGLookupResult> {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&utf8=&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { headers: { "User-Agent": "MaterioMCPServer/1.0" } });
    const searchData = (await searchRes.json()) as any;

    if (!searchData?.query?.search?.length) {
      return { topic, source: null, content: "", found: false };
    }

    const title = searchData.query.search[0].title;
    const pageUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}&origin=*`;

    const pageRes = await fetch(pageUrl, { headers: { "User-Agent": "MaterioMCPServer/1.0" } });
    const pageData = (await pageRes.json()) as any;

    const pages = pageData?.query?.pages;
    if (!pages) return { topic, source: null, content: "", found: false };

    const pageId = Object.keys(pages)[0];
    const content = pages[pageId].extract;

    return {
      topic,
      source: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      content: content ? content.slice(0, 8000) : "",
      found: !!content
    };
  } catch (e) {
    return { topic, source: null, content: "", found: false };
  }
}

export async function lookupGfG(topic: string): Promise<GfGLookupResult> {
  try {
    // 1. Try GeeksforGeeks via Yahoo Search
    const href = await searchGfGTopic(topic);
    if (href) {
      try {
        const articleHtml = await fetchText(href);
        const content = extractMainContent(articleHtml);
        if (content && content.length > 200) {
          return { topic, source: href, content, found: true };
        }
      } catch (articleErr) {
        // If article fetch fails (e.g. 403 from GFG), fall through to Wikipedia
      }
    }

    // 2. Fallback to Wikipedia (Very reliable on Datacenter IPs / Vercel)
    const wikiResult = await lookupWikipedia(topic);
    if (wikiResult.found) {
      return wikiResult;
    }

    return { topic, source: null, content: "", found: false };
  } catch (e: any) {
    // Final fallback to Wikipedia if anything else explodes
    return await lookupWikipedia(topic);
  }
}
