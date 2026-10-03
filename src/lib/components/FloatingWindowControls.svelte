<script>
  import { onMount } from 'svelte';
  import { isTauri as isTauriEnv } from '$lib/config/api.js';

  // Floating window controls (close / restore / minimize) that stay
  // available on pages where the app header — which carries the same
  // buttons — is not rendered (landing, pricing, interviewer, downloads,
  // bare policy/docs pages). On core pages the header copy is used and
  // this component renders nothing.
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

  onMount(() => {
    if (typeof window === 'undefined') return;
    isDesktopApp = Boolean(
      isTauriEnv ||
      window.__TAURI_INTERNALS__ ||
      window.__TAURI__ ||
      window.__TAURI_METADATA__ ||
      window.location?.hostname === 'tauri.localhost' ||
      window.location?.protocol === 'tauri:'
    );
    if (isDesktopApp) {
      checkMaximized();
      const onResize = () => checkMaximized();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
  });
</script>

{#if isDesktopApp}
<div class="floating-window-controls" aria-label="Window Controls">
    <button type="button" class="window-control-btn btn-min" on:click|stopPropagation={handleMinimize} aria-label="Minimize" title="Minimize">
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M 0 5.5 H 10" stroke="currentColor" stroke-width="1"/>
        </svg>
    </button>
    <button type="button" class="window-control-btn btn-max" on:click|stopPropagation={handleToggleMaximize} aria-label={isMaximized ? 'Restore' : 'Maximize'} title={isMaximized ? 'Restore' : 'Maximize'}>
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
    <button type="button" class="window-control-btn btn-close" on:click|stopPropagation={handleClose} aria-label="Close" title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M 1 1 L 9 9 M 9 1 L 1 9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
    </button>
</div>
{/if}

<style>
  .floating-window-controls {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483640;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 4px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
    -webkit-app-region: no-drag;
    app-region: no-drag;
    user-select: none;
  }

  :global(body:not(.dark-mode)) .floating-window-controls {
    background: rgba(255, 255, 255, 0.82);
    border-color: rgba(0, 0, 0, 0.08);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.10);
  }

  .window-control-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 24px;
    background: transparent;
    border: none;
    border-radius: 999px;
    color: var(--text, #333333);
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
    padding: 0;
    margin: 0;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  :global(body.dark-mode) .window-control-btn {
    color: var(--text, #e0e0e0);
  }

  .window-control-btn:hover {
    background-color: rgba(128, 128, 128, 0.28);
  }

  :global(body.dark-mode) .window-control-btn:hover {
    background-color: rgba(255, 255, 255, 0.14);
  }

  .window-control-btn.btn-close:hover {
    background-color: #c42b1c;
    color: #ffffff;
  }

  .window-control-btn.btn-close:active {
    background-color: #b22518;
    color: #ffffff;
  }
</style>
