<script>
    import { onMount } from 'svelte';
    import { activeTab, activeModalStore } from '$lib/stores.js';
    import HugeIcon from '$lib/components/HugeIcon.svelte';
    import { isTauri, isCapacitor } from '$lib/config/api.js';

    import { pushState } from '$app/navigation';

    const validTabs = ['home', 'notifications', 'leaderboard', 'notebooks', 'downloads', 'settings'];

    function setTab(tab, e) {
        if (e && e.preventDefault) e.preventDefault();
        // Guard: an invalid tab value would push a dead URL (/invalid) and
        // break all tab navigation until refresh — reset to home instead.
        if (!validTabs.includes(tab)) {
            tab = 'home';
        }
        try {
            activeTab.set(tab);
        } catch (err) {
            console.error('Tab switch failed:', err);
            return;
        }
        if (typeof window !== 'undefined') {
            try {
                if (window.__materioSetTab) {
                    window.__materioSetTab(tab);
                }
            } catch (err) {
                console.error('Tab bridge failed:', err);
            }
            const path = tab === 'home' ? '/' : `/${tab}`;
            if (window.location.pathname !== path) {
                try {
                    pushState(path + window.location.hash, { tab });
                } catch (err) {
                    try {
                        window.history.pushState({ tab }, '', path + window.location.hash);
                    } catch (err2) {
                        console.error('Tab navigation failed:', err2);
                    }
                }
            }
        }
    }

    function openModal(modal, e) {
        if (e && e.preventDefault) e.preventDefault();
        try {
            activeModalStore.set(modal);
        } catch (err) {
            console.error('Open modal failed:', err);
        }
    }

    import { getLoginUrl, getOverviewUrl } from '$lib/utils/app-urls.js';

    onMount(async () => {
        const profileModule = await import('$lib/utils/profile-image.js').catch(e => null);
        if (profileModule && typeof profileModule.init === 'function') {
            profileModule.init();

            const handleAuthChange = () => {
                profileModule.init();
            };

            window.addEventListener('auth:login', handleAuthChange);
            window.addEventListener('auth:logout', handleAuthChange);

            return () => {
                window.removeEventListener('auth:login', handleAuthChange);
                window.removeEventListener('auth:logout', handleAuthChange);
            };
        }
    });
</script>

