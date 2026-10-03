// Should this annotation snapshot be allowed to replace the record we hold?
//
// The viewer posts a snapshot on every change and once after each restore.
// Almost every snapshot that is SMALLER than the record we hold is data loss:
// the parent's copy in IndexedDB is the only durable one, and adopting a
// smaller snapshot rebases the baseline, so the next save writes the smaller
// state over the real record.
//
// Two shrinks are legitimate and allowed:
//
//   - the reader deleted annotations. The viewer reports every real removal in
//     `removed`, and those are subtracted from the comparison.
//   - nothing else. An empty or partial snapshot after a restore means the
//     restore has not reached every page yet: PDF.js only builds a page's
//     AnnotationEditorLayer while that page draws, and the editor mode
//     defaults to NONE, so a large PDF opened near the end can take a while.
//     The viewer keeps those entries in its own snapshot meanwhile (see
//     `unrestored` in sidecar.js), which is why an honest snapshot is never
//     smaller - a smaller one is by definition incomplete.
//
// So the comparison is a count of EDITOR entries, never of keys. Keys cannot
// be compared: pdf.js hands out fresh editor ids for every document, and the
// viewer renames incoming keys so they cannot collide with live ones.
//
// Deliberately NO "the restore finished, trust it" escape hatch. That would be
// the original bug again: a sync emitted before every entry was accounted for
// is exactly what used to wipe the record. Holding the old record is never
// lossy, and a shrink the viewer cannot explain disappears on its own once the
// remaining entries are restored and rejoin the snapshot - the counts meet and
// the snapshot is accepted again.

function isEditorEntry(v) {
  return !!v && typeof v === 'object' &&
    (v.annotationType != null || v.annotationEditorType != null);
}

/** How many editor annotations a storage map holds. */
export function annotEditorCount(storage) {
  let n = 0;
  const s = storage || {};
  for (const k of Object.keys(s)) if (isEditorEntry(s[k])) n++;
  return n;
}

/**
 * @param {*} heldStorage the record we already hold for this PDF
 * @param {*} incomingStorage the snapshot just received from the viewer
 * @param {{ removed?: string[] }} opts
 * @returns {{ reject: boolean, reason: string, held: number, incoming: number, removed: number }}
 */
export function annotShrinkGuard(heldStorage, incomingStorage, opts = {}) {
  const held = annotEditorCount(heldStorage);
  const incoming = annotEditorCount(incomingStorage);
  // Removals are counted, not matched by key: a restored editor has a fresh
  // id this session, so the key the reader deleted will usually not be one we
  // hold. Requiring a match would reject every real deletion and freeze the
  // record in its pre-deletion state.
  const removed = Array.isArray(opts.removed) ? opts.removed.length : 0;

  // Deleting the last annotation is allowed: 0 incoming + 1 removed against 1
  // held is not a shrink. A separate "reject empty" rule (the original code
  // had one) had no way to see that and would have frozen the record at its
  // pre-deletion state forever.
  if (incoming + removed >= held) {
    return { reject: false, reason: 'no-shrink', held, incoming, removed };
  }
  return { reject: true, reason: 'incomplete-restore', held, incoming, removed };
}
