<script>
    import { onMount } from 'svelte';
    import HugeIcon from "./HugeIcon.svelte";
    import { HugeiconsIcon } from "@hugeicons/svelte";
    import { LoaderIcon } from "@hugeicons/core-free-icons";
    import { activeModalStore } from '$lib/stores.js';

    const POSTS_API = 'https://room.getmaterio.app/api/posts';
    const FALLBACK_IMG = '/assets/img/noidea.png';

    const DEFAULT_POSTS = [
        {
            title: "Introduction to IoT - Week 1 Notes",
            link: "https://room.getmaterio.app/nptel/nptel-introduction-to-iot-week-1-notes",
            image: FALLBACK_IMG,
            excerpt: "Week 1 covers IoT introduction · IoT addressing (IPv4 vs IPv6) · Sensing · Actuation · Basics of IoT networking",
            date: "24-09-2026",
            visibility: "public"
        },
        {
            title: "Assignment 1 Solutions - Introduction to Big Data",
            link: "https://room.getmaterio.app/assignments/big-data-analytics-assignment-1-solutions-chapter-1-introduction-to-big-data",
            image: FALLBACK_IMG,
            excerpt: "Assignment solutions covering fundamental Big Data concepts and distributed architectures.",
            date: "27-08-2026",
            visibility: "public"
        },
        {
            title: "BDA Assignment 2 and 3 Solutions",
            link: "https://room.getmaterio.app/bda-assignment-2-and-3-solutions",
            image: FALLBACK_IMG,
            excerpt: "Complete solutions for Big Data Analytics Assignments 2 and 3.",
            date: "27-08-2026",
            visibility: "public"
        },
        {
            title: "Concept Learning",
            link: "https://room.getmaterio.app/originals/concept-learning-from-formal-hypotheses-to-candidate-elimination",
            image: FALLBACK_IMG,
            excerpt: "Concept learning through formal hypotheses, PAC guarantees, VC dimension, and Candidate Elimination.",
            date: "20-08-2026",
            visibility: "public"
        },
        {
            title: "NoSQL Data Management",
            link: "https://room.getmaterio.app/database-management-systems/nosql-data-management",
            image: FALLBACK_IMG,
            excerpt: "Exam-ready notes on NoSQL data management: types, aggregates, key-value and document models.",
            date: "19-08-2026",
            visibility: "public"
        }
    ];

    let posts = [...DEFAULT_POSTS];
    let recommended = [];
    let loading = false;
    let recLoading = false;
    let error = false;
    let feedEnabled = true;
    let viewMode = 'normal';
    let isExpanded = false;
    let activeSubject = '';

    $: showRecommended = activeSubject.trim() !== '';
    $: heading = showRecommended ? 'Smart Recommendations' : 'Latest from the Insightroom';

    function hasPrivateAccess() {
        try {
            if (typeof window !== 'undefined' && window.materioUserHasPrivateAccess) return true;
        } catch {}
        return false;
    }

    function formatPostDate(raw) {
        try {
            const d = new Date(raw);
            if (isNaN(d.getTime())) return '';
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        } catch {
            return '';
        }
    }

    function truncateExcerpt(text) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        if (words.length <= 12) return words.join(' ');
        return words.slice(0, 12).join(' ') + '...';
    }

    // Normalizes both the live API shape ({link, imgUrl}) and the legacy
    // fallback shape ({url, image}) so covers + links always render.
    function normalizePost(p) {
        const img = p.imgUrl ?? p.image;
        const image = img && String(img).trim() && String(img).trim() !== 'null' && String(img).trim() !== 'undefined'
            ? String(img).trim()
            : FALLBACK_IMG;
        return {
            title: p.title || 'Untitled',
            link: p.link || p.url || '#',
            image,
            excerpt: truncateExcerpt(p.excerpt || p.excerpt_home || ''),
            date: formatPostDate(p.date),
            visibility: p.visibility || 'public'
        };
    }

    function toPostList(data) {
        const raw = Array.isArray(data) ? data : (data?.posts || []);
        const allowPrivate = hasPrivateAccess();
        return raw
            .filter((p) => p && (allowPrivate || p.visibility !== 'private'))
            .map(normalizePost)
            .slice(0, 5);
    }

    async function fetchFallback() {
        const fallbackRes = await fetch('/_data/insightroom_fallback.json');
        if (!fallbackRes.ok) throw new Error('fallback missing');
        return toPostList(await fallbackRes.json());
    }

    async function loadLatest() {
        try {
            let data = null;
            const early = typeof window !== 'undefined' ? window.__materioPosts : null;
            if (early) {
                window.__materioPosts = null;
                data = await early;
            }
            if (!data) {
                const res = await fetch(`${POSTS_API}?num=5`);
                if (!res.ok) throw new Error(`posts API ${res.status}`);
                data = await res.json();
            }
            posts = toPostList(data);
            error = false;
        } catch (e) {
            console.error('Failed to load posts:', e);
            try {
                posts = await fetchFallback();
                error = false;
            } catch (e2) {
                error = true;
            }
        } finally {
            loading = false;
        }
    }

    // Smart recommendations (ported from parent): subject-driven server
    // filtering — api/posts?subject={subject}, latest 5, private-filtered.
    async function loadRecommendations(subject) {
        const sub = String(subject || '').trim();
        activeSubject = sub;
        if (!sub) {
            recommended = [];
            return;
        }
        recLoading = true;
        try {
            const res = await fetch(`${POSTS_API}?subject=${encodeURIComponent(sub)}`);
            if (!res.ok) throw new Error(`posts API ${res.status}`);
            recommended = toPostList(await res.json());
        } catch (e) {
            console.error('Failed to load recommendations:', e);
            recommended = [];
        } finally {
            recLoading = false;
        }
    }

    function handleSelectChange(e) {
        const t = e?.target;
        if (!t || t.id !== 'subjectSelect') return;
        loadRecommendations(t.value);
    }

    function getSettings() {
        if (typeof window !== 'undefined' && typeof window.getInsightroomSettings === 'function') {
            return window.getInsightroomSettings();
        }
        if (typeof document !== 'undefined') {
            try {
                const raw = document.cookie.match(new RegExp('(^| )insightroomSettings=([^;]+)'));
                if (raw) {
                    // Tolerate legacy double-encoded cookies.
                    let parsed = null;
                    try { parsed = JSON.parse(decodeURIComponent(raw[2])); } catch {}
                    if (!parsed) {
                        try { parsed = JSON.parse(decodeURIComponent(decodeURIComponent(raw[2]))); } catch {}
                    }
                    if (Array.isArray(parsed) && parsed.length === 2) return parsed;
                }
            } catch {}
        }
        return [true, 'normal'];
    }

    function applySettings(enabled, mode) {
        feedEnabled = enabled;
        viewMode = mode;
        if (mode === 'normal') {
            isExpanded = false;
        }
    }

    function handleHeaderClick(e) {
        if (viewMode !== 'folded') return;
        if (e.target && e.target.closest('.view-more-btn')) return;

        if (typeof window !== 'undefined' && window.MaterioHaptics) {
            window.MaterioHaptics.vibrate('tap');
        }

        isExpanded = !isExpanded;
    }

    onMount(async () => {
        const [savedEnabled, savedMode] = getSettings();
        applySettings(savedEnabled, savedMode);

        const handleInsightroomChange = (e) => {
            if (e.detail) {
                applySettings(
                    typeof e.detail.enabled === 'boolean' ? e.detail.enabled : feedEnabled,
                    e.detail.viewMode || viewMode
                );
            }
        };

        window.addEventListener('materioInsightroomChange', handleInsightroomChange);
        // Subject changes (native selects + custom-select modal, which
        // dispatches bubbling change events) drive smart recommendations.
        document.addEventListener('change', handleSelectChange);

        await loadLatest();

        // Initialize exam card logic once DOM is rendered
        setTimeout(async () => {
            const examModule = await import('$lib/utils/exam-card.js').catch(e => null);
            if (examModule && typeof examModule.loadAndDisplayExamCard === 'function') {
                examModule.loadAndDisplayExamCard();
            }
        }, 100);

        return () => {
            window.removeEventListener('materioInsightroomChange', handleInsightroomChange);
            document.removeEventListener('change', handleSelectChange);
        };
    });

    function handleOpenExamModal() {
        // If activeModalStore already reads 'examModal', this set() is a
        // silent no-op (Svelte's writable skips equal values) and ExamModal's
        // reactive never re-runs — so a modal closed behind the store's back
        // stayed shut no matter how many times the card was tapped. The store
        // is already correct in that case, so reopen the DOM directly.
        if ($activeModalStore === 'examModal') {
            import('$lib/utils/exam-card.js')
                .then((m) => { if (typeof m.openExamModal === 'function') m.openExamModal(); })
                .catch(() => {});
            return;
        }
        activeModalStore.set('examModal');
    }
