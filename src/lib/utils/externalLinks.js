// External links in native app shells (Tauri desktop / Capacitor Android).
//
// Problem: plain `<a href="https://…" target="_blank">` links (room posts,
// status page, share URLs, …) silently do nothing inside the desktop
// WebView — Tauri ships no opener/shell plugin here — so "pages don't open".
// This capture-phase handler opens any off-app http(s) link in the OS
// browser instead: a tiny validated Rust command on desktop, the native
// bridge (ACTION_VIEW intent) on Android. Web behavior is untouched, and
// in-app routes are never intercepted.

function isNativeShell() {
    try {
        return Boolean(
            window.__TAURI_INTERNALS__ ||
            window.__TAURI__ ||
            window.AndroidBridge ||
            window.Capacitor ||
            window.location?.protocol === 'tauri:' ||
            window.location?.protocol === 'capacitor:' ||
            window.location?.hostname === 'tauri.localhost' ||
            window.location?.hostname === 'capacitor.localhost'
        );
    } catch {
        return false;
    }
}

function isTauriShell() {
    try {
        return Boolean(
            window.__TAURI_INTERNALS__ ||
            window.__TAURI__ ||
            window.location?.protocol === 'tauri:' ||
            window.location?.hostname === 'tauri.localhost'
        );
    } catch {
        return false;
    }
}

async function openExternal(url) {
    // Desktop: validated Rust command (http/https only, enforced natively too).
    if (isTauriShell()) {
        try {
            const core = window.__TAURI__?.core;
            if (core?.invoke) {
                await core.invoke('open_external_url', { url });
                return true;
            }
            const legacy = window.__TAURI__?.invoke;
            if (typeof legacy === 'function') {
                await legacy('open_external_url', { url });
                return true;
            }
        } catch (e) {
            console.warn('open_external_url failed:', e);
        }
        return false;
    }
    // Android: native ACTION_VIEW intent via the bridge.
    try {
        if (window.AndroidBridge?.openExternal) {
            window.AndroidBridge.openExternal(url);
            return true;
        }
    } catch (e) {
        console.warn('AndroidBridge.openExternal failed:', e);
    }
    // Last resort: let the shell decide (system browser for _blank).
    try {
        window.open(url, '_blank', 'noopener');
        return true;
    } catch {
        return false;
    }
}

export function installExternalLinkHandler() {
    if (typeof window === 'undefined' || window.__materio_external_links__) return;
    window.__materio_external_links__ = true;

    window.addEventListener(
        'click',
        (e) => {
            try {
                if (!isNativeShell()) return;
                if (e.defaultPrevented || e.button !== 0) return;
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                const anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
                if (!anchor) return;
                const raw = anchor.getAttribute('href');
                if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) return;
                let parsed;
                try {
                    parsed = new URL(raw, window.location.href);
                } catch {
                    return;
                }
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
                // In-app origins stay inside the WebView (SvelteKit handles them).
                const here = window.location;
                const sameOrigin = parsed.hostname === here.hostname &&
                    (parsed.port || '') === (here.port || '') &&
                    parsed.protocol === here.protocol;
                if (sameOrigin) return;
                // Off-app link (room subdomain, status, share, github, …) → OS browser.
                e.preventDefault();
                e.stopPropagation();
                openExternal(parsed.toString());
            } catch {
                // Never break navigation on handler errors.
            }
        },
        true
    );
}
