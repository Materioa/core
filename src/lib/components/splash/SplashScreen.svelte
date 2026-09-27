<script lang="ts">
  import { onMount } from "svelte";
  import LineArtBackground from "./LineArtBackground.svelte";
  import BudDoesThings from "./BudDoesThings.svelte";
  import DayWithBud from "./DayWithBud.svelte";
  import stickerDataUri from "./assets/sticker.png?inline";

  // Full-screen splash for the Materio Android (Capacitor) app:
  //  1. Line art background (system light/dark) + Bud shuffling fast at center.
  //  2. Bud fades + slides down out, sticker slides up from the same
  //     offset into the center and replaces it.
  //
  // Usage:
  //   import SplashScreen from '$lib/components/splash/SplashScreen.svelte';
  //   <SplashScreen ondone={() => goto('/home')} />
  // The sticker is bundled (assets/sticker.png, inlined as base64 via
  // Vite `?inline`) — no asset hosting needed.
  // Pass stickerSrc to override, stickerWidth to resize.

  let {
    class: className = "",
    theme = "system",
    bud = "day",
    shuffleMs = 5000,
    budSpeed = 2.4,
    budScale = 0.8,
    dayPhaseMs = 800,
    stickerSrc = stickerDataUri,
    stickerAlt = "Materio",
    stickerWidth = 168,
    autoplay = true,
    ondone,
  }: {
    class?: string;
    theme?: "system" | "light" | "dark";
    bud?: "does-things" | "day";
    shuffleMs?: number;
    budSpeed?: number;
    budScale?: number;
    dayPhaseMs?: number;
    stickerSrc?: string;
    stickerAlt?: string;
    stickerWidth?: number;
    autoplay?: boolean;
    ondone?: () => void;
  } = $props();

  // Resolved theme drives `data-theme` on the root: line art, Bud ink and
  // surface colors all key off it. "system" mirrors the app convention
  // (host `.dark-mode` class > OS preference) and live-tracks OS / host
  // changes — this is what the Android WebView needs.
  let isDark = $state(false);
  let showSticker = $state(false);
  let settled = $state(false);

  function hostIsDark(): boolean {
    if (typeof document === "undefined") return false;
    const root = document.documentElement;
    if (root.classList.contains("dark") || root.classList.contains("dark-mode")) return true;
    try {
      if (document.body && document.body.classList.contains("dark-mode")) return true;
    } catch {}
    return false;
  }

  function resolveDark(): boolean {
    if (theme === "light") return false;
    if (theme === "dark") return true;
    try {
      const stored = localStorage.getItem("materio_theme");
      if (stored === "dark") return true;
      if (stored === "light") return false;
    } catch {}
    if (hostIsDark()) return true;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  }

  onMount(() => {
    const cleanups: Array<() => void> = [];
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    if (theme === "system") {
      const sync = () => (isDark = resolveDark());
      sync();
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onMq = () => sync();
        mq.addEventListener("change", onMq);
        cleanups.push(() => mq.removeEventListener("change", onMq));
      }
      // The host theme engine toggles classes on <html> and <body>.
      const obs = new MutationObserver(sync);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      cleanups.push(() => obs.disconnect());
      try {
        if (document.body) {
          const obsBody = new MutationObserver(sync);
          obsBody.observe(document.body, { attributes: true, attributeFilter: ["class"] });
          cleanups.push(() => obsBody.disconnect());
        }
      } catch {}
      const onStorage = () => sync();
      window.addEventListener("storage", onStorage);
      cleanups.push(() => window.removeEventListener("storage", onStorage));
    } else {
      isDark = theme === "dark";
    }

    if (autoplay) {
      // Phase 1: Bud animates for `shuffleMs`. Phase 2: handoff to the sticker.
      timers.push(setTimeout(() => (showSticker = true), Math.max(400, shuffleMs)));
      // Phase 3: after sticker has displayed, fire ondone to exit.
      timers.push(
        setTimeout(() => {
          settled = true;
          ondone?.();
        }, Math.max(400, shuffleMs) + 1200),
      );
    }

    return () => {
      timers.forEach(clearTimeout);
      cleanups.forEach((fn) => fn());
    };
  });

  export function skipToSticker() {
    showSticker = true;
  }

  export function isSettled() {
    return settled;
  }
