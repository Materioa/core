// Landing / App redirect preferences
// Stored in both cookie (for SSR/hooks if needed) and localStorage for client persistence.

export const SKIP_KEY = 'materio_skip_landing';
export const START_KEY = 'materio_app_start'; // 'root' | 'home'

function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    if (m) {
        try { return decodeURIComponent(m[2]); } catch { return m[2]; }
    }
    return null;
}

function setCookie(name, val) {
    if (typeof document === 'undefined') return;
    // 1 year
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(val)}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

export function getSkipLanding() {
    if (typeof window === 'undefined') return false;
    const raw = getCookie(SKIP_KEY) ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(SKIP_KEY) : null);
    return raw === 'true' || raw === '1';
}

export function setSkipLanding(value) {
    const str = value ? 'true' : 'false';
    setCookie(SKIP_KEY, str);
    try { localStorage.setItem(SKIP_KEY, str); } catch {}
    if (value) {
        try { localStorage.setItem('landing_skipped', 'true'); } catch {}
    } else {
        try { localStorage.removeItem('landing_skipped'); } catch {}
        // Explicit opt-in to the landing page: drop any session "Go to App"
        // override so this toggle stays authoritative.
        clearForceApp();
    }
    if (typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('landingPrefsChanged', { detail: { skip: value } })); } catch {}
    }
}

export function getAppStart() {
    if (typeof window === 'undefined') return 'root';
    const raw = getCookie(START_KEY) ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(START_KEY) : null);
    if (raw === 'home' || raw === 'root') return raw;
    // migration: check older key materio_app_start or default root
    return 'root';
}

export function setAppStart(value) {
    const v = value === 'home' ? 'home' : 'root';
    setCookie(START_KEY, v);
    try { localStorage.setItem(START_KEY, v); } catch {}
    if (typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('landingPrefsChanged', { detail: { start: v } })); } catch {}
    }
}

export function getLandingPrefs() {
    return { skip: getSkipLanding(), start: getAppStart() };
}

// Page-lifetime "force app" flag: set when the user clicks "Go to App" while
// the app-start preference is 'root'. Same-URL navigation (goto('/')) is a
// no-op in SvelteKit and onMount won't re-run, so +page and the root layout
// react to this flag via custom events instead.
//
// Deliberately kept in memory only (NOT sessionStorage/localStorage): a fresh
// page load must unconditionally honor the persisted skip toggle, so "toggle
// off" always means "landing shows" with no stale override surviving reloads.
export function isForceApp() {
    if (typeof window === 'undefined') return false;
    try {
        return !!(window.__materioForceApp || window.__landingForceApp);
    } catch {
        return false;
    }
}

export function setForceApp() {
    if (typeof window === 'undefined') return;
    try { window.__materioForceApp = true; window.__landingForceApp = true; } catch {}
    if (typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('materioForceAppChanged')); } catch {}
        try { window.dispatchEvent(new CustomEvent('landingPrefsChanged')); } catch {}
    }
}

export function clearForceApp() {
    if (typeof window === 'undefined') return;
    try { window.__materioForceApp = false; window.__landingForceApp = false; } catch {}
    if (typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('materioForceAppChanged')); } catch {}
        try { window.dispatchEvent(new CustomEvent('landingPrefsChanged')); } catch {}
    }
}
