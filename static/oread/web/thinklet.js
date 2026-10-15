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

  let cachedExtractedPdf = null;
  let isExtractingPdf = false;

  function postToThinkletFrame(msg) {
    try {
      const frame = document.getElementById('thinkletFrame');
      if (frame?.contentWindow) {
        frame.contentWindow.postMessage(msg, '*');
      }
    } catch (e) {}
  }

  async function resolveDocumentTitle(app, doc) {
    // 1. Try app._title or app.pdfTitle
    const appTitle = app?._title || app?.pdfTitle;
    if (appTitle && typeof appTitle === 'string' && !/pdf\.?js(\s+viewer)?/i.test(appTitle)) {
      return appTitle.trim();
    }

    // 2. Try doc metadata Title
    if (doc?.getMetadata) {
      try {
        const meta = await doc.getMetadata();
        const metaTitle = meta?.info?.Title || meta?.metadata?.get?.('dc:title');
        if (metaTitle && typeof metaTitle === 'string' && metaTitle.trim() && !/pdf\.?js(\s+viewer)?/i.test(metaTitle)) {
          return metaTitle.trim();
        }
      } catch (e) {}
    }

    // 3. Try app?._contentDispositionFilename
    const rawFilename = app?._contentDispositionFilename || '';
    if (rawFilename && !/pdf\.?js/i.test(rawFilename)) {
      return cleanContextPart(rawFilename, 'Document');
    }

    // 4. Try activePdfUrl or query param 'file' or app?.url
    const fileUrl = activePdfUrl || new URLSearchParams(window.location.search).get('file') || app?.url || '';
    if (fileUrl) {
      try {
        const parsed = new URL(fileUrl, window.location.href);
        const segments = parsed.pathname.split('/').filter(Boolean);
        const last = segments.pop() || '';
        if (last && !/viewer\.html/i.test(last)) {
          const decoded = decodeURIComponent(last);
          return cleanContextPart(decoded, 'Document');
        }
      } catch (e) {}
    }

    // 5. Try document.title ONLY if it's not generic PDF.js viewer
    const curTitle = document.title || '';
    if (curTitle && !/pdf\.?js(\s+viewer)?/i.test(curTitle)) {
      return curTitle.trim();
    }

    // 6. Try breadcrumb context from URL params
    const ctx = readContextFromUrl();
    if (ctx?.topic && ctx.topic !== 'this document') {
      return ctx.topic;
    }
    if (ctx?.sub && ctx.sub !== 'this subject') {
      return ctx.sub;
    }

    return 'Document';
  }

  async function renderPageAsImage(page, maxDim = 1200) {
    try {
      const defaultViewport = page.getViewport({ scale: 1.0 });
      const scale = Math.min(1.8, Math.max(0.75, maxDim / Math.max(defaultViewport.width, defaultViewport.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch (e) {
      console.warn('[thinklet] renderPageAsImage error:', e);
      return null;
    }
  }

  async function extractOreadPdfText(options = {}) {
    const app = window.PDFViewerApplication;
    const doc = app?.pdfDocument;
    if (!doc) return null;

    const maxPages = options.maxPages || 40;
    const numPages = doc.numPages;
    const currentPage = app.page || 1;
    const docTitle = await resolveDocumentTitle(app, doc);
    if (docTitle && docTitle !== 'Document' && (!document.title || /pdf\.?js(\s+viewer)?/i.test(document.title))) {
      document.title = docTitle;
    }

    // Specific page requested
    if (options.pageNumber && options.pageNumber >= 1 && options.pageNumber <= numPages) {
      try {
        const page = await doc.getPage(options.pageNumber);
        const textContent = await page.getTextContent();
        let pageText = textContent.items.map(item => item.str).join(' ');
        let image = null;

        // If page has almost no text (scanned PDF), render a visual snapshot
        if (!pageText || pageText.trim().length < 40) {
          image = await renderPageAsImage(page);
        }

        return {
          title: docTitle,
          numPages,
          currentPage,
          pageNumber: options.pageNumber,
          text: pageText,
          image,
          isScanned: !pageText || pageText.trim().length < 40,
          url: activePdfUrl || ''
        };
      } catch (err) {
        console.warn('[thinklet] extract page error:', err);
      }
    }

    if (cachedExtractedPdf && cachedExtractedPdf.numPages === numPages && cachedExtractedPdf.title === docTitle) {
      cachedExtractedPdf.currentPage = currentPage;
      return cachedExtractedPdf;
    }

    if (isExtractingPdf) return cachedExtractedPdf;
    isExtractingPdf = true;

    try {
      const pages = [];
      let fullText = '';
      const limit = Math.min(numPages, maxPages);

      for (let i = 1; i <= limit; i++) {
        try {
          const page = await doc.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          pages.push({ pageNumber: i, text: pageText });
          fullText += `--- Page ${i} ---\n${pageText}\n\n`;
        } catch (e) {}
      }

      const isScanned = fullText.trim().length < 50;

      cachedExtractedPdf = {
        title: docTitle,
        numPages,
        currentPage,
        pageCount: limit,
        fullText: fullText.trim(),
        pages,
        isScanned,
        url: activePdfUrl || ''
      };
      return cachedExtractedPdf;
    } finally {
      isExtractingPdf = false;
    }
  }

  async function sendPdfContextToThinklet() {
    try {
      const data = await extractOreadPdfText();
      if (!data) return;

      postToThinkletFrame({
        type: 'MATERIO_ACTIVE_PDF',
        pdf: {
          title: data.title,
          numPages: data.numPages,
          currentPage: data.currentPage,
          text: data.fullText,
          pages: data.pages,
          isScanned: !!data.isScanned,
          url: data.url
        }
      });
    } catch (e) {
      console.warn('[thinklet] sendPdfContextToThinklet error:', e);
    }
  }

  function hookPdfEvents() {
    const bindBus = (bus) => {
      if (!bus || bus._thinkletBound) return;
      bus._thinkletBound = true;

      bus.on('pagesloaded', () => {
        cachedExtractedPdf = null;
        sendPdfContextToThinklet();
      });

      bus.on('pagechanging', (evt) => {
        const pageNum = evt?.pageNumber || window.PDFViewerApplication?.page || 1;
        postToThinkletFrame({
          type: 'MATERIO_PAGE_CHANGED',
          pageNumber: pageNum
        });
      });
    };

    if (window.PDFViewerApplication?.eventBus) {
      bindBus(window.PDFViewerApplication.eventBus);
    } else {
      document.addEventListener('webviewerloaded', () => {
        if (window.PDFViewerApplication?.eventBus) {
          bindBus(window.PDFViewerApplication.eventBus);
        }
      });
    }

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (window.PDFViewerApplication?.eventBus) {
        bindBus(window.PDFViewerApplication.eventBus);
        clearInterval(interval);
      } else if (attempts > 30) {
        clearInterval(interval);
      }
    }, 500);
  }

  function attachThinkletAuth(frame) {
    if (!frame) {
      return;
    }

    frame.addEventListener('load', () => {
      postThinkletAuth(frame);
      sendPdfContextToThinklet();
    }, { once: true });
    postThinkletAuth(frame);
    sendPdfContextToThinklet();
  }

  function isNativeShell() {
    try {
      const h = window.location.hostname || '';
      const p = window.location.protocol || '';
      return h === 'tauri.localhost' || h === 'capacitor.localhost' ||
        p === 'tauri:' || p === 'capacitor:' ||
        (h === 'localhost' && window.location.port !== '5173') ||
        (typeof window !== 'undefined' && (Boolean(window.__TAURI__) || Boolean(window.Capacitor)));
    } catch (e) {
      return false;
    }
  }

  function isThinkletReleaseOfferActive() {
    return Date.now() < THINKLET_RELEASE_OFFER_END;
  }

  function profileUrl() {
    // Inside native shells there is no same-origin backend (tauri://,
    // capacitor://), so resolve the absolute production API like
    // showbtnrq.js does instead of a relative path that 404s.
    try {
      if (isNativeShell()) return 'https://getmaterio.app/api/v2/profile';
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
    if (isNativeShell()) {
      return true;
    }

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
    try {
      const override = localStorage.getItem('materio_thinklet_url');
      if (override) return override;
    } catch (e) {}

    if (isNativeShell()) {
      return THINKLET_PROD_URL;
    }

    const hostname = window.location.hostname;
    const isLocalhost = (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') && window.location.port === '5173';
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
      } else {
        sendPdfContextToThinklet();
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
        'https://chat.getmaterio.app',
        'https://materio.jinansh.workers.dev',
        'https://tauri.localhost',
        'http://tauri.localhost',
        'tauri://localhost',
        'https://localhost',
        'http://localhost',
        'capacitor://localhost',
        'https://capacitor.localhost'
      ]);

      const isAllowedOrigin =
        event.origin === 'null' ||
        allowedOrigins.has(event.origin) ||
        event.origin === getThinkletOrigin() ||
        event.origin.startsWith('http://localhost') ||
        event.origin.startsWith('https://localhost') ||
        event.origin.endsWith('.vercel.app');

      if (!isAllowedOrigin) {
        return;
      }

      if (event.data?.type === 'MATERIO_REQUEST_ACTIVE_PDF') {
        sendPdfContextToThinklet();
        return;
      }

      if (event.data?.type === 'MATERIO_READ_PDF_PAGE') {
        extractOreadPdfText({ pageNumber: event.data.pageNumber }).then(pageData => {
          postToThinkletFrame({
            type: 'MATERIO_CURRENT_PDF_RESPONSE',
            requestId: event.data.requestId,
            data: pageData
          });
        });
        return;
      }

      if (event.data?.type === 'loadFile' && event.data.url) {
        activePdfUrl = event.data.url;
        cachedExtractedPdf = null;
        updateOpenPanelContext();
        setTimeout(sendPdfContextToThinklet, 800);
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
    hookPdfEvents();
    verifiedAccess = await verifyThinkletAccess();

    if (!verifiedAccess) {
      return;
    }

    document.getElementById('thinkletButton')?.removeAttribute('hidden');
    document.getElementById('thinkletSeparator')?.removeAttribute('hidden');
    bindThinkletThemeSync();
  });
})();
