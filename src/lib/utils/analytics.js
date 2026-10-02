// Materio analytics tracker (exodus port of materio/assets/scripts/sync.js).
//
// Same payload contract as the old app (p_anon_id / p_date / p_metrics_diff /
// p_usermeta_diff -> POST /api/v2/features?action=analytics -> Supabase
// merge_daily_stats), so the backend, leaderboard and PDF view counts work
// unchanged. Differences from the old tracker are all cost cuts:
//   - PDF open/close comes from pdfModalStore, not MutationObserver DOM
//     scraping + iframe polling. Zero DOM cost, exact counts, every open path
//     covered (search, reading form, downloads, share links, keyboard).
//   - Tab switches come from the activeTab store, not click delegation.
//   - No wall of per-element click hooks; a small allowlist of key CTAs only.
//   - Flush discipline: 1s debounce, 3-min idle-gated heartbeat, beacon on
//     hide, single-slot pending retry, never sends empty payloads.
// Backend rate limit is 90/min/anon; this client stays ~100x under it.

import { pdfModalStore, activeTab } from '$lib/stores.js';
import { toApiUrl } from '$lib/config/api.js';

const ANALYTICS_URL = '/api/v2/features?action=analytics';
const STORAGE_ANON_ID = 'materio_anon_id';
const STORAGE_PENDING = 'materio_analytics_pending';
const STORAGE_DEVICE_CTX = 'materio_device_ctx';
// appVersion is refreshed live on every flush (a user who updates the app
// must show up under the new version immediately); the other fields are
// hardware-stable and cached per install.
const APP_VERSION_TIMEOUT_MS = 1000;
// Heartbeat is the only recurring load (each flush = 1 worker invocation +
// 1 Mongo moderation read + 1 Supabase RPC per active user). 10 min + a
// minimum-data gate keeps volume ~3x under the old 3-min cadence while clean
// exits still flush instantly via beacon. Worst case on a browser crash is 10
// min of trailing engagement lost; PDF opens/closes always flush immediately.
const HEARTBEAT_FLUSH_MS = 10 * 60 * 1000;
const HEARTBEAT_MIN_ENGAGEMENT_SEC = 15;
const MAX_PDF_ENTRIES = 30; // mirrors the server cap

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function generateFingerprint() {
  try {
    const nav = window.navigator;
    const screen = window.screen;
    const data = [
      nav.userAgent,
      nav.language,
      screen.colorDepth,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      nav.platform,
      nav.hardwareConcurrency
    ].join('###');
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(16);
  } catch {
    return 'nofp';
  }
}

function readSettings() {
  const s = {};
  const keys = [
    'theme', 'accentColor', 'invertMode', 'paperMode', 'nightMode', 'einkMode',
    'enableBg', 'selectedWallpaper', 'notificationsEnabled', 'hapticToggle'
  ];
  try {
    document.cookie.split(';').forEach((c) => {
      const p = c.trim().split('=');
      if (p.length < 2) return;
      const clean = p[0].replace(/^materio_/, '');
      if (keys.includes(clean) && s[clean] === undefined) s[clean] = decodeURIComponent(p.slice(1).join('='));
    });
    keys.forEach((k) => {
      if (s[k] !== undefined) return;
      const v = localStorage.getItem(k) || localStorage.getItem(`materio_${k}`);
      if (v !== null) s[k] = v;
    });
  } catch {}
  return s;
}

function readUserId() {
  try {
    for (const key of ['materio_user', 'user']) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const u = JSON.parse(raw);
      const id = u?.id || u?.user_id || u?.uuid || null;
      if (id) return String(id);
    }
  } catch {}
  return null;
}

function normalizePdfTitle(title) {
  return String(title || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120) || 'unknown';
}

function cleanStr(v, max) {
  return String(v || '').trim().slice(0, max) || null;
}

