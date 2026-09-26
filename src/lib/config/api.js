/**
 * Environment-aware API configuration for Web, Tauri (Desktop), and Capacitor (Mobile).
 */

export const isTauri = typeof window !== 'undefined' && Boolean(
  window.__TAURI_INTERNALS__ || 
  window.__TAURI__ || 
  window.__TAURI_METADATA__
);

export const isCapacitor = typeof window !== 'undefined' && Boolean(
  window.Capacitor?.isNativePlatform?.() || 
  window.Capacitor
);

export const isNative = isTauri || isCapacitor;

// In native desktop/mobile apps, requests cannot hit local origin (tauri:// or capacitor://).
// They must point to the remote production backend API on Cloudflare.
const DEFAULT_REMOTE_API = 'https://beta.getmaterio.app';

export const API_BASE_URL = (() => {
  if (typeof window === 'undefined') return DEFAULT_REMOTE_API;
  
  if (isNative || window.location?.protocol === 'tauri:' || window.location?.protocol === 'capacitor:' || window.location?.hostname === 'tauri.localhost') {
    return import.meta.env?.VITE_MATERIO_API_URL || DEFAULT_REMOTE_API;
  }
  
  // On web, relative path uses the current domain/proxy unless explicitly overridden
  return import.meta.env?.VITE_MATERIO_API_URL || '';
})();

/**
 * Helper to build full endpoint URL depending on platform.
 * Example: toApiUrl('/api/v2/search') -> 'https://beta.getmaterio.app/api/v2/search' in native apps
 */
export function toApiUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = API_BASE_URL || DEFAULT_REMOTE_API;
  return `${base}${cleanPath}`;
}

/**
 * Universal fetch wrapper that automatically routes relative API paths in native apps.
 */
export async function apiFetch(path, options = {}) {
  const url = toApiUrl(path);
  return fetch(url, options);
}

/**
 * Automatically intercepts window.fetch in native environments (Tauri and Capacitor)
 * so that any relative API call (/api/..., /llm, /room, etc.) resolves to the full
 * Cloudflare backend URL with proper headers and authentication.
 */
export function installApiInterceptor() {
  if (typeof window === 'undefined') return;
  if (window.__materio_api_interceptor_installed__) return;
  window.__materio_api_interceptor_installed__ = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function(input, init) {
    const isAppNative = isNative || Boolean(
      window.__TAURI_INTERNALS__ ||
      window.__TAURI__ ||
      window.location?.protocol === 'tauri:' ||
      window.location?.protocol === 'capacitor:' ||
      window.location?.hostname === 'tauri.localhost' ||
      window.Capacitor
    );

    if (isAppNative) {
      let rawUrl = '';
      if (typeof input === 'string') {
        rawUrl = input;
      } else if (input instanceof URL) {
        rawUrl = input.toString();
      } else if (input && typeof input === 'object' && 'url' in input) {
        rawUrl = input.url || '';
      }

      const isRelativeInternalEndpoint = 
        rawUrl.startsWith('/api/') || 
        rawUrl.startsWith('api/') ||
        rawUrl.startsWith('/llm') || 
        rawUrl.startsWith('llm') ||
        rawUrl.startsWith('/room') || 
        rawUrl.startsWith('room') ||
        rawUrl.startsWith('/share/llm') ||
        rawUrl.startsWith('share/llm');

      if (isRelativeInternalEndpoint) {
        const cleanPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
        const targetBase = API_BASE_URL || DEFAULT_REMOTE_API;
        const targetUrl = `${targetBase}${cleanPath}`;

        const newInit = { ...init };
        if (!newInit.credentials) {
          newInit.credentials = 'include';
        }

        try {
          const token = localStorage.getItem('token') || localStorage.getItem('materio_auth_token');
          if (token) {
            newInit.headers = new Headers(newInit.headers || {});
            if (!newInit.headers.has('Authorization')) {
              newInit.headers.set('Authorization', `Bearer ${token}`);
            }
          }
        } catch {}

        if (typeof input === 'string' || input instanceof URL) {
          return originalFetch(targetUrl, newInit);
        } else if (input instanceof Request) {
          return originalFetch(new Request(targetUrl, { ...input, ...newInit }));
        }
      }
    }

    return originalFetch(input, init);
  };
}

export default {
  isTauri,
  isCapacitor,
  isNative,
  API_BASE_URL,
  toApiUrl,
  apiFetch,
  installApiInterceptor
};
