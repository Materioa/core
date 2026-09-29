<script>
    import { onMount, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { themeStore, actualThemeStore } from '$lib/stores.js';
    import { initTheme, getCookie, setCookie, resolveActualMode } from '$lib/theme-engine.js';

    // Immediately run theme initialization if in browser
    if (typeof document !== 'undefined') {
        initTheme();
    }

    let currentTheme = 'system';
    let currentAccent = '#ff8200';
    let smartDarkInterval = null;
    let mediaQueryList = null;
    let mediaQueryListener = null;

    // Accent palette shared with the Settings accent picker. Applying the
    // hex here (not just a body class) drives --color-primary,
    // --color-primary-alt and --accent, so navbar dots, the notification
    // badge and every icon/button using those vars follow the accent.
    const ACCENT_HEX = {
        default: '#ff8400',
        orange: '#ff8400',
        yellow: '#eab308',
        green: '#22c55e',
        teal: '#14b8a6',
        blue: '#3b82f6',
        pink: '#ec4899',
        purple: '#8b5cf6',
        lilac: '#a78bfa',
        grey: '#6b7280'
    };

    $: if (typeof document !== 'undefined' && $page) {
        const isHome = $page.url.pathname === '/';
        document.body.classList.toggle('home-tab-active', isHome);
        document.body.classList.toggle('blog-layout', !isHome);
    }

    // Smart dark mode time range (19:00 to 6:45)
    const SMART_DARK_START_HOUR = 19;
    const SMART_DARK_START_MINUTE = 0;
    const SMART_DARK_END_HOUR = 6;
    const SMART_DARK_END_MINUTE = 45;

    // Element IDs from parent theme.js
    const THEME_ELEMENT_IDS = [
        'themeCard', 'bgToggleCard', 'popup', 'versionInfo', 'reading',
        'notices', 'notificationBoard', 'advanced', 'about', 'cookiesToggleCard',
        'paperModeCard', 'grainSizeControl', 'creatorInfo', 'licensesCard',
        'miscCard', 'account', 'oiaa', 'gh', 'nightReadingCard', 'einkModeCard',
        'tabSwitcherCard', 'blogs', 'blogPost1', 'blogPost2', 'blogPost3',
        'blogPost4', 'blogPost5', 'recommendedPosts', 'recommendedPost1',
        'recommendedPost2', 'recommendedPost3', 'recommendedPost4',
        'recommendedPost5', 'wallpaperSelectionCard', 'getinsights',
        'storageInfoCard', 'localCdnCard', 'serverTerminal', 'invertMode',
        'clearSiteDataCard', 'hapticToggleCard', 'notificationsToggleCard'
    ];


    function resolveSystemTheme() {
        // Pure light mode cookie overrides system/smart dark mode
        if (getCookie('pureLightMode') === 'true') return 'light';

        if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }

        const now = new Date();
        const current = now.getHours() * 60 + now.getMinutes();
        const start = SMART_DARK_START_HOUR * 60 + SMART_DARK_START_MINUTE;
        const end = SMART_DARK_END_HOUR * 60 + SMART_DARK_END_MINUTE;

        if (current >= start || current < end) return 'dark';
        return 'light';
    }

    function updateThemeColor(actualMode) {
        if (typeof document === 'undefined') return;
        const metaThemeColor = document.querySelector('meta[name=theme-color]');
        if (!metaThemeColor) return;

        if (actualMode === 'dark' || actualMode === 'coffee-dark' || actualMode === 'amoled') {
            metaThemeColor.setAttribute('content', actualMode === 'coffee-dark' ? '#1c1510' : '#121212');
        } else if (actualMode === 'coffee') {
            metaThemeColor.setAttribute('content', '#fdf6e3');
        } else {
            metaThemeColor.setAttribute('content', '#faf9f5');
        }
    }

    function updateDropdownUI(mode) {
        if (typeof document === 'undefined') return;
        const currentText = document.getElementById('currentThemeText');
        const currentIcon = document.getElementById('currentThemeIcon');

        if (currentText) {
            const labels = { system: 'System', light: 'Light', dark: 'Dark', coffee: 'Coffee', amoled: 'AMOLED' };
            currentText.textContent = labels[mode] || 'System';
        }

        if (currentIcon) {
            let svgHtml = '';
            if (mode === 'system') {
                svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 21H16M14 21C13.1716 21 12.5 20.3284 12.5 19.5V17L12 17M14 21H10M10 21H8M10 21C10.8284 21 11.5 20.3284 11.5 19.5V17L12 17M12 17V21"></path>
                    <path d="M16 3H8C5.17157 3 3.75736 3 2.87868 3.87868C2 4.75736 2 6.17157 2 9V11C2 13.8284 2 15.2426 2.87868 16.1213C3.75736 17 5.17157 17 8 17H16C18.8284 17 20.2426 17 21.1213 16.1213C22 15.2426 22 13.8284 22 11V9C22 6.17157 22 4.75736 21.1213 3.87868C20.2426 3 18.8284 3 16 3Z"></path>
                </svg>`;
            } else if (mode === 'light') {
                svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" color="currentColor" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12Z"></path>
                    <path d="M12 2V3.5M12 20.5V22M19.0708 19.0713L18.0101 18.0106M5.98926 5.98926L4.9286 4.9286M22 12H20.5M3.5 12H2M19.0713 4.92871L18.0106 5.98937M5.98975 18.0107L4.92909 19.0714" stroke-linecap="round"></path>
                </svg>`;
            } else if (mode === 'dark' || mode === 'amoled') {
                svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.5 14.0784C20.3003 14.7189 18.9301 15.0821 17.4751 15.0821C12.7491 15.0821 8.91792 11.2509 8.91792 6.52485C8.91792 5.06986 9.28105 3.69968 9.92163 2.5C5.66765 3.49698 2.5 7.31513 2.5 11.8731C2.5 17.1899 6.8101 21.5 12.1269 21.5C16.6849 21.5 20.503 18.3324 21.5 14.0784Z"></path>
                </svg>`;
            } else if (mode === 'coffee') {
                svgHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M18.2505 10.5H19.6403C21.4918 10.5 22.0421 10.7655 21.9975 12.0838C21.9237 14.2674 20.939 16.8047 17 17.5"></path>
                    <path d="M5.94627 20.6145C2.57185 18.02 2.07468 14.3401 2.00143 10.5001C1.96979 8.8413 2.45126 8.5 4.65919 8.5H15.3408C17.5487 8.5 18.0302 8.8413 17.9986 10.5001C17.9253 14.3401 17.4281 18.02 14.0537 20.6145C13.0934 21.3528 12.2831 21.5 10.9194 21.5H9.08064C7.71686 21.5 6.90658 21.3528 5.94627 20.6145Z"></path>
                    <path d="M11.3089 2.5C10.7622 2.83861 10.0012 4 10.0012 5.5M7.53971 4C7.53971 4 7 4.5 7 5.5M14.0012 4C13.7279 4.1693 13.5 5 13.5 5.5" stroke-linejoin="round"></path>
                </svg>`;
            }
            currentIcon.innerHTML = svgHtml;
            currentIcon.style.color = 'var(--color-primary)';
        }

        document.querySelectorAll('#themeDropdown .theme-dropdown-item').forEach(item => {
            if (item.dataset.theme === mode) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    function updateSmartDarkModeStatus(mode) {
        if (typeof document === 'undefined') return;
        const statusEl = document.getElementById('smartDarkModeStatus');
        if (!statusEl) return;

        if (mode === 'system') {
            statusEl.textContent = 'Changes with the daylight';
        } else if (mode === 'dark') {
            statusEl.textContent = 'After hours';
        } else if (mode === 'light') {
            statusEl.textContent = 'The morning brews';
        } else if (mode === 'coffee') {
            const isCoffeeDark = getCookie('coffeeDarkMode') === 'true';
            statusEl.textContent = isCoffeeDark ? 'Pure and concentrated espresso' : 'Smooth and creamy latte';
        }
    }

    function updateSubTogglesVisibility(mode) {
        if (typeof document === 'undefined') return;
        const pureLightEl = document.getElementById('pureLightModeOptions');
        if (pureLightEl) {
            pureLightEl.style.display = (mode === 'system' || mode === 'light') ? 'flex' : 'none';
        }
    }

    function applyThemeModeClass(actualMode) {
        if (typeof document === 'undefined') return;

        const elements = [
            document.documentElement,
            document.body,
            document.querySelector('header'),
            document.querySelector('.navbar'),
            document.querySelector('.content'),
            ...THEME_ELEMENT_IDS.map(id => document.getElementById(id))
        ];

        const notifyCards = document.querySelectorAll('#notify');
        notifyCards.forEach(card => elements.push(card));

        const isDark = (actualMode === 'dark' || actualMode === 'coffee-dark' || actualMode === 'amoled');

        elements.forEach(el => {
            if (el) {
                el.classList.remove('dark-mode', 'light-mode', 'coffee-mode', 'coffee-dark-mode', 'amoled-mode');
                if (actualMode === 'dark') el.classList.add('dark-mode');
                if (actualMode === 'light') el.classList.add('light-mode');
                if (actualMode === 'coffee') el.classList.add('coffee-mode');
                if (actualMode === 'coffee-dark') {
                    el.classList.add('coffee-dark-mode');
                    el.classList.add('dark-mode');
                }
                if (actualMode === 'amoled') {
                    el.classList.add('dark-mode');
                    el.classList.add('amoled-mode');
                }
            }
        });

        // Sync with Giscus iframe
        const giscusFrame = document.querySelector('iframe.giscus-frame');
        if (giscusFrame?.contentWindow) {
            const giscusDarkTheme = `${window.location.origin}/assets/style/giscus.css`;
            try {
                giscusFrame.contentWindow.postMessage({
                    giscus: {
                        setConfig: {
                            theme: isDark ? giscusDarkTheme : 'noborder_light'
                        }
                    }
                }, 'https://giscus.app');
            } catch {}
        }

        // Sync with PDF iframe
        const pdfIframe = document.getElementById('pdf-iframe');
        if (pdfIframe?.contentWindow) {
            try {
                pdfIframe.contentWindow.postMessage({
                    type: 'themeMode',
                    isDark: isDark,
                    actualMode: actualMode
                }, '*');
            } catch (e) {}
        }

        updateThemeColor(actualMode);
    }

    function applyThemeBasedOnConditions() {
        if (typeof document === 'undefined') return;

        let mode = getCookie('theme') || 'system';

        // Handle old boolean cookies
        if (mode === 'true' || mode === 'false') {
            mode = mode === 'true' ? 'dark' : 'light';
            setCookie('theme', mode, 365);
        }

        let actualMode = mode;
        if (mode === 'system') {
            actualMode = resolveSystemTheme();
        }

        if (mode === 'light' && getCookie('pureLightMode') === 'true') {
            actualMode = 'light';
        }

        if (actualMode === 'coffee') {
            const isCoffeeDark = getCookie('coffeeDarkMode') === 'true';
            if (isCoffeeDark) {
                actualMode = 'coffee-dark';
            }
        }

        applyThemeModeClass(actualMode);
        actualThemeStore.set(actualMode);

        updateSmartDarkModeStatus(mode);
        updateDropdownUI(mode);
        updateSubTogglesVisibility(mode);
    }

    function cycleTheme() {
        const theme = getCookie('theme') || 'system';
        const isCoffeeDark = getCookie('coffeeDarkMode') === 'true';

        let nextTheme = 'system';
        let nextCoffeeDark = isCoffeeDark;

        if (theme === 'system') {
            nextTheme = 'light';
        } else if (theme === 'light') {
            nextTheme = 'dark';
        } else if (theme === 'dark') {
            nextTheme = 'coffee';
            nextCoffeeDark = false; // Latte first
        } else if (theme === 'coffee') {
            if (!isCoffeeDark) {
                nextTheme = 'coffee';
                nextCoffeeDark = true; // Espresso next
            } else {
                nextTheme = 'system';
            }
        }

        setCookie('theme', nextTheme, 365);
        setCookie('coffeeDarkMode', nextCoffeeDark ? 'true' : 'false', 365);

        const coffeeDarkToggle = document.getElementById('coffeeDarkModeToggle');
        if (coffeeDarkToggle) {
            coffeeDarkToggle.checked = nextCoffeeDark;
        }

        themeStore.set(nextTheme);
        applyThemeBasedOnConditions();

        if (typeof window !== 'undefined' && window.MaterioHaptics) {
            window.MaterioHaptics.vibrate('tap');
        }
    }

    function applyAccent(color) {
        currentAccent = color;
        if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty('--color-primary', color);
            document.documentElement.style.setProperty('--color-primary-alt', color);
            document.documentElement.style.setProperty('--accent', color);
            try {
                localStorage.setItem('materio_accent_color', color);
            } catch {}
        }
    }

    function applyAccentKey(key) {
        const hex = ACCENT_HEX[key] || ACCENT_HEX.default;
        applyAccent(hex);
    }

    onMount(() => {
        if (typeof window !== 'undefined') {
            window.cycleTheme = cycleTheme;
            window.applyThemeBasedOnConditions = applyThemeBasedOnConditions;
            window.resolveSystemTheme = resolveSystemTheme;
            window.__materioApplyAccent = applyAccentKey;

            // Read initial theme cookie / localStorage
            const savedTheme = getCookie('theme') || 'system';
            currentTheme = savedTheme;
            themeStore.set(savedTheme);

            const savedAccent = localStorage.getItem('materio_accent_color');
            if (savedAccent) {
                currentAccent = savedAccent;
                applyAccent(savedAccent);
            } else {
                // Settings stores the picker choice as the `accentColor`
                // cookie (e.g. "blue"); map it to hex so dots, icons and
                // buttons follow the chosen accent on every load.
                const savedAccentKey = getCookie('accentColor');
                if (savedAccentKey && savedAccentKey !== 'default') {
                    applyAccentKey(savedAccentKey);
                }
            }

            // Apply immediately on mount
            applyThemeBasedOnConditions();

            // Set up system theme change listener (matches prefers-color-scheme)
            if (window.matchMedia) {
                mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
                mediaQueryListener = () => {
                    const mode = getCookie('theme') || 'system';
                    if (mode === 'system') {
                        applyThemeBasedOnConditions();
                    }
                };
                mediaQueryList.addEventListener('change', mediaQueryListener);
            }

            // Start smart dark mode interval (60s)
            smartDarkInterval = setInterval(() => {
                const mode = getCookie('theme') || 'system';
                if (mode === 'system') {
                    applyThemeBasedOnConditions();
                }
            }, 60000);
        }
    });

    onDestroy(() => {
        if (smartDarkInterval) clearInterval(smartDarkInterval);
        if (mediaQueryList && mediaQueryListener) {
            mediaQueryList.removeEventListener('change', mediaQueryListener);
        }
    });

    // When themeStore is updated from anywhere (SettingsTab, AdvancedDrawer, etc.)
    let isInitial = true;
    themeStore.subscribe(val => {
        if (!val) return;
        currentTheme = val;
        if (typeof document !== 'undefined') {
            if (!isInitial) {
                setCookie('theme', val, 365);
                applyThemeBasedOnConditions();
            }
            isInitial = false;
        }
    });
</script>