</script>

<div
  data-theme={isDark ? "dark" : "light"}
  class="splash-root {className}"
  role="status"
  aria-label="Loading Materio"
>
  <LineArtBackground />

  <!-- Center stage: Bud and sticker share one slot so the handoff reads
       as a single element morphing in place. -->
  <div class="splash-center">
    <div class="splash-stage">
      <!-- Bud: fast shuffle, then fade + slide DOWN out -->
      <div
        class="splash-bud {showSticker ? 'splash-bud-out' : ''}"
        aria-hidden={showSticker}
      >
       <div class="splash-bud-scale" style="scale: {budScale}">
        {#if bud === "day"}
          <DayWithBud
            class="splash-day-bud"
            autoPlay={true}
            phaseDuration={dayPhaseMs}
            speed={budSpeed}
            interactive={false}
            showTimeline={false}
            showCaption={false}
            showControls={false}
          />
        {:else}
          <BudDoesThings
            class="splash-bud-things"
            activity="auto"
            speed={budSpeed}
            interactive={false}
            autoCycle={true}
            showDesk={false}
          />
        {/if}
        </div>
      </div>

      <!-- Sticker: slides UP from the same offset Bud sank to -->
      <div
        class="splash-sticker {showSticker ? 'splash-sticker-in' : ''}"
        aria-hidden={!showSticker}
      >
        <img
          src={stickerSrc}
          alt={stickerAlt}
          width={stickerWidth}
          draggable="false"
          class="splash-sticker-img"
        />
      </div>
    </div>
  </div>
</div>

<style>
  /* Critical layout lives here (not in Tailwind utilities): the host
     app's Tailwind only scans its own files, so arbitrary values used
     solely by this component would silently produce no CSS. */
  .splash-root {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
    overflow: hidden;
    background-color: #f7f7f2;
    color: #0e0f0c;
    transition: background-color 0.5s ease, color 0.5s ease;
  }
  .splash-root[data-theme="dark"] {
    background-color: #121310;
    color: #f4f4ee;
  }
  .splash-center {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 360px;
    padding-left: 2rem;
    padding-right: 2rem;
  }
  /* Bud ink follows the surface theme even without Tailwind tokens.
     DayWithBud hardcodes text-white on its inner svg, which lives in the
     child component — so cross the boundary with :global. */
  .splash-root .splash-bud,
  .splash-root .splash-bud :global(svg) {
    color: #0e0f0c;
  }
  .splash-root[data-theme="dark"] .splash-bud,
  .splash-root[data-theme="dark"] .splash-bud :global(svg) {
    color: #f4f4ee;
  }

  .splash-stage {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 280px;
    perspective: 600px;
  }

  /* Optical bud size via the independent `scale` property, so the
     exit-transition `transform` on the parent is left undisturbed. */
  .splash-bud-scale {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }

  /* Bud rests centered, then sinks down + fades. */
  .splash-bud {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 1;
    transform: translateY(0) scale(1);
    transition:
      opacity 480ms ease,
      transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: opacity, transform;
  }
  .splash-bud-out {
    opacity: 0;
    transform: translateY(56px) scale(0.94);
    pointer-events: none;
  }

  /* Sticker waits below at the exact offset Bud sinks to, then rises in. */
  .splash-sticker {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: translateY(56px) scale(0.94);
    transition:
      opacity 520ms ease,
      transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
    transition-delay: 140ms;
    will-change: opacity, transform;
    pointer-events: none;
  }
  .splash-sticker-in {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .splash-sticker-img {
    max-width: 100%;
    height: auto;
    user-select: none;
    filter: drop-shadow(0 18px 40px rgba(0, 0, 0, 0.22));
  }
  .splash-root[data-theme="dark"] .splash-sticker-img {
    filter: drop-shadow(0 18px 44px rgba(0, 0, 0, 0.7));
  }

  @media (prefers-reduced-motion: reduce) {
    .splash-bud,
    .splash-sticker {
      transition-duration: 1ms;
      transition-delay: 0ms;
    }
  }
</style>
