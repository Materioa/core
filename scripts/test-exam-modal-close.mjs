/**
 * Guards the activeModalStore release inside closeExamModal().
 *
 * Three paths close the exam modal: the X in ExamModal.svelte, a tap on the
 * overlay, and Escape. The last two call closeExamModal() directly and used to
 * leave activeModalStore holding 'examModal'. Svelte's writable.set is a
 * no-op when the new value equals the old one, so once it latched:
 *
 *   1. tapping the exam card called set('examModal') again, notified nothing,
 *      and ExamModal's reactive never re-ran -> the modal would not reopen;
 *   2. InterviewerModal.isOtherModalOpen read the stale value as "another
 *      modal is up" and isVivaBoxForm resolved to 'examModal', so
 *      examGatePassed was false -> the viva box could never pop up.
 *
 * One root cause, both reported symptoms.
 *
 * Extracts the SHIPPED closeExamModal rather than mirroring it, and stubs the
 * DOM so the store logic is what is under test.
 *
 *   node scripts/test-exam-modal-close.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const SRC = 'src/lib/utils/exam-card.js';
const src = readFileSync(SRC, 'utf8');

/**
 * Extract a top-level function by line range rather than by counting braces:
 * brace counting also counts braces inside string literals, and several
 * functions here deliberately contain brace characters. Top-level functions
 * close with a lone `}` at column 0 while nested closes are indented.
 */
function extractFn(name) {
  const lines = src.split(/\r?\n/);
  const open = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const start = lines.findIndex((l) => open.test(l));
  if (start === -1) throw new Error(`function ${name} not found in ${SRC}`);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`no column-0 closing brace for ${name}`);
}

// closeExamModal touches document and only that; everything else it needs is
// module scope. getElementById returning null takes the branch where the modal
// element is already gone, which is exactly the store logic we want to test.
globalThis.document = { getElementById: () => null };

const modPath = new URL('./.exam-modal-close.mjs', import.meta.url);
// Built by join, not a template literal: the extracted source contains
// backticks (in the `set('examModal')` comment), which would close a
// template literal early and leave the module body unbalanced.
writeFileSync(
  modPath,
  [
    "import { writable, get } from 'svelte/store';",
    'const activeModalStore = writable(null);',
    'let pendingOpen = false;',
    extractFn('closeExamModal'),
    // extractFn keeps the function's own `export`, so only the stubs need one.
    'export { activeModalStore, get };',
    ''
  ].join('\n')
);

let activeModalStore, get, closeExamModal;
try {
  ({ activeModalStore, get, closeExamModal } = await import(modPath.href));
} finally {
  rmSync(modPath, { force: true });
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

console.log('every close path releases the store');

check('overlay tap / Escape (store latched on examModal) clears it', () => {
  activeModalStore.set('examModal');
  closeExamModal();
  assert.equal(get(activeModalStore), null, 'store still latched on examModal');
});

check('the X button path still ends at null', () => {
  activeModalStore.set('examModal');
  closeExamModal();
  activeModalStore.set(null); // ExamModal.handleClose does this too
  assert.equal(get(activeModalStore), null);
});

check('closing again is idempotent', () => {
  activeModalStore.set('examModal');
  closeExamModal();
  closeExamModal();
  assert.equal(get(activeModalStore), null);
});

console.log('the release is guarded');

check('Escape with no exam modal open does not close another modal', () => {
  activeModalStore.set('notebook');
  closeExamModal();
  assert.equal(get(activeModalStore), 'notebook', 'unrelated modal was clobbered');
});

check('Escape with everything closed stays closed', () => {
  activeModalStore.set(null);
  closeExamModal();
  assert.equal(get(activeModalStore), null);
});

check('an open viva box key is left alone', () => {
  activeModalStore.set('viva-box');
  closeExamModal();
  assert.equal(get(activeModalStore), 'viva-box');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
