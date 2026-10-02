/**
 * Notebook covers and ribbons.
 *
 * A cover is two custom properties, not an image and not a class — `--cover`
 * (the flat fill) and `--cover-ink` (the colour of anything drawn on it).
 * Everything downstream is plain CSS, so a cover follows the active theme
 * automatically instead of carrying a hard-coded palette that would look
 * wrong on coffee, amoled, or a user-chosen accent.
 *
 * The values are deliberately desaturated and mid-toned: a cover has to stay
 * readable behind text and must not fight the accent colour, which is what
 * `color-mix()` below handles on the ink side.
 */

export const DEFAULT_COVER = 'slate';

export const NOTEBOOK_COVERS = [
  { id: 'slate', label: 'Slate', cover: '#5c6470', ink: '#f2f4f7' },
  { id: 'ink', label: 'Ink', cover: '#2f3540', ink: '#e8ebf0' },
  { id: 'moss', label: 'Moss', cover: '#4a6152', ink: '#eaf2ec' },
  { id: 'clay', label: 'Clay', cover: '#8a5f4c', ink: '#f7ece6' },
  { id: 'plum', label: 'Plum', cover: '#5f4a63', ink: '#f2eaf4' },
  { id: 'teal', label: 'Teal', cover: '#356b6e', ink: '#e6f2f2' },
  { id: 'sand', label: 'Sand', cover: '#8c7a5c', ink: '#f6f0e2' },
  { id: 'rust', label: 'Rust', cover: '#7d4636', ink: '#f8eae5' },
  { id: 'navy', label: 'Navy', cover: '#33455f', ink: '#e8eef6' },
  { id: 'olive', label: 'Olive', cover: '#5f6141', ink: '#f0f1e4' }
];

/**
 * Bookmark ribbons, drawn as a small bookmark tail in the cover's corner.
 * Used to mark a note's state at a glance without another badge.
 */
export const NOTEBOOK_RIBBONS = [
  { id: null, label: 'None' },
  { id: 'active', label: 'Active' },
  { id: 'exam', label: 'Exam prep' },
  { id: 'revision', label: 'Revision' }
];

export function getCover(id) {
  return NOTEBOOK_COVERS.find((c) => c.id === id) || NOTEBOOK_COVERS.find((c) => c.id === DEFAULT_COVER);
}

export function getRibbon(id) {
  return NOTEBOOK_RIBBONS.find((r) => r.id === id) || null;
}

/** Stable-ish pick so a new note gets colour without feeling random-wrong. */
export function randomCover() {
  const pool = NOTEBOOK_COVERS.filter((c) => c.id !== DEFAULT_COVER);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return pick?.id || DEFAULT_COVER;
}

export function coverLabel(id) {
  return getCover(id).label;
}

/**
 * Inline custom properties for a cover. Returned as a style string so it can
 * be spread onto markup in both components without a wrapper element.
 */
export function coverStyle(id) {
  const cover = getCover(id);
  return `--cover:${cover.cover};--cover-ink:${cover.ink};`;
}