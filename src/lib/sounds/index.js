/**
 * Materio interaction sounds — native app shells only.
 *
 * Wraps `cuelume` (fourteen interaction cues synthesized live with Web Audio,
 * no audio files) behind three things this app needs:
 *
 *   1. A gate. Sound is for the Tauri (Windows) and Capacitor (Android) apps.
 *      The website stays silent, so `isNative` is checked before cuelume is
 *      even imported — the module is a dynamic import, so on web the audio
 *      chunk is never fetched at all.
 *   2. Preferences. cuelume deliberately stores nothing; enabled / volume /
 *      material live in localStorage here and are pushed into cuelume through
 *      setEnabled / setVolume / setTheme.
 *   3. Coverage. There is no component library in this codebase — interactive
 *      markup is raw HTML with CSS classes — so hand-annotating every button
 *      is not realistic. `bind()` handles anything already marked with a
 *      `data-cuelume-*` attribute, and `autoAnnotate()` marks the rest by
 *      element role, tag and class, which is what gets taps onto the hundreds
 *      of buttons the app already has.
 *
 * See https://cuelume-site.pages.dev/agents.md for the cue/emphasis contract.
 */

import { isNative } from '$lib/config/api.js';
import { writable, get } from 'svelte/store';

/* ------------------------------------------------------------------ prefs */

export const STORAGE_ENABLED = 'materio_sounds_enabled';
export const STORAGE_VOLUME = 'materio_sounds_volume';
export const STORAGE_MATERIAL = 'materio_sounds_material';

// cuelume's four materials. Labels are the app-facing names.
export const MATERIALS = [
  { id: 'default', label: 'Default', hint: 'Glass, wood and soft mallets' },
  { id: 'mech', label: 'Mechanical', hint: 'Dry machined parts' },
  { id: 'press', label: 'Press', hint: 'Crisp click over a warm note' },
  { id: 'bubble', label: 'Playful', hint: 'Knocks, drips and gulps' }
];

export const soundsEnabled = writable(false);
export const soundVolume = writable(0.75);
export const soundMaterial = writable('default');

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/* ------------------------------------------------------- the lazy engine */

let engine = null; // { play, bind, setEnabled, setVolume, setTheme }
let loadPromise = null;

/**
 * Imports cuelume once, on demand. Returns null on web, or when Web Audio is
 * unavailable — every caller treats null as "stay silent", which is also how
 * cuelume behaves internally, so there is no failure path to handle.
 */
function loadEngine() {
  if (engine) return Promise.resolve(engine);
  if (!isNative) return Promise.resolve(null);
  if (!loadPromise) {
    loadPromise = import('cuelume')
      .then((mod) => {
        engine = mod;
        // cuelume reads nothing from storage, so the saved preferences have to
        // be pushed in before the first cue can possibly play.
        mod.setEnabled(get(soundsEnabled));
        mod.setVolume(get(soundVolume));
        mod.setTheme(get(soundMaterial));
        return mod;
      })
      .catch(() => null);
  }
  return loadPromise;
}

/** Loads the engine without waiting; used by the boot sequence. */
export function warmSoundEngine() {
  return loadEngine();
}

/* ------------------------------------------------------------- playback */

/**
 * Plays a cue. Safe to call before the engine has loaded (the cue is simply
 * dropped rather than queued — sounds are feedback, not state) and safe to
 * call on web, where it does nothing.
 *
 * @param {string} name  one of cuelume's fourteen cues
 * @param {object} [options]  emphasis / direction / key / duration / theme
 */
export function sfx(name, options) {
  if (!isNative || !get(soundsEnabled)) return;
  loadEngine().then((mod) => {
    if (!mod) return;
    try {
      mod.play(name, options);
    } catch {
      /* cuelume is a silent no-op by contract; never let feedback throw */
    }
  });
}

/**
 * Wires up cuelume's delegated `data-cuelume-*` listeners under `root`.
 * Idempotent per root, and delegated, so it keeps working when the framework
 * replaces DOM underneath it.
 */
export function bindSounds(root) {
  if (!isNative) return;
  loadEngine().then((mod) => {
    try {
      mod?.bind(root);
    } catch {}
  });
}

/* ----------------------------------------------------------- preferences */

export function setSoundEnabled(enabled) {
  const value = !!enabled;
  soundsEnabled.set(value);
  write(STORAGE_ENABLED, value ? 'true' : 'false');
  try {
    engine?.setEnabled(value);
  } catch {}
  return value;
}

export function setSoundVolume(volume) {
  const value = Math.min(1, Math.max(0, Number(volume) || 0));
  soundVolume.set(value);
  write(STORAGE_VOLUME, String(value));
  try {
    engine?.setVolume(value);
  } catch {}
  return value;
}

