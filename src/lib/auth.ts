export const COOKIE_NAME = 'materio_auth_token';
export const USER_KEY = 'materio_user';

// Get cookie utility
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

// Set wildcard subdomain cookie
export function setAuthCookie(token: string) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30); // 30 days
  
  let cookieString = `${COOKIE_NAME}=${token}; path=/; expires=${expiryDate.toUTCString()}; SameSite=Lax; Secure`;
  
  // Set on wildcard parent domain if running on getmaterio.app
  if (window.location.hostname.endsWith('getmaterio.app')) {
    cookieString += '; domain=.getmaterio.app';
  }
  
  document.cookie = cookieString;
}

// Clear cookie
export function clearAuthCookie() {
  let cookieString = `${COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure`;
  if (window.location.hostname.endsWith('getmaterio.app')) {
    cookieString += '; domain=.getmaterio.app';
  }
  document.cookie = cookieString;
  localStorage.removeItem(USER_KEY);
}
