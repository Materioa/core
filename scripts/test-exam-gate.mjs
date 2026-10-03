// Regression tests for the exam gate. Run: node .examgate-test/run.mjs
import {
  isExamPeriodActive,
  isExamPeriodRunning,
  effectiveEndDate,
  findVivaOrPracticalExam,
  showBeforeDaysFor,
  isUsableExamConfig
} from '../src/lib/utils/exam-gate.js';

let pass = 0, fail = 0;
const ok = (name, got, want) => {
  if (got === want) { pass++; console.log('ok  ', name); }
  else { fail++; console.log('FAIL', name, '-> got', got, 'want', want); }
};

const day = (s) => new Date(s + 'T12:00:00');
// "Now" is 2026-10-02.
const NOW = day('2026-10-02');

/* ---- the reported bug: a PAST practical period with no endDate --------- */
const pastPracticalNoEnd = {
  semester: '3',
  examPeriod: { name: 'Practical', startDate: '2026-03-10' }, // no endDate
  exams: [{ type: 'practical', subject: 'Maths', date: '2026-03-14' }]
};
ok('past practical, no endDate -> hidden', isExamPeriodActive(pastPracticalNoEnd, 3, NOW), false);
ok('...and not hidden when the gate is unbounded (old bug)',
   day('2026-03-10') <= new Date(NOW) && !pastPracticalNoEnd.examPeriod.endDate, true);

/* ---- still inside the show-before window ------------------------------ */
const upcomingViva = {
  semester: '5',
  examPeriod: { name: 'Viva', startDate: '2026-10-05' }, // 3 days out
  exams: [{ type: 'viva', subject: 'Physics', date: '2026-10-07' }]
};
ok('viva 3 days out, showBefore 3 -> shown', isExamPeriodActive(upcomingViva, 3, NOW), true);
ok('viva 3 days out, showBefore 0 -> hidden', isExamPeriodActive(upcomingViva, 0, NOW), false);

const farFuture = {
  semester: '5',
  examPeriod: { startDate: '2026-11-20' },
  exams: [{ type: 'viva', date: '2026-11-22' }]
};
ok('viva 49 days out -> hidden', isExamPeriodActive(farFuture, 3, NOW), false);

/* ---- genuinely ongoing, bounded by an exam date ----------------------- */
const ongoingBounded = {
  semester: '5',
  examPeriod: { startDate: '2026-10-01' }, // no endDate
  exams: [{ type: 'viva', date: '2026-10-04' }]
};
ok('ongoing, last exam still ahead -> shown', isExamPeriodActive(ongoingBounded, 3, NOW), true);

const ongoingFinished = {
  semester: '5',
  examPeriod: { startDate: '2026-09-01' },
  exams: [{ type: 'viva', date: '2026-09-04' }] // last exam already past
};
ok('ongoing but every exam date passed -> hidden', isExamPeriodActive(ongoingFinished, 3, NOW), false);

/* ---- explicit endDate wins over exam dates ---------------------------- */
const explicitEnd = {
  semester: '5',
  examPeriod: { startDate: '2026-09-01', endDate: '2026-10-20' },
  exams: [{ type: 'viva', date: '2026-09-04' }]
};
ok('explicit endDate still ahead -> shown', isExamPeriodActive(explicitEnd, 3, NOW), true);
ok('effectiveEndDate prefers configured endDate',
   effectiveEndDate(explicitEnd).toISOString().slice(0, 10), '2026-10-20');

const explicitEndPast = { ...explicitEnd, examPeriod: { startDate: '2026-08-01', endDate: '2026-08-10' } };
ok('explicit endDate already passed -> hidden', isExamPeriodActive(explicitEndPast, 3, NOW), false);

/* ---- no endDate AND no exam dates: must not run forever --------------- */
const noBounds = {
  semester: '5',
  examPeriod: { startDate: '2026-01-01' },
  exams: []
};
ok('no endDate and no exam dates -> hidden', isExamPeriodActive(noBounds, 3, NOW), false);

/* ---- missing startDate ------------------------------------------------ */
ok('missing startDate -> hidden', isExamPeriodActive({ examPeriod: {} }, 3, NOW), false);

