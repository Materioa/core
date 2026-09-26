// ─────────────────────────────────────────────────────
//  Materio MCP Server — MCP Server Factory
// ─────────────────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMaterioTools } from "./tools/materio.js";
import { registerCommunityTools } from "./tools/community.js";
import { generateDocumentTool, handleGenerateDocument } from "./tools/generate-document.js";
import type { MaterioProtectedUser, AccessTier } from "./services/materio-auth.js";

export interface McpContext {
  user?: MaterioProtectedUser | null;
  accessTier?: AccessTier;
  token?: string;
}

// Helper: create a fresh, tool-registered MCP server instance with optional auth context
export function createMcpServer(context?: McpContext): McpServer {
  const server = new McpServer({
    name: "materio-mcp-server",
    version: "1.0.0",
  });

  // 1. Register course curriculum, search, diagrams, and deepthink tools
  registerMaterioTools(server, context);

  // 2. Register community tools: exams, promos, notifications, notebooks, insightroom posts
  registerCommunityTools(server, context);

  // 3. Document generation
  server.tool(
    generateDocumentTool.name,
    generateDocumentTool.description,
    generateDocumentTool.inputSchema,
    handleGenerateDocument
  );

  return server;
}