// Stable native device context (platform, model, OS, per-install UUID).
// Hardware doesn't change, so this is bridged at most once per install and
// cached. appVersion is deliberately EXCLUDED: it refreshes live per flush
// (see getFreshAppVersion) so updated apps report the new version at once.
// Web returns null — UA/screen/fingerprint already cover it. Everything is
// optional-chained: unknown plugin shapes or a missing bridge just yield
// fewer fields, never a throw.
let _stableCtxPromise = null;
function getStableDeviceCtx() {
  if (_stableCtxPromise) return _stableCtxPromise;
  _stableCtxPromise = (async () => {
    try {
      const cached = localStorage.getItem(STORAGE_DEVICE_CTX);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object' && (parsed.platform || parsed.installId || parsed.model)) {
          return {
            platform: parsed.platform || null,
            model: parsed.model || null,
            osVersion: parsed.osVersion || null,
            installId: parsed.installId || null
          };
        }
      }
    } catch {}
    let stable = null;
    try {
      const isCapacitor =
        !!window.Capacitor || !!window.AndroidBridge || window.location?.protocol === 'capacitor:';
      const isTauri =
        !!window.__TAURI_INTERNALS__ || !!window.__TAURI__ || window.location?.protocol === 'tauri:';
      if (isCapacitor) {
        const { Device } = await import('@capacitor/device').catch(() => ({}));
        const [idRes, infoRes] = await Promise.all([
          Device?.getId?.().catch(() => null),
          Device?.getInfo?.().catch(() => null)
        ]);
        stable = {
          platform: cleanStr(infoRes?.platform, 16) || 'android',
          model: cleanStr(infoRes?.model, 100),
          osVersion: cleanStr(infoRes?.osVersion, 32),
          installId: cleanStr(idRes?.identifier, 128)
        };
      } else if (isTauri) {
        stable = { platform: 'windows', model: null, osVersion: null, installId: null };
      }
    } catch {}
    if (stable && (stable.platform || stable.model || stable.osVersion || stable.installId)) {
      try {
        localStorage.setItem(STORAGE_DEVICE_CTX, JSON.stringify(stable));
      } catch {}
      return stable;
    }
    return null;
  })().catch(() => null);
  return _stableCtxPromise;
}

// Fresh app version on every flush: one cheap bridge call, timeout-raced so
// a wedged bridge never blocks analytics. Falls back to null (server keeps
// the row; version distribution just skips that flush).
async function getFreshAppVersion() {
  try {
    const lookup = (async () => {
      try {
        if (!!window.Capacitor || !!window.AndroidBridge || window.location?.protocol === 'capacitor:') {
          const { App } = await import('@capacitor/app').catch(() => ({}));
          const info = await App?.getInfo?.().catch(() => null);
          if (info?.version) return cleanStr(info.version, 32);
        }
      } catch {}
      try {
        if (typeof __MATERIO_APP_VERSION__ !== 'undefined' && __MATERIO_APP_VERSION__) {
          return cleanStr(__MATERIO_APP_VERSION__, 32);
        }
      } catch {}
      return null;
    })();
    return await Promise.race([
      lookup,
      new Promise((resolve) => setTimeout(() => resolve(null), APP_VERSION_TIMEOUT_MS))
    ]);
  } catch {
    return null;
  }
}

async function getDeviceContext() {
  try {
    const [stable, appVersion] = await Promise.all([getStableDeviceCtx(), getFreshAppVersion()]);
    if (!stable) return null;
    return { ...stable, appVersion: appVersion || null };
  } catch {
    return null;
  }
}

class ExodusAnalytics {
  constructor() {
    if (typeof window === 'undefined') return;
    if (window.__materioAnalyticsInstalled) return;
    window.__materioAnalyticsInstalled = true;

    this.anonId = this._loadIdentity();
    this.userId = readUserId();
    this.metricsDiff = { total_reading_sec: 0, pdf_counts: {} };
    this.usermetaDiff = {
      total_engagement_sec: 0,
      session: null,
      engagement: { clicks: {}, scroll: 0, zoom: 0, shortcuts: {} },
      state: null
    };
    this._pageActiveTs = Date.now();
    this._pdfTitle = null;
    this._pdfOpenTs = 0;
    this._lastActivityTs = Date.now();
    this._lastPdfScrollTs = Date.now();
    this._flushTimer = null;
    this._lastFlushAt = 0;
    this._idleMs = { page: 120000, pdf: 300000 };
    this._lastTab = null;
    this._init();
  }

