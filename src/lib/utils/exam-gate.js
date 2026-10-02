/**
 * Exam-period visibility gate.
 *
 * Shared by the exam card (exam-card.js, ExamCard.svelte) and the viva
 * interviewer box (InterviewerModal.svelte) so the two can never disagree about
 * whether an exam is "on".
 *
 * Why this is its own module: the rule was copy-pasted into three places, and
 * all three shared one fatal bug —
 *
 *     (today >= startDateOnly && (!endDate || now <= endDate))
 *
 * When a semester has a practical/viva exam period with a startDate in the past
 * and NO endDate, `!endDate` made the condition vacuously true forever. The
 * period stayed "ongoing" years after the exams finished, so the card kept
 * rendering and the interviewer box kept auto-opening, long outside the
 * show-before window. An unbounded period has to end somewhere, so the end is
 * derived from the period's own exam dates, and a period with neither an
 * endDate nor any exam date is not treated as ongoing at all.
 */

/** Midnight-local, so a date never crosses a day boundary on DST. */
function dayStart(value) {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export function daysUntil(date, now = new Date()) {
  const target = dayStart(date);
  return Math.ceil((target.getTime() - dayStart(now).getTime()) / 86400000);
}

/**
 * The latest date we can justify calling the period "still running".
 * Prefers the admin-configured endDate; otherwise the last exam date in the
 * period. Returns null when neither exists.
 */
export function effectiveEndDate(semester) {
  const configured = semester?.examPeriod?.endDate;
  if (configured) {
    const d = new Date(configured);
    if (isValidDate(d)) return d;
  }
  const examDates = (semester?.exams || [])
    .map((e) => (e?.date ? new Date(e.date) : null))
    .filter(isValidDate);
  if (!examDates.length) return null;
  return examDates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
}

/**
 * True only for a real, admin-authored exam config.
 *
 * The API answers `{ enabled:false, semesters:[], degraded:true }` when Mongo
 * is unreachable or holds no config — "we do not know", which must render as
 * nothing. Callers used to treat any parsable object as data and fall back to
 * the committed /assets/data/examdata.json snapshot, so a stale file kept
 * switching the viva interviewer on. A snapshot is never usable config.
 */
export function isUsableExamConfig(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.degraded === true) return false;
  if (data.enabled === false) return false;
  if (!Array.isArray(data.semesters) || data.semesters.length === 0) return false;
  // At least one semester must actually have an exam period, otherwise there
  // is nothing to show regardless of the enabled flag.
  return data.semesters.some((s) => s && s.examPeriod && s.examPeriod.startDate);
}

/**
 * True while the period is either inside its show-before window or genuinely
 * still running.
 *
 * @param {object} semester       one entry from examdata.semesters
 * @param {number} showBeforeDays how many days before the start date to reveal
 * @param {Date}   [now]
 */
export function isExamPeriodActive(semester, showBeforeDays, now = new Date()) {
  const startDate = semester?.examPeriod?.startDate;
  if (!startDate) return false;
  const start = new Date(startDate);
  if (!isValidDate(start)) return false;

  const today = dayStart(now);
  const startDay = dayStart(start);

  // 1. Inside the show-before window (0 to showBeforeDays days out).
  const days = daysUntil(start, now);
  const threshold = Number.isFinite(Number(showBeforeDays)) ? Number(showBeforeDays) : 0;
  if (days <= threshold && days >= 0) return true;

  // 2. Started, and still within a bounded window. The bound is mandatory:
  //    without it an open-ended period never stops being "ongoing".
  const end = effectiveEndDate(semester);
  if (!end) return false;
  return today.getTime() >= startDay.getTime() && now.getTime() <= end.getTime();
}

/**
 * The viva/practical exam in a semester, if it has one. The interviewer box
 * is about collecting questions for these two types only.
 */
export function findVivaOrPracticalExam(semester) {
  const exams = semester?.exams;
  if (!Array.isArray(exams)) return null;
  return exams.find((e) => e?.type === 'viva' || e?.type === 'practical') || null;
}

/**
 * showBeforeDays for a semester: viva/practical periods use the viva value,
 * everything else the standard one. `??` rather than `||` so an admin-set 0 is
 * respected — `0 || 3` silently became 3 and the card appeared days early.
 */
export function showBeforeDaysFor(semester, data, { viva = 3, standard = 7 } = {}) {
  const isViva = Boolean(findVivaOrPracticalExam(semester));
  const raw = isViva ? data?.showBeforeDaysViva : data?.showBeforeDays;
  const value = raw ?? (isViva ? viva : standard);
  const n = Number(value);
  return Number.isFinite(n) ? n : (isViva ? viva : standard);
}