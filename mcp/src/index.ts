#!/usr/bin/env bun
// ─────────────────────────────────────────────────────
//  Materio MCP Server — Standalone Server Entry Point
//  Provides tools for course materials, search, RAG,
//  document generation, diagrams, and external lookup.
//
//  Transports:
//    • stdio   — for Claude Desktop local
//    • http    — Streamable HTTP JSON-RPC for
//                Perplexity, Claude & remote connectors
//    • worker  — Cloudflare Worker via src/worker.ts
// ─────────────────────────────────────────────────────

import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

let __srcDir = process.cwd();
try {
  if (typeof import.meta.url === "string" && import.meta.url.startsWith("file:")) {
    __srcDir = path.dirname(fileURLToPath(import.meta.url));
  }
} catch {}
dotenv.config({ path: path.join(__srcDir, "../.env") });

import { createMcpServer } from "./server.js";
export { createMcpServer };
import { generateDocumentTool, handleGenerateDocument } from "./tools/generate-document.js";
import { registerMaterioTools } from "./tools/materio.js";
import {
  listSemesters,
  listSubjects,
  listResources,
  searchResources,
  resolvePdfUrl,
  getFullIndex,
  generateMaskedUrl,
} from "./services/resources.js";
import { findResources } from "./services/finder.js";
import { queryDeepThinkRAG, queryVectorlessRAG } from "./services/rag.js";
import { lookupExternalSources } from "./services/external-lookup.js";
import {
  resolveUserFromHeaders,
  checkToolAccess,
  getOAuthAuthorizationServerMetadata,
  getOAuthProtectedResourceMetadata,
  handleAuthorizeRedirect,
  handleTokenProxy,
  handleRegisterProxy,
} from "./services/materio-auth.js";

let APP_ICON_PATH = path.join(__srcDir, "app.png");
let OPENAPI_SPEC_PATH = path.join(__srcDir, "../openapi.json");
let OPENAPI_LITE_SPEC_PATH = path.join(__srcDir, "../openapi.search-lite.json");
try {
  if (typeof import.meta.url === "string" && import.meta.url.startsWith("file:")) {
    APP_ICON_PATH = fileURLToPath(new URL("./app.png", import.meta.url));
    OPENAPI_SPEC_PATH = fileURLToPath(new URL("../openapi.json", import.meta.url));
    OPENAPI_LITE_SPEC_PATH = fileURLToPath(
      new URL("../openapi.search-lite.json", import.meta.url)
    );
  }
} catch {}
const FAVICON_SIZES = [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512];
const faviconCache = new Map<number, Buffer>();
const DIAGRAM_INTENT_PATTERN = /(?:^|\b)(draw|diagram|visualize|render|flowchart|mermaid|graphviz|dot|svg|dfa|fsm|automaton|state machine|circuit|gantt|timeline|logic gate|schemdraw|matplotlib|plot|chart|mindmap|markmap|tree)(?:\b|$)/i;

function isDiagramIntent(query: string): boolean {
  return DIAGRAM_INTENT_PATTERN.test(query);
}

function getRequestedFaviconSize(req: express.Request): number {
  const rawSize = req.query.sz ?? req.query.size ?? req.query.s;
  const parsed = Number(Array.isArray(rawSize) ? rawSize[0] : rawSize);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(512, Math.max(16, Math.round(parsed)));
  }

  return 256;
}

function faviconLinkHeader(): string {
  return FAVICON_SIZES.map(
    (size) => `</app.png?size=${size}>; rel="icon"; type="image/png"; sizes="${size}x${size}"`
  ).join(", ");
}

function applyIconHeaders(res: express.Response): void {
  res.setHeader("Link", faviconLinkHeader());
  res.setHeader("X-Content-Type-Options", "nosniff");
}

async function readTextFile(filePath: string): Promise<string> {
  if (typeof (globalThis as any).Bun !== "undefined") {
    return (globalThis as any).Bun.file(filePath).text();
  }

  return readFile(filePath, "utf8");
}

async function renderFavicon(_size: number): Promise<Buffer> {
  const cached = faviconCache.get(_size);
  if (cached) return cached;

  const buffer = await readFile(APP_ICON_PATH);
  faviconCache.set(_size, buffer);
  return buffer;
}

