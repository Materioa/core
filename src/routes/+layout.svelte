<script>
  import '../app.css';
  import { page } from '$app/stores';
  import { pushState, replaceState } from '$app/navigation';
  import Header from '$lib/components/Header.svelte';
  import FloatingWindowControls from '$lib/components/FloatingWindowControls.svelte';
  import PdfReaderModal from '$lib/components/PdfReaderModal.svelte';
  import AiChatModal from '$lib/components/AiChatModal.svelte';
  import DynamicFormsModal from '$lib/components/DynamicFormsModal.svelte';
  import AutoShowPopups from '$lib/components/AutoShowPopups.svelte';
  import NotebookEditor from '$lib/components/NotebookEditor.svelte';
  import AdvancedSettingsDrawer from '$lib/components/AdvancedSettingsDrawer.svelte';
  import NotificationsDrawer from '$lib/components/NotificationsDrawer.svelte';
  import KeyboardShortcuts from '$lib/components/KeyboardShortcuts.svelte';
  import PromoBanner from '$lib/components/PromoBanner.svelte';
  import ExamModal from '$lib/components/ExamModal.svelte';
  import ThemeManager from '$lib/components/ThemeManager.svelte';
  import DownloadsManager from '$lib/components/DownloadsManager.svelte';
  import WallpaperEngine from '$lib/components/WallpaperEngine.svelte';
  import MaterioModal from '$lib/components/MaterioModal.svelte';
  import SearchResultsModal from '$lib/components/SearchResultsModal.svelte';
  import InterviewerModal from '$lib/components/InterviewerModal.svelte';
  import AppUpdateModal from '$lib/components/AppUpdateModal.svelte';
  import SplashScreen from '$lib/components/splash/SplashScreen.svelte';
  import OpenInAppBanner from '$lib/components/OpenInAppBanner.svelte';
  import NudgeCards from '$lib/components/NudgeCards.svelte';
  import SoundEngine from '$lib/components/SoundEngine.svelte';
  import { installApiInterceptor, isTauri, isAndroidApp, isCapacitor } from '$lib/config/api.js';
  import { installExternalLinkHandler } from '$lib/utils/externalLinks.js';
  
  import { activeModalStore, pdfModalStore, searchModalStore, activeTab } from '$lib/stores.js';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  if (browser) {
    installApiInterceptor();
  }

  let showSplash = false;
  let splashExiting = false;
  let splashRef;

  function checkShouldShowSplash() {
    if (!browser) return false;
    if (window.location.search && window.location.search.includes('splash=1')) return true;
    try {
      if (sessionStorage.getItem('materio_splash_shown')) return false;
    } catch {}
    return Boolean(
      isAndroidApp ||
      window.AndroidBridge ||
      (window.Capacitor?.getPlatform && window.Capacitor.getPlatform() === 'android') ||
      (isCapacitor && !isTauri) ||
      (window.location?.protocol === 'capacitor:') ||
      (window.location?.hostname === 'capacitor.localhost')
    );
  }

  if (browser) {
    showSplash = checkShouldShowSplash();
  }

  function handleSplashDone() {
    if (splashExiting) return;
    splashExiting = true;
    try {
      sessionStorage.setItem('materio_splash_shown', 'true');
    } catch {}
    setTimeout(() => {
      showSplash = false;
    }, 450);
  }

  let headerVersion = 0;
  function shouldHideHeader(pathname, _ver) {
    if (!browser) return false;
    if (pathname === '/home') return false;
    // Standalone landing-style pages (no app chrome, cream landing theme).
    if (pathname === '/pricing' || pathname.startsWith('/pricing/')) return true;
    if (pathname === '/interviewer' || pathname.startsWith('/interviewer')) return true;
    if (pathname === '/downloads' || pathname.startsWith('/downloads')) return true;
    if (pathname === '/') {
      // In native apps, never hide app header
      try {
        if (typeof window !== 'undefined' && (
          window.__TAURI_INTERNALS__ || 
          window.__TAURI__ || 
          window.location?.protocol === 'tauri:' || 
          window.location?.protocol === 'capacitor:' || 
          window.location?.hostname === 'tauri.localhost' || 
          window.Capacitor
        )) {
          return false;
        }
      } catch {}
      // In-memory "Go to App" click (app-start preference is 'root'):
      // render the full app chrome instead of the landing shell.
      try {
        if (typeof window !== 'undefined' && (window.__materioForceApp || window.__landingForceApp)) return false;
      } catch {}
      try {
        const m = document.cookie.match(new RegExp('(^| )materio_skip_landing=([^;]+)'));
        let skip = null;
        if (m) skip = decodeURIComponent(m[2]);
        else try { skip = localStorage.getItem('materio_skip_landing'); } catch {}
        return !(skip === 'true' || skip === '1');
      } catch { return false; }
    }
    return false;
  }
  $: hideGlobalHeader = shouldHideHeader($page.url.pathname, headerVersion);
  $: if (browser) document.body.classList.toggle('landing-page-active', hideGlobalHeader);
  // Reading pages (blog posts, docs, legal) render without app chrome,
  // like the parent layouts — but keep the base stylesheets.
  $: bareContent = $page.data?.layout === 'bare'
    || ['/privacy', '/cookies', '/terms', '/changelog'].includes($page.url.pathname)
    || $page.url.pathname === '/docs'
    || $page.url.pathname.startsWith('/docs/');

  const modalToHash = {
    'notebook': '#notebook',
    'shortcuts': '#shortcuts',
    'examModal': '#exam',
    'feedback': '#feedback',
    'contribute': '#contribute',
    'bug-report': '#bug-report',
    'ai-chat': '#ai-chat',
    'mcp': '#mcp',
    'interview': '#interview'
  };

  const hashToModal = {
    '#notebook': 'notebook',
    '#shortcuts': 'shortcuts',
    '#exam': 'examModal',
    '#exam-modal': 'examModal',
    '#feedback': 'feedback',
    '#contribute': 'contribute',
    '#bug-report': 'bug-report',
    '#ai-chat': 'ai-chat',
    '#mcp': 'mcp',
    '#interview': 'interview',
    '#viva': 'interview',
    '#viva-box': 'interview',
    '#viva-question-bank': 'interview'
  };

  onMount(() => {
    try { installExternalLinkHandler(); } catch {}
    try {
      // One-time cleanup of service workers registered by older builds.
      // The app ships no SW, but a stale registration keeps re-fetching its
      // script URL (/sw.js) on every navigation -> a permanent 404 for that
      // visitor. Clearing it once stops the noise. Runs a single time ever.
      if (
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        !localStorage.getItem('m_sw_cleanup_done')
      ) {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => Promise.all(regs.map((r) => r.unregister())))
          .then(() => {
            if (typeof caches !== 'undefined') {
              return caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
            }
          })
          .catch(() => {})
          .finally(() => {
            try { localStorage.setItem('m_sw_cleanup_done', '1'); } catch {}
          });
      }
    } catch {}
    try {
      // Client analytics (PDF views, reading time, engagement) -> Supabase
      // via /api/v2/features?action=analytics. Initialized once per load.
      import('$lib/utils/analytics.js').then((m) => {
        try { m.initAnalytics(); } catch {}
      }).catch(() => {});
    } catch {}
    let prevModal = null;
    let updatingFromHash = false;

    if (typeof window !== 'undefined' && window.location.hash) {
      const initModal = hashToModal[window.location.hash];
      if (initModal) {
        updatingFromHash = true;
        activeModalStore.set(initModal);
        updatingFromHash = false;
      }
    }

    const unsubActive = activeModalStore.subscribe(val => {
      // Never throw out of a store subscriber: Svelte aborts the whole
      // notify queue on throw, which used to wedge tab navigation.
      try {
        if (val) {
        document.body.classList.add('modal-open');
        const targetHash = modalToHash[val];
        if (targetHash && typeof window !== 'undefined' && window.location.hash !== targetHash && !updatingFromHash) {
          try {
            pushState(window.location.pathname + window.location.search + targetHash, { modal: val });
          } catch (e) {
            window.history.pushState({ modal: val }, '', window.location.pathname + window.location.search + targetHash);
          }
        }
      } else {
        if (!get(pdfModalStore).isOpen) document.body.classList.remove('modal-open');
        if (typeof window !== 'undefined' && !updatingFromHash) {
          if (prevModal && modalToHash[prevModal] && window.location.hash === modalToHash[prevModal]) {
            try {
              replaceState(window.location.pathname + window.location.search, {});
            } catch (e) {
              window.history.replaceState(null, '', window.location.pathname + window.location.search);
            }
          } else if (hashToModal[window.location.hash]) {
            try {
              replaceState(window.location.pathname + window.location.search, {});
            } catch (e) {
              window.history.replaceState(null, '', window.location.pathname + window.location.search);
            }
          }
        }
      }
      prevModal = val;
      } catch (err) {
        console.error('Modal sync failed:', err);
      }
    });

    const unsubPdf = pdfModalStore.subscribe(val => {
      try {
        if (val.isOpen) document.body.classList.add('modal-open');
        else if (!get(activeModalStore)) document.body.classList.remove('modal-open');
      } catch (err) {
        console.error('PDF modal sync failed:', err);
      }
    });

    const handleHashSync = () => {
      try {
        if (typeof window === 'undefined') return;
        const curHash = window.location.hash;
        const matchingModal = hashToModal[curHash];
        updatingFromHash = true;
        if (matchingModal) {
          if (get(activeModalStore) !== matchingModal) {
            activeModalStore.set(matchingModal);
          }
        } else {
          if (get(activeModalStore) && modalToHash[get(activeModalStore)]) {
            activeModalStore.set(null);
          }
        }
        updatingFromHash = false;
      } catch (err) {
        console.error('Hash sync failed:', err);
        updatingFromHash = false;
      }
    };

    window.addEventListener('popstate', handleHashSync);
    window.addEventListener('hashchange', handleHashSync);

    const prefHandler = () => { headerVersion += 1; };
    window.addEventListener('landingPrefsChanged', prefHandler);
    window.addEventListener('materioForceAppChanged', prefHandler);
    window.addEventListener('storage', prefHandler);

    // Android gesture / hardware back handler
    window.__materioHandleAndroidBack = () => {
      try {
        // 0. If splash screen is currently active, dismiss it
        if (showSplash) {
          handleSplashDone();
          return true;
        }

        // 1. If PDF Reader modal is open, close it
        const currentPdf = get(pdfModalStore);
        if (currentPdf && currentPdf.isOpen) {
          pdfModalStore.set({
            isOpen: false,
            pdfUrl: '',
            title: '',
            semester: '',
            subject: '',
            category: '',
            topic: '',
            readingMode: 'default',
            isBookmarked: false
          });
          return true;
        }

        // 2. If any modal is active in activeModalStore, close it
        const currentModal = get(activeModalStore);
        if (currentModal) {
          activeModalStore.set(null);
          return true;
        }

        // 3. If search modal is open, close it
        const currentSearch = get(searchModalStore);
        if (currentSearch && currentSearch.isOpen) {
          searchModalStore.update(s => ({ ...s, isOpen: false }));
          return true;
        }

        // 4. If any open modal or overlay exists in the DOM, close it
        const openOverlay = document.querySelector('.materio-modal-overlay.visible, .dynamic-form-overlay, .search-modal.active, .drawer-open, .popup-container.visible');
        if (openOverlay) {
          const closeBtn = openOverlay.querySelector('.promo-close-btn, .close-popup, .modal-close, button[aria-label="Close"]');
          if (closeBtn && typeof closeBtn.click === 'function') {
            closeBtn.click();
            return true;
          }
        }

        // 5. If user is on a non-home tab (e.g. notifications, settings, notebooks, downloads)
        const currentTab = get(activeTab);
        if (currentTab && currentTab !== 'home') {
          activeTab.set('home');
          if (typeof window.__materioSetTab === 'function') {
            window.__materioSetTab('home');
          }
          return true;
        }

        // 6. If user navigated to a subroute (e.g. /downloads, /about, /privacy, etc.)
        if (window.location.pathname !== '/' && window.location.pathname !== '/home') {
          if (window.history.length > 1) {
            window.history.back();
            return true;
          }
        }
      } catch (e) {
        console.error('Android back handling failed:', e);
      }
      return false;
    };

    try {
      if (window.Capacitor?.Plugins?.App?.addListener) {
        window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
          const handled = window.__materioHandleAndroidBack ? window.__materioHandleAndroidBack() : false;
          if (!handled && canGoBack) {
            window.history.back();
          }
        });
      }
    } catch {}

    // Deep Link & Associated URL Handler (Android Intents + Desktop materio:// protocol)
    window.__materioHandleDeepLink = (rawUrl) => {
      try {
        if (!rawUrl || typeof rawUrl !== 'string') return;
        let urlObj;
        if (rawUrl.startsWith('materio://')) {
          const rest = rawUrl.replace(/^materio:\/\/?/, '');
          urlObj = new URL(rest.startsWith('?') ? `https://getmaterio.app/${rest}` : `https://getmaterio.app/${rest}`);
        } else {
          urlObj = new URL(rawUrl);
        }

        const shareId = urlObj.searchParams.get('share');
        if (shareId) {
          if (typeof window.__materioLoadShareMask === 'function') {
            window.__materioLoadShareMask(shareId);
          } else {
            window.location.search = `?share=${shareId}`;
          }
          return;
        }

        const path = urlObj.pathname;
        if (path && path !== '/' && path !== '/home') {
          window.location.href = path + (urlObj.search || '');
        }
      } catch (err) {
        console.warn('Failed to parse deep link URL:', err);
      }
    };

    // Check for pending Android deep link on initial launch
    if (window.AndroidBridge?.getPendingDeepLink) {
      try {
        const pending = window.AndroidBridge.getPendingDeepLink();
        if (pending) {
          setTimeout(() => window.__materioHandleDeepLink(pending), 400);
        }
      } catch {}
    }

    return () => {
      unsubActive();
      unsubPdf();
      window.removeEventListener('popstate', handleHashSync);
      window.removeEventListener('hashchange', handleHashSync);
      window.removeEventListener('landingPrefsChanged', prefHandler);
      window.removeEventListener('materioForceAppChanged', prefHandler);
      window.removeEventListener('storage', prefHandler);
      delete window.__materioHandleAndroidBack;
    };
  });
