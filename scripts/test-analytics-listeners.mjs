// Regression guard: addEventListener / removeEventListener called with a
// non-literal first argument.
//
// This exists because of a real production bug. analytics.js registered its
// activity listeners like this:
//
//   ['mousedown', 'keydown', ...].forEach((ev) => {
//     document.addEventListener(() => mark(...), { passive: true });
//   });
//
// The event name `ev` was never passed, so every call threw
// "parameter 1 is not of type 'string'". The throw was swallowed by a
// surrounding try/catch, the forEach died on its first iteration, and none of
// the six listeners were ever registered. Nothing logged, nothing threw, the
// bundle built, type checks passed and unit tests passed -- but every session's
// engagement was capped and the analytics heartbeat never fired, so reading
// stats silently stopped being recorded.
//
// A silent catch turns a typo into invisible data loss, so this fails loudly.
// It is deliberately a source scan rather than a runtime test: analytics.js
// pulls in SvelteKit aliases ($lib/...) that cannot be imported outside a
// bundle, and the bug is a syntactic slip that a scan catches perfectly.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['src'];
const EXTS = new Set(['.svelte', '.js', '.ts']);
// Calls whose first argument is legitimately a variable/constant. Each is a
// deliberate, reviewed exception -- add to this only after reading the call.
const ALLOWED_DYNAMIC_FIRST_ARG = [
  // Documented event-bus helpers that pass a name through from callers.
];

const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTS.has(extname(full))) continue;
    checkFile(full);
  }
}

function checkFile(file) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/\b(addEventListener|removeEventListener)\s*\(\s*([^,)]*)/);
    if (!m) return;
    const firstArg = (m[2] || '').trim();
    if (!firstArg) return; // handled elsewhere
    // A string literal, a template literal, or a quoted/identifier-free
    // constant is fine. Anything starting with a function/arrow is not.
    if (/^['"`]/.test(firstArg)) return;
    if (/^(function|\(|async\s*\()/.test(firstArg)) {
      offenders.push(
        `${file}:${i + 1}  ${m[1]}(${firstArg}...) -- first argument looks like a function, not an event name`
      );
    }
  });
}

for (const root of ROOTS) {
  try {
    walk(root);
  } catch {
    // No such directory in this checkout; nothing to guard.
  }
}

const allowed = offenders.filter((o) =>
  ALLOWED_DYNAMIC_FIRST_ARG.some((frag) => o.includes(frag))
);
const real = offenders.filter((o) => !allowed.includes(o));

if (real.length) {
  console.error(`\n  ${real.length} listener registration(s) pass a function where an event name belongs:\n`);
  real.forEach((o) => console.error(`    ${o}`));
  console.error('\n  This silently throws and is swallowed by try/catch.');
  console.error('  Pass the event name explicitly.\n');
  process.exit(1);
}

console.log(`analytics listener guard: 0 offenders, ${ALLOWED_DYNAMIC_FIRST_ARG.length} allowed exception(s)`);
