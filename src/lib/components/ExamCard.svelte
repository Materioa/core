<script>
    import { onMount } from 'svelte';
    import { activeModalStore } from '$lib/stores.js';

    let examData = null;
    let selectedSemester = null;
    let loading = true;

    function shouldDisplayCard(data, semester) {
        if (!data?.enabled || !semester?.examPeriod?.startDate) return false;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startDate = new Date(semester.examPeriod.startDate);
        const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endDate = semester.examPeriod.endDate ? new Date(semester.examPeriod.endDate) : null;

        const daysUntilExam = Math.ceil((startDateOnly - today) / (1000 * 60 * 60 * 24));
        const isVivaExam = semester.exams && semester.exams.some(e => e.type === 'viva' || e.type === 'practical');
        // `||` here silently discarded an admin-set 0 and fell back to the
        // default, so "show 0 days before" became "show 3 days before" and the
        // card appeared early. Only fall back on a genuinely missing value.
        const showBefore = Number(
            isVivaExam
                ? (data.showBeforeDaysViva ?? 3)
                : (data.showBeforeDays ?? 7)
        );

        // 1. Shows within showBeforeDays (e.g. 3 days) before exam starts
        if (daysUntilExam <= showBefore && daysUntilExam >= 0) return true;
        // 2. Once exam starts, stays visible while ongoing until end date
        if (today >= startDateOnly && (!endDate || now <= endDate)) return true;

        return false;
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
        // Live admin-managed config first. This component used to fetch ONLY
        // the build-time snapshot, so every showBeforeDays / enabled change
        // made in admin never reached it — the card was driven entirely by
        // whatever was baked in at the last deploy.
        try {
            const live = await fetch('/api/v2/examdata', { cache: 'no-store' });
            if (live.ok) {
                const j = await live.json();
                if (j && j.enabled !== false && Array.isArray(j.semesters) && j.semesters.length > 0) {
                    examData = j;
                    selectedSemester = j.semesters[0];
                    loading = false;
                    return;
                }
                // Authoritative "off" from admin — do not fall back.
                loading = false;
                return;
            }
        } catch (e) {
            // Unreachable; the snapshot below is the fallback for that case only.
        }

        try {
            const res = await fetch('/assets/data/examdata.json');
            if (res.ok) {
                examData = await res.json();
                if (examData?.semesters?.length > 0) {
                    selectedSemester = examData.semesters[0];
                }
            }
        } catch (e) {
            console.error('Failed to load exam data:', e);
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
