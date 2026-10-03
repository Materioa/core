#!/usr/bin/env node
// Unit test for the parent-side shrink guard.
//
//   node scripts/test-annot-shrink-guard.mjs
//
// The guard is the LAST line of defence against the "saved, but never comes
// back" bug: the record in IndexedDB is the only durable copy, so a snapshot
// that is merely incomplete (restore has not reached every page yet) must
// never be allowed to replace it. This test pins down exactly which shrinks
// are legitimate and which are refused, using real editor-shaped payloads.

import { annotShrinkGuard, annotEditorCount } from '../src/lib/utils/pdfAnnotShrinkGuard.js';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) failures.push(name);
};

const hl = (i) => ({
  annotationType: 9,
  color: [255, 235, 59],
  opacity: 1,
  thickness: 12,
  quadPoints: [10, 20, 30, 20, 10, 40, 30, 40],
  pageIndex: 0,
  rect: [10, 20, 30, 40],
  rotation: 0,
  id: null,
});
const freeHl = (i) => ({
  annotationType: 9,
  color: [255, 235, 59],
  opacity: 1,
  thickness: 12,
  quadPoints: null,
  outlines: { outline: [NaN, NaN, NaN, NaN, 120, 640, 121, 641, 122, 642, 124, 640], points: [[120, 640, 124, 644]] },
  pageIndex: 0,
  rect: [120, 640, 124, 644],
  rotation: 0,
  id: null,
});
const ink = (i) => ({
  annotationType: 15,
  color: [0, 0, 0],
  opacity: 1,
  thickness: 2,
  paths: { points: [[100, 300], [220, 340]] },
  pageIndex: 0,
  rect: [100, 300, 220, 340],
  rotation: 0,
  id: null,
});

console.log('\nGUARD  counting');

check('counts only editor entries',
  annotEditorCount({ a: hl(), b: { value: 'form-field' }, c: freeHl(), d: ink() }) === 3,
  `got ${annotEditorCount({ a: hl(), b: { value: 'form-field' }, c: freeHl(), d: ink() })}`);

check('counts by annotationEditorType too',
  annotEditorCount({ a: { annotationEditorType: 3, rect: [0, 0, 1, 1] } }) === 1);

check('empty storage is 0', annotEditorCount({}) === 0);
check('null storage is 0', annotEditorCount(null) === 0);

console.log('\nGUARD  equal / growing snapshots are accepted');

{
  const held = { p0: hl(), p1: freeHl(), p2: ink() };
  const g = annotShrinkGuard(held, { q0: hl(), q1: freeHl(), q2: ink() });
  check('same count under NEW keys is accepted (ids change every session)',
    g.reject === false, `reason=${g.reason}`);
}

{
  const held = { p0: hl() };
  const g = annotShrinkGuard(held, { q0: hl(), q1: ink() });
  check('growth is accepted', g.reject === false, `reason=${g.reason}`);
}

console.log('\nGUARD  incomplete restores are refused');

{
  // The actual data-loss scenario: viewer emits a partial sync before its
  // restore has reached every page. Adopting it rebases the baseline onto
  // "only one annotation here" and the next save destroys the other two.
  const held = { p0: hl(), p1: freeHl(), p2: ink() };
  const g = annotShrinkGuard(held, { q0: hl() }, { synced: true });
  check('partial sync is refused even though synced=true',
    g.reject === true, `reason=${g.reason} held=${g.held} incoming=${g.incoming}`);
}

{
  const held = { p0: hl(), p1: freeHl(), p2: ink() };
  const g = annotShrinkGuard(held, {}, { synced: true });
  check('EMPTY sync is refused (the "wipe the record" case)',
    g.reject === true, `reason=${g.reason}`);
}

{
  const held = { p0: hl(), p1: freeHl() };
  const g = annotShrinkGuard(held, { q0: hl() });
  check('shrinking changed-snapshot is refused', g.reject === true, `reason=${g.reason}`);
}

{
  // One viewer-reported removal does not license dropping three entries.
  const held = { p0: hl(), p1: freeHl(), p2: ink() };
  const g = annotShrinkGuard(held, { q0: hl() }, { removed: ['x'] });
  check('removals are counted, not trusted blindly',
    g.reject === true, `reason=${g.reason} removed=${g.removed}`);
}

console.log('\nGUARD  legitimate deletions are accepted');

{
  const held = { p0: hl(), p1: freeHl(), p2: ink() };
  const g = annotShrinkGuard(held, { q0: hl(), q1: freeHl() }, { removed: ['fresh_pdfjs_id'] });
  check('deleting one of three is accepted',
    g.reject === false, `reason=${g.reason}`);
}

{
  // Deleting the LAST annotation. The old separate "reject empty" rule had no
  // way to see the removal credit and would have frozen the record at its
  // pre-deletion state forever.
  const held = { p0: hl() };
  const g = annotShrinkGuard(held, {}, { removed: ['fresh_pdfjs_id'] });
  check('deleting the last annotation is accepted',
    g.reject === false, `reason=${g.reason} held=${g.held} removed=${g.removed}`);
}

{
  const held = { p0: hl(), p1: freeHl() };
  const g = annotShrinkGuard(held, { q0: hl() }, { removed: ['a', 'b'] });
  check('removal credit may exceed the observed drop',
    g.reject === false, `reason=${g.reason}`);
}

console.log('\nGUARD  non-editor entries never wedge it');

{
  // An old build's form values are dropped by the viewer; if they were counted
  // as held, every snapshot would look like a shrink and saving would freeze.
  const held = { p0: hl(), junk1: { value: 'x' }, junk2: { value: 'y' } };
  const g = annotShrinkGuard(held, { q0: hl() });
  check('junk in the held record does not cause a false shrink',
    g.reject === false, `reason=${g.reason} held=${g.held}`);
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
