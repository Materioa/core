// Guards against the unbounded-retry loop that froze the tab on entry.
//
// showPreExamView()/showTimelineView() re-enter themselves after loadVivaData()
// whenever `vivaData` is null. loadVivaData() leaves it null when there is no
// seatingDataUrl, or when the URL 404s — so `if (!vivaData) retry` never
// terminated. This extracts the shipped functions and drives the caller's
// retry pattern against them.
//
//   node scripts/test-viva-load-guard.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const SRC = 'src/lib/utils/exam-card.js';
const src = readFileSync(SRC, 'utf8');

function extractFn(name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`function ${name} not found in ${SRC}`);
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const modPath = new URL('./.viva-guard.mjs', import.meta.url);
writeFileSync(
  modPath,
  `
let currentSemesterData = null;
let vivaData = null;
let vivaDataUrl = null;
let vivaDivisions = [];
let vivaUnavailableUrl = null;

${extractFn('getVivaScheduleUrl')}
${extractFn('loadVivaData')}
${extractFn('isVivaDataSettled')}

export function reset(cfg) {
  currentSemesterData = cfg;
  vivaData = null;
  vivaDataUrl = null;
  vivaDivisions = [];
  vivaUnavailableUrl = null;
}
export function state() { return { vivaData, vivaUnavailableUrl }; }
export { getVivaScheduleUrl, loadVivaData, isVivaDataSettled };
`
);

const mod = await import(modPath.href);

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

const CSV =
  'Date,Division,Subject Name,Subject Code,Classroom\n' +
  '2026-10-05,7A1,INS,303105376,172-C1\n' +
  '2026-10-06,7A1,DS,303105394,172-C1\n';

/** Exactly the retry shape the view functions use. */
async function driveCaller(predicate, max = 500) {
  let iterations = 0;
  let fetches = 0;
  const attempt = async () => {
    if (++iterations > max) return { iterations, fetches, terminated: false };
    if (!mod.state().vivaData && predicate()) {
      await mod.loadVivaData();
      return attempt();
    }
    return { iterations, fetches, terminated: true };
  };
  return attempt();
}

// getVivaScheduleUrl() reads a *semester* entry (that is what
// findSemesterData() hands to currentSemesterData), so shape it that way.
const period = (seatingDataUrl) => ({
  semester: 7,
  examPeriod: { startDate: '2026-10-05T09:00:00', endDate: '2026-10-16T17:00:00' },
  seatingDataUrl
});

async function run(label, cfg, fetchImpl, predicate) {
  globalThis.fetch = fetchImpl;
  mod.reset(cfg);
  let calls = 0;
  const wrapped = (...a) => (calls++, fetchImpl(...a));
  globalThis.fetch = wrapped;
  const r = await driveCaller(predicate);
  r.fetches = calls;
  console.log(`\n${label}`);
  return r;
}

// The fixed predicate — mirrors showPreExamView()/showTimelineView().
const fixed = () => !mod.isVivaDataSettled();
// The old predicate, kept here as a control to prove this test detects the bug.
const legacy = () => true;

try {
  let r = await run(
    'no seatingDataUrl at all (the production case)',
    period(''),
    async () => { throw new Error('fetch should not be reached'); },
    fixed
  );
  check('terminates', r.terminated, true);
  check('iterations', r.iterations <= 3, true);
  check('network calls', r.fetches, 0);

  r = await run(
    'seatingDataUrl that 404s',
    period('https://cdn.example/viva.csv'),
    async () => ({ ok: false, status: 404, text: async () => '' }),
    fixed
  );
  check('terminates', r.terminated, true);
  check('iterations', r.iterations <= 3, true);
  check('fetch tried exactly once (no hammering)', r.fetches, 1);

  r = await run(
    'CSV loads fine',
    period('https://cdn.example/viva.csv'),
    async () => ({ ok: true, text: async () => CSV }),
    fixed
  );
  check('terminates', r.terminated, true);
  check('data loaded', mod.state().vivaData?.length, 2);
  check('cleared the unavailable marker', mod.state().vivaUnavailableUrl, null);

  // A later config refresh with a different URL must be allowed to retry.
  console.log('\nURL changes after a failure');
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  mod.reset(period('https://cdn.example/old.csv'));
  await mod.loadVivaData();
  check('marked unavailable', mod.state().vivaUnavailableUrl, 'https://cdn.example/old.csv');
  check('settled for the same URL', mod.isVivaDataSettled(), true);
  mod.reset(period('https://cdn.example/new.csv'));
  check('settled for a *different* URL (must retry)', mod.isVivaDataSettled(), false);

  // Control: without the guard the caller never stops.
  r = await run(
    '\ncontrol — legacy predicate, no seatingDataUrl',
    period(''),
    async () => { throw new Error('should not fetch'); },
    legacy
  );
  check('legacy predicate does NOT terminate (this is the bug)', r.terminated, false);
} finally {
  rmSync(modPath, { force: true });
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
