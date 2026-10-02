/**
 * App-level sound vocabulary.
 *
 * cuelume ships fourteen cues named after interface *jobs*, not after sounds.
 * This module is the translation layer for the jobs Materio actually has —
 * a PDF opening, loading, failing; a highlight or drawing landing; an update
 * arriving — so those decisions are written down once here instead of being
 * re-guessed at every call site.
 *
 * Cue choices follow the table in https://cuelume-site.pages.dev/agents.md.
 * Two rules from it are load-bearing and easy to get wrong:
 *   - emphasis carries weight: subtle for the many, strong for the rare.
 *   - never one cue per event inside a burst. PDF progress, drawing strokes
 *     and scrolling are all throttled below rather than played per event.
 */

import { sfx } from './index.js';

/* ------------------------------------------------------------- debounce */

/** Collapses a burst of calls into one, trailing-edge. */
function throttle(fn, gapMs) {
  let last = -Infinity;
  return (...args) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - last < gapMs) return false;
    last = now;
    fn(...args);
    return true;
  };
}

/* ----------------------------------------------------------------- PDF */

/**
 * A PDF's progress arrives continuously — a 40 MB file can post hundreds of
 * `pdfProgress` messages. Each tenth gets one soft detent, nothing else, and
 * only while the document is actually being fetched.
 */
export function createPdfProgressCue() {
  let lastStep = -1;
  return function onProgress(loaded, total) {
    if (!total) return;
    const pct = Math.round((loaded / total) * 100);
    const step = Math.floor(pct / 10);
    if (step === lastStep || step <= 0 || step >= 10) return;
    lastStep = step;
    // A stepper moving: one detent per tenth, subtle so it sits under the page.
    sfx('select', { emphasis: 'subtle' });
  };
}

/** A PDF is being opened: slow work has started, nothing has landed yet. */
export function pdfOpening() {
  sfx('open');
  sfx('loading', { emphasis: 'subtle' });
}

/** The document rendered. A result is there — nothing has been confirmed. */
export function pdfReady() {
  sfx('ready');
}

export function pdfFailed() {
  sfx('error');
}

export function pdfClosing() {
  sfx('close');
}

/** Page turn / carousel move: navigation, subtle, with a direction. */
export function pdfPageTurn(direction = 'forward') {
  sfx('navigate', { emphasis: 'subtle', direction });
}

/* --------------------------------------------------------- annotations */

// The viewer already debounces its own change events, but drawing sessions
// keep firing across a whole sentence, so this collapses them further: one cue
// per pause in the drawing.
const annotCue = throttle(() => sfx('select', { emphasis: 'subtle' }), 700);

/** A highlight or a drawing landed in the document. */
export function annotationCommitted() {
  annotCue();
}

export function annotationsSaved() {
  sfx('success', { emphasis: 'subtle' });
}

export function annotationsSaveFailed() {
  sfx('error', { emphasis: 'subtle' });
}

/* ------------------------------------------------------------ downloads */

export function downloadStarted() {
  sfx('loading');
}

export function downloadFinished() {
  sfx('success');
}

export function downloadFailed() {
  sfx('error');
}

/* -------------------------------------------------------------- updater */

const updateCheckCue = throttle(() => sfx('loading', { emphasis: 'subtle' }), 5000);

export function updateCheckStarted() {
  updateCheckCue();
}

/** A new build exists: a result is there, and the user has to act on it. */
export function updateAvailable() {
  sfx('ready');
}

export function updateInstalling() {
  sfx('loading');
}

export function updateInstalled() {
  sfx('success', { emphasis: 'strong' });
}

export function updateFailed() {
  sfx('error');
}

/* ------------------------------------------------------------- chrome */

export function routeChanged(direction = 'forward') {
  sfx('navigate', { emphasis: 'subtle', direction });
}

export function overlayOpened() {
  sfx('open');
}

export function overlayClosed() {
  sfx('close');
}

export function signedIn() {
  sfx('success', { emphasis: 'strong' });
}

export function signedOut() {
  sfx('close');
}

export function wentOffline() {
  sfx('warning');
}

export function cameOnline() {
  sfx('success', { emphasis: 'subtle' });
}

export function copiedToClipboard() {
  sfx('success', { emphasis: 'subtle' });
}

/** Long work finished while the user was somewhere else. */
export function finishedInBackground() {
  sfx('ready', { emphasis: 'strong' });
}

/** Something needs an answer before the app can continue. */
export function needsAttention() {
  sfx('attention');
}

/** A count animating to a new value — one cue for the whole roll. */
export function counted(duration = 900, direction = 'forward') {
  sfx('count', { duration, direction });
}

/* ----------------------------------------------------------- dialogs */

/**
 * The cue a dialog reports when it is dismissed. MaterioModal is the app's
 * de-facto notification channel, so this covers most messaging in one place.
 */
export function dialogOutcome(type) {
  switch (type) {
    case 'success':
      return sfx('success');
    case 'warning':
      return sfx('warning');
    case 'danger':
    case 'error':
      return sfx('error');
    case 'info':
    default:
      return sfx('select');
  }
}

/** A destructive confirmation the user went through with. */
export function destructiveConfirmed() {
  sfx('close', { emphasis: 'strong' });
}