</script>

<svelte:head>
  {#if !hideGlobalHeader || bareContent}
    <link id="app-main-css" rel="stylesheet" href="/assets/style/main.css?v=20260926" />
  {:else}
    <link id="landing-css" rel="stylesheet" href="/assets/style/landing.css" />
    <link id="pricing-css" rel="stylesheet" href="/assets/style/pricing.css" />
  {/if}
</svelte:head>
<!-- Interaction sounds. Mounted outside every shell branch so one instance
  covers the app chrome, the landing pages and all the global overlays. No-ops
  on web; the audio module is never imported there. -->
<SoundEngine />

<!-- Window caption buttons stay reachable on every desktop (Tauri) route —
     on pages where the app header (which normally hosts them) is hidden.
     Reading pages are headerless too, so they get them as well. -->
{#if hideGlobalHeader || bareContent}
<FloatingWindowControls />
{/if}

<!-- bareContent is checked FIRST: hideGlobalHeader is false on every reading
     route (/docs, /changelog, posts, legal), so putting the app-header branch
     ahead of it made this branch unreachable and those pages rendered
     underneath the fixed header instead of chromeless. -->
{#if bareContent}
<ThemeManager />
<div class="bare-content">
  <slot />
</div>
{:else if !hideGlobalHeader}
<ThemeManager />
<Header />
<main>
  <slot />
</main>
{:else}
<div class="landing-shell">
  <slot />
</div>
{/if}
<!-- Global modals/drawers stay mounted on every route (landing, pricing,
  interviewer included) so hash deep-links and modal triggers always work —
  previously a landing-shell render left these unmounted and every modal
  button silently did nothing until refresh. -->
<PdfReaderModal />
<AiChatModal />
<DynamicFormsModal />
{#if !hideGlobalHeader}
<AutoShowPopups />
{/if}
<NotebookEditor />
<AdvancedSettingsDrawer />
<NotificationsDrawer />
<KeyboardShortcuts />
{#if !hideGlobalHeader}
<PromoBanner />
{/if}
<ExamModal />
<DownloadsManager />
<MaterioModal />
<SearchResultsModal />
<WallpaperEngine />
<InterviewerModal />
{#if !hideGlobalHeader}
<OpenInAppBanner />
{/if}
{#if isTauri}
<AppUpdateModal />
{/if}
<NudgeCards />

{#if showSplash}
<div
  class="splash-screen-overlay"
  class:splash-screen-exit={splashExiting}
  onclick={() => splashRef?.skipToSticker()}
  role="presentation"
>
  <SplashScreen
    bind:this={splashRef}
    ondone={handleSplashDone}
    shuffleMs={4250}
    budSpeed={2.2}
    budScale={0.9}
    dayPhaseMs={1500}
  />
</div>
{/if}

<style>
  .splash-screen-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    z-index: 9999999;
    background-color: #f7f7f2;
    overflow: hidden;
    pointer-events: auto;
    opacity: 1;
    transition: opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1);
  }

  :global(body.dark-mode) .splash-screen-overlay {
    background-color: #121310;
  }

  .splash-screen-overlay.splash-screen-exit {
    opacity: 0;
    pointer-events: none;
  }
</style>
