<script>
  /**
   * Sound engine boot. Mounted once from the root layout.
   *
   * Nothing renders. On mount it: loads the saved preference, warms cuelume,
   * binds its delegated `data-cuelume-*` listeners, revives the app's dead
   * `MaterioHaptics` surface as a sound shim, marks up the interactive DOM,
   * and wires the handful of app-wide events (navigation, connectivity, auth)
   * that no single component owns.
   *
   * On web every path here is a no-op — `isNative` is checked before cuelume is
   * ever imported, so the audio chunk is not fetched for browser visitors.
   */
  import { onMount } from 'svelte';
  import { isNative } from '$lib/config/api.js';
  import { activeTab } from '$lib/stores.js';
  import {
    warmSoundEngine,
    loadSoundPrefs,
    bindSounds,
    autoAnnotate,
    observeAnnotations,
    installHapticsShim,
    soundsEnabled,
    sfx
  } from '$lib/sounds/index.js';
  import { routeChanged, cameOnline, wentOffline, signedIn, signedOut } from '$lib/sounds/events.js';

  // Subscribing is what turns a preference change into a setEnabled() call.
  $: if (isNative) void soundsEnabled;

  onMount(() => {
    if (!isNative) return;

    loadSoundPrefs();
    warmSoundEngine();
    bindSounds(document);
    installHapticsShim();

    // The fetch interceptor installs itself on api.js evaluation, but the very
    // first paint can land before layout has finished; annotate again once the
    // app shell is actually on screen.
    autoAnnotate(document.body);
    const stopObserving = observeAnnotations(document.body);

    // --- app-wide events -------------------------------------------------

    // Tab navigation. The store is the single source of truth for which tab is
    // showing (Navbar, MainApp and deep links all write to it), so subscribing
    // covers every navigation path without touching each one.
    let lastTab = null;
    const stopTab = activeTab.subscribe((tab) => {
      if (lastTab === null) {
        lastTab = tab;
        return;
      }
      if (tab && tab !== lastTab) {
        const order = ['home', 'notifications', 'leaderboard', 'notebooks', 'downloads', 'settings'];
        const forward = order.indexOf(tab) >= order.indexOf(lastTab);
        lastTab = tab;
        routeChanged(forward ? 'forward' : 'back');
      } else {
        lastTab = tab;
      }
    });

    const onOnline = () => cameOnline();
    const onOffline = () => wentOffline();
    const onLogin = () => signedIn();
    const onLogout = () => signedOut();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('auth:login', onLogin);
    window.addEventListener('auth:logout', onLogout);

    // A late second pass: several overlays (splash, drawers, the app chrome)
    // mount on their own schedules, and their buttons should not be silent.
    const settle = setTimeout(() => autoAnnotate(document.body), 900);

    // Handy from anywhere (and from the console while tuning).
    if (typeof window !== 'undefined') window.sfx = sfx;

    return () => {
      clearTimeout(settle);
      stopObserving();
      stopTab();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('auth:login', onLogin);
      window.removeEventListener('auth:logout', onLogout);
    };
  });
</script>