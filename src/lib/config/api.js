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
// They must point to the remote production backend API.
const DEFAULT_REMOTE_API = 'https://getmaterio.app';

export const API_BASE_URL = (() => {
  if (typeof window === 'undefined') return '';
  
  if (isNative) {
    return import.meta.env?.VITE_MATERIO_API_URL || DEFAULT_REMOTE_API;
  }
  
  // On web, relative path uses the current domain/proxy unless explicitly overridden
  return import.meta.env?.VITE_MATERIO_API_URL || '';
})();

/**
 * Helper to build full endpoint URL depending on platform.
 * Example: toApiUrl('/api/v2/search') -> 'https://getmaterio.app/api/v2/search' in native apps
 */
export function toApiUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

/**
 * Universal fetch wrapper that automatically routes relative API paths in native apps.
 */
export async function apiFetch(path, options = {}) {
  const url = toApiUrl(path);
  return fetch(url, options);
}

export default {
  isTauri,
  isCapacitor,
  isNative,
  API_BASE_URL,
  toApiUrl,
  apiFetch
};