  _loadIdentity() {
    let id = null;
    try {
      id = localStorage.getItem(STORAGE_ANON_ID);
      if (!id) {
        const found = document.cookie
          .split(';')
          .find((c) => c.trim().startsWith(STORAGE_ANON_ID + '='));
        if (found) id = found.split('=')[1];
      }
      if (!id) {
        id = `${generateFingerprint()}-${Math.random().toString(36).substring(2, 10)}`;
        localStorage.setItem(STORAGE_ANON_ID, id);
      }
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 2);
      document.cookie = `${STORAGE_ANON_ID}=${id}; expires=${expiry.toUTCString()}; path=/; SameSite=Lax`;
    } catch {}
    return id;
  }

  _init() {
    this._retryPending();
    this._prepareSession();
    this._refreshState();
    this._setupActivityListeners();
    this._setupHeartbeat();
    this._setupStoreSubscriptions();
    this._setupClickTracking();
  }

  _setupHeartbeat() {
    setInterval(() => {
      try {
        const now = Date.now();
        const idleThreshold = this._pdfTitle ? this._idleMs.pdf : this._idleMs.page;
        if (now - this._lastActivityTs > idleThreshold) return;
        this._recordEngagementUntil(now);
        if (!this._hasHeartbeatWorthyData()) return;
        if (this._lastFlushAt && now - this._lastFlushAt < HEARTBEAT_FLUSH_MS) return;
        this._flush();
      } catch {}
    }, HEARTBEAT_FLUSH_MS);
  }

  // Heartbeat gate: only spend a request when something worth persisting
  // accumulated (a real reading session, clicks, or the once-daily session).
  // Tiny idle drips (< 15s, no events) wait for the next gate or exit beacon.
  _hasHeartbeatWorthyData() {
    if (this.usermetaDiff.session) return true;
    if (Object.keys(this.metricsDiff.pdf_counts).length > 0) return true;
    if (Object.keys(this.usermetaDiff.engagement?.clicks || {}).length > 0) return true;
    return (
      this.metricsDiff.total_reading_sec >= HEARTBEAT_MIN_ENGAGEMENT_SEC ||
      this.usermetaDiff.total_engagement_sec >= HEARTBEAT_MIN_ENGAGEMENT_SEC
    );
  }

  _prepareSession() {
    try {
      const flag = `m_exodus_meta_${todayLocalISO()}`;
      if (localStorage.getItem(flag)) return;
      const url = new URL(window.location.href);
      const utm = {};
      url.searchParams.forEach((v, k) => {
        if (['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'].includes(k)) {
          utm[k.replace('utm_', '')] = v;
        }
      });
      this.usermetaDiff.session = {
        ua: navigator.userAgent,
        screen: `${screen.width}x${screen.height}`,
        referrer: document.referrer || null,
        url: window.location.href,
        path: window.location.pathname,
        campaign: utm.campaign || null,
        fp: generateFingerprint()
      };
      localStorage.setItem(flag, '1');
    } catch {}
  }

  _refreshState() {
    this.usermetaDiff.state = { updated: new Date().toISOString(), settings: readSettings() };
  }

  _scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flush();
    }, 1000);
  }

  _recordEngagementUntil(now = Date.now()) {
    if (now <= this._pageActiveTs) return;
    const idleCutoff = this._pdfTitle
      ? this._lastPdfScrollTs + this._idleMs.pdf
      : this._lastActivityTs + this._idleMs.page;
    const engagedSec = Math.floor((Math.min(now, idleCutoff) - this._pageActiveTs) / 1000);
    if (engagedSec > 0) {
      this.usermetaDiff.total_engagement_sec += engagedSec;
      if (this._pdfTitle) {
        this.metricsDiff.total_reading_sec += engagedSec;
        const entry =
          this.metricsDiff.pdf_counts[this._pdfTitle] ||
          (this.metricsDiff.pdf_counts[this._pdfTitle] = { count: 0, time_sec: 0 });
        entry.time_sec += engagedSec;
      }
    }
    this._pageActiveTs = now;
  }

  _openPdf(title) {
    const now = Date.now();
    this._recordEngagementUntil(now);
    const clean = normalizePdfTitle(title);
    // Same-doc reopen within 5s (modal re-render) is not a new open.
    if (this._pdfTitle === clean && now - this._pdfOpenTs < 5000) return;
    this._pdfTitle = clean;
    this._pdfOpenTs = now;
    this._lastPdfScrollTs = now;
    if (Object.keys(this.metricsDiff.pdf_counts).length >= MAX_PDF_ENTRIES && !this.metricsDiff.pdf_counts[clean]) {
      this._flush();
    }
    const entry =
      this.metricsDiff.pdf_counts[clean] ||
      (this.metricsDiff.pdf_counts[clean] = { count: 0, time_sec: 0 });
    entry.count += 1;
    this._refreshState();
    this._scheduleFlush();
  }

  _closePdf() {
    if (!this._pdfTitle) return;
    this._recordEngagementUntil(Date.now());
    this._refreshState();
    this._scheduleFlush();
    this._pdfTitle = null;
    this._pdfOpenTs = 0;
  }

  // Exact PDF lifecycle from the store: every open path (search, reading
  // form, downloads, share links, keyboard) flows through pdfModalStore.
  _setupStoreSubscriptions() {
    try {
      let lastDoc = null;
      pdfModalStore.subscribe((s) => {
        try {
          if (s && s.isOpen && (s.pdfUrl || s.title)) {
            const doc = s.pdfUrl || s.title;
            if (doc !== lastDoc) {
              if (this._pdfTitle) this._closePdf();
              lastDoc = doc;
              this._openPdf(s.title || doc);
            }
          } else if ((!s || !s.isOpen) && this._pdfTitle) {
            lastDoc = null;
            this._closePdf();
          }
        } catch {}
      });
    } catch {}
    try {
      let first = true;
      activeTab.subscribe((tab) => {
        try {
          if (first) {
            first = false;
            this._lastTab = tab;
            return;
          }
          if (tab && tab !== this._lastTab) {
            this._lastTab = tab;
            const clicks = this.usermetaDiff.engagement.clicks;
            clicks[`tab_${tab}`] = (clicks[`tab_${tab}`] || 0) + 1;
            this._refreshState();
            this._scheduleFlush();
          }
        } catch {}
      });
    } catch {}
  }

  _setupClickTracking() {
    // Small allowlist of key CTAs only (guarded: absent IDs cost nothing).
    const idMap = {
      bugReportBtn: 'bug_report',
      sharePdfButton: 'share',
      downloadButton: 'download',
      offerButton: 'promo_cta',
      remindLaterBtn: 'promo_remind_later'
    };
    try {
      document.addEventListener(
        'click',
        (e) => {
          try {
            const t = e.target.closest('[id]');
            const key = t && idMap[t.id];
            if (!key) return;
            const clicks = this.usermetaDiff.engagement.clicks;
            clicks[key] = (clicks[key] || 0) + 1;
            this._refreshState();
            this._scheduleFlush();
          } catch {}
        },
        { passive: true }
      );
    } catch {}
    try {
      const orig = window.openDynamicForm;
      if (typeof orig === 'function' && !orig.__analyticsWrapped) {
        const self = this;
        window.openDynamicForm = function (t, ...a) {
          try {
            const clicks = self.usermetaDiff.engagement.clicks;
            clicks[`form_${t}`] = (clicks[`form_${t}`] || 0) + 1;
            self._refreshState();
            self._scheduleFlush();
          } catch {}
          return orig(t, ...a);
        };
        window.openDynamicForm.__analyticsWrapped = true;
      }
    } catch {}
  }

  _setupActivityListeners() {
    const mark = (isPdfScrollEvent) => {
      const now = Date.now();
      this._recordEngagementUntil(now);
      this._lastActivityTs = now;
      if (this._pdfTitle && isPdfScrollEvent) this._lastPdfScrollTs = now;
    };
    const pdfScrollEvents = new Set(['scroll', 'wheel', 'touchmove']);
    // The event name was never passed to addEventListener, so each call threw
    // "parameter 1 is not of type 'string'", the forEach died on its first
    // iteration, and the surrounding catch swallowed it. That left all six
    // activity listeners unregistered, so _lastActivityTs froze at page load.
    // Two consequences: _recordEngagementUntil capped itself at the idle
    // cutoff forever (2 min, or 5 min in a PDF), and the heartbeat's idle gate
    // was permanently tripped so it never flushed at all. Long reading
    // sessions reported almost nothing.
    // Registered individually so one failure can't take out the rest, and
    // captured because 'scroll' does not bubble (scrollable inner elements).
    ['mousedown', 'keydown', 'scroll', 'touchstart', 'wheel', 'touchmove'].forEach((ev) => {
      try {
        document.addEventListener(ev, () => mark(pdfScrollEvents.has(ev)), {
          passive: true,
          capture: true
        });
      } catch (err) {
        console.warn('[analytics] activity listener failed:', ev, err?.message || err);
      }
    });
    try {
      // Viewer iframe activity bridge (posted by the PDF viewer when present).
      window.addEventListener('message', (event) => {
        try {
          if (event.origin !== window.location.origin) return;
          if (!event.data || event.data.type !== 'pdfUserActivity') return;
          if (!this._pdfTitle) return;
          mark(true);
        } catch {}
      });
      document.addEventListener('visibilitychange', () => {
        try {
          this._recordEngagementUntil(Date.now());
          if (document.visibilityState === 'visible') {
            this._pageActiveTs = Date.now();
            this._lastActivityTs = Date.now();
            if (this._pdfTitle) this._lastPdfScrollTs = Date.now();
          } else {
            this._refreshState();
            this._flush(true);
          }
        } catch {}
      });
      window.addEventListener('pagehide', () => {
        try {
          this._recordEngagementUntil(Date.now());
          this._refreshState();
          this._flush(true);
        } catch {}
      });
    } catch {}
  }

  async _flush(isBeacon = false) {
    try {
      if (document.visibilityState === 'visible') this._recordEngagementUntil(Date.now());
      // Native device context (cached; null on web or bridge failure).
      let device = null;
      try {
        device = await getDeviceContext();
      } catch {}
      const payload = {
        metrics: { ...this.metricsDiff },
        usermeta: { ...this.usermetaDiff, device }
      };
      const hasMetrics =
        payload.metrics.total_reading_sec > 0 || Object.keys(payload.metrics.pdf_counts).length > 0;
      const hasEngagement =
        payload.usermeta.total_engagement_sec > 0 ||
        Object.keys(payload.usermeta.engagement?.clicks || {}).length > 0;
      if (!hasMetrics && !hasEngagement && !payload.usermeta.session) return;

      this._lastFlushAt = Date.now();
      this.userId = readUserId();
      this.metricsDiff = { total_reading_sec: 0, pdf_counts: {} };
      this.usermetaDiff.total_engagement_sec = 0;
      this.usermetaDiff.session = null;
      this.usermetaDiff.engagement = { clicks: {}, scroll: 0, zoom: 0, shortcuts: {} };
      this.usermetaDiff.state = null;

      const url = toApiUrl(ANALYTICS_URL);
      const data = {
        p_anon_id: this.anonId,
        p_date: todayLocalISO(),
        p_metrics_diff: payload.metrics,
        p_usermeta_diff: payload.usermeta,
        p_user_id: this.userId
      };
      if (isBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([JSON.stringify(data)], { type: 'application/json' }));
      } else {
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            keepalive: true
          });
        } catch {
          try {
            localStorage.setItem(STORAGE_PENDING, JSON.stringify(data));
          } catch {}
        }
      }
    } catch {}
  }

  async _retryPending() {
    try {
      const raw = localStorage.getItem(STORAGE_PENDING);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      await fetch(toApiUrl(ANALYTICS_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true
      });
      localStorage.removeItem(STORAGE_PENDING);
    } catch {}
  }
}

let instance = null;

/** Start the tracker once per page load (browser only, DNT respected). */
export function initAnalytics() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    if (navigator.doNotTrack === '1') return null;
    if (!instance) {
      instance = new ExodusAnalytics();
      window.MetricsClient = instance;
      window.SyncManager = instance;
    }
    return instance;
  } catch {
    return null;
  }
}

export default { initAnalytics };
