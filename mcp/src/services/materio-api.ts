// ─────────────────────────────────────────────────────
//  Materio Canonical API Client
//  Connects MCP tools directly to Materio & InsightRoom
// ─────────────────────────────────────────────────────

import crypto from "crypto";
import { API_BASE, INSIGHTROOM_API_BASE } from "../constants.js";

export function signLegacyToken(user?: any): string {
  const secret = process.env.LEGACY_JWT_SECRET || "8EF/5eF2Qm1Oe0xL7kMp7zHSHINjb6bU66U5FcV7AdY=";
  if (!user || !user.id) return "";
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    sub: user.id,
    email: user.email || "",
    username: user.username || "",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 86400,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function getMaterioApiBase(): string {
  return (process.env.MATERIO_API_URL || API_BASE).replace(/\/+$/, "");
}

function getInsightroomApiBase(): string {
  return (process.env.INSIGHTROOM_API_URL || INSIGHTROOM_API_BASE).replace(/\/+$/, "");
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }
  return headers;
}

// ==========================================
// 1. Current Exams (Public Read & Admin Edit)
// ==========================================

export async function fetchCurrentExams(): Promise<any> {
  const base = getMaterioApiBase();
  const res = await fetch(`${base}/api/v2/examdata`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch exam data: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function updateExamData(token: string, examData: Record<string, unknown>, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/examdata`, {
    method: "POST",
    headers: authHeaders(effectiveToken),
    body: JSON.stringify(examData),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to update exam data: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

// ==========================================
// 2. Promotions (Public Active & Admin CRUD)
// ==========================================

export async function fetchActivePromotions(): Promise<any> {
  const base = getMaterioApiBase();
  const res = await fetch(`${base}/api/v2/promotions`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch active promotions: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAllPromotions(token: string, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/promotions?all=true`, {
    headers: authHeaders(effectiveToken),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch all promotions: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

export async function createPromotion(token: string, promoData: Record<string, unknown>, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/promotions`, {
    method: "POST",
    headers: authHeaders(effectiveToken),
    body: JSON.stringify(promoData),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create promotion: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

export async function updatePromotion(token: string, promoData: Record<string, unknown>, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/promotions`, {
    method: "PUT",
    headers: authHeaders(effectiveToken),
    body: JSON.stringify(promoData),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to update promotion: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

export async function deletePromotion(token: string, id: string, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/promotions?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(effectiveToken),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to delete promotion: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

// ==========================================
// 3. Notifications (Public Feed & Admin CRUD)
// ==========================================

export async function fetchNotifications(limit: number = 10): Promise<any> {
  const base = getMaterioApiBase();
  const res = await fetch(`${base}/api/v2/notifications-feed?num=${limit}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch notifications feed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function createNotification(token: string, notifData: {
  title: string;
  message: string;
  category?: string;
  link?: string;
}, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/notifications`, {
    method: "POST",
    headers: authHeaders(effectiveToken),
    body: JSON.stringify(notifData),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create notification: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

export async function updateNotification(token: string, notifData: {
  id: string;
  title?: string;
  message?: string;
  category?: string;
  link?: string;
  [key: string]: unknown;
}, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/notifications`, {
    method: "PUT",
    headers: authHeaders(effectiveToken),
    body: JSON.stringify(notifData),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to update notification: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

export async function deleteNotification(token: string, id: string, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/notifications?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(effectiveToken),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to delete notification: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

// ==========================================
// 4. Personal Cloud Notebooks (User-Scoped)
// ==========================================

export interface NotebookPayload {
  id?: string;
  title: string;
  content: string;
  linkedPdf?: {
    url?: string;
    name?: string;
    subject?: string;
    semester?: string;
    category?: string;
  } | null;
  [key: string]: unknown;
}

export async function fetchUserNotebooks(token: string, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/features?action=notebooks&subAction=list`, {
    method: "GET",
    headers: authHeaders(effectiveToken),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch notebooks: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

export async function syncUserNotebook(token: string, notebook: NotebookPayload, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const noteId = notebook.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${base}/api/v2/features?action=notebooks`, {
    method: "POST",
    headers: authHeaders(effectiveToken),
    body: JSON.stringify({
      subAction: "sync",
      notebook: {
        ...notebook,
        id: noteId,
        updatedAt: new Date().toISOString(),
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to sync notebook: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

export async function deleteUserNotebook(token: string, id: string, user?: any): Promise<any> {
  const base = getMaterioApiBase();
  const effectiveToken = signLegacyToken(user) || token;
  const res = await fetch(`${base}/api/v2/features?action=notebooks`, {
    method: "POST",
    headers: authHeaders(effectiveToken),
    body: JSON.stringify({
      subAction: "delete",
      id,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to delete notebook: ${res.status} ${errText || res.statusText}`);
  }
  return res.json();
}

// ==========================================
// 5. InsightRoom Posts (Public, Plus & Super)
// ==========================================

export async function fetchInsightroomPosts(options: {
  limit?: number;
  subject?: string;
  semester?: string;
  token?: string;
  includePrivate?: boolean;
}): Promise<any> {
  const base = getInsightroomApiBase();
  const params = new URLSearchParams();
  if (options.limit) params.set("num", String(options.limit));
  if (options.subject) params.set("subject", options.subject);
  if (options.semester) params.set("semester", options.semester);
  if (options.token) params.set("token", options.token);

  const url = `${base}/api/posts?${params.toString()}`;
  const res = await fetch(url, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch insightroom posts: ${res.status} ${res.statusText}`);
  }
  const posts = await res.json();

  if (Array.isArray(posts) && !options.includePrivate) {
    return posts.filter((p: any) => p.visibility !== "private");
  }

  return posts;
}

export async function readInsightroomPost(options: {
  slug: string;
  category?: string;
  token?: string;
  canAccessPrivate?: boolean;
}): Promise<any> {
  const base = getInsightroomApiBase();
  const cat = encodeURIComponent(options.category || "_permalink");
  const slug = encodeURIComponent(options.slug);
  const tokenQuery = options.token ? `?token=${encodeURIComponent(options.token)}` : "";

  const contentUrl = `${base}/api/posts/content/${cat}/${slug}${tokenQuery}`;
  const res = await fetch(contentUrl, {
    headers: authHeaders(options.token),
  });

  if (res.status === 403) {
    return {
      status: "locked",
      isPrivate: true,
      message: "This InsightRoom post is exclusive to Materio Plus and Admin members. Please authenticate with a Plus account to view.",
    };
  }

  if (!res.ok) {
    throw new Error(`Failed to read post content: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return {
    status: "success",
    slug: options.slug,
    category: options.category,
    html: data.html,
  };
}
