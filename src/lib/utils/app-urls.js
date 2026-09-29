/**
 * Resolves cross-app URLs dynamically based on environment configuration.
 * Always defaults to the full production URLs:
 *   accounts: https://accounts.getmaterio.app
 *   auth:     https://auth.getmaterio.app
 *   admin:    https://admin.getmaterio.app
 *
 * Can be overridden via environment variables if running custom local auth ports:
 *   PUBLIC_MATERIO_AUTH_URL / VITE_MATERIO_AUTH_URL
 *   PUBLIC_MATERIO_ACCOUNTS_URL / VITE_MATERIO_ACCOUNTS_URL
 *   PUBLIC_MATERIO_ADMIN_URL / VITE_MATERIO_ADMIN_URL
 */

export function getAppUrls(currentOrigin) {
  let envAuth = '';
  let envAccounts = '';
  let envAdmin = '';

  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      envAuth = import.meta.env.PUBLIC_MATERIO_AUTH_URL || import.meta.env.VITE_MATERIO_AUTH_URL || '';
      envAccounts = import.meta.env.PUBLIC_MATERIO_ACCOUNTS_URL || import.meta.env.VITE_MATERIO_ACCOUNTS_URL || '';
      envAdmin = import.meta.env.PUBLIC_MATERIO_ADMIN_URL || import.meta.env.VITE_MATERIO_ADMIN_URL || '';
    }
  } catch {}

  try {
    if (!envAuth && typeof process !== 'undefined' && process.env) {
      envAuth = process.env.PUBLIC_MATERIO_AUTH_URL || process.env.VITE_MATERIO_AUTH_URL || '';
      envAccounts = process.env.PUBLIC_MATERIO_ACCOUNTS_URL || process.env.VITE_MATERIO_ACCOUNTS_URL || '';
      envAdmin = process.env.PUBLIC_MATERIO_ADMIN_URL || process.env.VITE_MATERIO_ADMIN_URL || '';
    }
  } catch {}

  return {
    accounts: envAccounts || 'https://accounts.getmaterio.app',
    auth: envAuth || 'https://auth.getmaterio.app',
    admin: envAdmin || 'https://admin.getmaterio.app'
  };
}

/**
 * Returns the SSO login URL with the full callback URL.
 * @param {string} [callbackUrl]
 * @returns {string}
 */
export function getLoginUrl(callbackUrl) {
  const urls = getAppUrls();
  let origin = 'https://getmaterio.app';
  if (typeof window !== 'undefined' && window.location?.origin) {
    origin = window.location.origin;
  }
  const cb = callbackUrl || `${origin}/auth/callback`;
  return `${urls.auth}/login?callback=${encodeURIComponent(cb)}`;
}

/**
 * Returns the SSO signup URL with the full callback URL.
 * @param {string} [callbackUrl]
 * @returns {string}
 */
export function getSignupUrl(callbackUrl) {
  const urls = getAppUrls();
  let origin = 'https://getmaterio.app';
  if (typeof window !== 'undefined' && window.location?.origin) {
    origin = window.location.origin;
  }
  const cb = callbackUrl || `${origin}/auth/callback`;
  return `${urls.auth}/signup?callback=${encodeURIComponent(cb)}`;
}

/**
 * Returns the full accounts overview URL.
 * @returns {string}
 */
export function getOverviewUrl() {
  const urls = getAppUrls();
  return `${urls.accounts}/overview`;
}

export default getAppUrls;
