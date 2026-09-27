<script>
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';

    // "Open in app" nudge for the web build.
    // - Hidden inside the native Android / desktop shells.
    // - On Android browsers it attempts a one-time silent auto-open (per
    //   session) via an intent: URL — no Play Console needed. Tapping
    //   "Open in app" uses an intent whose fallback is the downloads page,
    //   so a missing app lands on "get the app" instead of an error.
    // - On desktop it tries the materio:// scheme; if nothing handles it,
    //   the card flips to a download ask.
    //
    // Props:
    //   packageId    Android applicationId (default com.materio.app)
    //   scheme       custom scheme registered by the native app (materio://)
    //   downloadsUrl where "Get the app" points

    let {
        packageId = 'com.materio.app',
        scheme = 'materio',
        downloadsUrl = 'https://beta.getmaterio.app/downloads',
        dismissDays = 30
    } = $props();

    let visible = $state(false);
    let isAndroid = $state(false);
    let openFailed = $state(false);

    const DISMISS_KEY = 'materio_open_in_app_dismissed';
    const AUTO_KEY = 'materio_open_in_app_auto';

    function isNativeShell() {
        if (typeof window === 'undefined') return false;
        try {
            if (window.__TAURI_INTERNALS__ || window.__TAURI__ || window.__TAURI_METADATA__) return true;
            if (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) return true;
            if (window.Capacitor?.getPlatform && window.Capacitor.getPlatform() !== 'web') return true;
            if (window.AndroidBridge) return true;
            const h = window.location?.hostname || '';
            const p = window.location?.protocol || '';
            if (p === 'tauri:' || p === 'capacitor:') return true;
            if (h === 'tauri.localhost' || h === 'capacitor.localhost') return true;
        } catch {}
        return false;
    }

    function detectAndroid() {
        try {
            return /Android/i.test(navigator?.userAgent || '');
        } catch {
            return false;
        }
    }

    function dismissedRecently() {
        try {
            const raw = localStorage.getItem(DISMISS_KEY);
            if (!raw) return false;
            return Date.now() - parseInt(raw, 10) < dismissDays * 24 * 60 * 60 * 1000;
        } catch {
            return false;
        }
    }

    function currentPath() {
        try {
            return window.location.pathname + window.location.search + window.location.hash;
        } catch {
            return '/';
        }
    }

    // Manual tap: missing app falls back to the downloads page.
    function intentUrl(fallback) {
        const host = (() => { try { return window.location.host; } catch { return 'beta.getmaterio.app'; } })();
        const fb = encodeURIComponent(fallback || window.location.href);
        return `intent://${host}${currentPath()}#Intent;scheme=https;package=${packageId};S.browser_fallback_url=${fb};end`;
    }

    function schemeUrl() {
        const host = (() => { try { return window.location.host; } catch { return 'beta.getmaterio.app'; } })();
        return `${scheme}://${host}${currentPath()}`;
    }

    function tryAutoOpenAndroid() {
        try {
            if (sessionStorage.getItem(AUTO_KEY)) return;
            sessionStorage.setItem(AUTO_KEY, '1');
            // Give the page a beat to render before handing off. Falls back
            // to this same page, so a missing app just sees the nudge below.
            setTimeout(() => {
                try { window.location.href = intentUrl(window.location.href); } catch {}
            }, 900);
        } catch {}
    }

    export function openInApp() {
        try {
            if (isAndroid) {
                window.location.href = intentUrl(downloadsUrl);
            } else {
                // Desktop: attempt the registered protocol; if nothing handles
                // it we are still here a moment later -> ask to download.
                openFailed = false;
                let left = false;
                const onHide = () => { left = true; };
                window.addEventListener('pagehide', onHide, { once: true });
                window.addEventListener('blur', onHide, { once: true });
                window.location.href = schemeUrl();
                setTimeout(() => {
                    window.removeEventListener('pagehide', onHide);
                    window.removeEventListener('blur', onHide);
                    if (!left) openFailed = true;
                }, 1400);
            }
        } catch {}
    }

    function dismiss() {
        visible = false;
        try {
            localStorage.setItem(DISMISS_KEY, String(Date.now()));
        } catch {}
    }

    onMount(() => {
        if (!browser) return;
        if (isNativeShell()) return;
        if (dismissedRecently()) return;
        isAndroid = detectAndroid();
        if (isAndroid) tryAutoOpenAndroid();
        // Show the banner a moment after load (also the fallback surface
        // if the Android auto-handoff had nowhere to go).
        const t = setTimeout(() => { visible = true; }, isAndroid ? 2200 : 1200);
        return () => clearTimeout(t);
    });
</script>

{#if visible}
    <div class="open-in-app" role="dialog" aria-label="Open in the Materio app">
        {#if openFailed}
            <div class="open-in-app-text">
                <strong>Couldn't open the app</strong>
                <span>It may not be installed yet — want to download it?</span>
            </div>
            <div class="open-in-app-actions">
                <a class="open-in-app-primary" href={downloadsUrl} target="_blank" rel="noopener noreferrer">Download the app</a>
                <button type="button" class="open-in-app-dismiss" onclick={dismiss} aria-label="Dismiss">✕</button>
            </div>
        {:else}
            <div class="open-in-app-text">
                <strong>Materio is better in the app</strong>
                <span>Open this page in the app for the full experience.</span>
            </div>
            <div class="open-in-app-actions">
                <button type="button" class="open-in-app-primary" onclick={openInApp}>Open in app</button>
                <a class="open-in-app-link" href={downloadsUrl} target="_blank" rel="noopener noreferrer">Get the app</a>
                <button type="button" class="open-in-app-dismiss" onclick={dismiss} aria-label="Dismiss">✕</button>
            </div>
        {/if}
    </div>
{/if}

<style>
    .open-in-app {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: 12px;
        z-index: 9000000;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 16px;
        background: #171814;
        color: #f4f4ee;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
        font-size: 13px;
    }
    :global(body:not(.dark-mode)) .open-in-app {
        background: #171814;
        color: #f4f4ee;
    }
    .open-in-app-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .open-in-app-text strong {
        font-size: 13px;
    }
    .open-in-app-text span {
        font-size: 12px;
        opacity: 0.75;
    }
    .open-in-app-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
    }
    .open-in-app-primary {
        border: none;
        border-radius: 10px;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 600;
        background: #ff6b00;
        color: #fff;
        cursor: pointer;
        text-decoration: none;
        display: inline-block;
    }
    .open-in-app-link {
        font-size: 12px;
        color: #ffb37a;
        text-decoration: underline;
        white-space: nowrap;
    }
    .open-in-app-dismiss {
        background: none;
        border: none;
        color: inherit;
        opacity: 0.6;
        cursor: pointer;
        font-size: 14px;
        padding: 4px;
    }
</style>
