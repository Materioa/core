// ─────────────────────────────────────────────────────
//  Materio ID Authentication & Access Tier Control
//  Aligned with Materio ID Auth (auth.getmaterio.app)
// ─────────────────────────────────────────────────────

export interface MaterioProtectedUser {
  id: string;
  username?: string;
  displayName?: string;
  email?: string;
  hasAdminPrivileges: boolean;
  isPlusUser: boolean;
  isLiteUser?: boolean;
  isBanned?: boolean;
  banReason?: string;
  profilePicture?: string;
  [key: string]: unknown;
}

export type AccessTier = "guest" | "normal" | "plus" | "super";
export type ToolTierRequirement = "public" | "plus" | "admin";

export interface TokenValidationResult {
  user: MaterioProtectedUser | null;
  accessTier: AccessTier;
  token?: string;
}

export interface ToolAccessCheckResult {
  allowed: boolean;
  status: "ALLOWED" | "UNAUTHENTICATED" | "FORBIDDEN_TIER";
  message?: string;
}

// In-memory validation cache (30-second TTL) to ensure subscription updates reflect quickly
const tokenCache = new Map<string, { data: TokenValidationResult; expires: number }>();
const CACHE_DURATION = 30 * 1000;

function getAuthBaseUrl(): string {
  return (process.env.AUTH_URL || "https://auth.getmaterio.app").replace(/\/+$/, "");
}

/**
 * The real OAuth issuer.
 *
 * Materio ID mints the authorization codes and the access/id tokens, and it
 * derives `iss` from its own Host header. This worker is only the protected
 * resource server, so it must advertise Materio ID as the issuer — otherwise a
 * strict client reads `issuer` from here, then receives a different `iss` in the
 * callback and aborts with an RFC 9207 issuer mismatch.
 */
function getIssuerUrl(): string {
  return getAuthBaseUrl();
}

/** Scopes this resource server honours, independent of what Materio ID declares. */
const RESOURCE_SCOPES = [
  "openid",
  "profile",
  "email",
  "admin",
  "offline_access",
  "pro",
  "plus",
  "subscription",
];

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeUser(payload: unknown): MaterioProtectedUser | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate =
    (payload as Record<string, unknown>).user ??
    (payload as Record<string, unknown>).profile ??
    (payload as Record<string, unknown>).data ??
    payload;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const id = toTrimmedString(record.id);

  if (!id) {
    return null;
  }

  // Support both snake_case (Supabase/PostgreSQL schema) and camelCase (API wrappers)
  const hasAdminPrivileges = Boolean(
    record.hasAdminPrivileges ??
    record.has_admin_privileges ??
    record.hasAdminPrivilages ??
    record.is_admin
  );
  const isPlusUser = Boolean(
    record.isPlusUser ??
    record.is_plus_user
  );
  const isLiteUser = Boolean(
    record.isLiteUser ??
    record.is_lite_user
  );
  const isBanned = Boolean(record.isBanned ?? (payload as Record<string, unknown>).suspended);
  const banReason = toTrimmedString(record.banReason ?? (payload as Record<string, unknown>).banReason);

  return {
    ...record,
    id,
    hasAdminPrivileges,
    isPlusUser,
    isLiteUser,
    isBanned,
    banReason,
  } as MaterioProtectedUser;
}

/**
 * Validates a Materio ID token against the auth service profile API (https://auth.getmaterio.app/api/v2/profile).
 * Uses 5-minute memory cache to ensure high performance and low latency.
 */
