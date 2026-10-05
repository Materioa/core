// ─────────────────────────────────────────────────────
//  Materio MCP Server — Cloudflare Worker Entry Point
//  Hosted on: mcp.getmaterio.app
// ─────────────────────────────────────────────────────

// Polyfill process.binding for Cloudflare Workers Emscripten runtime compatibility
if (typeof process !== "undefined" && typeof (process as any).binding !== "function") {
  (process as any).binding = function (name: string) {
    if (name === "constants") {
      return {
        fs: {
          O_RDONLY: 0,
          O_WRONLY: 1,
          O_RDWR: 2,
          S_IFMT: 61440,
          S_IFREG: 32768,
          S_IFDIR: 16384,
          S_IFCHR: 8192,
          S_IFBLK: 24576,
          S_IFIFO: 4096,
          S_IFLNK: 40960,
          S_IFSOCK: 49152,
          O_CREAT: 64,
          O_EXCL: 128,
          O_NOCTTY: 256,
          O_TRUNC: 512,
          O_APPEND: 1024,
          O_DIRECTORY: 65536,
          O_NOFOLLOW: 131072,
          O_SYNC: 1052672,
          O_DSYNC: 4096,
          O_NONBLOCK: 2048,
        },
      };
    }
    return {};
  };
}
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server.js";
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
import openapiSpec from "../openapi.json" with { type: "json" };
import openapiLiteSpec from "../openapi.search-lite.json" with { type: "json" };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE, PUT, HEAD",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, mcp-session-id, mcp-protocol-version, X-OAuth-Client-Id, X-OAuth-Client-Secret, X-Anonymous-Id, X-Target-Url, X-Materio-Client, X-Materio-Token, X-OAuth-Token, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

function addCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function jsonResponse(data: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function syncEnv(env: Record<string, any>) {
  if (!env) return;
  for (const [key, val] of Object.entries(env)) {
    if (typeof val === "string") {
      process.env[key] = val;
    }
  }
}

export default {
  async fetch(request: Request, env: Record<string, any>, ctx: any): Promise<Response> {
    syncEnv(env);

    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS Preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    try {
      // 0a. OAuth 2.0 Authorization Server Discovery (RFC 8414)
      if (
        url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname === "/.well-known/openid-configuration" ||
        url.pathname === "/oauth-metadata"
      ) {
        return jsonResponse(await getOAuthAuthorizationServerMetadata(), 200, {
          "Cache-Control": "public, max-age=3600",
        });
      }

      // 0b. OAuth 2.0 Protected Resource Metadata (RFC 9728)
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return jsonResponse(getOAuthProtectedResourceMetadata(url.origin), 200, {
          "Cache-Control": "public, max-age=3600",
        });
      }

      // 0c. OAuth Authorize Redirect (SSO Proxy)
      if (url.pathname === "/authorize") {
        return handleAuthorizeRedirect(url);
      }

      // 0d. OAuth Token Endpoint (Proxy to auth.getmaterio.app)
      if (url.pathname === "/token") {
        const tokenRes = await handleTokenProxy(request);
        return addCors(tokenRes);
      }

      // 0e. Dynamic Client Registration (RFC 7591)
      if (url.pathname === "/register") {
        const regRes = await handleRegisterProxy(request);
        return addCors(regRes);
      }

      // 1. Core MCP JSON-RPC Endpoint: /mcp
      if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
        const { user, accessTier, token } = await resolveUserFromHeaders(request.headers, url.searchParams);

        // ── OAuth Challenge Gate (RFC 9728) ──────────────────────────
        // Only trigger the 401 challenge if the client specifically supports RFC 9728
        // (e.g. Claude Desktop, Claude.ai) and the user has not explicitly requested guest mode.
        // Other clients (ChatGPT, Cursor, Windsurf, MCP Inspector) do not support RFC 9728
        // and expect unauthenticated sessions to discover free public tools.
        const userAgent = (request.headers.get("user-agent") || "").toLowerCase();
        const isClaude = userAgent.includes("claude") || userAgent.includes("anthropic");
        const isExplicitGuest = url.searchParams.get("guest") === "true" || url.searchParams.get("auth") === "none";

        if (accessTier === "guest" && isClaude && !isExplicitGuest) {
          return new Response(
            JSON.stringify({
              error: "unauthorized",
              message: "Bearer token required. Authenticate via Materio ID to access MCP tools.",
            }),
            {
              status: 401,
              headers: {
                "Content-Type": "application/json",
                "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
                ...CORS_HEADERS,
              },
            }
          );
        }

        const server = createMcpServer({ user, accessTier, token });
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        await server.connect(transport);

        // Normalize Accept header: The MCP SDK requires both application/json and text/event-stream.
        // If a client (e.g. ChatGPT, curl, or standard JSON-RPC clients) only sends application/json or */*,
        // normalize the Accept header so the request is not rejected with a -32000 Not Acceptable error.
        const incomingAccept = request.headers.get("accept") || "";
        let effectiveRequest = request;
        if (!incomingAccept.includes("text/event-stream") || !incomingAccept.includes("application/json")) {
          const newHeaders = new Headers(request.headers);
          newHeaders.set("accept", "application/json, text/event-stream");
          effectiveRequest = new Request(request, { headers: newHeaders });
        }

        const mcpResponse = await transport.handleRequest(effectiveRequest);
        return addCors(mcpResponse);
      }

      // 2. Health Check: /health
      if (url.pathname === "/health") {
        return jsonResponse({
          status: "ok",
          server: "materio-mcp-server",
          version: "1.0.0",
          protocol: "MCP (JSON-RPC 2.0 over Streamable HTTP)",
          platform: "cloudflare-workers",
          host: url.hostname,
          oauth: {
            issuer: "https://auth.getmaterio.app",
            authorizationEndpoint: "https://auth.getmaterio.app/authorize",
            tokenEndpoint: "https://auth.getmaterio.app/api/v2/auth",
          },
        });
      }

      // 3. Root endpoint: /
      if (url.pathname === "/" || url.pathname === "") {
        if (method === "HEAD") {
          return new Response(null, { status: 200, headers: CORS_HEADERS });
        }
        return jsonResponse({
          jsonrpc: "2.0",
          message: "Materio MCP server is running on Cloudflare Workers. Use POST /mcp for JSON-RPC.",
          host: url.hostname,
          oauthDiscovery: "/.well-known/oauth-authorization-server",
        });
      }

      // 4. OpenAPI Specifications
      if (url.pathname === "/openapi.json") {
        const spec = { ...openapiSpec } as any;
        spec.servers = [{ url: url.origin, description: "Current server" }];
        return jsonResponse(spec);
      }

      if (url.pathname === "/openapi.search-lite.json") {
        const spec = { ...openapiLiteSpec } as any;
        spec.servers = [{ url: url.origin, description: "Current server" }];
        return jsonResponse(spec);
      }

      // 5. REST Endpoints for ChatGPT & External Tools
      if (url.pathname === "/api/semesters") {
        const semesters = await listSemesters();
        return jsonResponse({ semesters, count: semesters.length });
      }

      if (url.pathname === "/api/subjects") {
        const sem = url.searchParams.get("semester");
        if (!sem) return jsonResponse({ error: "semester query parameter required" }, 400);
        const subjects = await listSubjects(sem);
        return jsonResponse({ semester: sem, subjects, count: subjects.length });
      }

      if (url.pathname === "/api/resources") {
        const sem = url.searchParams.get("semester");
        const sub = url.searchParams.get("subject");
        if (!sem || !sub) return jsonResponse({ error: "semester and subject parameters required" }, 400);
        const items = await listResources(sem, sub);
        return jsonResponse({ semester: sem, subject: sub, resources: items, count: items.length });
      }

      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("query") || url.searchParams.get("q");
        const sem = url.searchParams.get("semester") || undefined;
        if (!q) return jsonResponse({ error: "query parameter required" }, 400);
        const result = await findResources(q, sem);
        return jsonResponse(result);
      }

      if (url.pathname === "/api/pdf-url") {
        const sem = url.searchParams.get("semester");
        const sub = url.searchParams.get("subject");
        const topic = url.searchParams.get("topic");
        if (!sem || !sub || !topic) {
          return jsonResponse({ error: "semester, subject, and topic parameters required" }, 400);
        }
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
        return jsonResponse({
          semester: sem,
          subject: match?.subject ?? sub,
          topic: match?.topic ?? topic,
          shareLink,
        });
      }

      if (url.pathname === "/api/index") {
        const index = await getFullIndex();
        return jsonResponse({ totalSubjects: index.length, library: index });
      }

      if (url.pathname === "/api/snap-search") {
        const q = url.searchParams.get("query") || url.searchParams.get("q");
        const sem = url.searchParams.get("semester") || undefined;
        const sub = url.searchParams.get("subject") || undefined;
        if (!q) return jsonResponse({ error: "query parameter required" }, 400);

        const pageRaw = url.searchParams.get("page");
        const resultsPerPageRaw = url.searchParams.get("results_per_page");
        const currentPage = Math.max(1, Number(pageRaw ?? 1) || 1);
        const resultsPerPage = Math.min(20, Math.max(1, Number(resultsPerPageRaw ?? 3) || 3));
        const fetchCount = Math.max(currentPage * resultsPerPage, 10);
        const results = await queryVectorlessRAG(q, sem, sub, fetchCount);

        const startIndex = (currentPage - 1) * resultsPerPage;
        const pageResults = results.slice(startIndex, startIndex + resultsPerPage);
        return jsonResponse({
          query: q,
          semester: sem ?? null,
          subject: sub ?? null,
          page: currentPage,
          resultsPerPage,
          results: pageResults,
          count: pageResults.length,
          hasMore: results.length > startIndex + resultsPerPage,
        });
      }

      if (url.pathname === "/api/deep-think") {
        const { accessTier } = await resolveUserFromHeaders(request.headers, url.searchParams);
        const accessCheck = checkToolAccess(accessTier, "plus");
        if (!accessCheck.allowed) {
          return jsonResponse(
            {
              error: accessCheck.message,
              status: accessCheck.status,
              upgradeUrl: "https://auth.getmaterio.app",
            },
            accessCheck.status === "UNAUTHENTICATED" ? 401 : 403,
            {
              "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
            }
          );
        }

        const q = url.searchParams.get("query") || url.searchParams.get("q");
        const sem = url.searchParams.get("semester");
        const sub = url.searchParams.get("subject");
        if (!q || !sem || !sub) {
          return jsonResponse({ error: "query, semester, and subject parameters required" }, 400);
        }

        const results = await queryDeepThinkRAG(q, sem, sub, 5);
        return jsonResponse({ query: q, semester: sem, subject: sub, results });
      }

      if (url.pathname === "/api/share-link") {
        const directUrl = (url.searchParams.get("url") || "").trim();
        const sem = url.searchParams.get("semester");
        const sub = url.searchParams.get("subject");
        const topic = url.searchParams.get("topic");

        let rawUrl = directUrl;
        if (rawUrl && (rawUrl.includes("?share=") || rawUrl.includes("getmaterio.app/?share="))) {
          return jsonResponse(
            { error: "HARD GUARDRAIL: Input URL is already a masked share link. Masked share links cannot be re-masked." },
            400
          );
        }

        let resolvedSubject = sub;
        let resolvedTopic = topic;

        if (!rawUrl) {
          if (!sem || !sub || !topic) {
            return jsonResponse({ error: "Provide either url, or semester + subject + topic" }, 400);
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
          return jsonResponse({ error: "Could not resolve a valid PDF document to generate a share link." }, 404);
        }

        const maskedUrl = await generateMaskedUrl(rawUrl);
        // HARD GUARDRAIL: Return ONLY masked sharelink, NEVER expose internal CDN URL
        return jsonResponse({
          shareLink: maskedUrl,
          maskedUrl,
          subject: resolvedSubject,
          topic: resolvedTopic,
        });
      }

      if (url.pathname === "/api/lookup-external-sources") {
        const q = url.searchParams.get("query") || url.searchParams.get("q");
        if (!q) return jsonResponse({ error: "query parameter required" }, 400);
        const results = await lookupExternalSources(q);
        return jsonResponse({ query: q, results });
      }

      // 6. MCP Proxy Endpoint: /api/mcp-proxy
      if (url.pathname === "/api/mcp-proxy") {
        const target = url.searchParams.get("target");
        if (!target) return jsonResponse({ error: "Missing target URL" }, 400);

        const proxyHeaders = new Headers(request.headers);
        proxyHeaders.delete("host");
        proxyHeaders.delete("x-target-url");

        const proxyRes = await fetch(target, {
          method: request.method,
          headers: proxyHeaders,
          body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        });

        return addCors(proxyRes);
      }

      // Fallback 404
      return jsonResponse({ error: `Not found: ${url.pathname}` }, 404);
    } catch (err: any) {
      console.error("Worker handler error:", err);
      return jsonResponse({ error: err.message || "Internal Worker Error" }, 500);
    }
  },
};