<nav class="navbar">
    <div class="navbar-top-group">
        <a href="/" class="tab-link" class:active={$activeTab === 'home'} data-tab="home" aria-label="Home" onclick={(e) => setTab('home', e)}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path
                    d="M22 10.5L12.8825 2.82207C12.6355 2.61407 12.3229 2.5 12 2.5C11.6771 2.5 11.3645 2.61407 11.1175 2.82207L2 10.5" />
                <path
                    d="M20.5 9.5V16C20.5 18.3456 20.5 19.5184 19.8801 20.3263C19.7205 20.5343 19.5343 20.7205 19.3263 20.8801C18.5184 21.5 17.3456 21.5 15 21.5V17C15 15.5858 15 14.8787 14.5607 14.4393C14.1213 14 13.4142 14 12 14C10.5858 14 9.87868 14 9.43934 14.4393C9 14.8787 9 15.5858 9 17V21.5C6.65442 21.5 5.48164 21.5 4.67372 20.8801C4.46572 20.7205 4.27954 20.5343 4.11994 20.3263C3.5 19.5184 3.5 18.3456 3.5 16V9.5" />
            </svg>
        </a>

        <a href="/notifications" class="tab-link" class:active={$activeTab === 'notifications'} data-tab="notifications" aria-label="Notifications" onclick={(e) => setTab('notifications', e)}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor"
                fill="none" stroke="#141B34" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15.5 18C15.5 19.933 13.933 21.5 12 21.5C10.067 21.5 8.5 19.933 8.5 18" />
                <path
                    d="M19.2311 18H4.76887C3.79195 18 3 17.208 3 16.2311C3 15.762 3.18636 15.3121 3.51809 14.9803L4.12132 14.3771C4.68393 13.8145 5 13.0514 5 12.2558V9.5C5 5.63401 8.13401 2.5 12 2.5C15.866 2.5 19 5.634 19 9.5V12.2558C19 13.0514 19.3161 13.8145 19.8787 14.3771L20.4819 14.9803C20.8136 15.3121 21 15.762 21 16.2311C21 17.208 20.208 18 19.2311 18Z" />
            </svg>
        </a>

        <a href="/leaderboard" class="tab-link" class:active={$activeTab === 'leaderboard'} data-tab="leaderboard" aria-label="Leaderboard" onclick={(e) => setTab('leaderboard', e)}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor"
                fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path
                    d="M3.5 18C3.5 16.5858 3.5 15.8787 3.93934 15.4393C4.37868 15 5.08579 15 6.5 15H7C7.94281 15 8.41421 15 8.70711 15.2929C9 15.5858 9 16.0572 9 17V22H3.5V18Z" />
                <path
                    d="M15 19C15 18.0572 15 17.5858 15.2929 17.2929C15.5858 17 16.0572 17 17 17H17.5C18.9142 17 19.6213 17 20.0607 17.4393C20.5 17.8787 20.5 18.5858 20.5 20V22H15V19Z" />
                <path d="M2 22H22" />
                <path
                    d="M9 16C9 14.5858 9 13.8787 9.43934 13.4393C9.87868 13 10.5858 13 12 13C13.4142 13 14.1213 13 14.5607 13.4393C15 13.8787 15 14.5858 15 16V22H9V16Z" />
                <path
                    d="M12.6911 2.57767L13.395 3.99715C13.491 4.19475 13.7469 4.38428 13.9629 4.42057L15.2388 4.6343C16.0547 4.77141 16.2467 5.36824 15.6587 5.957L14.6668 6.95709C14.4989 7.12646 14.4069 7.4531 14.4589 7.68699L14.7428 8.925C14.9668 9.90492 14.4509 10.284 13.591 9.77185L12.3951 9.05808C12.1791 8.92903 11.8232 8.92903 11.6032 9.05808L10.4073 9.77185C9.5514 10.284 9.03146 9.90089 9.25543 8.925L9.5394 7.68699C9.5914 7.4531 9.49941 7.12646 9.33143 6.95709L8.33954 5.957C7.7556 5.36824 7.94358 4.77141 8.75949 4.6343L10.0353 4.42057C10.2473 4.38428 10.5033 4.19475 10.5993 3.99715L11.3032 2.57767C11.6872 1.80744 12.3111 1.80744 12.6911 2.57767Z" />
            </svg>
        </a>

        <a href="https://room.getmaterio.app" target="_blank" rel="noopener" aria-label="Insightroom" class="tab-link">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path
                    d="M17.5055 2.01874C12.8289 2.83455 12 7.5 12 7.5V22C12 22 12.8867 17.1272 18.0004 16.5588C18.5493 16.4978 19 16.0576 19 15.5058V3.39309C19 2.5654 18.3216 1.87638 17.5055 2.01874Z" />
                <path
                    d="M5.33333 5.00001C7.79379 4.99657 10.1685 5.88709 12 7.5V22C10.1685 20.3871 7.79379 19.4966 5.33333 19.5C3.77132 19.5 2.99032 19.5 2.64526 19.2792C2.4381 19.1466 2.35346 19.0619 2.22086 18.8547C2 18.5097 2 17.8941 2 16.6629V8.40322C2 6.97543 2 6.26154 2.54874 5.68286C3.09748 5.10418 3.65923 5.07432 4.78272 5.0146C4.965 5.00491 5.14858 5.00001 5.33333 5.00001Z" />
                <path
                    d="M12 22.001C13.8315 20.3881 16.2062 19.4976 18.6667 19.501C20.2287 19.501 21.0097 19.501 21.3547 19.2802C21.5619 19.1476 21.6465 19.0629 21.7791 18.8558C22 18.5107 22 17.8951 22 16.6639V8.40424C22 6.97645 22 6.26256 21.4513 5.68388C20.9025 5.1052 20.1235 5.05972 19 5" />
            </svg>
        </a>
    </div>

    <div class="navbar-bottom-group">
        <a href="/changelog" class="changelog-btn desktop-only" role="button" aria-label="Changelog" title="Changelog">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor"
                fill="none" stroke="#141B34" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path
                    d="M2 21.494C3.2945 21.5899 4.38367 20.5 5.33333 20.5C6.283 20.5 7.82473 21.5053 8.66667 21.494C9.67699 21.5025 10.8604 20.5 12 20.5C13.1396 20.5 14.323 21.5025 15.3333 21.494C16.6278 21.5899 17.717 20.5 18.6667 20.5C19.6163 20.5 21.1581 21.5053 22 21.494" />
                <path
                    d="M6 20.5C4.58214 18.7336 3.58286 16.4728 3.15734 15.2748C3.0224 14.8949 2.95494 14.705 3.03329 14.5234C3.11163 14.3419 3.30377 14.2568 3.68803 14.0866L11.1772 10.7692C11.5824 10.5897 11.785 10.5 12 10.5C12.215 10.5 12.4176 10.5897 12.8228 10.7692L20.312 14.0866C20.6962 14.2568 20.8884 14.3419 20.9667 14.5234C21.0451 14.705 20.9776 14.8949 20.8427 15.2748C20.4171 16.4728 19.4179 18.7336 18 20.5" />
                <path
                    d="M6 13L6.21591 10.1932C6.35068 8.44115 6.41807 7.56511 6.99316 7.03256C7.56826 6.5 8.44688 6.5 10.2041 6.5H13.7959C15.5531 6.5 16.4317 6.5 17.0068 7.03256C17.5819 7.56511 17.6493 8.44115 17.7841 10.1932L18 13" />
                <path
                    d="M8.5 6.5L8.67151 5.1279C8.82792 3.87661 8.90613 3.25097 9.33147 2.87548C9.75681 2.5 10.3873 2.5 11.6483 2.5H12.3517C13.6127 2.5 14.2432 2.5 14.6685 2.87548C15.0939 3.25097 15.1721 3.87661 15.3285 5.1279L15.5 6.5" />
            </svg>
        </a>

        <a href="#" class="keyboard-shortcuts-btn desktop-only" id="keyboardShortcutsBtn" role="button"
            aria-label="Keyboard Shortcuts" title="Keyboard Shortcuts" onclick={(e) => openModal('shortcuts', e)}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor"
                fill="none" stroke="#141B34" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path
                    d="M9.5 9.5C9.5 8.11929 10.6193 7 12 7C13.3807 7 14.5 8.11929 14.5 9.5C14.5 10.3569 14.0689 11.1131 13.4117 11.5636C12.7283 12.0319 12 12.6716 12 13.5" />
                <path d="M12.0001 17H12.009" />
            </svg>
        </a>

        {#if !isTauri && !isCapacitor}
            <a href="/downloads" class="changelog-btn desktop-only" id="downloadsNavbarBtn" role="button" aria-label="Downloads" title="Download Desktop & Mobile Apps">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor"
                    fill="none" stroke="#141B34" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3.09477 10.0002C3.03217 10.4572 2.99976 10.9247 2.99976 11.4002C2.99976 16.7021 7.02919 21.0002 11.9998 21.0002C16.9703 21.0002 20.9998 16.7021 20.9998 11.4002C20.9998 10.9247 20.9673 10.4572 20.9047 10.0002" stroke="currentColor" stroke-linecap="round"/>
                    <path d="M11.9998 13.0002L11.9998 3.0002M11.9998 13.0002C11.2995 13.0002 9.99129 11.0059 9.49976 10.5002M11.9998 13.0002C12.7 13.0002 14.0082 11.0059 14.4998 10.5002" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </a>
        {/if}

        <div class="profile-icon-container">
            <a href="/settings" class="tab-link profile-icon" class:active={$activeTab === 'notebooks' || $activeTab === 'settings'} data-tab="settings" role="button" aria-label="Profile and Settings" onclick={(e) => setTab("settings", e)}>
                <HugeIcon name="settings-01" id="settings-icon" size="24" />
                <img id="profile-image" src="/assets/img/default-avatar.svg" style="display: none;" alt="Profile Picture">
            </a>

            <div id="profile-dropdown-backdrop" class="profile-dropdown-backdrop"></div>

            <div id="profile-dropdown" class="profile-dropdown" role="menu" aria-hidden="true">
                <div id="profile-menu-item" class="dropdown-item" role="menuitem" tabindex="-1" onclick={(e) => {
                    if (!e.currentTarget.classList.contains('has-submenu')) {
                        e.preventDefault();
                        window.location.href = getLoginUrl();
                    }
                }}>
                    <HugeIcon name="user" class="dropdown-icon" />
                    <span id="profile-item-text">Account</span>
                    <HugeIcon name="arrow-right-01" class="submenu-chevron" id="profile-chevron" />
                    <div class="dropdown-submenu" id="profile-submenu">
                        <div class="dropdown-item submenu-back-btn mobile-only">
                            <HugeIcon name="arrow-left-01" class="dropdown-icon" />
                            <span>Back</span>
                        </div>
                        <a href={getOverviewUrl()} rel="external" class="dropdown-item">
                            <HugeIcon name="user-circle" class="dropdown-icon" />
                            <span>Profile</span>
                        </a>
                        <a href="#" class="dropdown-item" id="logout-btn" onclick={(e) => { e.preventDefault(); if (window.handleLogout) window.handleLogout(); }}>
                            <HugeIcon name="logout" class="dropdown-icon" />
                            <span>Log Out</span>
                        </a>
                    </div>
                </div>

                <div class="dropdown-item has-submenu" role="menuitem" tabindex="-1">
                    <HugeIcon name="bookmark-02" class="dropdown-icon" />
                    <span>Notebooks</span>
                    <HugeIcon name="arrow-right-01" class="submenu-chevron" />
                    <div class="dropdown-submenu" role="menu" aria-hidden="true">
                        <div class="dropdown-item submenu-back-btn mobile-only">
                            <HugeIcon name="arrow-left-01" class="dropdown-icon" />
                            <span>Back</span>
                        </div>
                        <a href="#notebook" class="dropdown-item" onclick={(e) => { e.preventDefault(); if (window.createNewNotebook) window.createNewNotebook(true); if (typeof window !== 'undefined' && window.setProfileDropdownOpen) window.setProfileDropdownOpen(false); }}>
                            <HugeIcon name="plus-sign-circle" class="dropdown-icon" />
                            <span>Create</span>
                        </a>
                        <a href="/notebooks" class="dropdown-item tab-link" data-tab="notebooks" onclick={(e) => { setTab('notebooks', e); if (typeof window !== 'undefined' && window.setProfileDropdownOpen) window.setProfileDropdownOpen(false); }}>
                            <HugeIcon name="task-01" class="dropdown-icon" />
                            <span>Manage</span>
                        </a>
                    </div>
                </div>

                <div class="dropdown-item" data-action="downloads" role="menuitem" tabindex="-1" onclick={(e) => { setTab('downloads', e); if (typeof window !== 'undefined' && window.setProfileDropdownOpen) window.setProfileDropdownOpen(false); }}>
                    <HugeIcon name="folder-download" class="dropdown-icon" />
                    <span>Downloads</span>
                </div>

                <div class="dropdown-item" data-action="settings" role="menuitem" tabindex="-1" onclick={(e) => { setTab('settings', e); if (typeof window !== 'undefined' && window.setProfileDropdownOpen) window.setProfileDropdownOpen(false); }}>
                    <HugeIcon name="settings-01" class="dropdown-icon" />
                    <span>Settings</span>
                </div>
            </div>
        </div>
    </div>
</nav>
