(function () {
  'use strict';

  const THINKLET_LOCAL_URL = 'http://localhost:5173/new';
  const THINKLET_PROD_URL = 'https://chat.getmaterio.app/new';
  const THINKLET_WIDTH_KEY = 'materio_thinklet_panel_width';
  const THINKLET_RELEASE_OFFER_END = Date.parse('2026-08-27T00:00:00+05:30');
  let verifiedAccess = false;
  let activePdfUrl = null;
  let selectedQuery = '';
  let selectionMenuTimer = 0;
  let selectionMenuSuppressedUntil = 0;
  let lastTheme = 'light';
  let currentThinkletPath = '/new';

  function getAuthToken() {
    return localStorage.getItem('materio_auth_token') || '';
  }

  function getCookieValue(name) {
    const cookie = document.cookie.split('; ').find(row => row.startsWith(`${name}=`));
    return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : '';
  }

  function getStoredUser() {
    const raw = localStorage.getItem('materio_user') || getCookieValue('materio_user');
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function postThinkletAuth(frame) {
    const token = getAuthToken() || getCookieValue('materio_auth_token');
    const user = getStoredUser();

    if (!frame?.contentWindow || (!token && !user)) {
      return;
    }

    frame.contentWindow.postMessage({
      type: 'MATERIO_AUTH',
      token: token || '',
      user: user || null
    }, '*');
  }

  function attachThinkletAuth(frame) {
    if (!frame) {
      return;
    }

    frame.addEventListener('load', () => postThinkletAuth(frame), { once: true });
    postThinkletAuth(frame);
  }

  function isThinkletReleaseOfferActive() {
    return Date.now() < THINKLET_RELEASE_OFFER_END;
  }

  function profileUrl() {
    // Inside native shells there is no same-origin backend (tauri://,
    // capacitor://), so resolve the absolute production API like
    // showbtnrq.js does instead of a relative path that 404s.
    try {
      const h = window.location.hostname || '';
      const p = window.location.protocol || '';
      const isNative = h === 'tauri.localhost' || h === 'capacitor.localhost' ||
        p === 'tauri:' || p === 'capacitor:' ||
        (h === 'localhost' && window.location.port !== '5173');
      if (isNative) return 'https://getmaterio.app/api/v2/profile';
    } catch (e) { /* ignore */ }
    return '/api/v2/profile';
  }

  // Wait for showbtnrq.js's verdict (it verifies first and publishes
  // window.__materioPlusVerified) instead of racing a duplicate fetch.
  // Thinklet admits lite: a thinklet-level (or legacy save-level) verdict
  // grants access. Returns true/false when known, null on timeout.
  function awaitPlusVerdict(timeoutMs) {
    const read = () => {
      try {
        const v = window.__materioPlusVerified;
        if (v && v.done === true) {
          return (v.thinklet === true || v.save === true || v.plus === true) ? true : false;
        }
      } catch (e) { /* ignore */ }
      return null;
    };
    return new Promise((resolve) => {
      const first = read();
      if (first !== null) {
        resolve(first);
        return;
      }
      const started = Date.now();
      const timer = setInterval(() => {
        const val = read();
        if (val !== null) {
          clearInterval(timer);
          resolve(val);
          return;
        }
        if (Date.now() - started > (timeoutMs || 5000)) {
          clearInterval(timer);
          resolve(null);
        }
      }, 150);
    });
  }

  // Broad paid/admin matching (mirrors showbtnrq.js + the profile server).
  function isPrivilegedUser(u) {
    if (!u || typeof u !== 'object') return false;
    if (u.isPlusUser === true || u.is_plus_user === true || u.is_plus === true ||
      u.isPlus === true || u.plus === true || u.is_pro === true || u.isPro === true ||
      u.isLiteUser === true || u.is_lite_user === true ||
      u.hasAdminPrivileges === true || u.has_admin_privileges === true ||
      u.isAdmin === true || u.is_admin === true ||
      u.isSuperUser === true || u.is_superuser === true ||
      u.isSuperAdmin === true || u.is_super_admin === true ||
      u.superuser === true || u.is_staff === true) return true;
    const tier = String(u.tier || '').trim().toLowerCase();
    if (['plus', 'pro', 'super', 'admin', 'premium', 'lifetime', 'ultimate', 'vip', 'paid'].indexOf(tier) >= 0) return true;
    const role = String(u.role || u.user_role || '').trim().toLowerCase();
    if (['admin', 'superadmin', 'super-admin', 'super', 'superuser', 'owner', 'root', 'staff', 'plus', 'pro'].indexOf(role) >= 0) return true;
    return false;
  }

  async function verifyThinkletAccess() {
    if (isThinkletReleaseOfferActive()) {
      return true;
    }

    try {
      if (window.__materioCheckThinkletStatus?.() === true || window.checkPlusStatus?.() === true) {
        return true;
      }
    } catch (e) { /* ignore */ }

    const verdict = await awaitPlusVerdict(5000);
    if (verdict === true) {
      return true;
    }

    const authToken = getAuthToken();
    if (!authToken) {
      return false;
    }

    try {
      const response = await fetch(profileUrl(), {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const ok = isPrivilegedUser(data.user);
      try {
        console.info('[oread] thinklet check:', JSON.stringify({ ok, tier: data.user?.tier ?? null, role: data.user?.role ?? null }));
      } catch (e) { /* ignore */ }
      return ok;
    } catch (error) {
      console.error('Thinklet access verification failed:', error);
      return false;
    }
  }

  function cleanContextPart(value, fallback) {
    const clean = String(value || '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return clean || fallback;
  }

  function readContextFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const fileUrl = activePdfUrl || params.get('file') || '';
    const context = {
      sem: params.get('sem') || params.get('semester') || '',
      sub: params.get('sub') || params.get('subject') || '',
      topic: params.get('topic') || ''
    };

    if (fileUrl) {
      try {
        const pdfUrl = new URL(fileUrl, window.location.href);
        const parts = pdfUrl.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
        const pdfsIndex = parts.findIndex(part => part.toLowerCase() === 'pdfs');

        if (pdfsIndex >= 0) {
          context.sem ||= parts[pdfsIndex + 1] || '';
          context.sub ||= parts[pdfsIndex + 2] || '';

          const vaultIndex = parts.findIndex(part => part.toLowerCase() === 'vault');
          if (!context.topic && vaultIndex >= 0) {
            context.topic = parts[vaultIndex + 1] || '';
          }

          context.topic ||= parts[parts.length - 1] || '';
        } else {
          context.topic ||= parts[parts.length - 1] || '';
        }
      } catch (error) {
        context.topic ||= fileUrl.split('/').pop() || '';
      }
    }

    return {
      sem: cleanContextPart(context.sem.replace(/^semester\s*/i, ''), 'current semester'),
      sub: cleanContextPart(context.sub, 'this subject'),
      topic: cleanContextPart(context.topic, 'this document')
    };
  }

  function getThinkletBaseUrl() {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    return isLocalhost ? THINKLET_LOCAL_URL : THINKLET_PROD_URL;
  }

  function getThinkletOrigin() {
    return new URL(getThinkletBaseUrl()).origin;
  }

  function getCurrentTheme() {
    if (document.body.classList.contains('dark-mode') || document.documentElement.classList.contains('dark-mode')) {
      return 'dark';
    }

    if (document.body.classList.contains('light-mode') || document.documentElement.classList.contains('light-mode')) {
      return 'light';
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyThinkletUrlParams(url, query = '') {
    const context = readContextFromUrl();
    url.searchParams.set('hide-sidebar-icon', 'true');
    url.searchParams.set('theme', getCurrentTheme());

    url.searchParams.set(
      'shared-context',
      `i am reading ${context.topic} of ${context.sub} from sem ${context.sem}.`
    );

    if (query) {
      url.searchParams.set('query', query);
    }

    return url;
  }

  function buildThinkletUrl(query = '') {
    const url = new URL(getThinkletBaseUrl());
    url.pathname = currentThinkletPath;
    return applyThinkletUrlParams(url, query).toString();
  }

  function getFrameUrl(frame) {
    if (!frame?.src) {
      return null;
    }

    try {
      return new URL(frame.src);
    } catch (error) {
      return null;
    }
  }

  function isThinkletConversationPath(pathname) {
    return /^\/c\/[^/]+/.test(pathname || '');
  }

  function buildThinkletUrlForCurrentChat(frame, query = '') {
    const frameUrl = getFrameUrl(frame);

    if (frameUrl && frameUrl.origin === getThinkletOrigin() && isThinkletConversationPath(frameUrl.pathname)) {
      currentThinkletPath = frameUrl.pathname;
      return applyThinkletUrlParams(frameUrl, query).toString();
    }

    return buildThinkletUrl(query);
  }

  function rememberThinkletRoute(data) {
    const route = data?.url || data?.href || data?.path || data?.pathname;
    if (!route || typeof route !== 'string') {
      return false;
    }

    try {
      const url = new URL(route, getThinkletBaseUrl());
      if (url.origin !== getThinkletOrigin()) {
        return false;
      }

      if (isThinkletConversationPath(url.pathname) || url.pathname === '/new' || url.pathname === '/settings') {
        currentThinkletPath = url.pathname;
        return true;
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  function syncThinkletTheme(forceReload = false) {
    const panel = document.getElementById('thinkletPanel');
    const frame = document.getElementById('thinkletFrame');
    if (!panel || !frame || panel.hidden || !frame.src) {
      return;
    }

    const nextTheme = getCurrentTheme();
    if (!forceReload && nextTheme === lastTheme) {
      return;
    }

    lastTheme = nextTheme;
    frame.src = buildThinkletUrl(selectedQuery);
    attachThinkletAuth(frame);
  }

  function isMobileSheet() {
    return window.matchMedia('(max-width: 870px)').matches;
  }

  function updateBackdrop(open) {
    const backdrop = document.getElementById('thinkletBackdrop');
    if (!backdrop) {
      return;
    }

    backdrop.hidden = !(open && isMobileSheet());
  }

  function bindMobileSheetSwipe() {
    const panel = document.getElementById('thinkletPanel');
    if (!panel || panel.dataset.swipeInitialized) {
      return;
    }

    panel.dataset.swipeInitialized = 'true';

    let startY = 0;
    let currentY = 0;
    let startTime = 0;
    let isDragging = false;

    panel.addEventListener('touchstart', event => {
      if (!isMobileSheet() || panel.hidden) {
        return;
      }

      const touchY = event.touches[0].clientY;
      const panelRect = panel.getBoundingClientRect();
      const isNearHandle = touchY < panelRect.top + 80;
      const isScrolledToTop = panel.scrollTop <= 5;

      if (!isNearHandle && !isScrolledToTop) {
        return;
      }

      startY = touchY;
      currentY = touchY;
      startTime = Date.now();
      isDragging = true;
      panel.style.transition = 'none';
      panel.style.willChange = 'transform';
    }, { passive: true });

    panel.addEventListener('touchmove', event => {
      if (!isDragging || !isMobileSheet()) {
        return;
      }

      currentY = event.touches[0].clientY;
      const deltaY = currentY - startY;

      if (deltaY <= 0) {
        return;
      }

      panel.style.transform = `translateY(${deltaY * 0.6}px)`;
      event.preventDefault();
    }, { passive: false });

    panel.addEventListener('touchend', () => {
      if (!isDragging || !isMobileSheet()) {
        isDragging = false;
        return;
      }

      const deltaY = currentY - startY;
      const elapsed = Math.max(Date.now() - startTime, 1);
      const velocity = deltaY / elapsed;
      const shouldDismiss = deltaY > 80 || velocity > 0.5;

      panel.style.transition = 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)';

      if (shouldDismiss) {
        panel.style.transform = 'translateY(100%)';
        setTimeout(() => {
          panel.style.transform = '';
          panel.style.transition = '';
          panel.style.willChange = '';
          setPanelOpen(false);
        }, 360);
      } else {
        panel.style.transform = 'translateY(0)';
        setTimeout(() => {
          panel.style.transform = '';
          panel.style.transition = '';
          panel.style.willChange = '';
        }, 360);
      }

      isDragging = false;
    }, { passive: true });
  }

  function setPanelOpen(open, query = '', options = {}) {
    const button = document.getElementById('thinkletButton');
    const panel = document.getElementById('thinkletPanel');
    const frame = document.getElementById('thinkletFrame');

    if (!button || !panel || !frame || !verifiedAccess) {
      return;
    }

    if (open) {
      let nextUrl = '';
      let shouldLoadFrame = false;

      if (options.keepCurrentFrame && frame.src) {
        shouldLoadFrame = false;
      } else {
        if (options.reuseCurrentChat) {
          nextUrl = buildThinkletUrlForCurrentChat(frame, query);
        } else {
          currentThinkletPath = '/new';
          nextUrl = buildThinkletUrl(query);
        }

        shouldLoadFrame = !frame.src || frame.src !== nextUrl;
      }

      applyStoredPanelWidth();
      if (shouldLoadFrame) {
        frame.src = nextUrl;
        attachThinkletAuth(frame);
      }
      lastTheme = getCurrentTheme();
      selectedQuery = query;
      panel.hidden = false;
      updateBackdrop(true);
      button.classList.add('toggled');
      button.setAttribute('aria-expanded', 'true');
      document.body.classList.add('thinkletPanelOpen');
      return;
    }

    panel.hidden = true;
    updateBackdrop(false);
    button.classList.remove('toggled');
    button.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('thinkletPanelOpen');
  }

  function clampPanelWidth(width) {
    const minWidth = 340;
    const maxWidth = Math.max(minWidth, Math.min(760, Math.floor(window.innerWidth * 0.72), window.innerWidth - 350));
    return Math.min(Math.max(Math.round(width), minWidth), maxWidth);
  }

  function setPanelWidth(width) {
    const nextWidth = clampPanelWidth(width);
    document.documentElement.style.setProperty('--thinklet-panel-width', `${nextWidth}px`);
    return nextWidth;
  }

  function applyStoredPanelWidth() {
    const savedWidth = Number(localStorage.getItem(THINKLET_WIDTH_KEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      setPanelWidth(savedWidth);
    }
  }

  function updateOpenPanelContext() {
    const panel = document.getElementById('thinkletPanel');
    const frame = document.getElementById('thinkletFrame');

    if (verifiedAccess && panel && frame && !panel.hidden && currentThinkletPath === '/new') {
      frame.src = buildThinkletUrl(selectedQuery);
      attachThinkletAuth(frame);
    }
  }

  function getSelectedText() {
    return window.getSelection?.().toString().replace(/\s+/g, ' ').trim() || '';
  }

  function getSelectionMenuPoint() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return null;
    }

    return {
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom + 8
    };
  }

  function hideSelectionMenu() {
    const menu = document.getElementById('thinkletSelectionMenu');
    if (menu) {
      menu.hidden = true;
    }
  }

  function showSelectionMenu(point, text) {
    const menu = document.getElementById('thinkletSelectionMenu');
    const button = document.getElementById('thinkletAskSelectionButton');
    if (!menu || !button) {
      return;
    }

    selectedQuery = text;
    menu.hidden = false;

    const padding = 8;
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(point.clientX, window.innerWidth - menuRect.width - padding);
    const top = Math.min(point.clientY, window.innerHeight - menuRect.height - padding);
    menu.style.left = `${Math.max(padding, left)}px`;
    menu.style.top = `${Math.max(padding, top)}px`;
  }

  function postThinkletQuery(query) {
    const frame = document.getElementById('thinkletFrame');
    if (!frame || !frame.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage({
      type: 'MATERIO_SET_QUERY',
      query,
      autoSubmit: false
    }, '*');
  }

  function queueSelectionMenuUpdate() {
    window.clearTimeout(selectionMenuTimer);
    selectionMenuTimer = window.setTimeout(() => {
      const panel = document.getElementById('thinkletPanel');
      if (!verifiedAccess || Date.now() < selectionMenuSuppressedUntil || panel?.contains(document.activeElement)) {
        return;
      }

      const text = getSelectedText();
      if (!text) {
        hideSelectionMenu();
        return;
      }

      const point = getSelectionMenuPoint();
      if (!point) {
        hideSelectionMenu();
        return;
      }

      showSelectionMenu(point, text);
    }, 60);
  }

  function askSelectedText() {
    const query = selectedQuery || getSelectedText();
    if (!query) {
      hideSelectionMenu();
      return;
    }

    selectedQuery = query;
    selectionMenuSuppressedUntil = Date.now() + 600;
    hideSelectionMenu();
    const panel = document.getElementById('thinkletPanel');
    const frame = document.getElementById('thinkletFrame');
    const frameUrl = getFrameUrl(frame);
    const canRewriteCurrentChat = frameUrl?.origin === getThinkletOrigin() && isThinkletConversationPath(frameUrl.pathname);

    if (canRewriteCurrentChat) {
      setPanelOpen(true, query, { reuseCurrentChat: true });
    } else if (frame?.src && currentThinkletPath !== '/settings') {
      setPanelOpen(true, query, { keepCurrentFrame: true });
    } else {
      setPanelOpen(true, query);
    }

    postThinkletQuery(`Explain this: ${query}`);
  }

  function bindThinkletControls() {
    const button = document.getElementById('thinkletButton');
    const closeButton = document.getElementById('thinkletCloseButton');
    const settingsButton = document.getElementById('thinkletSettingsButton');
    const resizeHandle = document.getElementById('thinkletResizeHandle');
    const askSelectionButton = document.getElementById('thinkletAskSelectionButton');
    const backdrop = document.getElementById('thinkletBackdrop');

    button?.addEventListener('click', () => {
      const panel = document.getElementById('thinkletPanel');
      setPanelOpen(panel?.hidden !== false);
    });

    closeButton?.addEventListener('click', () => setPanelOpen(false));
    backdrop?.addEventListener('click', () => setPanelOpen(false));
    askSelectionButton?.addEventListener('click', askSelectedText);
    settingsButton?.addEventListener('click', () => {
      const panel = document.getElementById('thinkletPanel');
      const frame = document.getElementById('thinkletFrame');
      if (!panel || !frame || !verifiedAccess) {
        return;
      }

      currentThinkletPath = '/settings';
      lastTheme = getCurrentTheme();
      applyStoredPanelWidth();
      frame.src = buildThinkletUrl(selectedQuery);
      attachThinkletAuth(frame);
      panel.hidden = false;
      updateBackdrop(true);
      button?.classList.add('toggled');
      button?.setAttribute('aria-expanded', 'true');
      document.body.classList.add('thinkletPanelOpen');
    });

    resizeHandle?.addEventListener('pointerdown', event => {
      if (!verifiedAccess || event.button !== 0) {
        return;
      }

      event.preventDefault();
      resizeHandle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('thinkletResizing');

      const onPointerMove = moveEvent => {
        const nextWidth = setPanelWidth(window.innerWidth - moveEvent.clientX);
        localStorage.setItem(THINKLET_WIDTH_KEY, String(nextWidth));
      };

      const stopResize = () => {
        document.body.classList.remove('thinkletResizing');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', stopResize);
        window.removeEventListener('pointercancel', stopResize);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', stopResize);
      window.addEventListener('pointercancel', stopResize);
    });

    window.addEventListener('resize', () => {
      const panel = document.getElementById('thinkletPanel');
      if (panel && !panel.hidden) {
        if (isMobileSheet()) {
          document.documentElement.style.removeProperty('--thinklet-panel-width');
        } else {
          applyStoredPanelWidth();
        }
        updateBackdrop(true);
      }
      hideSelectionMenu();
    });

    document.addEventListener('selectionchange', queueSelectionMenuUpdate);
    document.addEventListener('mouseup', queueSelectionMenuUpdate);
    document.addEventListener('keyup', queueSelectionMenuUpdate);

    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#thinkletSelectionMenu')) {
        hideSelectionMenu();
      }
    });

    document.addEventListener('scroll', hideSelectionMenu, true);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        hideSelectionMenu();
      }
    });

    window.addEventListener('message', event => {
      if (
        event.origin === getThinkletOrigin() &&
        ['THINKLET_ROUTE_CHANGED', 'THINKLET_LOCATION', 'MATERIO_THINKLET_LOCATION'].includes(event.data?.type)
      ) {
        rememberThinkletRoute(event.data);
        return;
      }

      const allowedOrigins = new Set([
        window.location.origin,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'https://getmaterio.app',
        'https://www.getmaterio.app',
        'https://beta.getmaterio.app',
        'https://materio.jinansh.workers.dev',
        'https://tauri.localhost',
        'http://tauri.localhost',
        'tauri://localhost',
        'https://localhost',
        'http://localhost',
        'capacitor://localhost',
        'https://capacitor.localhost'
      ]);
      if (event.origin !== 'null' && !allowedOrigins.has(event.origin) && !event.origin.startsWith('http://localhost') && !event.origin.startsWith('https://localhost')) {
        return;
      }

      if (event.data?.type === 'loadFile' && event.data.url) {
        activePdfUrl = event.data.url;
        updateOpenPanelContext();
      }
    });
  }

  function bindThinkletThemeSync() {
    lastTheme = getCurrentTheme();

    const onThemeSignal = () => syncThinkletTheme();
    const observer = new MutationObserver(onThemeSignal);

    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', onThemeSignal);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(onThemeSignal);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindThinkletControls();
    bindMobileSheetSwipe();
    verifiedAccess = await verifyThinkletAccess();

    if (!verifiedAccess) {
      return;
    }

    document.getElementById('thinkletButton')?.removeAttribute('hidden');
    document.getElementById('thinkletSeparator')?.removeAttribute('hidden');
    bindThinkletThemeSync();
  });
})();