export function setSoundMaterial(material) {
  const value = MATERIALS.some((m) => m.id === material) ? material : 'default';
  soundMaterial.set(value);
  write(STORAGE_MATERIAL, value);
  try {
    engine?.setTheme(value);
  } catch {}
  return value;
}

/** Reads persisted preferences into the stores. Native apps default to on. */
export function loadSoundPrefs() {
  if (!isNative) {
    soundsEnabled.set(false);
    return;
  }
  const enabled = read(STORAGE_ENABLED, 'true');
  const volume = Number(read(STORAGE_VOLUME, '0.75'));
  const material = read(STORAGE_MATERIAL, 'default');
  soundsEnabled.set(enabled !== 'false');
  soundVolume.set(Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.75);
  soundMaterial.set(MATERIALS.some((m) => m.id === material) ? material : 'default');
}

/* --------------------------------------------------------- legacy shim */

// `window.MaterioHaptics.vibrate(name)` is called from ~28 places across the
// app but has never been defined, so every one of those calls has been a
// silent no-op. Its vocabulary is the app's original feedback taxonomy, so it
// maps straight onto cues. Defining it here revives all of them at once, and
// routes through the same Sound preference so there is one off switch.
const LEGACY_CUES = {
  tap: ['tap', { emphasis: 'subtle' }],
  light: ['tap', { emphasis: 'subtle' }],
  tick: ['select', { emphasis: 'subtle' }],
  select: ['select', undefined],
  success: ['success', undefined],
  dropdownOpen: ['open', { emphasis: 'subtle' }],
  dropdownClose: ['close', { emphasis: 'subtle' }]
};

/**
 * Restores the `MaterioHaptics` surface the app has always called into, now
 * backed by real audio. Vibrate is kept alongside the sound so the (dead)
 * haptics preference still means something where haptics do exist.
 */
export function installHapticsShim() {
  if (!isNative || typeof window === 'undefined') return;
  if (window.MaterioHaptics?.__cuelume) return;
  const vibrate = (name) => {
    try {
      const mapped = LEGACY_CUES[name] || LEGACY_CUES.tap;
      sfx(mapped[0], mapped[1]);
      let hapticsOn = true;
      try {
        hapticsOn = localStorage.getItem('materio_haptics_enabled') !== 'false';
      } catch {}
      if (hapticsOn && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([10]);
      }
    } catch {}
  };
  window.MaterioHaptics = { vibrate, __cuelume: true };
}

/* ------------------------------------------- auto-annotation of the DOM */

const MARKED = '[data-cuelume-tap],[data-cuelume-type],[data-cuelume-select],[data-cuelume-toggle],[data-cuelume-open],[data-cuelume-close],[data-cuelume-navigate]';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE', 'IFRAME', 'AUDIO', 'VIDEO', 'CANVAS', 'SVG', 'PATH']);
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date',
  'time', 'datetime-local', 'month', 'week'
]);

const DESTRUCTIVE_CLASS = /delete|remove|danger|destructive|trash|discard|clear-all|erase|log-?out|sign-?out|deactivate/i;
const DESTRUCTIVE_TEXT = /^(delete|remove|log ?out|sign out|discard|clear all|reset|erase)\b/i;
const NAV_CLASS = /(^|[\s_-])(tab-link|nav-item|nav-link|tab-item|tab-btn)([\s_-]|$)/i;
const NAV_DATA = ['data-tab', 'data-route', 'data-nav'];
const MENU_CLASS = /(^|[\s_-])(dropdown-item|menu-item|menuitem|list-item|option|select-option|dropdown-link)([\s_-]|$)/i;
const CLOSE_CLASS = /(^|[\s_-])(close|close-btn|dismiss|modal-close|x-btn|cancel)([\s_-]|$)/i;
const TOGGLE_CLASS = /(^|[\s_-])(toggle|switch|toggle-btn|star|bookmark|like|fav)([\s_-]|$)/i;
const PRIMARY_CLASS = /(^|[\s_-])(primary|btn-primary|primary-btn|submit|cta|accent)([\s_-]|$)/i;

// pdf.js viewer toolbar (Oread). Marked from the parent document, so the
// oread build itself is never touched.
const OREAD_HIGHLIGHT = /highlight/i;
const OREAD_DRAW = /freehand|ink|draw|pencil|annotationEditor|editorFreehand/i;

function hasClass(el, re) {
  const c = el.className;
  if (typeof c !== 'string' || !c) return false;
  return re.test(c);
}

function textOf(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function isDisabled(el) {
  return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
}

function alreadyMarked(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hasAttribute?.(MARKED)) return true;
  }
  return false;
}

/**
 * Chooses the cue for one element by the job it does, per the cuelume table.
 * Returns the attribute name to set, or null to leave the element alone.
 */
