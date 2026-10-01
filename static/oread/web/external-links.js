// Opens off-app http(s) links in the OS browser from inside the PDF viewer.
//
// Why this file exists: the desktop WebView ships no opener/shell plugin, so a
// plain `<a target="_blank">` silently does nothing — which is why the
// dictionary card's "source" link appeared dead in the desktop app. The Svelte
// app installs the equivalent handler in src/lib/utils/externalLinks.js, but
// that listener lives in the PARENT window and this viewer runs in an
// same-origin IFRAME, so parent-document handlers never see these clicks.
//
// Mirrors externalLinks.js: validated Rust command on Tauri, native bridge on
// Android, window.open as the last resort. In-app and non-http(s) links are
// left alone so the viewer's own navigation is untouched.
(function () {
  'use strict';

  if (typeof window === 'undefined' || window.__oreadExternalLinks) return;
  window.__oreadExternalLinks = true;

  function isTauri() {
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

  function isNative() {
    try {
      return isTauri() || Boolean(window.AndroidBridge || window.Capacitor ||
        window.location?.protocol === 'capacitor:' ||
        window.location?.hostname === 'capacitor.localhost');
    } catch {
      return false;
    }
  }

  async function openExternal(url) {
    if (isTauri()) {
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
        console.warn('[oread] open_external_url failed:', e);
      }
      return false;
    }
    try {
      if (window.AndroidBridge?.openExternal) {
        window.AndroidBridge.openExternal(url);
        return true;
      }
    } catch (e) {
      console.warn('[oread] AndroidBridge.openExternal failed:', e);
    }
    try {
      window.open(url, '_blank', 'noopener');
      return true;
    } catch {
      return false;
    }
  }

  window.addEventListener('click', (event) => {
    try {
      if (!isNative()) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;

      const raw = anchor.getAttribute('href');
      if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') ||
        raw.startsWith('javascript:')) return;

      let parsed;
      try {
        parsed = new URL(raw, window.location.href);
      } catch {
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

      // Same-origin stays in the viewer (PDF.js handles those itself).
      const here = window.location;
      if (parsed.hostname === here.hostname &&
        (parsed.port || '') === (here.port || '') &&
        parsed.protocol === here.protocol) return;

      event.preventDefault();
      event.stopPropagation();
      openExternal(parsed.toString());
    } catch {
      // Never break navigation on handler errors.
    }
  }, true);
})();
