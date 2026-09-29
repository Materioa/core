/**
 * promoMagic — Magic actions + per-modal GA/GTM tracking.
 *
 * Admin authors a small JS snippet per promotion / pop-up wizard / interview
 * (stored as `magicJs` + `magicEnabled`, with `trackingId` + `trackViews`).
 * This module runs that snippet safely and fires `modal_view` events.
 *
 * Snippet context (`ctx`):
 * - ctx.root:     modal card element (or document.body fallback).
 *                  Clipped by the card's `overflow: hidden` — keep
 *                  in-card tweaks here (notes, countdowns, styles).
 * - ctx.overlay:  fullscreen overlay element wrapping the card
 *                  (`.promo-modal-overlay` / `.modal-backdrop` /
 *                  `.overlay-fullscreen`, or document.body fallback).
 *                  Not clipped — use for confetti, falling snow,
 *                  spotlights, or anything that should fly around the
 *                  card or fall from the page top. Position children
 *                  `absolute`/`fixed` with `pointer-events: none` and
 *                  return a cleanup that removes them.
 * - ctx.data:     raw promo / form config object
 * - ctx.id:       modal id (promo title fallback / form id)
 * - ctx.kind:     'promotion' | 'popup' | 'interview'
 * - ctx.stage:    'open' | 'submit' | 'close' | 'load'
 * - ctx.formData: live form values (forms only, else undefined)
 * - ctx.close():  closes the modal
 * - ctx.track(name, params): fires a GA/GTM event scoped to this modal
 * - ctx.isApp:    true inside the Android / Windows apps, false on web.
 *                  Skip app-only noise with `if (ctx.isApp) return;`
 * - ctx.platform: 'web' | 'android' | 'windows'
 *
 * Everything is admin-trusted but still guarded: syntax/runtime errors are
 * caught and logged, never break the modal. Tracking scripts load lazily,
 * once per ID, and only when `trackViews` (or an explicit track call) needs them.
 */

const loadedIds = new Set();

export function normaliseTrackingId(raw) {
	if (!raw) return '';
	const id = String(raw).trim().toUpperCase();
	if (/^(G-[A-Z0-9]{6,20}|UA-\d{4,12}-\d{1,4}|GTM-[A-Z0-9]{4,12}|AW-[A-Z0-9]{6,14})$/.test(id)) return id;
	return '';
}

export function trackingKind(id) {
	const clean = normaliseTrackingId(id);
	if (!clean) return null;
	return clean.startsWith('GTM-') ? 'gtm' : 'ga';
}