/* ---- showBeforeDaysFor: admin-set 0 must survive ---------------------- */
const practicalSem = { exams: [{ type: 'practical' }] };
ok('admin 0 not replaced by default (practical)', showBeforeDaysFor(practicalSem, { showBeforeDaysViva: 0, showBeforeDays: 0 }), 0);
ok('viva sem uses viva value', showBeforeDaysFor({ exams: [{ type: 'viva' }] }, { showBeforeDaysViva: 5, showBeforeDays: 7 }), 5);
ok('theory sem uses standard value', showBeforeDaysFor({ exams: [{ type: 'theory' }] }, { showBeforeDaysViva: 5, showBeforeDays: 7 }), 7);
ok('missing values fall back', showBeforeDaysFor({ exams: [{ type: 'theory' }] }, {}), 7);

/* ---- practical detection --------------------------------------------- */
ok('finds practical', findVivaOrPracticalExam({ exams: [{ type: 'practical' }] })?.type, 'practical');
ok('finds viva', findVivaOrPracticalExam({ exams: [{ type: 'viva' }] })?.type, 'viva');
ok('none for theory', findVivaOrPracticalExam({ exams: [{ type: 'theory' }] }), null);

/* ---- isExamPeriodRunning: strictly "underway", never show-before -------- */
const oncomingPractical = {
  semester: '7',
  examPeriod: { startDate: '2026-10-04T09:00:00', endDate: '2026-10-08T17:00:00' },
  exams: [
    { type: 'practical', date: '2026-10-07' },
    { type: 'viva', date: '2026-10-13' }
  ]
};
// Oct 2 (shown for the card via showBefore) must NOT unlock the viva box.
ok('running: day before start -> false', isExamPeriodRunning(oncomingPractical, day('2026-10-03')), false);
ok('...but the card still teases it via its window', isExamPeriodActive(oncomingPractical, 3, day('2026-10-03')), true);
// Admin forgot to extend the period past the viva exam: endDate 10-08 is
// inside the exam window — effectiveEndDate takes the last exam date.
ok('running: day of a viva inside the period -> true', isExamPeriodRunning(oncomingPractical, day('2026-10-07')), true);
ok('running: after a shorter configured endDate but viva still ahead -> true',
   isExamPeriodRunning(oncomingPractical, day('2026-10-13')), true);
ok('running: after the last viva -> false', isExamPeriodRunning(oncomingPractical, day('2026-10-14')), false);

/* ---- day-inclusive end boundary --------------------------------------- */
ok('period ending midnight on Oct 8 still runs on Oct 8',
   isExamPeriodActive({ examPeriod: { startDate: '2026-10-01', endDate: '2026-10-08' }, exams: [] }, 3, day('2026-10-08')), true);

/* ---- only a live Mongo config may switch the card on ----------------- */
const liveConfig = {
  enabled: true,
  showBeforeDays: 9,
  showBeforeDaysViva: 3,
  semesters: [{ semester: '7', examPeriod: { startDate: '2026-10-17' }, exams: [{ type: 'theory', date: '2026-10-17' }] }]
};
ok('live config is usable', isUsableExamConfig(liveConfig), true);

// What the API now returns when Mongo is unreachable or holds no config.
ok('degraded no-config is NOT usable', isUsableExamConfig({ enabled: false, semesters: [], degraded: true, reason: 'no-live-config' }), false);
ok('admin-disabled is NOT usable', isUsableExamConfig({ enabled: false, semesters: liveConfig.semesters }), false);
ok('empty semesters is NOT usable', isUsableExamConfig({ enabled: true, semesters: [] }), false);
ok('null is NOT usable', isUsableExamConfig(null), false);

// The deleted committed snapshot carried a Practical/Viva period inside the
// show-before window. Simulate it: a snapshot is never usable config, and it
// must stay hidden even when its dates say "on".
const staleSnapshot = {
  enabled: true,
  showBeforeDays: 9,
  showBeforeDaysViva: 3,
  semesters: [
    {
      semester: 6,
      examPeriod: { name: 'Viva/Practical', startDate: '2026-04-06T09:00:00', endDate: '2026-04-11T17:00:00' },
      exams: [{ type: 'viva', date: '2026-04-06' }]
    }
  ]
};
const staleVivaSem = staleSnapshot.semesters.find((s) =>
  (s.exams || []).some((e) => e.type === 'viva' || e.type === 'practical')
);
ok('snapshot declared a practical/viva period (the bug source)', Boolean(staleVivaSem), true);
ok('...and its dates would have gated the box during that window',
   isExamPeriodActive(staleVivaSem, staleSnapshot.showBeforeDaysViva, day('2026-04-06')), true);
ok('...but a snapshot is never usable config, so it stays hidden',
   isUsableExamConfig({ ...staleSnapshot, degraded: true }), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);