function cueFor(el) {
  const tag = el.tagName;

  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return 'data-cuelume-toggle';
    if (type === 'range') return 'data-cuelume-select';
    if (TEXT_INPUT_TYPES.has(type)) return 'data-cuelume-type';
    if (type === 'submit' || type === 'button' || type === 'reset') return 'data-cuelume-tap';
    return null;
  }
  if (tag === 'TEXTAREA' || el.isContentEditable) return 'data-cuelume-type';
  if (tag === 'SELECT') return 'data-cuelume-select';
  if (tag === 'SUMMARY') return 'data-cuelume-toggle';
  if (tag === 'OPTION') return null;

  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role === 'switch' || role === 'checkbox') return 'data-cuelume-toggle';
  if (role === 'tab') return 'data-cuelume-select';
  if (role === 'menuitem' || role === 'option' || role === 'listbox') return 'data-cuelume-select';
  if (role === 'dialog') return null;

  // Nothing to sound on a plain container.
  const interactive =
    tag === 'BUTTON' || tag === 'A' || role === 'button' || el.hasAttribute('onclick') || el.hasAttribute('tabindex');
  if (!interactive) return null;

  // Oread viewer toolbar: highlighting and drawing are tool switches.
  if (OREAD_HIGHLIGHT.test(el.id || '') || OREAD_DRAW.test(el.id || '') || OREAD_DRAW.test(el.className || '')) {
    return 'data-cuelume-toggle';
  }

  if (hasClass(el, DESTRUCTIVE_CLASS)) return 'data-cuelume-close';
  if ((el.textContent || '').trim() && DESTRUCTIVE_TEXT.test(textOf(el))) return 'data-cuelume-close';
  if (el.getAttribute('aria-pressed') !== null) return 'data-cuelume-toggle';
  if (hasClass(el, TOGGLE_CLASS)) return 'data-cuelume-toggle';
  if (hasClass(el, CLOSE_CLASS)) return 'data-cuelume-close';
  if (hasClass(el, MENU_CLASS)) return 'data-cuelume-select';
  if (NAV_DATA.some((a) => el.hasAttribute(a)) || hasClass(el, NAV_CLASS)) return 'data-cuelume-navigate';

  // Generic activation. Secondary controls stay subtle so a screen full of
  // buttons does not become a screen full of noise.
  if (hasClass(el, PRIMARY_CLASS) || (el.getAttribute('type') || '').toLowerCase() === 'submit') {
    return 'data-cuelume-tap';
  }
  return 'data-cuelume-tap';
}

/** The subtlety hint that goes beside the attribute. */
function emphasisFor(el, attr) {
  if (attr === 'data-cuelume-navigate' || attr === 'data-cuelume-toggle') return 'subtle';
  if (hasClass(el, DESTRUCTIVE_CLASS)) return 'strong';
  if (attr === 'data-cuelume-tap' && !hasClass(el, PRIMARY_CLASS)) return 'subtle';
  return null;
}

function annotateElement(el) {
  if (!el || el.nodeType !== 1) return;
  if (SKIP_TAGS.has(el.tagName)) return;
  if (el.hasAttribute('data-tauri-drag-region')) return;
  if (el.closest?.('[data-cuelume-annotations="off"]')) return;
  if (alreadyMarked(el)) return;
  if (isDisabled(el)) return;

  const attr = cueFor(el);
  if (!attr) return;
  el.setAttribute(attr, '');
  const emphasis = emphasisFor(el, attr);
  if (emphasis) el.setAttribute('data-cuelume-emphasis', emphasis);
}

/**
 * Marks a root and everything under it. Idempotent: already-marked subtrees
 * are skipped, so repeated calls over the same DOM are cheap.
 */
export function autoAnnotate(root) {
  if (!isNative || !root) return;
  try {
    if (root.nodeType === 1) annotateElement(root);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          // Marked elements still need descending: a marked wrapper can
          // contain unmarked controls.
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let node;
    while ((node = walker.nextNode())) annotateElement(node);
  } catch {}
}

/**
 * Keeps annotations in step with the DOM. Svelte creates and destroys nodes
 * constantly, so new subtrees get marked as they arrive. Only childList is
 * observed — watching attributes would loop forever, since the handler's own
 * writes would re-trigger it.
 */
export function observeAnnotations(root = document.body) {
  if (!isNative || typeof MutationObserver === 'undefined') return () => {};
  let queued = false;
  const observer = new MutationObserver((records) => {
    if (queued) return;
    queued = true;
    const run = () => {
      queued = false;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (SKIP_TAGS.has(node.tagName)) continue;
          autoAnnotate(node);
        }
      }
    };
    // Batched: a re-render can add hundreds of nodes at once, and this runs
    // off the critical path so it never competes with the click that caused it.
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 400 });
    else setTimeout(run, 0);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}