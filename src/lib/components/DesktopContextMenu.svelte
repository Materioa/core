<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { isTauri } from '$lib/config/api.js';

  // Desktop-only replacement for the WebView's default right-click menu.
  // Just Back + Refresh — no Print / Save as / More tools. Translucent
  // blur panel in the spirit of Windows Mica (pure CSS: backdrop-filter
  // over a semi-transparent surface; real Mica needs native APIs).
  let visible = $state(false);
  let x = $state(0);
  let y = $state(0);

  function isEditable(target) {
    // Text fields keep the native menu (copy / paste / select all).
    try {
      if (!target || !target.closest) return false;
      return !!target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
    } catch {
      return false;
    }
  }

  function openMenu(e) {
    if (!isTauri) return;
    if (isEditable(e.target)) return;
    try {
      e.preventDefault();
    } catch {}
    const margin = 8;
    const w = 190;
    const h = 96;
    x = Math.min(e.clientX, window.innerWidth - w - margin);
    y = Math.min(e.clientY, window.innerHeight - h - margin);
    visible = true;
  }

  function closeMenu() {
    visible = false;
  }

  function goBack() {
    closeMenu();
    try {
      if (window.history.length > 1) window.history.back();
    } catch {}
  }

  function refresh() {
    closeMenu();
    try {
      window.location.reload();
    } catch {}
  }

  function onKey(e) {
    if (e.key === 'Escape') closeMenu();
  }

  onMount(() => {
    if (!browser || !isTauri) return;
    window.addEventListener('contextmenu', openMenu);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', openMenu);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if visible}
  <div class="ctx-backdrop" onclick={closeMenu} oncontextmenu={(e) => { e.preventDefault(); closeMenu(); }} role="presentation"></div>
  <div class="ctx-menu" style="left: {x}px; top: {y}px;" role="menu" aria-label="Page actions">
    <button type="button" class="ctx-item" onclick={goBack} role="menuitem">
      <span class="ctx-label">Back</span>
      <span class="ctx-hint">Alt+Left arrow</span>
    </button>
    <button type="button" class="ctx-item" onclick={refresh} role="menuitem">
      <span class="ctx-label">Refresh</span>
      <span class="ctx-hint">Ctrl+R</span>
    </button>
  </div>
{/if}

<style>
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999990;
    background: transparent;
  }
  .ctx-menu {
    position: fixed;
    z-index: 9999991;
    width: 190px;
    padding: 6px;
    border-radius: 12px;
    background: rgba(32, 32, 34, 0.72);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    backdrop-filter: blur(24px) saturate(1.4);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  :global(body:not(.dark-mode)) .ctx-menu {
    background: rgba(248, 248, 246, 0.78);
    border-color: rgba(0, 0, 0, 0.1);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  }
  .ctx-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: none;
    color: #f4f4ee;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }
  :global(body:not(.dark-mode)) .ctx-item {
    color: #171814;
  }
  .ctx-item:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  :global(body:not(.dark-mode)) .ctx-item:hover {
    background: rgba(0, 0, 0, 0.07);
  }
  .ctx-label {
    font-weight: 500;
  }
  .ctx-hint {
    font-size: 11px;
    opacity: 0.55;
    white-space: nowrap;
  }
</style>