async function sendFavicon(req: express.Request, res: express.Response): Promise<void> {
  try {
    const size = getRequestedFaviconSize(req);
    const buffer = await renderFavicon(size);

    applyIconHeaders(res);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Favicon-Size", `${size}x${size}`);
    res.send(buffer);
  } catch (error) {
    console.error("Favicon render error:", error);
    res.status(404).send("Not found");
  }
}


// ──── Transport: stdio (for Claude Desktop) ────
async function runStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Materio MCP server running via stdio (JSON-RPC over stdin/stdout)");
}

// ──── Transport: Streamable HTTP & Express App ────
export const app = express();

// Parse JSON bodies
app.use(express.json({ limit: "50mb" }));

// CORS for all origins
app.use((_req, res, next) => {
  if (_req.method === "GET" || _req.method === "HEAD") {
    applyIconHeaders(res);
  }
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, mcp-session-id, mcp-protocol-version, X-OAuth-Client-Id, X-OAuth-Client-Secret, X-Anonymous-Id, X-Target-Url, X-Materio-Client, X-Materio-Token, X-OAuth-Token, X-Test-User, last-event-id"
  );
  res.header("Access-Control-Expose-Headers", "mcp-session-id");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// ════════════════════════════════════════════════════
//  OAuth 2.0 / RFC 8414 & RFC 9728 Discovery & Proxies
// ════════════════════════════════════════════════════
app.get(
  ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration", "/oauth-metadata"],
  async (req, res) => {
    const host = req.get("host") || "localhost:3001";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const origin = `${protocol}://${host}`;
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(await getOAuthAuthorizationServerMetadata());
  }
);

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const host = req.get("host") || "localhost:3001";
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const origin = `${protocol}://${host}`;
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(getOAuthProtectedResourceMetadata(origin));
});

app.get("/authorize", (req, res) => {
  const host = req.get("host") || "localhost:3001";
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const fullUrl = new URL(req.originalUrl || req.url, `${protocol}://${host}`);
  const response = handleAuthorizeRedirect(fullUrl);
  res.redirect(response.headers.get("Location") || "https://auth.getmaterio.app/authorize");
});

app.all("/token", async (req, res) => {
  try {
    const host = req.get("host") || "localhost:3001";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const fullUrl = new URL(req.originalUrl || req.url, `${protocol}://${host}`);
    const webReq = new Request(fullUrl.toString(), {
      method: req.method,
      headers: req.headers as any,
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    });
    const webRes = await handleTokenProxy(webReq);
    const data = await webRes.json().catch(() => ({}));
    res.status(webRes.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: "Token proxy error", details: err?.message });
  }
});

app.all("/register", async (req, res) => {
  try {
    const host = req.get("host") || "localhost:3001";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const fullUrl = new URL(req.originalUrl || req.url, `${protocol}://${host}`);
    const webReq = new Request(fullUrl.toString(), {
      method: req.method,
      headers: req.headers as any,
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    });
    const webRes = await handleRegisterProxy(webReq);
    const data = await webRes.json().catch(() => ({}));
    res.status(webRes.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: "Client registration error", details: err?.message });
  }
});

// ════════════════════════════════════════════════════
//  MCP JSON-RPC endpoint — POST /mcp
// ════════════════════════════════════════════════════
app.all("/mcp", async (req, res) => {
  try {
    req.headers["accept"] = "application/json, text/event-stream";
    const host = req.get("host") || "localhost:3001";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const fullUrl = new URL(req.originalUrl || req.url, `${protocol}://${host}`);
    const { user, accessTier } = await resolveUserFromHeaders(req.headers as any, fullUrl.searchParams);
    const server = createMcpServer({ user, accessTier });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => transport.close());

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP JSON-RPC error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// ════════════════════════════════════════════════════
//  Health check
// ════════════════════════════════════════════════════
app.get("/health", async (_req, res) => {
  res.json({
    status: "ok",
    server: "materio-mcp-server",
    version: "1.0.0",
    protocol: "MCP (JSON-RPC 2.0 over Streamable HTTP)",
  });
});

// ════════════════════════════════════════════════════
//  Web root & Icon
// ════════════════════════════════════════════════════
app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({
    jsonrpc: "2.0",
    message: "Materio MCP server is running. Use POST /mcp for JSON-RPC.",
  });
});

app.head("/", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).end();
});

app.get(["/app.png", "/favicon.png", "/favicon.ico", "/apple-touch-icon.png"], sendFavicon);

