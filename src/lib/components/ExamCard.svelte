<script>
    import { onMount } from 'svelte';
    import { activeModalStore } from '$lib/stores.js';
    import { isExamPeriodActive, showBeforeDaysFor, isUsableExamConfig } from '$lib/utils/exam-gate.js';

    let examData = null;
    let selectedSemester = null;
    let loading = true;

    // Single source of truth, shared with the viva interviewer box so the card
    // and the popup can never disagree about whether an exam is "on".
    function shouldDisplayCard(data, semester) {
        if (!data?.enabled || !semester?.examPeriod?.startDate) return false;
        return isExamPeriodActive(semester, showBeforeDaysFor(semester, data), new Date());
    }

	$: isCardVisible = !loading && examData && selectedSemester && shouldDisplayCard(examData, selectedSemester);
	$: featuredExam = selectedSemester?.exams?.[0];
	$: canCollectQuestions = isCardVisible && (featuredExam?.type === 'viva' || featuredExam?.type === 'practical');

    $: if (typeof window !== 'undefined') {
        window.__materioExamHasVivaOrPractical = canCollectQuestions;
        window.__materioActiveVivaExam = canCollectQuestions ? featuredExam : null;
        window.dispatchEvent(new CustomEvent('materioExamVivaStatus', { detail: { hasViva: canCollectQuestions, exam: featuredExam } }));
    }

    onMount(async () => {
        // Live admin-managed config ONLY. The /assets/data/examdata.json
        // fallback is gone on purpose: it is a committed snapshot that goes
        // stale on commit, and it kept driving the card (and the viva
        // interviewer gated on it) with no Mongo config saying so.
        try {
            const live = await fetch('/api/v2/examdata', { cache: 'no-store' });
            if (live.ok) {
                const j = await live.json();
                if (isUsableExamConfig(j)) {
                    examData = j;
                    selectedSemester = j.semesters[0];
                } else {
                    // Authoritative "off" / no live config — do not fall back.
                    examData = null;
                    selectedSemester = null;
                }
            }
        } catch (e) {
            console.warn('Exam data unavailable:', e?.message || e);
            examData = null;
            selectedSemester = null;
        } finally {
            loading = false;
        }
    });

    function openExamModal() {
        activeModalStore.set('examModal');
    }

    function openInterviewer(event) {
        event.stopPropagation();
        activeModalStore.set('viva-box');
    }
</script>

{#if isCardVisible}
    <div id="examCard" class="exam-card" on:click={openExamModal}>
        {#if selectedSemester.exams?.length > 0}
            <div class="exam-view exam-view-preexam" id="examViewPreexam">
                <div class="exam-card-header">
                    
                    <span>Exams are on the way!</span>
                </div>
                <p class="exam-subtitle">
                    Your <span id="examPeriodName">{selectedSemester.examPeriod?.name || 'Mid Semester'}</span> exams are starting this week
                </p>
                <div class="exam-first-info">
                    <div class="exam-label">Start with</div>
                    <div class="exam-subject" id="preexamFirstSubject">{selectedSemester.exams[0].subject}</div>
                    <div class="exam-date" id="preexamFirstDate">{selectedSemester.exams[0].date}</div>
                </div>
                {#if selectedSemester.exams[0].syllabus}
                    <div class="exam-syllabus-preview" id="preexamSyllabus">
                        <span>Syllabus: {selectedSemester.exams[0].syllabus}</span>
                    </div>
                {/if}
                <div class="exam-divider"></div>
                {#if canCollectQuestions}
                    <button class="exam-interviewer-link" type="button" on:click={openInterviewer}>Share a question from this practical</button>
                {/if}
                <div class="exam-show-all">Show all</div>
            </div>
        {/if}
    </div>
{/if}
