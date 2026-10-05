// Exam Card Display and Modal Script
// Handles the exam card in InsightRoom with 3 dynamic views and exam modal
// Supports multiple semesters with semester-based filtering

import { get } from 'svelte/store';
import { isExamPeriodActive, showBeforeDaysFor, isUsableExamConfig, findRunningVivaExam, readSavedSemester } from './exam-gate.js';
import { activeModalStore } from '../stores.js';

let examData = null;
let currentSemesterData = null;
// Set when openExamModal() is asked to show the modal before exam data has
// finished loading, and flushed once it lands. Without this a reload on
// #exam-modal latched the store on a modal that never appeared.
let pendingOpen = false;
let examViewRotationTimer = null;
let currentExamView = 0; // 0 = preexam, 1 = ongoing, 2 = timeline
let hasAutoFocusedExamCard = false;

// Debug: Fake date for testing (set via console)
let _fakeDate = null;

// Helper to get current date (uses fake date if set, otherwise real date)
function getCurrentDate() {
    return _fakeDate ? new Date(_fakeDate) : new Date();
}

if (typeof window !== 'undefined') {
    window.setFakeDate = function (dateTimeString) {
        _fakeDate = dateTimeString;
        const dateObj = new Date(dateTimeString);
        console.log(`[ExamCard Debug] Fake date/time set to: ${dateObj.toLocaleString()}`);
        console.log(`[ExamCard Debug] Refreshing exam card...`);
        if (examData && currentSemesterData) {
            displayExamCard(examData, currentSemesterData);
            generateExamTimeline();
        }
        return `Fake date/time set to ${dateObj.toLocaleString()}. Card and modal refreshed.`;
    };

    window.clearFakeDate = function () {
        _fakeDate = null;
        console.log('[ExamCard Debug] Fake date cleared. Using real date now.');
        if (examData && currentSemesterData) {
            displayExamCard(examData, currentSemesterData);
            generateExamTimeline();
        }
        return 'Fake date cleared. Using real date now.';
    };

    window.getFakeDate = function () {
        return _fakeDate ? `Fake date: ${_fakeDate}` : 'No fake date set (using real date)';
    };
}

const VIEW_ROTATION_INTERVAL = 15000; // 15 seconds shuffle as default
const SHOW_BEFORE_DAYS = 7; // Show card 7 days before exam starts
const SHOW_BEFORE_DAYS_VIVA = 3; // Show viva exams 3 days before
const EXAM_DATA_CACHE_KEY = 'materio_exam_data_cache';

let isExamDataLoading = false;
let hasExamDataProcessed = false;
// How many times the config fetch came back `degraded` (backend couldn't
// answer) without us ever having had a good copy. Bounded so a Mongo outage
// can't schedule retries forever.
let degradedFetchRetries = 0;

let vivaData = null; // Cached viva.csv data
let vivaDataUrl = null; // URL the cache was filled from
let vivaDivisions = []; // Cached divisions list from viva.csv
// The last schedule URL that produced no usable data: null = none tried,
// '' = there is no URL at all. `vivaData === null` cannot tell "not fetched
// yet" from "fetched, nothing there", and callers that retry on the former
// therefore retried on the latter — forever, whenever a viva/practical period
// had no seatingDataUrl (or a URL that 404s). See isVivaDataSettled().
let vivaUnavailableUrl = null;
const USER_DIV_LS_KEY = 'user_div';

// viva/practical schedules are division-specific (different classes sit
// different lab/viva slots), so they read from the period's seating CSV.
// The CSV lives at the exam-level seatingDataUrl override first, then the
// period-level seatingDataUrl — never the bundled /assets/data/viva.csv,
// which is a stale April snapshot and used to paper over Mongo gaps.
function isDivisionScheduled(exams) {
    return Array.isArray(exams) && exams.some(e => e.type === 'viva' || e.type === 'practical');
}

function getVivaScheduleUrl() {
    try {
        const fromExams = (currentSemesterData?.exams || [])
            .map((e) => e?.seatingDataUrl)
            .find((u) => typeof u === 'string' && u.trim());
        if (fromExams) return fromExams.trim();
        const periodUrl = currentSemesterData?.seatingDataUrl;
        if (typeof periodUrl === 'string' && periodUrl.trim()) return periodUrl.trim();
    } catch {}
    return '';
}

/**
 * Tell the viva box (InterviewerModal.svelte) whether a practical/viva period is
 * underway, so the box and this card can never disagree.
 *
 * This is the half that was missing. ExamCard.svelte used to publish
 * `materioExamVivaStatus`, but that component is no longer mounted — BlogPosts
 * renders its own exam-card markup and drives it through this module. So for a
 * while nothing dispatched the event and the box could only ever turn itself on
 * from its own separate fetch.
 *
 * It re-reads the live config rather than trusting whatever `examData` happens
 * to hold, because this module's cache can be a session-old snapshot. An
 * unusable/absent config publishes an explicit `false`: silence must never be
 * read as "yes" by the box.
 */
function publishVivaStatus() {
    if (typeof window === 'undefined') return;

    let exam = null;
    try {
        // `examData` is this module's single source: seeded from the
        // sessionStorage cache (which is only ever written from a live
        // /api/v2/examdata response — never from the deleted build snapshot),
        // then overwritten by the fresh fetch. isUsableExamConfig rejects the
        // degraded `{enabled:false, degraded:true}` "no live config" shape, so
        // we can never publish a viva-on from an answer that means "unknown".
        //
        // Before either has settled, examData is null and we publish nothing
        // rather than a guess — silence is not "yes" to the box.
        if (examData && isUsableExamConfig(examData)) {
            exam = findRunningVivaExam(examData, {
                savedSemester: readSavedSemester(),
                now: getCurrentDate()
            });
        } else if (hasExamDataProcessed) {
            // Fetch settled and the config was unusable (admin disabled it, or
            // Mongo reported degraded/no-config). That is a real, authoritative
            // "off", so publish the false — unlike the not-yet-loaded case
            // below, which must stay silent.
            exam = null;
        } else {
            return;
        }
    } catch {
        exam = null;
    }

    const hasViva = Boolean(exam);
    window.__materioExamHasVivaOrPractical = hasViva;
    window.__materioActiveVivaExam = exam;
    window.dispatchEvent(
        new CustomEvent('materioExamVivaStatus', {
            detail: { hasViva, exam, source: 'exam-card' }
        })
    );
}