// ════════════════════════════════════════════════════
//  OpenAPI spec — served for ChatGPT Actions import
// ════════════════════════════════════════════════════
app.get("/openapi.json", async (req, res) => {
  try {
    const specText = await readTextFile(OPENAPI_SPEC_PATH);
    const spec = JSON.parse(specText);
    const host = req.get("host");
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    if (host) {
      spec.servers = [{ url: `${protocol}://${host}`, description: "Current server" }];
    }
    res.json(spec);
  } catch {
    res.status(404).json({ error: "openapi.json not found" });
  }
});

app.get("/openapi.search-lite.json", async (req, res) => {
  try {
    const specText = await readTextFile(OPENAPI_LITE_SPEC_PATH);
    const spec = JSON.parse(specText);
    const host = req.get("host");
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    if (host) {
      spec.servers = [{ url: `${protocol}://${host}`, description: "Current server" }];
    }
    res.json(spec);
  } catch {
    res.status(404).json({ error: "openapi.search-lite.json not found" });
  }
});

// ════════════════════════════════════════════════════
//  REST API endpoints — for ChatGPT Custom GPT Actions
// ════════════════════════════════════════════════════

app.get("/api/semesters", async (_req, res) => {
  try {
    const semesters = await listSemesters();
    res.json({ semesters, count: semesters.length });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to list semesters." });
  }
});

app.get("/api/subjects", async (req, res) => {
  const sem = req.query.semester as string;
  if (!sem) return res.status(400).json({ error: "semester query parameter required" });
  try {
    const subjects = await listSubjects(sem);
    res.json({ semester: sem, subjects, count: subjects.length });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to list subjects." });
  }
});

app.get("/api/resources", async (req, res) => {
  const sem = req.query.semester as string;
  const sub = req.query.subject as string;
  if (!sem || !sub) return res.status(400).json({ error: "semester and subject parameters required" });
  try {
    const items = await listResources(sem, sub);
    res.json({ semester: sem, subject: sub, resources: items, count: items.length });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to list resources." });
  }
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.query ?? req.query.q) as string;
  const sem = req.query.semester as string | undefined;
  if (!q) return res.status(400).json({ error: "query parameter required" });
  try {
    const result = await findResources(q, sem);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: "Failed to search resources." });
  }
});

app.get("/api/pdf-url", async (req, res) => {
  const sem = req.query.semester as string;
  const sub = req.query.subject as string;
  const topic = req.query.topic as string;
  if (!sem || !sub || !topic)
    return res.status(400).json({ error: "semester, subject, and topic parameters required" });
  try {
    const items = await listResources(sem, sub);
    const match = items.find(
      (i) =>
        i.topic.toLowerCase() === topic.toLowerCase() ||
        i.topic.toLowerCase().includes(topic.toLowerCase()) ||
        topic.toLowerCase().includes(i.topic.toLowerCase())
    );
    const rawUrl = match
      ? await resolvePdfUrl(match.semester, match.subject, match.topic)
      : await resolvePdfUrl(sem, sub, topic);
    const shareLink = await generateMaskedUrl(rawUrl);
    res.json({ semester: sem, subject: match?.subject ?? sub, topic: match?.topic ?? topic, shareLink });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to resolve PDF URL." });
  }
});

app.get("/api/index", async (_req, res) => {
  try {
    const index = await getFullIndex();
    res.json({ totalSubjects: index.length, library: index });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to get library index." });
  }
});

