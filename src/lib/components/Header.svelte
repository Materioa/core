<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { searchTerm, activeModalStore, actualThemeStore } from '$lib/stores.js';
  import HugeIcon from '$lib/components/HugeIcon.svelte';
  
  import { isTauri as isTauriEnv, isCapacitor } from '$lib/config/api.js';

  $: isLightTheme = $actualThemeStore === 'light' || $actualThemeStore === 'coffee';
  let showBugTooltip = true;
  let statusClass = 'ok';
  let statusText = 'Operational';
  let statusTitle = 'All systems operational';
  let isDesktopApp = isTauriEnv;
  let isMaximized = false;

  async function checkMaximized() {
    if (!isDesktopApp) return;
    try {
      if (window.__TAURI__?.core?.invoke) {
        isMaximized = await window.__TAURI__.core.invoke('app_window_is_maximized');
        return;
      }
    } catch {}
    try {
      if (window.__TAURI__?.window?.getCurrentWindow) {
        isMaximized = await window.__TAURI__.window.getCurrentWindow().isMaximized();
      }
    } catch {}
  }

  async function handleMinimize() {
    try {
      if (window.__TAURI__?.core?.invoke) {
        await window.__TAURI__.core.invoke('app_window_minimize');
        return;
      }
    } catch {}
    try {
      if (window.__TAURI__?.window?.getCurrentWindow) {
        await window.__TAURI__.window.getCurrentWindow().minimize();
      }
    } catch {}
  }

  async function handleToggleMaximize() {
    try {
      if (window.__TAURI__?.core?.invoke) {
        await window.__TAURI__.core.invoke('app_window_toggle_maximize');
        setTimeout(checkMaximized, 80);
        return;
      }
    } catch {}
    try {
      if (window.__TAURI__?.window?.getCurrentWindow) {
        await window.__TAURI__.window.getCurrentWindow().toggleMaximize();
        setTimeout(checkMaximized, 80);
      }
    } catch {}
  }

  async function handleClose() {
    try {
      if (window.__TAURI__?.core?.invoke) {
        await window.__TAURI__.core.invoke('app_window_close');
        return;
      }
    } catch {}
    try {
      if (window.__TAURI__?.window?.getCurrentWindow) {
        await window.__TAURI__.window.getCurrentWindow().close();
      }
    } catch {}
  }

  // --- Custom window chrome FX (desktop app only) ---
  // Frameless windows get no OS snap flyout or native tooltips, so we
  // render our own: a Windows-styled tooltip for min/max/close and a
  // snap-layout popup on the maximize button.
  let winTip = null; // { text, x, y }
  let winTipTimer = null;
  let snapOpen = false;
  let snapX = 0;
  let snapY = 0;
  let snapTimer = null;

  function clearChromeTimers() {
    if (winTipTimer) { clearTimeout(winTipTimer); winTipTimer = null; }
    if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
  }

  function hideChromeFx() {
    clearChromeTimers();
    winTip = null;
    snapOpen = false;
  }

  function chromeHover(e) {
    if (!isDesktopApp) return;
    let t = null;
    try { t = e.target && e.target.closest ? e.target : null; } catch { return; }
    if (!t) return;
    try {
      if (t.closest('.snap-flyout')) return; // keep open while choosing
      const btn = t.closest('.window-control-btn');
      if (!btn) { hideChromeFx(); return; }
      clearChromeTimers();
      const label = btn.getAttribute('aria-label') || 'Window';
      const r = btn.getBoundingClientRect();
      winTipTimer = setTimeout(() => {
        winTip = { text: label, x: Math.max(8, r.right - 6), y: r.bottom + 10 };
      }, 650);
      if (btn.classList.contains('btn-max') && !snapOpen) {
        snapTimer = setTimeout(() => {
          const w = 224;
          snapX = Math.max(8, r.right - w - 2);
          snapY = r.bottom + 8;
          winTip = null;
          snapOpen = true;
        }, 550);
      } else if (!btn.classList.contains('btn-max')) {
        snapOpen = false;
      }
    } catch {}
  }

  async function snapLayout(kind) {
    snapOpen = false;
    winTip = null;
    try {
      const api = window.__TAURI__?.window;
      const win = api?.getCurrentWindow ? api.getCurrentWindow() : null;
      if (!win || !api?.PhysicalPosition || !api?.PhysicalSize) {
        handleToggleMaximize();
        return;
      }
      try { await win.unmaximize(); } catch {}
      if (kind === 'max') {
        try { await win.maximize(); } catch {}
        setTimeout(checkMaximized, 120);
        return;
      }
      let area = null;
      try {
        const mon = await win.currentMonitor();
        area = mon?.workArea || mon?.size || null;
      } catch {}
      if (!area || !area.width || !area.height) {
        handleToggleMaximize();
        return;
      }
      const ax = area.x || 0;
      const ay = area.y || 0;
      const aw = area.width;
      const ah = area.height;
      let x = ax, y = ay, w = aw, h = ah;
      if (kind === 'left') { w = Math.floor(aw / 2); }
      else if (kind === 'right') { x = ax + Math.ceil(aw / 2); w = Math.floor(aw / 2); }
      else if (kind === 'tl') { w = Math.floor(aw / 2); h = Math.floor(ah / 2); }
      else if (kind === 'tr') { x = ax + Math.ceil(aw / 2); w = Math.floor(aw / 2); h = Math.floor(ah / 2); }
      else if (kind === 'bl') { y = ay + Math.ceil(ah / 2); w = Math.floor(aw / 2); h = Math.floor(ah / 2); }
      else if (kind === 'br') { x = ax + Math.ceil(aw / 2); y = ay + Math.ceil(ah / 2); w = Math.floor(aw / 2); h = Math.floor(ah / 2); }
      await win.setPosition(new api.PhysicalPosition(Math.round(x), Math.round(y)));
      await win.setSize(new api.PhysicalSize(Math.round(w), Math.round(h)));
      setTimeout(checkMaximized, 120);
    } catch {
      try { handleToggleMaximize(); } catch {}
    }
  }

  onMount(() => {
    checkHealth();
    if (typeof window !== 'undefined') {
      isDesktopApp = Boolean(
        isTauriEnv ||
        window.__TAURI_INTERNALS__ ||
        window.__TAURI__ ||
        window.__TAURI_METADATA__ ||
        window.location?.hostname === 'tauri.localhost' ||
        window.location?.protocol === 'tauri:'
      );
    }
    // Window-chrome FX hover delegation (tooltips + snap flyout).
    const hoverListener = (e) => chromeHover(e);
    if (typeof window !== 'undefined') window.addEventListener('mouseover', hoverListener);
    if (isDesktopApp) {
      checkMaximized();
      const onResize = () => checkMaximized();
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('mouseover', hoverListener);
        hideChromeFx();
      };
    }
    return () => {
      window.removeEventListener('mouseover', hoverListener);
      hideChromeFx();
    };
  });

  async function checkHealth() {
    try {
      const response = await fetch(`/api/v2/health?t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      const incident = data.incident;
      const status = data.status;

      if (incident) {
        const impact = incident.impact || 'partial_outage';
        if (impact === 'major_outage') {
          statusClass = 'error';
          statusText = 'Outage';
        } else if (impact === 'partial_outage') {
          statusClass = 'partial-outage';
          statusText = 'Partial Outage';
        } else if (impact === 'degraded_performance' || impact === 'maintenance') {
          statusClass = 'degraded';
          statusText = 'Degraded';
        } else {
          statusClass = 'partial-outage';
          statusText = 'Issues';
        }
        statusTitle = incident.name || 'Active incident';
      } else if (status === 'offline') {
        statusClass = 'degraded';
        statusText = 'Offline';
        statusTitle = data.message || 'Please check your internet connection';
      } else if (status === 'degraded') {
        statusClass = 'degraded';
        statusText = 'Degraded';
        statusTitle = data.message || 'Systems are experiencing issues';
      } else {
        statusClass = 'ok';
        statusText = 'Operational';
        statusTitle = 'All systems operational';
      }
    } catch (error) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        statusClass = 'degraded';
        statusText = 'Offline';
        statusTitle = 'You are currently offline';
      } else {
        statusClass = 'ok';
        statusText = 'Operational';
        statusTitle = 'All systems operational';
      }
    }
  }
</script>

{#if ['/', '/home', '/notifications', '/leaderboard', '/notebooks', '/downloads', '/settings'].includes($page.url.pathname)}
<header
  class="actual-content"
  class:desktop-header={isDesktopApp}
  data-tauri-drag-region
  on:dblclick={isDesktopApp ? handleToggleMaximize : undefined}
  style="background-image: none !important;"
>
  <a href="/" class="header-logo" role="button" aria-label="Go to homepage">
    <img
      src={isLightTheme ? '/assets/img/materio_new_bk.svg' : '/assets/img/materio_new_wh.svg'}
      alt="Materio"
      class="header-logo-svg"
      style="width: 120px; height: 32px; object-fit: contain; display: block;"
    />
  </a>
  <div class="header-actions" class:desktop-actions={isDesktopApp}>
      {#if !isDesktopApp && !isCapacitor}
      <a href="https://github.com/Materioa/core" target="_blank" rel="noopener noreferrer" class="bug-report-btn" id="githubBtn" aria-label="Star Materio on GitHub" title="Star Materio on GitHub">
          <HugeIcon name="github" />
      </a>
      {/if}
      <button class="bug-report-btn" id="bugReportBtn" aria-label="Report a Bug" title="Report a Bug"
          on:click={() => { try { activeModalStore.set('bug-report'); } catch (e) { console.error('Open bug report failed:', e); } }}>
          <HugeIcon name="alert-02" />
      </button>
      {#if showBugTooltip}
      <div id="bugReportTooltip" class="bug-report-tooltip" style="display: block;">
          <span>Found a bug? Report it here.</span>
          <button type="button" style="background: none; border: none; padding: 0; cursor: pointer;" on:click={() => showBugTooltip = false} aria-label="Close tooltip">
            <HugeIcon name="cancel-01" class="close-tooltip" />
          </button>
      </div>
      {/if}
      <a href="https://status.getmaterio.app" target="_blank" class="health-status-container"
          aria-label={`System Status: ${statusText}`} title={statusTitle}>
          <div class={`health-status-indicator ${statusClass}`} id="healthIndicator" title={statusTitle}></div>
          <span class="health-status-text" id="healthStatusText">{statusText}</span>
      </a>

      {#if isDesktopApp}
      <div class="desktop-window-divider" aria-hidden="true"></div>
      <div class="desktop-window-controls" aria-label="Window Controls">
          <button type="button" class="window-control-btn btn-min" on:click|stopPropagation={handleMinimize} aria-label="Minimize">>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M 0 5.5 H 10" stroke="currentColor" stroke-width="1"/>
              </svg>
          </button>
          <button type="button" class="window-control-btn btn-max" on:click|stopPropagation={handleToggleMaximize} aria-label={isMaximized ? "Restore" : "Maximize"}>>
              {#if isMaximized}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M 2.5 2.5 V 2 C 2.5 1.17 3.17 0.5 4 0.5 H 8 C 8.83 0.5 9.5 1.17 9.5 2 V 6 C 9.5 6.83 8.83 7.5 8 7.5 H 7.5" stroke="currentColor" stroke-width="1"/>
                      <rect x="0.5" y="2.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1"/>
                  </svg>
              {:else}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="0.5" y="0.5" width="9" height="9" rx="2" stroke="currentColor" stroke-width="1"/>
                  </svg>
              {/if}
          </button>
          <button type="button" class="window-control-btn btn-close" on:click|stopPropagation={handleClose} aria-label="Close">>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M 1 1 L 9 9 M 9 1 L 1 9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
              </svg>
          </button>
      </div>
      {/if}
  </div>
</header>
{:else}
<header
  class="site-header"
  class:desktop-header={isDesktopApp}
  data-tauri-drag-region
  on:dblclick={isDesktopApp ? handleToggleMaximize : undefined}
>
  <a href="/" class="header-logo" role="button" aria-label="Go to homepage">
    <img
      src={isLightTheme ? '/assets/img/materio_new_bk.svg' : '/assets/img/materio_new_wh.svg'}
      alt="Materio"
      class="header-logo-svg"
      style="width: 120px; height: 32px; object-fit: contain; display: block;"
    />
  </a>
  
  {#if $page.url.pathname.includes('/post/')}
  <button class="toc-toggle" aria-label="Toggle table of contents" title="Toggle table of contents">
    <HugeIcon name="menu-01" />
  </button>
  {/if}

  <!-- Exit icon for post pages -->
  {#if $page.url.pathname.includes('/post/')}
  <button type="button"
    style="position: absolute; right: {isDesktopApp ? '145px' : '20px'}; top: 50%; transform: translateY(-50%); color: var(--text); background: none; border: none; font-size: 1.2rem; cursor: pointer;"
    on:click|preventDefault={() => { if (document.referrer) history.back(); else window.location.href='https://room.getmaterio.app'; }}
    on:mousedown={(e) => e.currentTarget.style.color='#ff8200'} 
    on:mouseup={(e) => e.currentTarget.style.color='var(--text)'}
    on:mouseleave={(e) => e.currentTarget.style.color='var(--text)'} aria-label="Back">
    <HugeIcon name="logout-03" />
  </button>
  {/if}

  {#if isDesktopApp}
  <div class="desktop-window-controls site-header-controls" aria-label="Window Controls">
      <button type="button" class="window-control-btn btn-min" on:click|stopPropagation={handleMinimize} aria-label="Minimize">>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M 0 5.5 H 10" stroke="currentColor" stroke-width="1"/>
          </svg>
      </button>
      <button type="button" class="window-control-btn btn-max" on:click|stopPropagation={handleToggleMaximize} aria-label={isMaximized ? "Restore" : "Maximize"}>>
          {#if isMaximized}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M 2.5 2.5 V 2 C 2.5 1.17 3.17 0.5 4 0.5 H 8 C 8.83 0.5 9.5 1.17 9.5 2 V 6 C 9.5 6.83 8.83 7.5 8 7.5 H 7.5" stroke="currentColor" stroke-width="1"/>
                  <rect x="0.5" y="2.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1"/>
              </svg>
          {:else}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0.5" y="0.5" width="9" height="9" rx="2" stroke="currentColor" stroke-width="1"/>
              </svg>
          {/if}
      </button>
      <button type="button" class="window-control-btn btn-close" on:click|stopPropagation={handleClose} aria-label="Close">>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M 1 1 L 9 9 M 9 1 L 1 9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          </svg>
      </button>
  </div>
  {/if}
</header>
{/if}

{#if isDesktopApp}
  {#if winTip}
    <div class="win-tip" style="left: {winTip.x}px; top: {winTip.y}px;" role="tooltip">{winTip.text}</div>
  {/if}
  {#if snapOpen}
    <div class="snap-flyout" style="left: {snapX}px; top: {snapY}px;" role="menu" aria-label="Snap layouts" on:mouseleave={hideChromeFx}>
      <div class="snap-grid">
        <button type="button" class="snap-opt" on:click={() => snapLayout('left')} aria-label="Snap left"><span class="snap-mini"><i class="snap-on snap-left"></i></span></button>
        <button type="button" class="snap-opt" on:click={() => snapLayout('max')} aria-label="Maximize"><span class="snap-mini"><i class="snap-on snap-full"></i></span></button>
        <button type="button" class="snap-opt" on:click={() => snapLayout('right')} aria-label="Snap right"><span class="snap-mini"><i class="snap-on snap-right"></i></span></button>
        <button type="button" class="snap-opt" on:click={() => snapLayout('tl')} aria-label="Snap top left"><span class="snap-mini"><i class="snap-on snap-tl"></i></span></button>
        <button type="button" class="snap-opt" on:click={() => snapLayout('tr')} aria-label="Snap top right"><span class="snap-mini"><i class="snap-on snap-tr"></i></span></button>
        <button type="button" class="snap-opt" on:click={() => snapLayout('bl')} aria-label="Snap bottom left"><span class="snap-mini"><i class="snap-on snap-bl"></i></span></button>
      </div>
    </div>
  {/if}
{/if}

<style>
  :global(header[data-tauri-drag-region]) {
    -webkit-app-region: drag;
    app-region: drag;
    user-select: none;
  }

  :global(.header-logo),
  :global(.header-actions button),
  :global(.header-actions a),
  :global(.bug-report-tooltip),
  :global(.desktop-window-controls),
  :global(.desktop-window-controls button),
  :global(.toc-toggle) {
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  .header-actions.desktop-actions {
    right: 0 !important;
    gap: 8px;
    padding-right: 0;
  }

  .desktop-window-divider {
    width: 1px;
    height: 18px;
    background-color: var(--border-color, rgba(128, 128, 128, 0.25));
    margin: 0 4px 0 2px;
    flex-shrink: 0;
  }

  .desktop-window-controls {
    display: inline-flex;
    align-items: center;
    height: 48px;
    -webkit-app-region: no-drag;
    app-region: no-drag;
    margin-left: 2px;
  }

  .site-header-controls {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    height: 100%;
  }

  .window-control-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 100%;
    background: transparent;
    border: none;
    color: var(--text, #333333);
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
    padding: 0;
    margin: 0;
    flex-shrink: 0;
  }

  :global(body.dark-mode) .window-control-btn {
    color: var(--text, #e0e0e0);
  }

  .window-control-btn:hover {
    background-color: rgba(128, 128, 128, 0.18);
  }

  :global(body.dark-mode) .window-control-btn:hover {
    background-color: rgba(255, 255, 255, 0.12);
  }

  .window-control-btn.btn-close:hover {
    background-color: #c42b1c !important;
    color: #ffffff !important;
  }

  .window-control-btn.btn-close:active {
    background-color: #b22518 !important;
    color: #ffffff !important;
  }

  /* Native-styled tooltip (Win11 dark tooltip look, both themes). */
  .win-tip {
    position: fixed;
    z-index: 9999995;
    transform: translateX(-100%);
    background: #2b2b2b;
    color: #ffffff;
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 12px;
    line-height: 1.3;
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    white-space: nowrap;
  }

  /* Snap-layout flyout (mica-style translucent panel). */
  .snap-flyout {
    position: fixed;
    z-index: 9999994;
    background: rgba(43, 43, 46, 0.8);
    -webkit-backdrop-filter: blur(30px) saturate(1.5);
    backdrop-filter: blur(30px) saturate(1.5);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }
  .snap-grid {
    display: grid;
    grid-template-columns: repeat(3, 64px);
    gap: 6px;
  }
  .snap-opt {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    border-radius: 6px;
  }
  .snap-mini {
    position: relative;
    display: block;
    width: 64px;
    height: 44px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .snap-opt:hover .snap-mini {
    background: rgba(255, 255, 255, 0.15);
  }
  .snap-mini .snap-on {
    position: absolute;
    background: var(--color-primary, #ff6b00);
    opacity: 0.9;
    border-radius: 2px;
  }
  .snap-left { left: 3px; top: 3px; bottom: 3px; width: calc(50% - 5px); }
  .snap-right { right: 3px; top: 3px; bottom: 3px; width: calc(50% - 5px); }
  .snap-full { left: 3px; right: 3px; top: 3px; bottom: 3px; }
  .snap-tl { left: 3px; top: 3px; width: calc(50% - 5px); height: calc(50% - 5px); }
  .snap-tr { right: 3px; top: 3px; width: calc(50% - 5px); height: calc(50% - 5px); }
  .snap-bl { left: 3px; bottom: 3px; width: calc(50% - 5px); height: calc(50% - 5px); }
</style>