async function loadVivaData() {
    const url = getVivaScheduleUrl();
    if (!url) {
        vivaData = null;
        vivaDataUrl = null;
        vivaDivisions = [];
        // '' is the sentinel: with no URL no attempt can ever succeed, so the
        // retrying callers below must stop rather than start over.
        vivaUnavailableUrl = '';
        return null;
    }
    // This exact URL already yielded nothing usable. Attempting it again would
    // fail identically, and the callers re-enter on the result.
    if (vivaUnavailableUrl === url) return null;
    // Refetch when the period (and therefore its CSV URL) changes.
    if (vivaData && vivaDataUrl === url) return vivaData;
    vivaDataUrl = url;
    try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Viva schedule CSV not found at ${url}`);
        const text = await response.text();
        const lines = text.trim().split(/\r?\n/);
        const headers = lines[0].split(',').map(h => h.trim());
        vivaData = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values.length >= headers.length) {
                const row = {};
                headers.forEach((h, idx) => {
                    row[h] = (values[idx] || '').trim();
                });
                vivaData.push(row);
            }
        }
        vivaDivisions = [...new Set(vivaData.map(row => row.Division).filter(Boolean))].sort((a, b) => {
            return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
        });
        vivaUnavailableUrl = null;
        return vivaData;
    } catch (e) {
        console.error('[ExamCard] Error loading viva schedule:', e);
        vivaData = null;
        vivaUnavailableUrl = url;
        return null;
    }
}

/**
 * True once loading has run its course for the current schedule URL: either we
 * have data, or we have established there is none to be had.
 *
 * Callers must gate their re-entry on this instead of `!vivaData`, which reads
 * "not fetched yet" and "fetched but unusable" identically. With no
 * seatingDataUrl configured, loadVivaData() resolved null on every attempt, so
 * `if (!vivaData) retry` never terminated — it saturated the microtask queue on
 * entry and froze the tab before the card could paint.
 */
function isVivaDataSettled() {
    if (vivaData) return true;
    return vivaUnavailableUrl === getVivaScheduleUrl();
}

async function populateClassroomSelector() {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('classroomSelect');
    const datalist = document.getElementById('classroomOptions');
    const selectorWrap = document.getElementById('classroomSelector');
    const clearBtn = document.getElementById('clearDivisionBtn');
    if (!input || !datalist) return;

    const data = await loadVivaData();
    if (!data) {
        // No fresh division CSV (e.g. admin never set a seatingDataUrl for
        // this period) — hide the selector rather than keep last session's
        // divisions on screen.
        if (selectorWrap) selectorWrap.style.display = 'none';
        return;
    }

    vivaDivisions = [...new Set(data.map(row => row.Division).filter(Boolean))].sort((a, b) => {
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    });

    datalist.innerHTML = '';
    vivaDivisions.forEach(division => {
        const option = document.createElement('option');
        option.value = String(division);
        datalist.appendChild(option);
    });

    if (selectorWrap) {
        selectorWrap.style.display = 'block';
    }

    const savedDivision = localStorage.getItem(USER_DIV_LS_KEY) || localStorage.getItem('selectedDivision') || localStorage.getItem('selectedClassroom');
    if (savedDivision) {
        const bestSavedMatch = findBestMatchingDivision(savedDivision, vivaDivisions);
        input.value = bestSavedMatch || savedDivision;
    }
    updateDivisionClearButtonVisibility();

    const applyBestMatch = (rawValue) => {
        const selectedDivision = findBestMatchingDivision(rawValue, vivaDivisions) || '';

        if (selectedDivision) {
            input.value = selectedDivision;
            localStorage.setItem(USER_DIV_LS_KEY, selectedDivision);
            localStorage.setItem('selectedDivision', selectedDivision);
            localStorage.removeItem('selectedClassroom');
        } else {
            input.value = '';
            localStorage.removeItem(USER_DIV_LS_KEY);
            localStorage.removeItem('selectedDivision');
            localStorage.removeItem('selectedClassroom');
        }
        generateExamTimeline();
        refreshMiniTimelineForCurrentState();
        updateDivisionClearButtonVisibility();
    };

    if (!input.dataset.classroomBound) {
        input.addEventListener('change', function () {
            applyBestMatch(this.value);
        });

        input.addEventListener('blur', function () {
            if (!this.value.trim()) {
                localStorage.removeItem(USER_DIV_LS_KEY);
                localStorage.removeItem('selectedDivision');
                localStorage.removeItem('selectedClassroom');
                generateExamTimeline();
                refreshMiniTimelineForCurrentState();
                updateDivisionClearButtonVisibility();
                return;
            }
            applyBestMatch(this.value);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyBestMatch(this.value);
            }
        });

        input.dataset.classroomBound = 'true';
    }

    if (clearBtn && !clearBtn.dataset.clearBound) {
        clearBtn.addEventListener('click', function () {
            clearSavedDivisionSelection();
        });
        clearBtn.dataset.clearBound = 'true';
    }
}

function normalizeClassroomValue(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function findBestMatchingDivision(query, divisions) {
    if (!query || !Array.isArray(divisions) || divisions.length === 0) return '';

    const raw = String(query).trim();
    if (!raw) return '';

    const exact = divisions.find(div => div.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;

    const normalizedQuery = normalizeClassroomValue(raw);
    if (!normalizedQuery) return '';

    const scored = divisions
        .map(div => {
            const normalizedClass = normalizeClassroomValue(div);
            let score = 0;

            if (normalizedClass.startsWith(normalizedQuery)) score += 4;
            if (normalizedClass.includes(normalizedQuery)) score += 3;
            if (normalizedQuery.includes(normalizedClass)) score += 2;

            score -= Math.abs(normalizedClass.length - normalizedQuery.length) * 0.05;

            return { div, score };
        })
        .sort((a, b) => b.score - a.score);

    return scored.length > 0 && scored[0].score > 0 ? scored[0].div : '';
}

function getSelectedDivision() {
    if (typeof document === 'undefined') return '';
    const classroomInput = document.getElementById('classroomSelect');
    const inputValue = classroomInput ? classroomInput.value : '';
    const savedValue = localStorage.getItem(USER_DIV_LS_KEY) || localStorage.getItem('selectedDivision') || localStorage.getItem('selectedClassroom') || '';
    const rawValue = inputValue || savedValue;

    if (!rawValue) return '';

    if (!Array.isArray(vivaDivisions) || vivaDivisions.length === 0) {
        return rawValue;
    }

    const best = findBestMatchingDivision(rawValue, vivaDivisions) || '';
    if (best) {
        if (classroomInput && classroomInput.value !== best) classroomInput.value = best;
        if (localStorage.getItem(USER_DIV_LS_KEY) !== best) localStorage.setItem(USER_DIV_LS_KEY, best);
    }
    return best;
}

function updateDivisionClearButtonVisibility() {
    if (typeof document === 'undefined') return;
    const clearBtn = document.getElementById('clearDivisionBtn');
    const input = document.getElementById('classroomSelect');
    if (!clearBtn || !input) return;

    clearBtn.style.display = input.value && input.value.trim() ? 'inline-flex' : 'none';
}

function clearSavedDivisionSelection() {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('classroomSelect');
    if (input) input.value = '';

    localStorage.removeItem(USER_DIV_LS_KEY);
    localStorage.removeItem('selectedDivision');
    localStorage.removeItem('selectedClassroom');

    updateDivisionClearButtonVisibility();
    generateExamTimeline();
    refreshMiniTimelineForCurrentState();
}

function refreshMiniTimelineForCurrentState() {
    if (!currentSemesterData || !currentSemesterData.exams) return;
    if (currentExamView !== 2) return;

    const sortedExams = [...currentSemesterData.exams].sort((a, b) => new Date(a.date) - new Date(b.date));
    showTimelineView(sortedExams, false);
    showTimelineView(sortedExams, true);
}

function getEffectiveCardExams(exams) {
    const isVivaExam = isDivisionScheduled(exams);
    if (!isVivaExam || !vivaData) return exams;

    const selectedDivision = getSelectedDivision();
    if (!selectedDivision) return exams;

    const divisionExams = buildVivaTimelineEntries(selectedDivision);
    return divisionExams.length > 0 ? divisionExams : exams;
}

function getCachedExamData() {
    if (typeof sessionStorage === 'undefined') return null;
    try {
        const cached = sessionStorage.getItem(EXAM_DATA_CACHE_KEY);
        if (!cached) return null;
        return JSON.parse(cached);
    } catch (error) {
        return null;
    }
}

function cacheExamData(data) {
    if (typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.setItem(EXAM_DATA_CACHE_KEY, JSON.stringify(data));
    } catch (error) {
    }
}

export async function loadAndDisplayExamCard() {
    if (typeof document === 'undefined') return;
    if (isExamDataLoading) return;

    if (!document.getElementById('examCard') && !document.getElementById('examCardDefault')) {
        return;
    }

    const now = Date.now();
    const skipUntilRaw = localStorage.getItem('materio_exam_skip_until');
    const skipUntil = Number(skipUntilRaw);

    if (Number.isFinite(skipUntil) && now < skipUntil) {
        hideExamCards();
    }

    try {
        isExamDataLoading = true;

        const cachedData = getCachedExamData();
        if (cachedData && cachedData.enabled !== false && Array.isArray(cachedData.semesters) && cachedData.semesters.length > 0 && !examData) {
            examData = cachedData;
        }

        // ONLY the live admin config. The build-time /assets/data/examdata.json was
        // removed as a candidate: it is a committed snapshot that goes stale
        // the moment it lands, and it kept declaring a practical/viva period
        // whose dates sat inside the show-before window — so the card and the
        // interviewer appeared with no Mongo config saying so. If the API is
        // unreachable or reports no config, the honest answer is "show none".
        const candidateRequests = [
            { url: '/api/v2/examdata', options: { cache: 'no-store' } }
        ];

        let loaded = false;
        for (const request of candidateRequests) {
            try {
                const response = await fetch(request.url, request.options);
                if (!response.ok) continue;
                const freshData = await response.json();
                if (!freshData || typeof freshData !== 'object') continue;
                // Any OK response is authoritative — including
                // { enabled: false } and the degraded "no live config" shape.
                if (!isUsableExamConfig(freshData)) {
                    // Two very different answers reach this branch, and treating
                    // them the same is what made the card vanish "at times":
                    //
                    //  - { enabled:false }        admin turned exams off — authoritative
                    //  - { degraded:true }        backend couldn't reach Mongo at all,
                    //                             per features-handler.js noConfig()
                    //
                    // The second is "I don't know", not "exams are off". Blanking
                    // the card on it meant a single Mongo blip hid the card for the
                    // rest of the visit, with no retry and no error anywhere.
                    if (freshData.degraded === true) {
                        if (examData) {
                            // Keep the session cache loaded above and show it.
                            loaded = true;
                            break;
                        }
                        isExamDataLoading = false;
                        if (degradedFetchRetries < 3) {
                            degradedFetchRetries++;
                            setTimeout(() => { loadAndDisplayExamCard(); }, 4000);
                        }
                        hideExamCards();
                        return;
                    }
                    degradedFetchRetries = 0;
                    // Clear FIRST. hideExamCards() publishes the viva status,
                    // and examData may still hold the session cache from above
                    // — publishing before nulling it would report a viva period
                    // that this authoritative "off" just disproved.
                    examData = null;
                    hasExamDataProcessed = true;
                    isExamDataLoading = false;
                    hideExamCards();
                    return;
                }
                degradedFetchRetries = 0;
                if (Array.isArray(freshData.semesters) && freshData.semesters.length > 0) {
                    examData = freshData;
                    cacheExamData(freshData);
                    loaded = true;
                }
                break;
            } catch (err) {
            }
        }

        if (!loaded && !examData) {
            isExamDataLoading = false;
            return;
        }

        isExamDataLoading = false;
        hasExamDataProcessed = true;

        const currentSemester = getCurrentUserSemester();
        currentSemesterData = findSemesterData(examData, currentSemester);

        if (currentSemesterData) {
            const shouldDisplay = shouldDisplayExamCard(examData, currentSemesterData);
            if (shouldDisplay) {
                displayExamCard(examData, currentSemesterData);
                localStorage.removeItem('materio_exam_skip_until');
            } else {
                hideExamCards();
                localStorage.setItem('materio_exam_skip_until', (now + 20 * 60 * 1000).toString());
            }
        } else {
            hideExamCards();
            localStorage.setItem('materio_exam_skip_until', (now + 10 * 60 * 1000).toString());
        }

        setupSemesterListeners(examData);

        // Flush an open that arrived before data was ready (set by
        // openExamModal). Deferred one tick so the card and timeline above
        // have rendered first.
        if (pendingOpen && currentSemesterData) {
            pendingOpen = false;
            setTimeout(() => openExamModal(), 0);
        }

    } catch (error) {
        console.error('[ExamCard] Error loading exam data:', error);
        isExamDataLoading = false;
    }
}

function setupSemesterListeners(data) {
    if (typeof document === 'undefined') return;
    const semesterSelect = document.getElementById('semesterSelect');
    const subjectSelect = document.getElementById('subjectSelect');

    function updateExamCard() {
        const newSemester = getCurrentUserSemester();
        currentSemesterData = findSemesterData(data, newSemester);
        if (currentSemesterData && shouldDisplayExamCard(data, currentSemesterData)) {
            displayExamCard(data, currentSemesterData);
            localStorage.removeItem('materio_exam_skip_until');
        } else {
            hideExamCards();
        }
    }

    if (semesterSelect && !semesterSelect.dataset.examListener) {
        semesterSelect.addEventListener('change', updateExamCard);
        semesterSelect.dataset.examListener = 'true';
    }
    if (subjectSelect && !subjectSelect.dataset.examListener) {
        subjectSelect.addEventListener('change', updateExamCard);
        subjectSelect.dataset.examListener = 'true';
    }
    document.addEventListener('semesterChanged', updateExamCard);
}

function getCurrentUserSemester() {
    if (typeof document === 'undefined') return null;
    const semesterSelect = document.getElementById('semesterSelect');
    if (semesterSelect && semesterSelect.value && semesterSelect.value.trim() !== '') {
        const match = semesterSelect.value.match(/\d+/);
        if (match) {
            return parseInt(match[0]);
        }
    }

    const savedSemester = localStorage.getItem('userSemester');
    if (savedSemester) {
        const match = savedSemester.match(/\d+/);
        if (match) {
            return parseInt(match[0]);
        }
    }

    return null;
}

function getSelectedSubjectName() {
    if (typeof document === 'undefined') return null;
    const subjectSelect = document.getElementById('subjectSelect');
    if (subjectSelect && subjectSelect.value && subjectSelect.value.trim() !== '') {
        const selectedOption = subjectSelect.options[subjectSelect.selectedIndex];
        if (selectedOption) {
            return selectedOption.text || selectedOption.value;
        }
    }
    return null;
}

function findSemesterData(data, semester) {
    if (!data.semesters || data.semesters.length === 0) {
        if (data.examPeriod && data.exams) {
            return {
                semester: null,
                examPeriod: data.examPeriod,
                exams: data.exams
            };
        }
        return null;
    }

    if (semester === null) {
        const now = getCurrentDate();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        for (const semData of data.semesters) {
            // Shared gate (exam-gate.js). The inline test here read
            // `!endDate` as "still ongoing forever", so a practical period from
            // a past semester with no configured endDate kept the card — and
            // the viva box gated on it — on screen indefinitely.
            if (isExamPeriodActive(semData, showBeforeDaysFor(semData, data, {
                viva: SHOW_BEFORE_DAYS_VIVA,
                standard: SHOW_BEFORE_DAYS
            }), now)) {
                return semData;
            }
        }
        return null;
    }

    const matches = data.semesters.filter(s => s.semester === semester);
    // A stored semester that matches nothing is a per-device staleness problem
    // (`userSemester` in localStorage), not evidence that no exam is running —
    // every period here is semester 7. Returning null used to hide the card
    // outright. Fall back to the active-period scan the null branch does.
    if (matches.length === 0) return findSemesterData(data, null);
    if (matches.length === 1) return matches[0];

    const now = getCurrentDate();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const ongoing = matches.find(semData => {
        // Bounded: a period with no endDate is not "ongoing" indefinitely.
        const startDate = new Date(semData.examPeriod.startDate);
        const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        if (!(today >= startDateOnly)) return false;
        return isExamPeriodActive(semData, showBeforeDaysFor(semData, data, {
            viva: SHOW_BEFORE_DAYS_VIVA,
            standard: SHOW_BEFORE_DAYS
        }), now);
    });
    if (ongoing) return ongoing;

    const upcoming = matches
        .filter(semData => new Date(semData.examPeriod.startDate) > now)
        .sort((a, b) => new Date(a.examPeriod.startDate) - new Date(b.examPeriod.startDate))[0];

    return upcoming || matches[0];
}

function shouldDisplayExamCard(data, semesterData) {
    if (!data.enabled) return false;
    if (!semesterData || !semesterData.examPeriod || !semesterData.examPeriod.startDate) return false;

    const now = getCurrentDate();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = new Date(semesterData.examPeriod.startDate);
    const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

    const daysUntilExam = Math.ceil((startDateOnly - today) / (1000 * 60 * 60 * 24));
    
    const isVivaExam = isDivisionScheduled(semesterData.exams);
    // Same falsy-zero fix as above.
    const showBeforeDays = Number(
        isVivaExam
            ? (data.showBeforeDaysViva ?? SHOW_BEFORE_DAYS_VIVA)
            : (data.showBeforeDays ?? SHOW_BEFORE_DAYS)
    );

    if (daysUntilExam <= showBeforeDays && daysUntilExam >= 0) return true;
    // Same unbounded-end bug as above: a missing endDate used to mean
    // "ongoing forever". isExamPeriodActive derives a bound from the exam
    // dates instead.
    if (today >= startDateOnly) {
        return isExamPeriodActive(semesterData, showBeforeDays, now);
    }

    return false;
}

export function hideExamCards() {
    if (typeof document === 'undefined') return;
    const examCards = [
        document.getElementById('examCard'),
        document.getElementById('examCardDefault')
    ].filter(Boolean);

    examCards.forEach(card => card.style.display = 'none');

    // Deliberately still published: the card being hidden is NOT the same as
    // the viva interview being off (a user can dismiss the card, or it can be
    // outside the show-before window while the period itself is underway).
    // publishVivaStatus() derives from the period gate, not from card
    // visibility, so this re-publishes the honest answer either way.
    publishVivaStatus();

    examCards.forEach(card => {
        const insightItem = card.closest('.insight-item');
        if (insightItem) {
            insightItem.style.display = 'none';
        }
    });

    const smartRecExam = document.querySelector('.recommendation-item#examCardDefault');
    if (smartRecExam) {
        smartRecExam.style.display = 'none';
    }

    const recommendedPosts = document.getElementById('recommendedPosts');
    if (recommendedPosts) {
        const hasVisiblePosts = recommendedPosts.querySelectorAll('.insight-card-link').length > 0;
        const attachmentsCard = document.getElementById('attachmentsCard');
        const hasVisibleAttachments = attachmentsCard && attachmentsCard.style.display !== 'none';
        if (!hasVisiblePosts && !hasVisibleAttachments) {
            recommendedPosts.style.setProperty('display', 'none', 'important');
        }
    }
}

export function displayExamCard(data, semesterData) {
    if (typeof document === 'undefined') return;
    const examCards = [
        document.getElementById('examCard'),
        document.getElementById('examCardDefault')
    ].filter(Boolean);

    if (examCards.length === 0) return;

    // Card is on screen, so this is the natural moment to tell the viva box.
    // The value still comes from the period gate, not from "the card is visible".
    publishVivaStatus();

    const now = new Date();
    const startDate = new Date(semesterData.examPeriod.startDate);
    const isPreExam = now < startDate;

    const periodName = semesterData.examPeriod.shortName || semesterData.examPeriod.name || 'Semester';
    const periodNameIds = [
        'examPeriodName', 'examPeriodNameOngoing', 'examPeriodNameTimeline',
        'examPeriodNameDefault', 'examPeriodNameOngoingDefault', 'examPeriodNameTimelineDefault'
    ];
    periodNameIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = periodName;
    });

    const sortedExams = [...semesterData.exams].sort((a, b) => new Date(a.date) - new Date(b.date));

    if (isDivisionScheduled(sortedExams)) {
        loadVivaData().then(() => {
            populateClassroomSelector();
            refreshMiniTimelineForCurrentState();

            if (currentSemesterData === semesterData) {
                const nowLocal = getCurrentDate();
                const startDateLocal = new Date(semesterData.examPeriod.startDate);
                if (nowLocal < startDateLocal) {
                    showPreExamView(sortedExams, data, false);
                    showPreExamView(sortedExams, data, true);
                }
            }
        });
    }

    examCards.forEach(card => {
        card.style.setProperty('display', 'flex', 'important');
    });

    const defaultPosts = document.getElementById('defaultPosts');
    const isSmartRecommendationsActive = defaultPosts && getComputedStyle(defaultPosts).display === 'none';
    if (isSmartRecommendationsActive) {
        const recommendedPosts = document.getElementById('recommendedPosts');
        if (recommendedPosts) {
            recommendedPosts.style.removeProperty('display');
            if (getComputedStyle(recommendedPosts).display === 'none') {
                recommendedPosts.style.display = 'flex';
            }

            if (!hasAutoFocusedExamCard && recommendedPosts.scrollLeft > 8) {
                recommendedPosts.scrollTo({ left: 0, behavior: 'smooth' });
                hasAutoFocusedExamCard = true;
            }
        }
    }

    if (isPreExam) {
        showPreExamView(sortedExams, data, false);
        showPreExamView(sortedExams, data, true);
        currentExamView = 0;
    } else {
        if (currentExamView === 2) {
            showTimelineView(sortedExams, false);
            showTimelineView(sortedExams, true);
        } else {
            showOngoingViews(sortedExams, data, false);
            showOngoingViews(sortedExams, data, true);
            currentExamView = 1;
        }
    }

    const selectedSubject = getSelectedSubjectName();
    if (!selectedSubject) {
        setupViewRotation(sortedExams, data);
    }
}

function isExamMatch(exam, subjectName) {
    if (!exam || !subjectName) return false;
    if (exam.global === true) return true;
    
    const normalizeForMatch = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const subjectNorm = normalizeForMatch(subjectName);
    const examNorm = normalizeForMatch(exam.subject);
    
    if (examNorm.includes(subjectNorm) || subjectNorm.includes(examNorm)) return true;

    if (exam.aliases && Array.isArray(exam.aliases)) {
        for (const alias of exam.aliases) {
            const aliasNorm = normalizeForMatch(alias);
            if (aliasNorm.includes(subjectNorm) || subjectNorm.includes(aliasNorm)) return true;
        }
    }

    if (exam.code && subjectNorm.includes(exam.code.toLowerCase())) return true;
    return false;
}

function getAvailableSubjectNames() {
    if (typeof document === 'undefined') return [];
    const subjectSelect = document.getElementById('subjectSelect');
    if (!subjectSelect) return [];
    return Array.from(subjectSelect.options)
        .map(opt => opt.text || opt.value)
        .filter(val => val && val.trim() !== '' && !val.toLowerCase().includes('select subject'));
}

function getBestExamForUser(examsList) {
    if (!examsList || examsList.length === 0) return null;
    const selectedSubject = getSelectedSubjectName();
    const availableSubjects = getAvailableSubjectNames();
    
    if (selectedSubject) {
        const match = examsList.find(e => isExamMatch(e, selectedSubject));
        if (match) return match;
    }
    
    if (availableSubjects && availableSubjects.length > 0) {
        const branchMatch = examsList.find(e => {
            return availableSubjects.some(sub => isExamMatch(e, sub));
        });
        if (branchMatch) return branchMatch;
    }
    
    return examsList[0];
}

function showPreExamView(exams, data, isDefault = false) {
    if (typeof document === 'undefined') return;
    const suffix = isDefault ? 'Default' : '';
    hideAllExamViews(suffix);

    const preexamView = document.getElementById('examViewPreexam' + suffix);
    if (!preexamView) return;

    preexamView.style.display = 'flex';

    const isVivaExam = isDivisionScheduled(currentSemesterData?.exams);
    // The `isVivaDataSettled()` half is what keeps this from being an infinite
    // loop: with no seatingDataUrl (or one that 404s) loadVivaData() resolves
    // null on every attempt, so re-entering on `!vivaData` alone never ends.
    if (isVivaExam && !vivaData && !isVivaDataSettled()) {
        loadVivaData().then(() => {
            showPreExamView(exams, data, isDefault);
        });
        return;
    }

    const effectiveExams = getEffectiveCardExams(exams);
    const now = new Date();
    const upcomingExams = effectiveExams.filter(e => new Date(e.date) >= now);

    let targetExam = getBestExamForUser(upcomingExams);
    if (!targetExam) targetExam = upcomingExams[0] || effectiveExams[0];

    if (targetExam) {
        const subjectEl = document.getElementById('preexamFirstSubject' + suffix);
        const dateEl = document.getElementById('preexamFirstDate' + suffix);
        const syllabusEl = document.getElementById('preexamSyllabus' + suffix);
        const labelEl = preexamView.querySelector('.exam-label');
        const headerSpan = preexamView.querySelector('.exam-card-header span');
        const headerIcon = preexamView.querySelector('.exam-card-header i');
        const subtitle = preexamView.querySelector('.exam-subtitle');

        const periodStartDate = new Date(currentSemesterData.examPeriod.startDate);
        const daysUntilStart = getDaysUntil(periodStartDate.toISOString());

        if (daysUntilStart === 0) {
            if (headerSpan) headerSpan.textContent = "Exams are on going!";
            if (headerIcon) {
                headerIcon.className = 'fa-solid fa-fire';
                headerIcon.style.color = '#ff8200';
            }
        } else if (daysUntilStart > 0 && daysUntilStart <= 3) {
            if (headerSpan) headerSpan.textContent = `${daysUntilStart} Day${daysUntilStart > 1 ? 's' : ''} Left!`;
            if (headerIcon) {
                headerIcon.className = 'fa-solid fa-fire';
                headerIcon.style.color = '#ff8200';
            }
            if (subtitle) {
                const periodName = currentSemesterData?.examPeriod?.shortName || 'Semester';
                subtitle.textContent = `Your ${periodName} exams are starting soon`;
            }
        } else {
            if (headerSpan) headerSpan.textContent = "Exams are on the way!";
            if (headerIcon) {
                headerIcon.className = 'fa-solid fa-calendar-check';
                headerIcon.style.color = '';
            }
        }

        if (labelEl) labelEl.textContent = "Start with";

        if (subjectEl) {
            const subject = targetExam.subject;
            subjectEl.textContent = subject.toLowerCase().endsWith('exam') ? subject : subject + " exam";
        }
        if (dateEl) dateEl.textContent = formatDate(targetExam.date);

        if (syllabusEl && isVivaExam) {
            syllabusEl.style.display = 'none';
        } else if (syllabusEl && targetExam.syllabus && targetExam.syllabus.length > 0) {
            syllabusEl.style.display = '';
            const isLocked = daysUntilStart <= 3;
            const topics = isLocked ? targetExam.syllabus.slice(0, 2) : getRandomItems(targetExam.syllabus, 2);
            syllabusEl.innerHTML = `<span>Topics: ${topics.join(', ')}</span>`;
        } else if (syllabusEl) {
            syllabusEl.style.display = '';
            syllabusEl.innerHTML = '';
        }
    }
}

function showOngoingViews(exams, data, isDefault = false) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayExamsList = exams.filter(e => new Date(e.date).toDateString() === today.toDateString());
    const tomorrowExamsList = exams.filter(e => new Date(e.date).toDateString() === tomorrow.toDateString());

    let todayExam = getBestExamForUser(todayExamsList);
    let tomorrowExam = getBestExamForUser(tomorrowExamsList);

    if (todayExam && isExamFinished(todayExam, now)) {
        todayExam = null;
    }

    const upcomingExams = exams.filter(e => {
        const examDate = new Date(e.date);
        if (examDate.toDateString() === today.toDateString()) {
            return !isExamFinished(e, now);
        }
        return examDate > now;
    });
    
    const nextExam = getBestExamForUser(upcomingExams);
    showOngoingView(todayExam, tomorrowExam, nextExam, exams, isDefault);
}

function showOngoingView(todayExam, tomorrowExam, nextExam, allExams, isDefault = false) {
    if (typeof document === 'undefined') return;
    const suffix = isDefault ? 'Default' : '';
    hideAllExamViews(suffix);

    const ongoingView = document.getElementById('examViewOngoing' + suffix);
    if (!ongoingView) return;

    ongoingView.style.display = 'flex';

    const itemContainer = document.getElementById('examTodayItem' + suffix);
    const labelEl = itemContainer?.querySelector('.exam-item-label');
    const subjectEl = document.getElementById('examTodaySubject' + suffix);
    const dateEl = document.getElementById('examTodayDate' + suffix);
    const syllabusEl = document.getElementById('ongoingSyllabus' + suffix);
    const isVivaExam = isDivisionScheduled(currentSemesterData?.exams);

    if (syllabusEl && isVivaExam) {
        syllabusEl.style.display = 'none';
    } else if (syllabusEl) {
        syllabusEl.style.display = '';
    }

    const displayExam = todayExam || tomorrowExam || nextExam;

    if (itemContainer && displayExam) {
        itemContainer.style.display = 'block';

        if (todayExam) {
            const headerSpan = ongoingView.querySelector('.exam-card-header span');
            if (headerSpan) headerSpan.textContent = "Exams are on going!";
            if (labelEl) labelEl.textContent = "Today is";
            if (subjectEl) {
                const subject = todayExam.subject;
                subjectEl.textContent = subject.toLowerCase().endsWith('exam') ? subject : subject + " exam";
            }
            if (dateEl) dateEl.textContent = formatDate(todayExam.date);
            if (!isVivaExam && syllabusEl && todayExam.syllabus) {
                const topics = todayExam.syllabus.slice(0, 2);
                syllabusEl.innerHTML = `<span>Topics: ${topics.join(', ')}</span>`;
            }
        } else if (tomorrowExam) {
            const headerSpan = ongoingView.querySelector('.exam-card-header span');
            if (headerSpan) headerSpan.textContent = "Tomorrow is the day!";
            if (labelEl) labelEl.textContent = "Tomorrow you have";
            if (subjectEl) {
                const subject = tomorrowExam.subject;
                subjectEl.textContent = subject.toLowerCase().endsWith('exam') ? subject : subject + " exam";
            }
            if (dateEl) dateEl.textContent = formatDate(tomorrowExam.date);
            if (!isVivaExam && syllabusEl && tomorrowExam.syllabus) {
                const topics = tomorrowExam.syllabus.slice(0, 2);
                syllabusEl.innerHTML = `<span>Topics: ${topics.join(', ')}</span>`;
            }
        } else if (nextExam) {
            const headerSpan = ongoingView.querySelector('.exam-card-header span');
            if (headerSpan) headerSpan.textContent = "Exams are on going!";
            if (labelEl) labelEl.textContent = "Next exam";

            if (subjectEl) {
                const subject = nextExam.subject;
                subjectEl.textContent = subject.toLowerCase().endsWith('exam') ? subject : subject + " exam";
            }
            if (dateEl) dateEl.textContent = formatDate(nextExam.date);
            if (!isVivaExam && syllabusEl && nextExam.syllabus) {
                const topics = nextExam.syllabus.slice(0, 2);
                syllabusEl.innerHTML = `<span>Topics: ${topics.join(', ')}</span>`;
            }
        }
    }
}

function showTimelineView(exams, isDefault = false) {
    if (typeof document === 'undefined') return;
    const suffix = isDefault ? 'Default' : '';
    hideAllExamViews(suffix);

    const timelineView = document.getElementById('examViewTimeline' + suffix);
    const timelineContainer = document.getElementById('examMiniTimeline' + suffix);

    if (!timelineView || !timelineContainer) return;

    timelineView.style.display = 'flex';

    const now = getCurrentDate();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const isVivaExam = isDivisionScheduled(exams);
    let sourceExams = exams;

    if (isVivaExam) {
        if (!vivaData && !isVivaDataSettled()) {
            loadVivaData().then(() => {
                showTimelineView(exams, isDefault);
            });
            return;
        }

        const selectedDivision = getSelectedDivision();
        sourceExams = selectedDivision && vivaData ? buildVivaTimelineEntries(selectedDivision) : [];
    }

    let relevantExams = sourceExams.filter(e => {
        const examDate = new Date(e.date);
        const examDateOnly = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());

        if (examDateOnly.toDateString() === today.toDateString()) {
            return !isExamFinished(e, now);
        }

        return examDateOnly > today;
    });

    if (!isVivaExam) {
        const availableSubjects = getAvailableSubjectNames();
        const selectedSubject = getSelectedSubjectName();
        if (availableSubjects && availableSubjects.length > 0) {
            relevantExams = relevantExams.filter(e => {
                return isExamMatch(e, selectedSubject) || availableSubjects.some(sub => isExamMatch(e, sub));
            });
        }
    }

    let timelineHTML = '';
    relevantExams.slice(0, 2).forEach((exam) => {
        const examDate = new Date(exam.date);
        const isToday = examDate.toDateString() === today.toDateString();
        const statusClass = isToday ? 'today' : 'upcoming';

        let topicStr = '';
        if (exam.syllabus && exam.syllabus.length > 0) {
            const randomTopic = exam.syllabus[Math.floor(Math.random() * exam.syllabus.length)];
            topicStr = randomTopic.length > 30 ? randomTopic.substring(0, 27) + '...' : randomTopic;
        }

        timelineHTML += `
            <div class="exam-mini-item ${statusClass}">
                <div class="exam-mini-content">
                    <div class="exam-mini-subject">${exam.subject}</div>
                    <div class="exam-mini-date">${formatDate(exam.date)}${exam.classroom ? ` - ${exam.classroom}` : (topicStr ? ` - ${topicStr}` : '')}</div>
                </div>
            </div>
        `;
    });

    if (!timelineHTML && isVivaExam) {
        timelineHTML = `
            <div class="exam-mini-item upcoming">
                <div class="exam-mini-content">
                    <div class="exam-mini-subject">Select division</div>
                    <div class="exam-mini-date">To see your exams</div>
                </div>
            </div>
        `;
    }

    timelineContainer.innerHTML = timelineHTML;
}

function hideAllExamViews(suffix = '') {
    if (typeof document === 'undefined') return;
    ['examViewPreexam', 'examViewOngoing', 'examViewTimeline'].forEach(id => {
        const el = document.getElementById(id + suffix);
        if (el) el.style.display = 'none';
    });
}

function setupViewRotation(exams, data) {
    if (examViewRotationTimer) {
        clearInterval(examViewRotationTimer);
    }

    const rotationInterval = 15000;
    const now = getCurrentDate();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = currentSemesterData ? new Date(currentSemesterData.examPeriod.startDate) : null;
    const isPreExam = startDate && now < startDate;

    if (currentExamView === undefined || currentExamView === null) {
        currentExamView = isPreExam ? 0 : 1;
    }

    let subIndex = 0;
    const availableSubjects = getAvailableSubjectNames();
    const selectedSubject = getSelectedSubjectName();
    let branchExams = exams;
    if (availableSubjects && availableSubjects.length > 0) {
        branchExams = exams.filter(e => {
            return isExamMatch(e, selectedSubject) || availableSubjects.some(sub => isExamMatch(e, sub));
        });
    }
    const upcomingExams = branchExams.filter(e => new Date(e.date) >= today);

    examViewRotationTimer = setInterval(() => {
        const innerNow = getCurrentDate();
        const innerToday = new Date(innerNow.getFullYear(), innerNow.getMonth(), innerNow.getDate());
        const innerStartDate = currentSemesterData ? new Date(currentSemesterData.examPeriod.startDate) : null;
        const daysUntilStart = innerStartDate ? getDaysUntil(innerStartDate.toISOString()) : 99;
        const isCurrentlyOngoing = daysUntilStart <= 0;

        if (!isCurrentlyOngoing) {
            if (daysUntilStart > 3) {
                if (upcomingExams.length > 1) {
                    subIndex = (subIndex + 1) % upcomingExams.length;
                    const nextTarget = upcomingExams[subIndex];
                    updatePreExamWithSubject(nextTarget, false);
                    updatePreExamWithSubject(nextTarget, true);
                }
            } else {
                const firstExam = upcomingExams[0];
                if (firstExam) {
                    updatePreExamWithSubject(firstExam, false);
                    updatePreExamWithSubject(firstExam, true);
                }
            }
            currentExamView = 0;
        } else {
            if (currentExamView === 2) {
                const tomorrow = new Date(innerToday);
                tomorrow.setDate(tomorrow.getDate() + 1);

                const todayExamsList = exams.filter(e => new Date(e.date).toDateString() === innerToday.toDateString());
                const tomorrowExamsList = exams.filter(e => new Date(e.date).toDateString() === tomorrow.toDateString());
                const upcomingList = exams.filter(e => new Date(e.date) > innerToday);

                const todayExam = getBestExamForUser(todayExamsList);
                const tomorrowExam = getBestExamForUser(tomorrowExamsList);
                const nextUpcoming = getBestExamForUser(upcomingList);

                showOngoingView(todayExam, tomorrowExam, nextUpcoming, exams, false);
                showOngoingView(todayExam, tomorrowExam, nextUpcoming, exams, true);
                currentExamView = 1;
            } else {
                showTimelineView(exams, false);
                showTimelineView(exams, true);
                currentExamView = 2;
            }
        }
    }, rotationInterval);
}

function updatePreExamWithSubject(exam, isDefault = false) {
    if (typeof document === 'undefined') return;
    const suffix = isDefault ? 'Default' : '';
    const preexamView = document.getElementById('examViewPreexam' + suffix);
    const subjectEl = document.getElementById('preexamFirstSubject' + suffix);
    const dateEl = document.getElementById('preexamFirstDate' + suffix);
    const syllabusEl = document.getElementById('preexamSyllabus' + suffix);
    const labelEl = preexamView ? preexamView.querySelector('.exam-label') : null;
    const headerSpan = preexamView ? preexamView.querySelector('.exam-card-header span') : null;
    const headerIcon = preexamView ? preexamView.querySelector('.exam-card-header i') : null;

    const periodStartDate = new Date(currentSemesterData.examPeriod.startDate);
    const daysUntilStart = getDaysUntil(periodStartDate.toISOString());

    if (daysUntilStart > 0 && daysUntilStart <= 3) {
        if (headerSpan) headerSpan.textContent = `${daysUntilStart} Day${daysUntilStart > 1 ? 's' : ''} Left!`;
        if (headerIcon) {
            headerIcon.className = 'fa-solid fa-fire';
            headerIcon.style.color = '#ff8200';
        }
    } else {
        if (headerSpan) headerSpan.textContent = "Exams are on the way!";
        if (headerIcon) {
            headerIcon.className = 'fa-solid fa-calendar-check';
            headerIcon.style.color = '';
        }
    }

    if (labelEl) labelEl.textContent = "Start with";

    if (subjectEl) {
        const subject = exam.subject;
        subjectEl.textContent = subject.toLowerCase().endsWith('exam') ? subject : subject + " exam";
    }
    if (dateEl) dateEl.textContent = formatDate(exam.date);

    const isVivaExam = isDivisionScheduled(currentSemesterData?.exams);
    if (syllabusEl && isVivaExam) {
        syllabusEl.style.display = 'none';
    } else if (syllabusEl && exam.syllabus) {
        syllabusEl.style.display = '';
        const isLocked = daysUntilStart <= 3 || daysUntilStart <= 0;
        const topics = isLocked ? exam.syllabus.slice(0, 2) : getRandomItems(exam.syllabus, 2);
        syllabusEl.innerHTML = `<span>Topics: ${topics.join(', ')}</span>`;
    } else if (syllabusEl) {
        syllabusEl.style.display = '';
        syllabusEl.innerHTML = '';
    }
}

function getRandomItems(arr, count) {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
}

function formatDateLong(dateStr) {
    const date = new Date(dateStr);
    const options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

function getDaysUntil(dateStr) {
    const now = getCurrentDate();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(dateStr);
    const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

    const diffTime = targetDay.getTime() - today.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function parseTimeString(str, baseDate) {
    if (!str) return null;
    const s = str.trim().toUpperCase();
    const isPM = s.includes('PM');
    const isAM = s.includes('AM');
    const cleanStr = s.replace(/AM|PM/g, '').trim();

    const parts = cleanStr.split(/[:.]/);
    if (parts.length < 1) return null;

    let hours = parseInt(parts[0], 10);
    let minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    if (isNaN(hours)) return null;
    if (isNaN(minutes)) minutes = 0;

    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    if (!isPM && !isAM && hours >= 1 && hours <= 7) {
        hours += 12;
    }

    const result = new Date(baseDate);
    result.setHours(hours, minutes, 0, 0);
    return result;
}

function isExamFinished(exam, now) {
    if (!exam || !exam.date) return false;

    try {
        const examDate = new Date(exam.date);
        if (isNaN(examDate.getTime())) return false;

        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const examDay = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());

        if (examDay < today) return true;
        if (examDay > today) return false;

        if (!exam.time) return false;

        const timeStr = String(exam.time).trim();
        const rangeParts = timeStr.split(/to|-|\u2013|\u2014/i);
        let examEndDate = null;

        if (rangeParts.length === 2) {
            const endStr = rangeParts[1].trim();
            const endParsed = parseTimeString(endStr, examDate);
            if (endParsed) {
                examEndDate = endParsed;
            }
        }

        if (!examEndDate) {
            const startStr = rangeParts[0].trim();
            const startParsed = parseTimeString(startStr, examDate);
            if (!startParsed) return false;

            let durationMinutes = 90;
            if (exam.duration) {
                const durationStr = String(exam.duration).toLowerCase();
                if (durationStr.includes('hour')) {
                    const hoursMatch = durationStr.match(/(\d+\.?\d*)\s*hour/);
                    if (hoursMatch) durationMinutes = parseFloat(hoursMatch[1]) * 60;
                } else if (durationStr.includes('min')) {
                    const minsMatch = durationStr.match(/(\d+)\s*min/);
                    if (minsMatch) durationMinutes = parseInt(minsMatch[1]);
                }
            }
            examEndDate = new Date(startParsed.getTime() + durationMinutes * 60000);
        }

        return now > examEndDate;
    } catch (e) {
        console.error('[ExamCard] Error calculating if exam is finished:', e);
        return false;
    }
}

export function openExamModal() {
    if (typeof document === 'undefined') return;
    if (!currentSemesterData) {
        console.error('[ExamCard] No exam data available for modal');
        // Not a failure worth dropping: on a reload the hash->store mapping in
        // +layout.svelte sets activeModalStore to 'examModal' during onMount,
        // which runs well ahead of the examdata fetch, so the reactive in
        // ExamModal fires here with nothing to render. Remember the intent and
        // open for real once data lands — otherwise the store stays latched on
        // a modal that never showed.
        pendingOpen = true;
        return;
    }
    pendingOpen = false;

    const modal = document.getElementById('examModal');
    if (!modal) {
        console.error('[ExamCard] Exam modal element not found');
        return;
    }

    const titleEl = document.getElementById('examModalTitle');
    if (titleEl) {
        const periodName = currentSemesterData.examPeriod.name || 'Semester';
        const now = new Date();
        const startDate = new Date(currentSemesterData.examPeriod.startDate);
        const isPreExam = now < startDate;

        const fullText = isPreExam ? `${periodName} Exams are coming!` : `${periodName} Exams are on going !`;
        const words = fullText.split(' ');
        if (words.length > 3) {
            titleEl.innerHTML = words.slice(0, 3).join(' ') + '<br>' + words.slice(3).join(' ');
        } else {
            titleEl.textContent = fullText;
        }
    }

    generateExamTimeline();

    const isVivaExam = currentSemesterData.exams && isDivisionScheduled(currentSemesterData.exams);
    if (isVivaExam) {
        populateClassroomSelector();
    } else {
        const selectorWrap = document.getElementById('classroomSelector');
        if (selectorWrap) selectorWrap.style.display = 'none';
    }

    if (typeof window.initSeatingLookup === 'function') {
        window.initSeatingLookup();
    }

    const slider = document.getElementById('examModalSlider');
    if (slider) {
        slider.classList.remove('show-syllabus');
    }
    setSyllabusPageAccessibility(false);

    modal.style.display = 'flex';
    modal.classList.add('show');
    document.body.classList.add('modal-open');

    setTimeout(() => {
        scrollToActiveExam();
    }, 100);

    if (window.MaterioHaptics) {
        window.MaterioHaptics.vibrate('select');
    }
}

function scrollToActiveExam() {
    if (typeof document === 'undefined') return;
    const timeline = document.getElementById('examModalTimeline');
    if (!timeline) return;

    const allItems = timeline.querySelectorAll('.exam-timeline-item');
    if (allItems.length === 0) return;

    let targetItem = null;

    for (const item of allItems) {
        if (!item.classList.contains('completed')) {
            targetItem = item;
            break;
        }
    }

    if (!targetItem) {
        targetItem = allItems[allItems.length - 1];
    }

    if (targetItem) {
        targetItem.scrollIntoView({ behavior: 'instant', block: 'start' });
        timeline.scrollTop = Math.max(0, timeline.scrollTop - 10);
    }
}

export function closeExamModal() {
    if (typeof document === 'undefined') return;

    // Release the store here rather than only in ExamModal's close button.
    //
    // Three paths close this modal: the X (which did clear the store), a tap
    // on the overlay, and Escape — the last two called this function directly
    // and left activeModalStore holding 'examModal'. Svelte's writable.set is
    // a no-op when the new value equals the old one, so once it latched:
    //
    //   1. tapping the exam card did `set('examModal')` again, which notified
    //      nothing, so ExamModal's reactive never re-ran and the modal stayed
    //      shut — "second tap does nothing";
    //   2. InterviewerModal.isOtherModalOpen read the stale value as "another
    //      modal is up" and suppressed the viva box for the rest of the
    //      session — "the interviewer never pops up".
    //
    // Guarded by value so Escape (which fires whether or not this modal is
    // up) cannot close an unrelated modal.
    pendingOpen = false;
    if (get(activeModalStore) === 'examModal') activeModalStore.set(null);

    const modal = document.getElementById('examModal');
    const slider = document.getElementById('examModalSlider');

    if (modal) {
        const examModalElement = modal.querySelector('.exam-modal');
        if (examModalElement) {
            examModalElement.style.willChange = 'transform, opacity';
            examModalElement.classList.add('closing');

            if (slider) {
                setTimeout(() => {
                    slider.classList.remove('show-syllabus');
                    setSyllabusPageAccessibility(false);
                }, 300);
            }

            modal.style.transition = 'opacity 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
            modal.style.opacity = '0';

            setTimeout(() => {
                modal.style.display = 'none';
                modal.classList.remove('show');
                modal.style.opacity = '';
                modal.style.transition = '';
                examModalElement.classList.remove('closing');
                examModalElement.style.willChange = '';
                examModalElement.style.transform = '';
                document.body.classList.remove('modal-open');
            }, 400);
        } else {
            modal.style.display = 'none';
            modal.classList.remove('show');
            document.body.classList.remove('modal-open');
            if (slider) slider.classList.remove('show-syllabus');
            setSyllabusPageAccessibility(false);
        }
    }
}

export async function generateExamTimeline() {
    if (typeof document === 'undefined') return;
    const timelineContainer = document.getElementById('examModalTimeline');
    if (!timelineContainer || !currentSemesterData || !currentSemesterData.exams) return;

    const now = getCurrentDate();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sortedExams = [...currentSemesterData.exams].sort((a, b) => new Date(a.date) - new Date(b.date));

    const isVivaExam = isDivisionScheduled(currentSemesterData.exams);
    if (isVivaExam && !vivaData) {
        await loadVivaData();
    }

    const selectedDivision = isVivaExam ? getSelectedDivision() : '';
    let timelineExams = isVivaExam ? buildVivaTimelineEntries(selectedDivision) : sortedExams;

    if (!isVivaExam) {
        const availableSubjects = getAvailableSubjectNames();
        const selectedSubject = getSelectedSubjectName();
        if (availableSubjects && availableSubjects.length > 0) {
            timelineExams = sortedExams.filter(e => {
                return isExamMatch(e, selectedSubject) || availableSubjects.some(sub => isExamMatch(e, sub));
            });
        }
    }

    updateDivisionClearButtonVisibility();

    if (isVivaExam && !selectedDivision) {
        timelineContainer.innerHTML = '<div class="exam-timeline-empty">Enter division to view your exam schedule</div>';
        return;
    }

    let timelineHTML = '';
    let foundFirstUpcoming = false;

    timelineExams.forEach((exam, index) => {
        const examDate = new Date(exam.date);
        const examDateOnly = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());

        const isPastDate = examDateOnly < today;
        const isToday = examDateOnly.toDateString() === today.toDateString();
        const isFinished = isToday && isExamFinished(exam, now);
        const isCompleted = isPastDate || isFinished;

        let statusClass = 'upcoming';
        if (isCompleted) {
            statusClass = 'completed';
        } else if (isToday) {
            statusClass = 'today active';
            foundFirstUpcoming = true;
        } else if (!foundFirstUpcoming) {
            statusClass = 'upcoming active';
            foundFirstUpcoming = true;
        }

        let subjectDisplay = exam.subject;

        let syllabusHTML = '';
        if (!isVivaExam && exam.syllabus && exam.syllabus.length > 0) {
            const displayLimit = 2;
            const hasMore = exam.syllabus.length > displayLimit;
            const shownItems = exam.syllabus.slice(0, displayLimit);

            syllabusHTML = `
                <div class="exam-timeline-syllabus">
                    <div class="exam-timeline-syllabus-label">Syllabus</div>
                    <div class="exam-timeline-syllabus-list">
                        ${shownItems.map(item => `<div class="exam-timeline-syllabus-item">${item}</div>`).join('')}
                        ${hasMore ? `<span class="syllabus-show-link" onclick="showExamSyllabus('${exam.id || index}')">... show</span>` : ''}
                    </div>
                </div>
            `;
        }

        // Class-wise viva rows carry the room. Show it in place of the
        // syllabus block (which is meaningless for a viva) so the entry reads
        // subject + code, when, and where — the three things you need on the
        // day. The hardcoded 09:00 is omitted when we know the room instead:
        // "at 09:00" was never in the sheet, the room was.
        const roomHTML = (isVivaExam && exam.classroom)
            ? `<div class="exam-timeline-room">at ${exam.classroom}</div>`
            : '';

        timelineHTML += `
            <div class="exam-timeline-item ${statusClass}" data-exam-id="${exam.id || index}">
                <div class="exam-timeline-dot"></div>
                <div class="exam-timeline-content">
                    <div class="exam-timeline-subject">${subjectDisplay}${exam.code ? ` (${exam.code})` : ''}</div>
                    <div class="exam-timeline-date">${formatDateLong(exam.date)}${roomHTML ? '' : (exam.time ? ` at ${exam.time}` : '')}</div>
                    ${roomHTML}
                    ${syllabusHTML}
                </div>
            </div>
        `;
    });

    if (timelineHTML === '') {
        timelineHTML = '<div class="exam-timeline-empty">No upcoming exam found for this division right now</div>';
    }

    timelineContainer.innerHTML = timelineHTML;
}

function buildVivaTimelineEntries(selectedDivision) {
    if (!vivaData || !selectedDivision) return [];

    const normalizedSelected = normalizeClassroomValue(selectedDivision);
    const filtered = vivaData.filter(row => normalizeClassroomValue(row.Division) === normalizedSelected);
    if (filtered.length === 0) return [];

    // The class-wise sheet is a matrix: one row per (date × division) carrying
    // subject, code AND the room the viva is held in. Older versions dropped
    // the room, so the timeline said what and when but never where.
    // `Classroom` is the header the admin CSV uses; the organiser sheet labels
    // the same column "Location", so accept both.
    const roomOf = (row) => row.Classroom || row.Location || row['Practical Room'] || '';

    const byDate = new Map();
    filtered.forEach(row => {
        const dateKey = row.Date;
        if (!dateKey) return;

        if (!byDate.has(dateKey)) {
            byDate.set(dateKey, {
                date: dateKey,
                subjectSet: new Set(),
                codeSet: new Set(),
                roomSet: new Set()
            });
        }

        const day = byDate.get(dateKey);
        if (row['Subject Name']) day.subjectSet.add(row['Subject Name']);
        if (row['Subject Code']) day.codeSet.add(row['Subject Code']);
        const room = roomOf(row);
        if (room) day.roomSet.add(room);
    });

    return [...byDate.values()]
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map((day, idx) => ({
            id: `viva-${idx + 1}`,
            subject: [...day.subjectSet].join(', '),
            code: [...day.codeSet].join(', '),
            classroom: [...day.roomSet].join(', '),
            date: day.date,
            time: '09:00',
            duration: 'full day',
            type: 'viva'
        }));
}

export function showExamSyllabus(examId) {
    if (typeof document === 'undefined') return;
    if (!currentSemesterData || !currentSemesterData.exams) return;

    const exam = currentSemesterData.exams.find(e => (e.id || '').toString() === examId.toString()) ||
        currentSemesterData.exams[parseInt(examId)];

    if (!exam) return;

    const slider = document.getElementById('examModalSlider');
    const titleEl = document.getElementById('syllabusSubjectTitle');
    const contentEl = document.getElementById('syllabusFullContent');
    const bannerImg = document.getElementById('syllabusBannerImg');

    if (!slider || !titleEl || !contentEl) return;

    titleEl.textContent = `${exam.subject} Syllabus`;

    if (bannerImg) {
        const coverImgUrl = exam.image || (examData && examData.defaultCoverImage);
        if (coverImgUrl) {
            bannerImg.src = coverImgUrl;
            bannerImg.style.display = 'block';
        } else {
            bannerImg.src = '';
            bannerImg.style.display = 'none';
        }
    }

    const syllabusText = Array.isArray(exam.syllabus) ? exam.syllabus.join('\n\n') : (exam.syllabus || '');
    contentEl.innerHTML = parseSyllabusMarkdown(syllabusText);

    slider.classList.add('show-syllabus');
    setSyllabusPageAccessibility(true);

    contentEl.scrollTop = 0;

    if (window.MaterioHaptics) {
        window.MaterioHaptics.vibrate('light');
    }
}

export function showExamTimeline() {
    if (typeof document === 'undefined') return;
    const slider = document.getElementById('examModalSlider');
    if (!slider) return;

    slider.classList.remove('show-syllabus');
    setSyllabusPageAccessibility(false);

    if (window.MaterioHaptics) {
        window.MaterioHaptics.vibrate('light');
    }
}

function setSyllabusPageAccessibility(isVisible) {
    if (typeof document === 'undefined') return;
    const syllabusPage = document.getElementById('examModalSyllabusPage');
    if (!syllabusPage) return;

    const backBtn = syllabusPage.querySelector('.syllabus-back-btn');

    if (isVisible) {
        syllabusPage.removeAttribute('aria-hidden');
        if ('inert' in syllabusPage) {
            syllabusPage.inert = false;
        }
        if (backBtn) {
            backBtn.tabIndex = 0;
        }
        return;
    }

    syllabusPage.setAttribute('aria-hidden', 'true');
    if ('inert' in syllabusPage) {
        syllabusPage.inert = true;
    }
    if (backBtn) {
        backBtn.tabIndex = -1;
    }
}

function parseSyllabusMarkdown(text) {
    if (!text) return '';

    let formattedText = text.replace(/\\n/g, '\n');

    let html = formattedText
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>');

    const lines = html.split('\n');
    let inList = false;
    let result = '';

    const chevronSvg = `
<svg class="hgi hgi-arrow-down-01" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75;">
  <path d="M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) {
            if (inList) {
                result += '</ul>';
                inList = false;
            }
            return;
        }

        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            if (!inList) {
                result += '<ul>';
                inList = true;
            }
            result += `<li>${trimmed.substring(2)}</li>`;
        } else {
            if (inList) {
                result += '</ul>';
                inList = false;
            }

            const unitMatch = trimmed.match(/^(Unit\s+\w+:)(.*)$/i);
            if (unitMatch) {
                const label = unitMatch[1];
                const content = unitMatch[2];
                result += `
<div class="syllabus-unit-row">
    <div class="syllabus-unit-content">
        <span class="syllabus-unit-num">${label}</span>
        <span class="syllabus-unit-text">${content}</span>
    </div>
    <div class="syllabus-unit-chevron">
        ${chevronSvg}
    </div>
</div>`;
            } else {
                result += `<p>${trimmed}</p>`;
            }
        }
    });

    if (inList) result += '</ul>';

    return result;
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', function (e) {
        const modal = document.getElementById('examModal');
        if (modal && e.target === modal) {
            closeExamModal();
            return;
        }

        const row = e.target.closest('.syllabus-unit-row');
        if (row) {
            const selection = window.getSelection();
            if (selection && selection.toString().trim() !== '' && row.contains(selection.anchorNode)) {
                return;
            }
            row.classList.toggle('expanded');
            if (window.MaterioHaptics) {
                window.MaterioHaptics.vibrate('light');
            }
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeExamModal();
        }
    });
}

if (typeof window !== 'undefined') {
    window.openExamModal = openExamModal;
    window.closeExamModal = closeExamModal;
    window.showExamSyllabus = showExamSyllabus;
    window.showExamTimeline = showExamTimeline;
}