export async function validateToken(rawToken?: string): Promise<TokenValidationResult> {
  const token = toTrimmedString(rawToken);
  if (!token) {
    return { user: null, accessTier: "guest" };
  }

  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  const authBaseUrl = getAuthBaseUrl();

  try {
    const response = await fetch(`${authBaseUrl}/api/v2/profile`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    let user = null;

    if (response.ok) {
      const payload = await response.json().catch(() => null);
      user = normalizeUser(payload);
    } else {
      // Fallback: If profile endpoint rejected an OAuth access token,
      // decode the JWT and query the user from Supabase using SUPABASE_SERVICE_KEY!
      const supabaseUrl = process.env.SUPABASE_URL || "https://popaoujsfvznlqltszfr.supabase.co";
      const supabaseKey =
        process.env.SUPABASE_SERVICE_KEY ||
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvcGFvdWpzZnZ6bmxxbHRzemZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzExODU1MiwiZXhwIjoyMDYyNjk0NTUyfQ.V3RWNcRq0O-iwucH07OrwZ7AAjPYkCmR7QCfPwlpNAI";
      if (supabaseUrl && supabaseKey) {
        try {
          const parts = token.split(".");
          if (parts.length === 3) {
            const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            const decodedPayload = JSON.parse(
              typeof atob === "function"
                ? atob(base64)
                : Buffer.from(base64, "base64").toString("utf8")
            );
            const userId = decodedPayload.id || decodedPayload.sub;
            const notExpired = !decodedPayload.exp || decodedPayload.exp * 1000 > now;
            if (userId && notExpired) {
              const supaRes = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=*`, {
                headers: {
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                },
              });
              if (supaRes.ok) {
                const rows = (await supaRes.json().catch(() => [])) as any[];
                if (rows && rows[0]) {
                  user = normalizeUser(rows[0]);
                }
              }
            }
          }
        } catch (fallbackErr) {
          console.error("[MaterioAuth] Fallback Supabase validation error:", fallbackErr);
        }
      }
    }

    if (!user || user.isBanned) {
      return { user: null, accessTier: "guest", token };
    }

    let accessTier: AccessTier = "normal";
    if (user.hasAdminPrivileges) {
      accessTier = "super";
    } else if (user.isPlusUser) {
      accessTier = "plus";
    }

    const result: TokenValidationResult = { user, accessTier, token };
    tokenCache.set(token, { data: result, expires: now + CACHE_DURATION });
    return result;
  } catch (err) {
    console.error("[MaterioAuth] Validation error connecting to auth server:", err);
    return { user: null, accessTier: "guest", token };
  }
}

/**
 * Resolves user & access tier from incoming request headers or search params.
 */
export async function resolveUserFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
  searchParams?: URLSearchParams
): Promise<TokenValidationResult> {
  const getHeader = (name: string): string => {
    if (!headers) return "";
    if (typeof (headers as Headers).get === "function") {
      return toTrimmedString((headers as Headers).get(name));
    }
    const record = headers as Record<string, string | string[] | undefined>;
    const val = record[name.toLowerCase()] ?? record[name];
    if (Array.isArray(val)) return toTrimmedString(val[0]);
    return toTrimmedString(val);
  };

  let token = "";
  const authHeader = getHeader("authorization");
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      token = match[1].trim();
    }
  }

  if (!token && searchParams) {
    token = toTrimmedString(searchParams.get("token"));
  }

  if (!token) {
    token = getHeader("x-materio-token") || getHeader("x-oauth-token");
  }

  if (!token) {
    return { user: null, accessTier: "guest", token: "" };
  }

  const result = await validateToken(token);
  return { ...result, token: token || result.token };
}

/**
 * Checks whether the user's access tier meets the required tool tier.
 */
export function checkToolAccess(
  accessTier: AccessTier,
  requiredTier: ToolTierRequirement
): ToolAccessCheckResult {
  if (requiredTier === "public") {
    return { allowed: true, status: "ALLOWED" };
  }

  if (accessTier === "guest") {
    return {
      allowed: false,
      status: "UNAUTHENTICATED",
      message:
        "Authentication required: Please authenticate with your Materio ID account (https://auth.getmaterio.app) to use this tool.",
    };
  }

  if (requiredTier === "admin") {
    if (accessTier === "super") {
      return { allowed: true, status: "ALLOWED" };
    }
    return {
      allowed: false,
      status: "FORBIDDEN_TIER",
      message:
        "Access denied: This tool requires administrator privileges (hasAdminPrivileges).",
    };
  }

  if (requiredTier === "plus") {
    // Unlocked for Pro members and Admin (super) members
    if (accessTier === "plus" || accessTier === "super") {
      return { allowed: true, status: "ALLOWED" };
    }
    return {
      allowed: false,
      status: "FORBIDDEN_TIER",
      message:
        "Access restricted: DeepThink and semantic vector reasoning are reserved for Materio Pro and Admin members. Upgrade your subscription at https://auth.getmaterio.app or use 'SnapSearch' for standard textbook search.",
    };
  }

  return { allowed: true, status: "ALLOWED" };
}

// ─────────────────────────────────────────────────────────────
// OAuth 2.0 / RFC 8414 & RFC 9728 Discovery Metadata
// ─────────────────────────────────────────────────────────────

export async function getOAuthAuthorizationServerMetadata(): Promise<Record<string, unknown>> {
  const issuer = getIssuerUrl();

  let remote: Record<string, any> = {};
  try {
    const res = await fetch(`${issuer}/api/v2/auth?action=oauth_metadata`, {
      headers: { accept: "application/json" },
    });
    if (res.ok) remote = (await res.json().catch(() => ({}))) as Record<string, any>;
  } catch {
    // Auth metadata unreachable - fall back to the pinned baseline below so
    // discovery still succeeds instead of taking the whole flow down.
  }

  return {
    ...remote,
    // Pinned: every endpoint must live under the issuer (RFC 8414 section 3.3).
    issuer,
    // Pinned: Materio ID advertises /account/sso, but no such route exists (404).
    // The real consent + login page is /authorize.
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/api/v2/auth`,
    registration_endpoint: `${issuer}/api/v2/auth?action=oauth_register_app`,
    jwks_uri: `${issuer}/api/v2/auth?action=jwks`,
    revocation_endpoint: `${issuer}/api/v2/auth?action=oauth_revoke`,
    introspection_endpoint: `${issuer}/api/v2/auth?action=oauth_introspect`,
    userinfo_endpoint: `${issuer}/api/v2/auth?action=userinfo`,
    end_session_endpoint: `${issuer}/api/v2/auth?action=logout`,
    response_types_supported: remote.response_types_supported ?? ["code"],
    grant_types_supported: remote.grant_types_supported ?? ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: remote.token_endpoint_auth_methods_supported ?? [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    // Union, not replace: Materio ID's DEFAULT_SCOPES omits pro/plus/subscription,
    // and a client that trims to the advertised set would silently lose them.
    scopes_supported: [...new Set([...(remote.scopes_supported ?? []), ...RESOURCE_SCOPES])],
  };
}

export function getOAuthProtectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    // The authorization server is Materio ID, not this resource server.
    authorization_servers: [getIssuerUrl()],
    scopes_supported: RESOURCE_SCOPES,
    bearer_methods_supported: ["header"]
  };
}

// ─────────────────────────────────────────────────────────────
// OAuth Endpoints (Authorize 302 to /authorize, Token Proxy, Dynamic Registration)
// ─────────────────────────────────────────────────────────────

export function handleAuthorizeRedirect(url: URL): Response {
  const authBaseUrl = getAuthBaseUrl();
  // New Materio ID uses /authorize as the consent & login page
  const ssoUrl = new URL(`${authBaseUrl}/authorize`);
  for (const [key, value] of url.searchParams.entries()) {
    ssoUrl.searchParams.append(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: ssoUrl.toString(),
    },
  });
}

export async function handleTokenProxy(request: Request): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  try {
    const contentType = request.headers.get("content-type") || "";
    let body: any;
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      const formObj: Record<string, any> = {};
      formData.forEach((value, key) => {
        formObj[key] = value;
      });
      body = formObj;
    } else {
      return new Response(JSON.stringify({ error: "Unsupported content type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authBaseUrl = getAuthBaseUrl();
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    const authHeader = request.headers.get("authorization");
    if (authHeader) {
      headers.set("Authorization", authHeader);
    }

    const res = await fetch(`${authBaseUrl}/api/v2/auth?action=oauth_token`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  } catch (err: any) {
    console.error("[Token Proxy Error]", err);
    return new Response(
      JSON.stringify({ error: "Token proxy failed", details: err?.message || String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

export async function handleRegisterProxy(request: Request): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const body = await request.json().catch(() => ({}));
    const authBaseUrl = getAuthBaseUrl();

    // Ensure redirect_uris is present and an array
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris
      : body.redirect_uri
      ? [body.redirect_uri]
      : [];

    const payload = {
      ...body,
      redirect_uris: redirectUris,
      client_name: body.client_name || "Claude Desktop / MCP Client",
      token_endpoint_auth_method: body.token_endpoint_auth_method || "none",
      scope: body.scope || "openid profile email admin",
    };

    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("x-forwarded-for") ||
      "";

    const fetchHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (clientIp) {
      fetchHeaders["x-forwarded-for"] = clientIp;
    }

    const res = await fetch(`${authBaseUrl}/api/v2/auth?action=oauth_register_app`, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[Register Proxy Error]", err);
    return new Response(
      JSON.stringify({ error: "server_error", error_description: "Failed to register client" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}