function isBrowser() {
	return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Where this bundle is running. Mirrors $lib/config/api.js detection:
 * - 'android': Capacitor native (window.Capacitor / AndroidBridge / capacitor: URL)
 * - 'windows': Tauri desktop (window.__TAURI__* / tauri: URL)
 * - 'web':     regular browser
 */
export function detectPlatform() {
	if (!isBrowser()) return 'web';
	try {
		if (
			window.__TAURI_INTERNALS__ ||
			window.__TAURI__ ||
			window.__TAURI_METADATA__ ||
			window.location?.hostname === 'tauri.localhost' ||
			window.location?.protocol === 'tauri:'
		)
			return 'windows';
		const cap = window.Capacitor;
		if (
			(cap?.isNativePlatform && cap.isNativePlatform()) ||
			(cap?.getPlatform && cap.getPlatform() !== 'web') ||
			window.AndroidBridge ||
			window.location?.protocol === 'capacitor:' ||
			window.location?.hostname === 'capacitor.localhost'
		)
			return 'android';
	} catch {}
	return 'web';
}

export function isNativeApp() {
	return detectPlatform() !== 'web';
}

/** Lazily inject gtag.js (GA4/UA/AW) or the GTM container. Safe to call repeatedly. */
export function ensureTracking(trackingId) {
	if (!isBrowser()) return false;
	const id = normaliseTrackingId(trackingId);
	if (!id || loadedIds.has(id)) return loadedIds.has(id);
	const kind = trackingKind(id);

	try {
		window.dataLayer = window.dataLayer || [];
		if (kind === 'gtm') {
			// Standard GTM snippet (single container per id)
			if (!document.querySelector(`script[data-materio-gtm="${id}"]`)) {
				const s = document.createElement('script');
				s.async = true;
				s.setAttribute('data-materio-gtm', id);
				s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
				document.head.appendChild(s);
				window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
			}
		} else {
			// GA4/UA via gtag.js
			if (!window.gtag) {
				window.gtag = function gtag() {
					(window.dataLayer = window.dataLayer || []).push(arguments);
				};
				window.gtag('js', new Date());
			}
			if (!document.querySelector(`script[data-materio-ga="${id}"]`)) {
				const s = document.createElement('script');
				s.async = true;
				s.setAttribute('data-materio-ga', id);
				s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
				document.head.appendChild(s);
			}
			window.gtag('config', id, { send_page_view: false });
		}
		loadedIds.add(id);
		return true;
	} catch (err) {
		console.warn('[magic] tracking inject failed:', err?.message || err);
		return false;
	}
}

function pushEvent({ trackingId, name, params }) {
	if (!isBrowser()) return;
	const id = normaliseTrackingId(trackingId);
	// Always mirror to dataLayer so GTM triggers work even before gtag loads
	try {
		window.dataLayer = window.dataLayer || [];
		window.dataLayer.push({ event: name, ...params });
	} catch {}
	try {
		if (id && trackingKind(id) === 'ga' && typeof window.gtag === 'function') {
			window.gtag('event', name, params);
		}
	} catch (err) {
		console.warn('[magic] track failed:', err?.message || err);
	}
	// Local hook for debugging / custom listeners
	try {
		window.dispatchEvent(new CustomEvent('materio:modal-event', { detail: { name, ...params } }));
	} catch {}
}

/** Fires once per modal open when `trackViews` is on and a trackingId is set. */
export function trackModalView({ id, title, kind, trackingId, trackViews = true }) {
	if (trackViews === false) return false;
	const clean = normaliseTrackingId(trackingId);
	if (!clean) return false;
	ensureTracking(clean);
	pushEvent({
		trackingId: clean,
		name: 'modal_view',
		params: {
			modal_id: String(id || title || 'unknown'),
			modal_title: String(title || id || 'unknown'),
			modal_kind: kind || 'promotion'
		}
	});
	return true;
}

/** Generic scoped event (submit / close / cta_click / custom). */
export function trackModalEvent({ id, title, kind, trackingId, action, params = {} }) {
	const clean = normaliseTrackingId(trackingId);
	if (!clean) return false;
	ensureTracking(clean);
	pushEvent({
		trackingId: clean,
		name: String(action || 'modal_event'),
		params: {
			modal_id: String(id || title || 'unknown'),
			modal_title: String(title || id || 'unknown'),
			modal_kind: kind || 'promotion',
			...params
		}
	});
	return true;
}

/**
 * Runs an admin-authored snippet. Returns a cleanup function if the snippet
 * returns one, else null. Never throws.
 */
export function runMagicJs(code, ctx = {}, opts = {}) {
	const { enabled = true, timeoutNote = '' } = opts;
	if (!enabled) return null;
	if (typeof code !== 'string' || !code.trim()) return null;
	if (!isBrowser()) return null;
	const source = code.slice(0, 20000);

	const fullCtx = {
		root: null,
		overlay: null,
		data: null,
		id: 'unknown',
		kind: 'promotion',
		stage: 'open',
		formData: undefined,
		isApp: undefined,
		platform: undefined,
		close: () => {},
		track: () => false,
		...ctx
	};
	// Shell is auto-detected; an explicitly passed value always wins.
	// Previews pin platform:'web' so they stay in web mode.
	if (typeof fullCtx.platform !== 'string' || !fullCtx.platform) fullCtx.platform = detectPlatform();
	if (typeof fullCtx.isApp !== 'boolean') fullCtx.isApp = fullCtx.platform !== 'web';
	// Backfill overlay when callers only pass root (or vice versa), so
	// snippets always get a usable overlay on web, Android (Capacitor
	// webview) and Windows (Tauri webview) — all three run this bundle.
	try {
		if (!fullCtx.overlay && fullCtx.root && typeof fullCtx.root.closest === 'function') {
			fullCtx.overlay =
				fullCtx.root.closest('.promo-modal-overlay, .modal-backdrop, .overlay-fullscreen') ||
				(fullCtx.root.classList?.contains('promo-modal-overlay') ||
				fullCtx.root.classList?.contains('modal-backdrop') ||
				fullCtx.root.classList?.contains('overlay-fullscreen')
					? fullCtx.root
					: null);
		}
		if (!fullCtx.overlay && typeof document !== 'undefined') fullCtx.overlay = document.body;
		if (!fullCtx.root && fullCtx.overlay && typeof fullCtx.overlay.querySelector === 'function') {
			fullCtx.root = fullCtx.overlay.querySelector('.promo-modal, .modal-card') || fullCtx.overlay;
		}
		if (!fullCtx.root && typeof document !== 'undefined') fullCtx.root = document.body;
	} catch {}
	// Bind ctx.track to this modal so snippets just call ctx.track('cta_click')
	const baseTrack = fullCtx.track;
	fullCtx.track = (name, params = {}) =>
		trackModalEvent({
			id: fullCtx.id,
			title: fullCtx.title || fullCtx.id,
			kind: fullCtx.kind,
			trackingId: fullCtx.trackingId,
			action: name,
			params
		}) || (typeof baseTrack === 'function' ? baseTrack(name, params) : false);

	let fn;
	try {
		fn = new Function('ctx', `"use strict";\n${source}\n${timeoutNote}`);
	} catch (err) {
		console.warn(`[magic] syntax error in "${fullCtx.id}":`, err?.message || err);
		return null;
	}
	try {
		const cleanup = fn(fullCtx);
		if (typeof window !== 'undefined') {
			window.__materioMagic = window.__materioMagic || {};
			window.__materioMagic[fullCtx.id] = { lastStage: fullCtx.stage, at: Date.now() };
		}
		return typeof cleanup === 'function' ? cleanup : null;
	} catch (err) {
		console.warn(`[magic] runtime error in "${fullCtx.id}":`, err?.message || err);
		return null;
	}
}