</script>

<div class="card-one" id="blogs"
    class:blog-folded={viewMode === 'folded' && !isExpanded}
    class:blog-expanded={viewMode === 'folded' && isExpanded}
    style:display={feedEnabled ? 'block' : 'none'}>
    <!-- Header row - always visible, clickable in folded mode -->
    <div class="blog-header-container" id="blogHeaderContainer" 
        on:click={handleHeaderClick}
        on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleHeaderClick(e)}
        role="button"
        tabindex={viewMode === 'folded' ? 0 : -1}
        aria-expanded={viewMode === 'folded' ? isExpanded : undefined}>
        <h2 id="blogCardHeading" class="blog-header-title">
            {heading}
        </h2>
        <div class="blog-header-right">
            <a href="https://room.getmaterio.app" class="view-more-btn" target="_blank" rel="noopener noreferrer" on:click|stopPropagation>
                View More
                <i class="fas fa-arrow-up" style="transform: rotate(45deg); font-size: 12px; display: inline-flex;" aria-hidden="true">
                    <HugeIcon name="arrow-up-01" />
                </i>
            </a>
            <!-- Chevron for folded mode (hidden by default) -->
            <i class="fas fa-chevron-down blog-fold-chevron" id="blogFoldChevron"
                style:display={viewMode === 'folded' ? 'inline-block' : 'none'}
                style="color: var(--color-primary); font-size: 14px; margin-left: 12px; cursor: var(--f-cursor-pointer); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);"
                style:transform={isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}
                aria-hidden="true">
                <HugeIcon name="arrow-down-01" />
            </i>
        </div>
    </div>

    <!-- Posts container - collapsible in folded mode -->
    <div class="blog-posts-container" id="blogPostsContent" style:display={(viewMode === 'folded' && !isExpanded) ? 'none' : 'block'}>
        <!-- Default: Latest 5 posts (loaded from API) - Horizontal Scroll -->
        <div id="defaultPosts" class="insight-cards-scroll" style:display={showRecommended ? 'none' : ''}>
            <!-- Exam Card in Default View — always first, before all post cards -->
            <div id="examCardDefault" class="exam-card" style="display: none;" on:click={handleOpenExamModal} role="button" tabindex="0">
                <!-- View 1: Pre-Exam -->
                <div class="exam-view exam-view-preexam" id="examViewPreexamDefault" style="display: none;">
                    <div class="exam-card-header">
                        <HugeIcon name="calendar-check" />
                        <span>Exams are in the way!</span>
                    </div>
                    <p class="exam-subtitle">Your <span id="examPeriodNameDefault">Mid Semester</span> exams are starting this week</p>
                    <div class="exam-first-info">
                        <div class="exam-label">Start with</div>
                        <div class="exam-subject" id="preexamFirstSubjectDefault">Subject name</div>
                        <div class="exam-date" id="preexamFirstDateDefault">16-02-26</div>
                    </div>
                    <div class="exam-syllabus-preview" id="preexamSyllabusDefault">
                        <span>Syllabus</span>
                    </div>
                    <div class="exam-divider"></div>
                    <div class="exam-show-all">Show all</div>
                </div>

                <!-- View 2: Ongoing -->
                <div class="exam-view exam-view-ongoing" id="examViewOngoingDefault" style="display: none;">
                    <div class="exam-card-header">
                        <HugeIcon name="fire" />
                        <span>Exams are on going!</span>
                    </div>
                    <p class="exam-subtitle">Your <span id="examPeriodNameOngoingDefault">Mid Semester</span> exams have started</p>
                    <div class="exam-today-tomorrow">
                        <div class="exam-item exam-today" id="examTodayItemDefault" style="display: none;">
                            <div class="exam-item-label">Tomorrow you have</div>
                            <div class="exam-item-subject" id="examTodaySubjectDefault">Subject name exam</div>
                            <div class="exam-item-date" id="examTodayDateDefault">16-02-26</div>
                        </div>
                    </div>
                    <div class="exam-syllabus-preview" id="ongoingSyllabusDefault">
                        <span>Syllabus</span>
                    </div>
                    <div class="exam-divider"></div>
                    <div class="exam-show-all">Show all</div>
                </div>

                <!-- View 3: Timeline -->
                <div class="exam-view exam-view-timeline" id="examViewTimelineDefault" style="display: none;">
                    <div class="exam-card-header">
                        <HugeIcon name="fire" />
                        <span>Exams are on going!</span>
                    </div>
                    <p class="exam-subtitle">Your <span id="examPeriodNameTimelineDefault">Mid Semester</span> exams have started</p>
                    <div class="exam-mini-timeline" id="examMiniTimelineDefault"></div>
                    <div class="exam-show-all">Show all</div>
                </div>
            </div>

            {#if posts && posts.length > 0}
                {#each posts as post, i}
                    <a href={post.link} class="insight-card-link" target="_blank" rel="noopener noreferrer">
                        <article class="insight-card" id="staticBlogPost{i + 1}" style="--card-bg: url('{post.image}')">
                            <div class="insight-card-bg"></div>
                            <div class="insight-card-gradient"></div>
                            <div class="insight-card-content">
                                <h3 class="insight-card-title">{post.title}</h3>
                                <p class="insight-card-excerpt">{post.excerpt} <span class="insight-card-read-more">Read</span></p>
                                <span class="insight-card-date">{post.date}</span>
                            </div>
                        </article>
                    </a>
                {/each}
            {/if}

            <!-- Loading state -->
            {#if loading}
                <div id="postsLoading" class="posts-loading">
                    <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" style="font-size: 24px; color: var(--color-primary);" />
                    <p style="margin-top: 12px; color: #666;">Just a sec...</p>
                </div>
            {/if}
        </div>

        <!-- Smart Recommendations (subject-driven, hidden by default) -->
        <div id="recommendedPosts" class="insight-cards-scroll" style:display={showRecommended ? '' : 'none'}>
            <!-- Exam Card in Recommended View — always first, before all post cards -->
            <div id="examCard" class="exam-card" style="display: none;" on:click={handleOpenExamModal} role="button" tabindex="0">
                <!-- View 1: Pre-Exam -->
                <div class="exam-view exam-view-preexam" id="examViewPreexam" style="display: none;">
                    <div class="exam-card-header">
                        <HugeIcon name="calendar-check" />
                        <span>Exams are on the way!</span>
                    </div>
                    <p class="exam-subtitle">Your <span id="examPeriodName">Mid Semester</span> exams are starting this week</p>
                    <div class="exam-first-info">
                        <div class="exam-label">Start with</div>
                        <div class="exam-subject" id="preexamFirstSubject">Subject name</div>
                        <div class="exam-date" id="preexamFirstDate">16-02-26</div>
                    </div>
                    <div class="exam-syllabus-preview" id="preexamSyllabus">
                        <span>Syllabus</span>
                    </div>
                    <div class="exam-divider"></div>
                    <div class="exam-show-all">Show all</div>
                </div>

                <!-- View 2: Ongoing -->
                <div class="exam-view exam-view-ongoing" id="examViewOngoing" style="display: none;">
                    <div class="exam-card-header">
                        <HugeIcon name="fire" />
                        <span>Exams are on going!</span>
                    </div>
                    <p class="exam-subtitle">Your <span id="examPeriodNameOngoing">Mid Semester</span> exams have started</p>
                    <div class="exam-today-tomorrow">
                        <div class="exam-item exam-today" id="examTodayItem" style="display: none;">
                            <div class="exam-item-label">Tomorrow you have</div>
                            <div class="exam-item-subject" id="examTodaySubject">Subject name exam</div>
                            <div class="exam-item-date" id="examTodayDate">16-02-26</div>
                        </div>
                    </div>
                    <div class="exam-syllabus-preview" id="ongoingSyllabus">
                        <span>Syllabus</span>
                    </div>
                    <div class="exam-divider"></div>
                    <div class="exam-show-all">Show all</div>
                </div>

                <!-- View 3: Timeline -->
                <div class="exam-view exam-view-timeline" id="examViewTimeline" style="display: none;">
                    <div class="exam-card-header">
                        <HugeIcon name="fire" />
                        <span>Exams are on going!</span>
                    </div>
                    <p class="exam-subtitle">Your <span id="examPeriodNameTimeline">Mid Semester</span> exams have started</p>
                    <div class="exam-mini-timeline" id="examMiniTimeline"></div>
                    <div class="exam-show-all">Show all</div>
                </div>
            </div>

            {#if recLoading}
                <div class="posts-loading">
                    <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" style="font-size: 24px; color: var(--color-primary);" />
                    <p style="margin-top: 12px; color: #666;">Finding picks for you...</p>
                </div>
            {:else if recommended && recommended.length > 0}
                {#each recommended as post, i}
                    <a href={post.link} class="insight-card-link" target="_blank" rel="noopener noreferrer">
                        <article class="insight-card" id="recommendedPost{i + 1}" style="--card-bg: url('{post.image}')">
                            <div class="insight-card-bg"></div>
                            <div class="insight-card-gradient"></div>
                            <div class="insight-card-content">
                                <h3 class="insight-card-title">{post.title}</h3>
                                <p class="insight-card-excerpt">{post.excerpt} <span class="insight-card-read-more">Read</span></p>
                                <span class="insight-card-date">{post.date}</span>
                            </div>
                        </article>
                    </a>
                {/each}
            {/if}
            <!-- Attachments Card -->
            <div id="attachmentsCard" class="attachments-card" style="display: none;">
                <div class="attachments-card-header">
                    <HugeIcon name="attachment-01" />
                    <span>Attachments</span>
                </div>
                <div id="attachmentsPillsContainer" class="attachments-pills-container"></div>
                <div id="attachmentsEmpty" class="attachments-empty" style="display: none;">
                    
                    <span>No attachments found</span>
                </div>
            </div>
        </div>

        <!-- No posts found message -->
        <div id="noPostsMessage" style:display={showRecommended && !recLoading && (!recommended || recommended.length === 0) ? 'block' : 'none'} style="text-align: center; padding: 20px; color: #666;">
            <p>No posts found for the selected semester and subject.</p>
            <p style="font-size: 14px;">Try selecting different options or check back later for new content.</p>
        </div>

        <!-- Error message -->
        {#if error}
            <div id="postsError" style="text-align: center; padding: 20px; color: #dc3545;">
                
                <p>Failed to load posts. Please try again later.</p>
            </div>
        {/if}
    </div>
</div>
