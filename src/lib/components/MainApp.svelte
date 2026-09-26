<script>
    import { onMount } from 'svelte';
    import { pushState, replaceState } from '$app/navigation';
    import { activeTab, activeModalStore, openPdfModal } from "$lib/stores.js";
    import Navbar from '$lib/components/Navbar.svelte';
    import ReadingForm from '$lib/components/ReadingForm.svelte';
    import AiConnectorsBanner from '$lib/components/AiConnectorsBanner.svelte';
    import BlogPosts from '$lib/components/BlogPosts.svelte';
    import Leaderboard from '$lib/components/Leaderboard.svelte';
    import NotebooksTab from '$lib/components/NotebooksTab.svelte';
    import NotificationsTab from '$lib/components/NotificationsTab.svelte';
    import DownloadsTab from '$lib/components/DownloadsTab.svelte';
    import SettingsTab from '$lib/components/SettingsTab.svelte';

    export let initialTab = 'home';

    const tabTitles = {
        home: 'Materio - Home | Materio',
        notifications: 'Notifications',
        leaderboard: 'Leaderboard',
        notebooks: 'Notebooks',
        downloads: 'Downloads',
        settings: 'Settings'
    };

    $: pageTitle = tabTitles[$activeTab] || 'Materio - Home | Materio';

    let mounted = false;
    let lastInitialTab = initialTab;

    // Only update activeTab when initialTab prop actually changes from router
    $: if (mounted && initialTab && initialTab !== lastInitialTab && tabTitles[initialTab]) {
        lastInitialTab = initialTab;
        activeTab.set(initialTab);
    }

    // Reactively synchronize activeTab with URL, title, cookies, and DOM.
    // Invalid values reset to home instead of pushing a dead URL (which
    // used to break all tab navigation until a full refresh).
    $: {
        if (mounted && $activeTab && typeof window !== 'undefined') {
            try {
                if (!tabTitles[$activeTab]) {
                    activeTab.set('home');
                } else {
                    const path = $activeTab === 'home'
                        ? (window.location.pathname === '/home' ? '/home' : '/')
                        : `/${$activeTab}`;
                    if (window.location.pathname !== path) {
                        try {
                            pushState(path + window.location.hash, { tab: $activeTab });
                        } catch (e) {
                            try {
                                window.history.pushState({ tab: $activeTab }, '', path + window.location.hash);
                            } catch (e2) {
                                console.error('Tab navigation failed:', e2);
                            }
                        }
                    }
                    if (tabTitles[$activeTab]) {
                        document.title = tabTitles[$activeTab];
                    }
                    document.cookie = `activeTab=${$activeTab}; path=/; max-age=604800`;
                    document.querySelector(".content")?.classList.toggle("hide-scrollbar", $activeTab === "home");
                    document.getElementById("quickSearchResults")?.style.setProperty("display", $activeTab === "home" ? "" : "none");
                    document.dispatchEvent(new CustomEvent("tabOpened", { detail: { tab: $activeTab } }));
                    if ($activeTab === "downloads") {
                        document.dispatchEvent(new Event("downloadsTabOpened"));
                    }
                    if ($activeTab === "leaderboard" && typeof window.loadLeaderboardData === "function") {
                        try {
                            window.loadLeaderboardData();
                        } catch (e) {
                            console.error('Leaderboard load failed:', e);
                        }
                    }
                }
            } catch (e) {
                console.error('Tab sync failed:', e);
            }
        }
    }

    onMount(() => {
        if (typeof window !== 'undefined') {
            window.MATERIO_CONFIG = Object.assign(window.MATERIO_CONFIG || {}, {
                INSIGHTROOM_API: "",
                IS_TAURI_APP: true,
                API_ORIGIN: null 
            });

            // Initialize activeTab from prop if valid, or pathname
            const pathSlug = window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
            const startTab = tabTitles[initialTab] ? initialTab : (tabTitles[pathSlug] ? pathSlug : 'home');
            activeTab.set(startTab);
            mounted = true;

            // Bridge Svelte store to imperative JS (profile-image.js, main.js)
            window.__materioSetTab = (tab) => {
                if (tabTitles[tab]) {
                    activeTab.set(tab);
                }
            };

            window.createNewNotebook = (create = true) => {
                try {
                    activeModalStore.set("notebook");
                } catch (e) {
                    console.error('Open notebook failed:', e);
                }
            };
            window.openModal = (modal) => {
                try {
                    activeModalStore.set(modal);
                } catch (e) {
                    console.error('Open modal failed:', e);
                }
            };
            window.openDynamicForm = (formType) => {
                try {
                    const formMap = { contribution: "contribute", contribute: "contribute", feedback: "feedback", "bug-report": "bug-report" };
                    activeModalStore.set(formMap[formType] || formType);
                } catch (e) {
                    console.error('Open form failed:', e);
                }
            };
            window.closeDynamicForm = () => {
                try {
                    activeModalStore.set(null);
                } catch (e) {
                    console.error('Close form failed:', e);
                }
            };
            window.openExamModal = () => {
                try {
                    activeModalStore.set("examModal");
                } catch (e) {
                    console.error('Open exam modal failed:', e);
                }
            };
            window.closeExamModal = () => {
                try {
                    activeModalStore.set(null);
                } catch (e) {
                    console.error('Close exam modal failed:', e);
                }
            };

            const handlePopState = () => {
                const curPath = window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
                const targetTab = curPath === '' ? 'home' : curPath;
                if (tabTitles[targetTab]) {
                    activeTab.set(targetTab);
                }
            };
            window.addEventListener('popstate', handlePopState);

            // Check for shared PDF link (?share=<maskId>)
            const urlParams = new URLSearchParams(window.location.search);
            const maskId = urlParams.get('share');
            if (maskId) {
                fetch(`/api/v2/features?action=pdf-share&subAction=resolve&maskId=${encodeURIComponent(maskId)}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.actualUrl) {
                            openPdfModal(data.actualUrl);
                            const cleanUrl = window.location.pathname;
                            try {
                                replaceState(cleanUrl, {});
                            } catch (e) {
                                window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
                            }
                        }
                    })
                    .catch(e => console.error('Failed to resolve shared PDF:', e));
            }

            // Check custom PDF open (?open= or ?file=)
            const customUrl = urlParams.get('open') || urlParams.get('file');
            if (customUrl) {
                try {
                    const decoded = decodeURIComponent(customUrl);
                    openPdfModal(decoded);
                    const cleanUrl = window.location.pathname;
                    try {
                        replaceState(cleanUrl, {});
                    } catch (e) {
                        window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
                    }
                } catch (e) {
                    console.error('Failed to open custom PDF:', e);
                }
            }

            return () => {
                window.removeEventListener('popstate', handlePopState);
                delete window.__materioSetTab;
                delete window.createNewNotebook;
                delete window.openModal;
                delete window.openDynamicForm;
                delete window.closeDynamicForm;
                delete window.openExamModal;
                delete window.closeExamModal;
            };
        }
    });
</script>

<svelte:head>
    <title>{pageTitle}</title>
</svelte:head>

<div class="container" style="max-width: none !important;">
    <!-- Mobile Frame Corners -->
    <div class="mobile-corner-tl" aria-hidden="true"></div>
    <div class="mobile-corner-tr" aria-hidden="true"></div>
    <div class="mobile-corner-bl" aria-hidden="true"></div>
    <div class="mobile-corner-br" aria-hidden="true"></div>

    <Navbar />

    <div class="content">
        <div id="home" class="tab-content" class:active={$activeTab === 'home'}>
            <ReadingForm />
            <AiConnectorsBanner />
            <BlogPosts />
        </div>

        <div id="notifications" class="tab-content" class:active={$activeTab === 'notifications'}>
            <NotificationsTab />
        </div>

        <div id="leaderboard" class="tab-content" class:active={$activeTab === 'leaderboard'}>
            <Leaderboard />
        </div>

        <div id="notebooks" class="tab-content" class:active={$activeTab === 'notebooks'}>
            <NotebooksTab />
        </div>

        <div id="downloads" class="tab-content" class:active={$activeTab === 'downloads'}>
            <DownloadsTab />
        </div>

        <div id="settings" class="tab-content" class:active={$activeTab === 'settings'}>
            <SettingsTab />
        </div>

        <!-- Quick Search Results Dropdown -->
        <div id="quickSearchResults">
            <!-- Results will be populated here -->
        </div>
    </div>
</div>
