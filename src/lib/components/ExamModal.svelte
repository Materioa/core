<script>
    import { activeModalStore } from '$lib/stores.js';
    import HugeIcon from './HugeIcon.svelte';
    import { openExamModal, closeExamModal } from '$lib/utils/exam-card.js';

    $: if ($activeModalStore === 'examModal') {
        openExamModal();
    }

    function handleClose() {
        closeExamModal();
        activeModalStore.set(null);
    }

    function handleSeatingLookup() {
        if (typeof window !== 'undefined' && typeof window.lookupSeating === 'function') {
            window.lookupSeating();
        }
    }

    function handleClearSeating() {
        if (typeof window !== 'undefined' && typeof window.clearSeatingLookup === 'function') {
            window.clearSeatingLookup();
        }
    }

    function handleShowTimeline() {
        if (typeof window !== 'undefined' && typeof window.showExamTimeline === 'function') {
            window.showExamTimeline();
        }
    }
</script>

<!-- Exam Schedule Modal (Promo-style) -->
<div class="promo-modal-overlay exam-modal-overlay" id="examModal" style="display: none;">
    <div class="promo-modal exam-modal">
        <!-- Close Button -->
        <button type="button" class="promo-close-btn" on:click={handleClose} aria-label="Close">
            <HugeIcon name="cancel-01" />
        </button>

        <!-- Pages Slider Container -->
        <div class="exam-modal-slider" id="examModalSlider">
            <!-- Page 1: Timeline -->
            <div class="exam-modal-page" id="examModalTimelinePage">
                <div class="promo-content exam-modal-content">
                    <h2><span class="promo-title" id="examModalTitle">Mid semester Exams are on going !</span></h2>
                    <div class="exam-schedule-section">
                        <div class="exam-schedule-header">
                            <h3 class="exam-schedule-heading">Exam schedule</h3>
                            <!-- Classroom Selector -->
                            <div class="classroom-selector" id="classroomSelector" style="display: none;">
                                <input id="classroomSelect" class="classroom-select" list="classroomOptions"
                                    type="text" autocomplete="off" placeholder="Search division (e.g. 6A1)" />
                                <button id="clearDivisionBtn" class="clear-division-btn" type="button"
                                    aria-label="Clear division" title="Clear division" style="display: none;">
                                    <HugeIcon name="cancel-01" aria-hidden="true" />
                                </button>
                                <datalist id="classroomOptions"></datalist>
                            </div>
                            <!-- Seating Lookup Bar -->
                            <div class="seating-lookup" id="seatingLookupContainer" style="display: none;">
                                <div class="seating-input-row" id="seatingInputRow">
                                    <span class="seating-venue-label">Venue:</span>
                                    <input type="text" id="enrollmentInput" class="enrollment-input" placeholder="Lookup with Enrollment number" autocomplete="off" />
                                    <button id="seatingSearchBtn" class="seating-search-btn" on:click={handleSeatingLookup} type="button" aria-label="Search Seating">
                                        <HugeIcon name="arrow-right-01" aria-hidden="true" />
                                    </button>
                                </div>
                                <div class="seating-result" id="seatingResult" style="display: none;">
                                    <span class="seating-venue-label">Venue:</span>
                                    <span class="seating-result-text" id="seatingResultText"></span>
                                    <button class="seating-clear-btn" on:click={handleClearSeating} type="button" aria-label="Clear Search">
                                        <HugeIcon name="cancel-01" aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="exam-timeline" id="examModalTimeline">
                            <!-- Timeline items will be populated by JS -->
                        </div>
                    </div>
                </div>
            </div>

            <!-- Page 2: Syllabus -->
            <div class="exam-modal-page" id="examModalSyllabusPage">
                <div class="exam-syllabus-view">
                    <!-- Banner Section -->
                    <div class="syllabus-banner" id="syllabusBanner">
                        <button class="syllabus-back-btn" on:click={handleShowTimeline} aria-label="Back to timeline">
                            <HugeIcon name="arrow-left-01" aria-hidden="true" />
                        </button>
                        <img src="" alt="" id="syllabusBannerImg" class="syllabus-banner-img">
                        <div class="syllabus-banner-overlay">
                            <h2 id="syllabusSubjectTitle">Subject Syllabus</h2>
                        </div>
                    </div>

                    <!-- Scrollable Content -->
                    <div class="syllabus-full-content" id="syllabusFullContent">
                        <!-- Full syllabus content will be populated by JS -->
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