app.get("/api/concept-explorer", async (req, res) => {
  const sem = req.query.semester as string;
  const sub = req.query.subject as string;
  const topic = req.query.topic as string;

  if (!sem || !sub || !topic) {
    return res.status(400).json({ error: "semester, subject, and topic parameters required" });
  }

  try {
    const items = await listResources(sem, sub);
    const match = items.find(
      (i) =>
        i.topic.toLowerCase() === topic.toLowerCase() ||
        i.topic.toLowerCase().includes(topic.toLowerCase())
    );

    const chapters = items.filter((i) => i.sectionType === "Chapters");
    const questionBanks = items.filter(
      (i) => i.sectionType === "Question Banks" || i.sectionType === "Important Questions"
    );
    const prevYearPapers = items.filter((i) => i.sectionType === "Previous Year Papers");

    let resolvedUrl = "";
    if (match) {
      resolvedUrl = await resolvePdfUrl(match.semester, match.subject, match.topic);
    }

    res.json({
      found: !!match,
      topic: match?.topic ?? topic,
      semester: sem,
      subject: match?.subject ?? sub,
      sectionType: match?.sectionType ?? "unknown",
      pdfUrl: resolvedUrl || null,
      relatedChapters: chapters.map((c) => c.topic),
      availableQuestionBanks: questionBanks.map((q) => ({
        topic: q.topic,
        pdfUrl: q.pdfUrl,
      })),
      previousYearPapers: prevYearPapers.map((p) => ({
        topic: p.topic,
        pdfUrl: p.pdfUrl,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to explore concept." });
  }
});

app.get("/api/snap-search", async (req, res) => {
  const q = (req.query.query ?? req.query.q) as string;
  const sem = req.query.semester as string | undefined;
  const sub = req.query.subject as string | undefined;
  const pageRaw = req.query.page as string | undefined;
  const resultsPerPageRaw = req.query.results_per_page as string | undefined;

  if (!q) {
    return res.status(400).json({ error: "query parameter required" });
  }

  try {
    if (isDiagramIntent(q)) {
      return res.status(400).json({
        error:
          "Diagram requests are not allowed in SnapSearch. Use diagram tools.",
      });
    }

    const currentPage = Math.max(1, Number(pageRaw ?? 1) || 1);
    const resultsPerPage = Math.min(20, Math.max(1, Number(resultsPerPageRaw ?? 3) || 3));
    const fetchCount = Math.max(currentPage * resultsPerPage, 10);
    const results = await queryVectorlessRAG(q, sem, sub, fetchCount);

    const startIndex = (currentPage - 1) * resultsPerPage;
    const pageResults = results.slice(startIndex, startIndex + resultsPerPage);

    return res.json({
      query: q,
      semester: sem ?? null,
      subject: sub ?? null,
      page: currentPage,
      resultsPerPage,
      results: pageResults,
      count: pageResults.length,
      hasMore: results.length > startIndex + resultsPerPage,
    });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to perform snap search." });
  }
});

app.get("/api/deep-think", async (req, res) => {
  const host = req.get("host") || "localhost:3001";
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const fullUrl = new URL(req.originalUrl || req.url, `${protocol}://${host}`);
  const { accessTier } = await resolveUserFromHeaders(req.headers as any, fullUrl.searchParams);
  const access = checkToolAccess(accessTier, "plus");
  if (!access.allowed) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${protocol}://${host}/.well-known/oauth-protected-resource"`
    );
    return res.status(access.status === "UNAUTHENTICATED" ? 401 : 403).json({
      error: access.message,
      status: access.status,
      upgradeUrl: "https://auth.getmaterio.app",
    });
  }

  const q = req.query.query as string;
  const sem = req.query.semester as string;
  const sub = req.query.subject as string;

  if (!q || !sem || !sub) {
    return res.status(400).json({ error: "query, semester, and subject parameters required" });
  }

  try {
    const contexts = await queryDeepThinkRAG(q, sem, sub, 5);
    res.json({
      query: q,
      semester: sem,
      subject: sub,
      contexts,
      count: contexts.length,
    });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to perform deep think search." });
  }
});

app.get("/api/share-link", async (req, res) => {
  const directUrl = ((req.query.url as string) || "").trim();
  const sem = req.query.semester as string | undefined;
  const sub = req.query.subject as string | undefined;
  const topic = req.query.topic as string | undefined;

  try {
    let rawUrl = directUrl;
    if (rawUrl && (rawUrl.includes("?share=") || rawUrl.includes("getmaterio.app/?share="))) {
      return res.status(400).json({
        error: "HARD GUARDRAIL: Input URL is already a masked share link. Masked share links cannot be re-masked.",
      });
    }

    let resolvedSubject = sub;
    let resolvedTopic = topic;

    if (!rawUrl) {
      if (!sem || !sub || !topic) {
        return res
          .status(400)
          .json({ error: "Provide either url, or semester + subject + topic" });
      }

      const items = await listResources(sem, sub);
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
        rawUrl = await resolvePdfUrl(sem, sub, topic);
      }
    }

    if (!rawUrl) {
      return res.status(404).json({ error: "Could not resolve a valid PDF document to generate a share link." });
    }

    const maskedUrl = await generateMaskedUrl(rawUrl);
    // HARD GUARDRAIL: Return ONLY masked sharelink, NEVER expose internal CDN URL
    res.json({
      shareLink: maskedUrl,
      maskedUrl,
      subject: resolvedSubject,
      topic: resolvedTopic,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to generate share link." });
  }
});

app.get("/api/lookup-external-sources", async (req, res) => {
  const q = (req.query.query ?? req.query.q) as string;
  if (!q) {
    return res.status(400).json({ error: "query parameter required" });
  }
  const useExa = req.query.useExa === "true";

  try {
    const result = await lookupExternalSources(q);
    res.json({ query: q, result });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to lookup external sources." });
  }
});

app.post("/mcp/elevated", async (req, res) => {
  try {
    const { user, accessTier } = await resolveUserFromHeaders(req.headers as any);
    if (!user) {
      return res.status(401).json({ error: "Missing or invalid token" });
    }
    if (accessTier !== "plus" && accessTier !== "super") {
      return res.status(403).json({ error: "Access restricted to admin or plus users" });
    }
    res.json({
      message: "Access granted",
      accessLevel: accessTier === "super" ? "admin" : "plus",
      user,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to authorize Materio access." });
  }
});

// ── MCP Proxy ──
app.all("/api/mcp-proxy", async (req, res) => {
  try {
    const targetUrl = (req.query.target || req.headers["x-target-url"]) as string;
    if (!targetUrl) {
      res.status(400).json({ error: "Missing target URL parameter or x-target-url header" });
      return;
    }

    let parsedTargetUrl: URL;
    try {
      parsedTargetUrl = new URL(targetUrl);
    } catch {
      res.status(400).json({ error: "Invalid target URL" });
      return;
    }

    const hostname = parsedTargetUrl.hostname.toLowerCase();
    const isPrivateOrLoopback = 
      hostname === "localhost" || 
      hostname === "127.0.0.1" || 
      hostname === "::1" ||
      hostname.startsWith("169.254.") || 
      hostname.startsWith("10.") || 
      hostname.startsWith("192.168.") || 
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
      
    if (isPrivateOrLoopback) {
      res.status(403).json({ error: "Access to private/local networks is not allowed" });
      return;
    }

    const forwardedHeaders: Record<string, string> = {};
    const excludedHeaders = ["host", "origin", "referer", "connection", "content-length"];
    Object.entries(req.headers).forEach(([key, val]) => {
      if (!excludedHeaders.includes(key.toLowerCase()) && typeof val === "string") {
        forwardedHeaders[key] = val;
      }
    });
    forwardedHeaders["accept"] = "application/json, text/event-stream";

    const fetchOpts: RequestInit = {
      method: req.method,
      headers: forwardedHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    };

    const targetRes = await fetch(targetUrl, fetchOpts);
    res.status(targetRes.status);
    targetRes.headers.forEach((val, key) => {
      if (!["transfer-encoding", "content-encoding", "content-length"].includes(key.toLowerCase())) {
        res.setHeader(key, val);
      }
    });

    if (targetRes.body) {
      const reader = targetRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(value);
      }
    }
    res.end();
  } catch (err: any) {
    console.error("MCP proxy error:", err);
    res.status(502).json({ error: `Proxy failed: ${err.message}` });
  }
});

// ── Start ──
const port = Number(process.env.PORT ?? 3000);
const transport = process.env.TRANSPORT ?? "http";
const isVercel = process.env.VERCEL === "1";

if (transport === "stdio") {
  runStdio().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else if (!isVercel && process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.error(`✅ Materio MCP server running on http://localhost:${port}`);
    console.error(`   ┌─────────────────────────────────────────────────────┐`);
    console.error(`   │  MCP (JSON-RPC 2.0):  POST http://localhost:${port}/mcp  │`);
    console.error(`   │  Health:              GET  http://localhost:${port}/health │`);
    console.error(`   │  OpenAPI (ChatGPT):   GET  http://localhost:${port}/openapi.json │`);
    console.error(`   │  REST API (ChatGPT):  GET  http://localhost:${port}/api/* │`);
    console.error(`   │  Protected auth:      POST http://localhost:${port}/mcp/elevated │`);
    console.error(`   └─────────────────────────────────────────────────────┘`);
  });
}

export default app;
