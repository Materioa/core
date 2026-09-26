// ─────────────────────────────────────────────────────
//  Constants for the Materio MCP Server
// ─────────────────────────────────────────────────────

/** CDN base for direct PDF downloads */
export const CDN_BASE = "https://cdn.getmaterio.app";

/** API proxy base for pointer / tiny files */
export const API_BASE = "https://getmaterio.app";

/** Insightroom base URL */
export const INSIGHTROOM_API_BASE = "https://room.getmaterio.app";

/** Resource library index URL */
export const RESOURCE_LIB_URL = `${CDN_BASE}/databases/beta/resource.lib.json`;

/** Maximum size (bytes) at which a file is considered a "pointer" */
export const POINTER_THRESHOLD = 1024; // 1 KB

/** Maximum characters in a single tool response */
export const CHARACTER_LIMIT = 25_000;

/** Cache TTL for the resource index (ms) */
export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
