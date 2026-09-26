/**
 * Shared CORS origin checks - ported from api/_config_shared/cors-origins.js
 * Cloudflare compatible (ESM)
 */
export const STATIC_ALLOWED_ORIGINS = [
  'https://getmaterio.app',
  'https://www.getmaterio.app',
  'https://materioa.netlify.app',
  'https://materioa.vercel.app',
  'https://materioapp.in',
  'https://auth-materioa.netlify.app',
  'https://insightroom.vercel.app',
  'https://room.getmaterio.app',
  'http://localhost:8888',
  'http://localhost:5173',
  'http://localhost:1000',
  'http://localhost:3000',
  'http://localhost:4000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://tauri.localhost',
  'http://tauri.localhost',
  'tauri://localhost'
];

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin === 'https://getmaterio.app' || origin.endsWith('.getmaterio.app')) return true;
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return true;
  if (origin.startsWith('tauri://')) return true;
  // Allow devtunnels
  if (origin.includes('.devtunnels.ms')) return true;
  return false;
}

export function corsHeaders(origin) {
  let corsOrigin = '*';
  if (origin && isAllowedOrigin(origin)) corsOrigin = origin;
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
