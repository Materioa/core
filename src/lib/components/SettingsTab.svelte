<script>
    import { onMount } from 'svelte';
    import { themeStore } from '$lib/stores.js';
    import { browser } from '$app/environment';
    import { isTauri, isCapacitor, toApiUrl, isNative } from '$lib/config/api.js';
    import { HugeiconsIcon } from '@hugeicons/svelte';
    import { sfx } from '$lib/sounds/index.js';
    import {
        soundsEnabled,
        soundVolume,
        soundMaterial,
        MATERIALS,
        setSoundEnabled,
        setSoundVolume,
        setSoundMaterial
    } from '$lib/sounds/index.js';
    import { UploadCircle01Icon, McpServerIcon, Copy01Icon, CheckmarkCircle01Icon } from '@hugeicons/core-free-icons';

    let selectedTheme = 'system';
    let themeDropdownOpen = false;
    let accentDropdownOpen = false;
    let selectedAccent = 'default';
    let settingsSubTab = 'preferences'; // 'preferences' | 'about-app'

    // Redirects / Landing preferences
    import { getAppStart as getLandingAppStart, setAppStart as setLandingAppStart, getSkipLanding as getLandingSkip, setSkipLanding as setLandingSkip } from '$lib/utils/landingPrefs.js';
    let redirectStart = 'root'; // 'root' | 'home'
    let redirectSkip = false;
    let redirectDropdownOpen = false;

    // Reading mode toggles
    let invertMode = false;
    let paperMode = false;
    let nightMode = false;
    let einkMode = false;
    let wallpaperEnabled = true;
    let hapticEnabled = true;
    let insightroomFeed = true;
    let cookiesAccepted = false;
    let notificationsEnabled = true;
    let soundMaterialDropdownOpen = false;

    let selectedWallpaper = 'dynamic';
    let showWallpaperStore = false;
    let showSereineModal = false;
    let sereineFrequency = 'everytime';
    let currentSereineImageUrl = 'https://sereine.vercel.app/api/wallpapers/random?fallback=true';
    let sereineArtistName = '';
    let sereineShuffling = false;
    let sereineLiked = false;
    let sereineLikedTimer = null;
    let insightroomView = 'normal';
    let viewStyleDropdownOpen = false;
    if (browser) {
        const m1 = document.cookie.match(new RegExp('(^| )selectedWallpaper=([^;]+)'));
        selectedWallpaper = m1 ? m1[2] : 'dynamic';
        try {
            const raw = document.cookie.match(new RegExp('(^| )insightroomSettings=([^;]+)'));
            if (raw) {
                // Tolerate legacy double-encoded cookies (written before the
                // single-encode fix) so old choices survive the migration.
                let parsed = null;
                try { parsed = JSON.parse(decodeURIComponent(raw[2])); } catch {}
                if (!parsed) {
                    try { parsed = JSON.parse(decodeURIComponent(decodeURIComponent(raw[2]))); } catch {}
                }
                if (Array.isArray(parsed)) {
                    insightroomFeed = !!parsed[0];
                    insightroomView = parsed[1] || 'normal';
                } else {
                    throw new Error('unreadable insightroom settings');
                }
            } else {
                const legacy = document.cookie.match(new RegExp('(^| )insightroomFeed=([^;]+)'));
                if (legacy) insightroomFeed = legacy[2] === 'true';
            }
        } catch {}
    }

    function getCookie(name){
        if(!browser) return null;
        const m=document.cookie.match(new RegExp('(^| )'+name+'=([^;]+)'));
        if (m) return decodeURIComponent(m[2]);
        try { return localStorage.getItem(name); } catch { return null; }
    }
    import { getLoginUrl, getOverviewUrl } from '$lib/utils/app-urls.js';

    let isLoggedIn = false;
    let loginUrl = getLoginUrl();
    let overviewUrl = getOverviewUrl();

    let releaseVersion = '';
    let releaseBuild = '';
    let releaseLogs = [];
    let loadingReleases = false;
    let liveBuildId = typeof __MATERIO_BUILD_ID__ !== 'undefined' ? __MATERIO_BUILD_ID__ : 'b4e216ad-fa9d-40c8-ac8c-f835f93cffd0';

    function getCurrentBranch() {
        if (!browser) return 'stable';
        const url = window.location.href;
        if (url.includes('/channels/')) return 'channels';
        if (url.includes('/labs')) return 'labs';
        return 'stable';
    }

    async function loadReleases() {
        loadingReleases = true;
        try {
            // Two API candidates only. The old third fallback — the committed
            // /assets/data/releases.json — was a stale snapshot that revived
            // dead releases when Mongo was slow. Mongo or nothing.
            let res = await fetch(toApiUrl('/api/v2/releases'));
            if (!res.ok) {
                res = await fetch(toApiUrl('/api/v2/features?action=releases'));
            }
            if (res.ok) {
                const releases = await res.json();
                const branch = getCurrentBranch();
                const found = Array.isArray(releases)
                    ? (releases.find(r => (r.branch || 'stable').toLowerCase() === branch) || releases[0])
                    : null;
                if (found) {
                    releaseVersion = found.version || '';
                    releaseBuild = found.build || '';
                    releaseLogs = Array.isArray(found.logs) ? found.logs : (found.logs ? [found.logs] : []);
                }
            }
        } catch (err) {
            console.warn('Error loading releases:', err);
        } finally {
            loadingReleases = false;
        }
    }

    onMount(async () => {
        const { init: initProfile, updateVersionInfo, updateAccountCard } = await import('$lib/utils/profile-image.js');
        const refreshAccountState = () => {
            loginUrl = getLoginUrl();
            overviewUrl = getOverviewUrl();
            if (typeof localStorage !== 'undefined') {
                isLoggedIn = !!(localStorage.getItem('token') || localStorage.getItem('materio_auth_token'));
            }
            const accountImg = document.getElementById('account-profile-image');
            const accountName = document.getElementById('account-name');
            const accountUsername = document.getElementById('account-username');
            updateAccountCard(accountImg, accountName, accountUsername);
            updateVersionInfo();
        };

        refreshAccountState();
        loadReleases();

        // Check Local MCP Server status if on desktop
        if (isTauri) {
            checkMcpStatus();
        }

        window.addEventListener('auth:login', refreshAccountState);
        window.addEventListener('auth:logout', refreshAccountState);

        return () => {
            window.removeEventListener('auth:login', refreshAccountState);
            window.removeEventListener('auth:logout', refreshAccountState);
        };
    });

    // ── Local MCP Server State & Actions (Desktop / Tauri) ──
    let mcpRunning = false;
    let mcpLoading = false;
    let copiedMcp = false;
    let mcpError = '';

    async function checkMcpStatus() {
        if (!browser) return;
        if (isTauri && window.__TAURI__?.core?.invoke) {
            try {
                const status = await window.__TAURI__.core.invoke('get_mcp_status');
                mcpRunning = !!status;
                return;
            } catch (e) {
                console.warn('Tauri get_mcp_status error:', e);
            }
        }
        try {
            const res = await fetch('http://localhost:3000/health', { method: 'GET' });
            mcpRunning = res.ok;
        } catch {
            mcpRunning = false;
        }
    }

    async function toggleMcpServer() {
        mcpLoading = true;
        mcpError = '';
        try {
            if (isTauri && window.__TAURI__?.core?.invoke) {
                if (mcpRunning) {
                    await window.__TAURI__.core.invoke('stop_mcp_server');
                    mcpRunning = false;
                } else {
                    await window.__TAURI__.core.invoke('start_mcp_server');
                    await new Promise(r => setTimeout(r, 1200));
                    await checkMcpStatus();
                }
            } else {
                mcpRunning = !mcpRunning;
            }
        } catch (err) {
            console.error('Failed to toggle MCP server:', err);
            mcpError = String(err?.message || err);
        } finally {
            mcpLoading = false;
        }
    }

    function copyMcpUrl() {
        if (!browser) return;
        navigator.clipboard.writeText('http://localhost:3000/mcp');
        copiedMcp = true;
        setTimeout(() => { copiedMcp = false; }, 2000);
    }

    // ── App Updates & Native Toast Handler (Desktop & Android) ──
    const currentAppVersion = (typeof __MATERIO_APP_VERSION__ !== 'undefined' ? __MATERIO_APP_VERSION__ : '2.1.14').replace(/^v/, '');
    let checkingAppUpdate = false;

    // Toasts are the app's lightest-weight notification, so they stay subtle
    // — native Android toasts are visual-only and this is the audio counterpart.
    function playToastCue(kind) {
        if (kind === 'error') sfx('error', { emphasis: 'subtle' });
        else if (kind === 'warning') sfx('warning', { emphasis: 'subtle' });
        else if (kind === 'success') sfx('success', { emphasis: 'subtle' });
        else sfx('ready', { emphasis: 'subtle' });
    }

    function showToastMessage(msg, kind = 'info') {
        if (!browser) return;
        playToastCue(kind);
        // 1. Android native bridge toast
        if (window.AndroidBridge?.showToast) {
            window.AndroidBridge.showToast(msg);
            return;
        }
        // 2. Capacitor Toast plugin if available
        if (window.Capacitor?.Plugins?.Toast?.show) {
            window.Capacitor.Plugins.Toast.show({ text: msg, duration: 'short' });
            return;
        }
        // 3. Fallback transient in-app toast
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f1f1f;color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-family:sans-serif;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3);transition:opacity 0.3s;opacity:1;';
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    async function checkAppUpdate(isManual = true) {
        if (!browser) return;
        checkingAppUpdate = true;
        if (isManual) {
            showToastMessage('Checking for updates…');
        }

        try {
            const res = await fetch(toApiUrl(`/api/releases/latest?t=${Date.now()}`));
            if (res.ok) {
                const data = await res.json();

                // ── Desktop is platform-INDEPENDENT ──────────────────────
                // A GH tag can ship an APK but no Windows asset (or the
                // reverse). Desktop availability is decided by data.windows,
                // so never run the desktop verdict through Android gates —
                // that made a Windows-only release invisible to Windows and
                // left desktop users stuck when an Android-only tag landed.
                if (isTauri) {
                    const winInfo = data.windows || {};
                    if (!isManual) return;
                    if (typeof window.__materioCheckUpdateModal !== 'function') {
                        showToastMessage('Update check is unavailable in this build.', 'warning');
                        return;
                    }
                    try {
                        // Time-boxed: the desktop checker can otherwise never
                        // settle and the "Checking for updates…" toast sticks.
                        const verdict = await Promise.race([
                            Promise.resolve().then(() => window.__materioCheckUpdateModal()),
                            new Promise((r) => setTimeout(() => r(null), 8000))
                        ]);
                        if (!verdict) {
                            showToastMessage('Update check timed out. Try again shortly.', 'warning');
                        } else if (verdict.status === 'update') {
                            showToastMessage(`Update available: v${String(verdict.remote || '').replace(/^v/, '')} (installed v${verdict.local})`);
                        } else if (verdict.status === 'current') {
                            const noWin = !winInfo.downloadUrl;
                            showToastMessage(noWin
                                ? `You have the latest Windows build (v${verdict.local}). No newer Windows download is published yet.`
                                : `You are on the latest version (v${verdict.local})!`);
                        } else {
                            showToastMessage(`Could not reach update server${verdict.error ? ': ' + verdict.error : '.'}`);
                        }
                    } catch {
                        showToastMessage('Could not check for updates.', 'error');
                    }
                    return;
                }

                // ── Android / web path ────────────────────────────────────
                // Platform-aware: the latest GH tag may not ship an APK
                // (e.g. a Windows-only release). Only offer an Android update
                // when this release actually contains an APK asset — otherwise
                // we'd download a 404 HTML page and the installer reports
                // "package invalid".
                const androidInfo = data.android || {};
                const apkAvailable = androidInfo.available !== false && Boolean(androidInfo.downloadUrl);
                const remoteVer = ((apkAvailable ? (androidInfo.version || data.version) : data.version) || '').replace(/^v/, '');
                const localVer = currentAppVersion;

                const isNewer = (r, l) => {
                    const rParts = r.split('.').map(Number);
                    const lParts = l.split('.').map(Number);
                    for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
                        if ((rParts[i] || 0) > (lParts[i] || 0)) return true;
                        if ((rParts[i] || 0) < (lParts[i] || 0)) return false;
                    }
                    return false;
                };

                if (!apkAvailable) {
                    if (isManual) {
                        showToastMessage('You are on the latest version!', 'success');
                    }
                    return;
                }

                if (isNewer(remoteVer, localVer)) {
                    const rawApkUrl = androidInfo.downloadUrl;
                    // Validate: must be an https URL ending in .apk, else we'd
                    // save an error page as .apk ("package invalid").
                    const apkUrlOk = typeof rawApkUrl === 'string'
                        && rawApkUrl.startsWith('https://')
                        && rawApkUrl.split('?')[0].toLowerCase().endsWith('.apk');
                    if (!apkUrlOk) {
                        if (isManual) showToastMessage('Update not published for Android yet.', 'warning');
                        return;
                    }
                    // If the update nudge card is already showing (or was
                    // shown), stay quiet on auto checks — the card is the
                    // prompt. Manual checks always report.
                    let nudgeShown = false;
                    try { nudgeShown = window.__materioUpdateNudgeShown === true; } catch {}
                    if (!isManual && nudgeShown) return;
                    showToastMessage(`Version ${data.version} is available!`);

                    const apkUrl = rawApkUrl;
                    if (window.AndroidBridge?.sendNotification) {
                        window.AndroidBridge.sendNotification('Materio Update Available', `Version ${data.version} is ready to download.`, apkUrl);
                    } else if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification('Materio Update Available', {
                            body: `Version ${data.version} is ready to download.`,
                            icon: '/assets/img/app.png'
                        });
                    }

                    if (isManual && isCapacitor) {
                        // In-app self-update: system downloads the APK and the
                        // package installer replaces this install in place
                        // (one system confirmation tap, data preserved).
                        if (window.AndroidBridge?.downloadAndInstallUpdate) {
                            window.AndroidBridge.downloadAndInstallUpdate(apkUrl, data.version || '');
                        } else {
                            window.open(apkUrl, '_system');
                        }
                    }
                    // Desktop returns early above; it must never reach this
                    // Android-gated block.
                } else {
                    if (isManual) {
                        showToastMessage('You are on the latest version!', 'success');
                    }
                }
            } else {
                if (isManual) {
                    showToastMessage('Could not reach update server.', 'error');
                }
            }
        } catch (e) {
            console.error('Update check failed:', e);
            if (isManual) {
                showToastMessage('Failed to check for updates.', 'error');
            }
        } finally {
            checkingAppUpdate = false;
        }
    }

    function setCookie(name,val){
        if(!browser) return;
        document.cookie= encodeURIComponent(name)+'='+encodeURIComponent(val)+'; Max-Age=31536000; Path=/; SameSite=Lax';
        try { localStorage.setItem(name, String(val)); } catch {}
    }

    function selectWallpaper(type) {
        selectedWallpaper = type;
        if (browser) {
            wallpaperEnabled = true;
            setCookie('enableBg', 'true');
            setCookie('wallpaperEnabled', 'true');
            setCookie('selectedWallpaper', type);
            window.dispatchEvent(new CustomEvent('materioWallpaperChange', { 
                detail: { 
                    enabled: true, 
                    wallpaperType: type 
                } 
            }));
        }
    }
    function handleCustomWallpaperInput(e){
        const file=e.target.files?.[0]; if(!file) return;
        const reader=new FileReader();
        reader.onload=()=>{ 
            const url=reader.result; 
            localStorage.setItem('materio_custom_wallpaper', url); 
            selectWallpaper('custom');
        };
        reader.readAsDataURL(file);
    }
    function removeCustomWallpaper(){
        localStorage.removeItem('materio_custom_wallpaper');
        selectWallpaper('dynamic');
    }
    function saveInsightroomSettings(enabled, view){
        insightroomFeed = enabled; 
        insightroomView = view;
        // setCookie encodes once — pass raw JSON (double-encoding used to
        // make the cookie unreadable after refresh, hiding the feed).
        setCookie('insightroomSettings', JSON.stringify([enabled, view]));
        applyInsightroomViewMode(enabled, view);
        if (browser) {
            window.dispatchEvent(new CustomEvent('materioInsightroomChange', {
                detail: { enabled, viewMode: view }
            }));
        }
    }
    function applyInsightroomViewMode(enabled, viewMode){
        const blogs = document.getElementById('blogs');
        const headerContainer = document.getElementById('blogHeaderContainer');
        const postsContainer = document.getElementById('blogPostsContent');
        const chevron = document.getElementById('blogFoldChevron');

        if (!blogs) return;

        if (!enabled) {
            blogs.style.display = 'none';
            return;
        }

        blogs.style.display = 'block';

        if (viewMode === 'folded') {
            blogs.classList.add('blog-folded');
            blogs.classList.remove('blog-expanded');
            if (chevron) {
                chevron.style.display = 'inline-block';
                chevron.style.transform = 'rotate(0deg)';
            }
            if (headerContainer) {
                headerContainer.style.cursor = 'pointer';
            }
            if (postsContainer) {
                postsContainer.style.display = 'none';
            }
        } else {
            blogs.classList.remove('blog-folded');
            blogs.classList.remove('blog-expanded');
            if (chevron) {
                chevron.style.display = 'none';
            }
            if (headerContainer) {
                headerContainer.style.cursor = 'default';
            }
            if (postsContainer) {
                postsContainer.style.display = 'block';
            }
        }
    }

    function setSereineFrequency(freq) {
        sereineFrequency = freq;
        if (browser) {
            localStorage.setItem('materio_sereine_frequency', freq);
            if (freq === 'random') {
                localStorage.setItem('materio_sereine_next_random', '0');
            } else if (freq === 'everytime') {
                localStorage.setItem('materio_sereine_last_fetch', '0');
                sessionStorage.removeItem('materio_sereine_session_fetch');
            }
        }
    }

    async function handleSereineShuffle() {
        sereineShuffling = true;
        setTimeout(() => { sereineShuffling = false; }, 500);

        if (browser && window.MaterioHaptics) {
            window.MaterioHaptics.vibrate('tick');
        }

        try {
            const res = await fetch('https://sereine.vercel.app/api/wallpapers/random');
            if (res.ok) {
                const data = await res.json();
                if (data && data.imageUrl) {
                    currentSereineImageUrl = data.imageUrl;
                    sereineArtistName = data.artistName || '';
                    if (browser) {
                        localStorage.setItem('materio_sereine_cache', JSON.stringify(data));
                        localStorage.setItem('materio_sereine_last_fetch', Date.now().toString());
                    }
                    const homeElem = document.getElementById('home');
                    if (homeElem && selectedWallpaper === 'sereine') {
                        homeElem.style.setProperty('--bg-img', `url('${currentSereineImageUrl}')`);
                    }
                    const sereinePreview = document.getElementById('sereinePreview');
                    if (sereinePreview) {
                        sereinePreview.style.backgroundImage = `url('${currentSereineImageUrl}')`;
                    }
                    const artistElem = document.getElementById('sereineArtistName');
                    if (artistElem) {
                        artistElem.textContent = sereineArtistName;
                    }
                }
            }
        } catch (e) {
            console.error('Failed to shuffle Sereine wallpaper:', e);
        }
    }

    function handleSereineSave() {
        if (browser && window.MaterioHaptics) {
            window.MaterioHaptics.vibrate('tick');
        }

        if (currentSereineImageUrl && browser) {
            try {
                const raw = localStorage.getItem('materio_custom_wallpaper_store') || '[]';
                let list = [];
                try { list = JSON.parse(raw); } catch {}
                const title = `Sereine - ${sereineArtistName || 'Curated'}`;
                const exists = list.some(item => item.dataUrl === currentSereineImageUrl);
                if (!exists) {
                    list.unshift({
                        id: `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                        name: title,
                        dataUrl: currentSereineImageUrl,
                        createdAt: Date.now()
                    });
                    if (list.length > 20) list = list.slice(0, 20);
                    localStorage.setItem('materio_custom_wallpaper_store', JSON.stringify(list));
                }
                localStorage.setItem('materio_custom_wallpaper', currentSereineImageUrl);
            } catch (err) {
                console.error('Failed to save to custom wallpapers:', err);
            }
        }

        sereineLiked = true;
        if (sereineLikedTimer) clearTimeout(sereineLikedTimer);
        sereineLikedTimer = setTimeout(() => {
            sereineLiked = false;
        }, 2000);
    }

    export let accentColors = [
        { id: 'default', name: 'Default', color: null },
        { id: 'lilac', name: 'Lilac', color: '#c8a2c8' },
        { id: 'purple', name: 'Purple', color: '#967bb6' },
        { id: 'blue', name: 'Blue', color: '#3f6bbd' },
        { id: 'teal', name: 'Teal', color: '#3ab49b' },
        { id: 'green', name: 'Green', color: '#257d2d' },
        { id: 'yellow', name: 'Yellow', color: '#f1b539' },
        { id: 'orange', name: 'Orange', color: '#ff6138' },
        { id: 'pink', name: 'Pink', color: '#f47272' },
        { id: 'grey', name: 'Grey', color: '#8a8d91' },
    ];

    function applyReadingToggles(){
        document.body.classList.toggle('invert-mode', invertMode);
        document.body.classList.toggle('paper-mode', paperMode);
        document.body.classList.toggle('night-mode', nightMode);
        document.body.classList.toggle('eink-mode', einkMode);
        const popup=document.getElementById('popup');
        if(popup){
            popup.classList.toggle('invert-mode', invertMode);
            popup.classList.toggle('paper-mode', paperMode);
            popup.classList.toggle('night-mode', nightMode);
            popup.classList.toggle('eink-mode', einkMode);
        }
        const home=document.getElementById('home');
        if(home){
            if (!wallpaperEnabled) {
                home.style.setProperty('--bg-img', 'none');
            }
        }
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('materioWallpaperChange', {
                detail: {
                    enabled: wallpaperEnabled,
                    wallpaperType: selectedWallpaper
                }
            }));
        }
        // haptics
        if (typeof localStorage!=='undefined') localStorage.setItem('materio_haptics_enabled', hapticEnabled ? 'true':'false');
        // cookies
        if (typeof document!=='undefined'){
            document.cookie=`invertMode=${invertMode ? 'true':'false'}; Max-Age=31536000; Path=/; SameSite=Lax`;
            document.cookie=`paperMode=${paperMode ? 'true':'false'}; Max-Age=31536000; Path=/; SameSite=Lax`;
            document.cookie=`nightMode=${nightMode ? 'true':'false'}; Max-Age=31536000; Path=/; SameSite=Lax`;
            document.cookie=`einkMode=${einkMode ? 'true':'false'}; Max-Age=31536000; Path=/; SameSite=Lax`;
            document.cookie=`enableBg=${wallpaperEnabled ? 'true':'false'}; Max-Age=31536000; Path=/; SameSite=Lax`;
            document.cookie=`wallpaperEnabled=${wallpaperEnabled ? 'true':'false'}; Max-Age=31536000; Path=/; SameSite=Lax`;
        }
        // notify pdf iframe
        const pdfIframe=document.getElementById('pdf-iframe');
        if(pdfIframe?.contentWindow){
            try{ pdfIframe.contentWindow.postMessage({type:'readingModes', invertMode, paperMode, nightMode, einkMode}, '*'); }catch{}
        }
    }
    $: if ($themeStore && selectedTheme !== $themeStore) selectedTheme = $themeStore;

    onMount(() => {
        if (typeof document !== 'undefined') {
            const saved = getCookie('theme');
            if (saved === 'light') selectedTheme = 'light';
            else if (saved === 'dark') selectedTheme = 'dark';
            else if (saved === 'coffee') selectedTheme = 'coffee';
            else selectedTheme = 'system';
            const savedAccent = getCookie('accentColor');
            if (savedAccent) { selectedAccent = savedAccent; setTimeout(()=> applyAccentColor(savedAccent), 50); }
            // load reading toggles
            invertMode = getCookie('invertMode')==='true';
            paperMode = getCookie('paperMode')==='true';
            nightMode = getCookie('nightMode')==='true';
            einkMode = getCookie('einkMode')==='true';
            const enableBgCookie = getCookie('enableBg');
            const we = getCookie('wallpaperEnabled');
            if (enableBgCookie !== null) wallpaperEnabled = enableBgCookie !== 'false';
            else if (we !== null) wallpaperEnabled = we !== 'false';
            else wallpaperEnabled = true;

            const he=localStorage.getItem('materio_haptics_enabled'); hapticEnabled = he===null ? true : he==='true';
            const ca=getCookie('cookiesAccepted'); cookiesAccepted = ca==='true';
            const ne=localStorage.getItem('notificationsEnabled'); notificationsEnabled = ne===null ? true : ne==='true';
            setTimeout(()=> { applyReadingToggles(); }, 50);
            setTimeout(()=> applyInsightroomViewMode(insightroomFeed, insightroomView), 100);

            window.applyInsightroomViewMode = applyInsightroomViewMode;
            window.getInsightroomSettings = () => [insightroomFeed, insightroomView];
            window.saveInsightroomSettings = saveInsightroomSettings;
            window.toggleInsightroomFeed = () => { const ne = !insightroomFeed; saveInsightroomSettings(ne, insightroomView); };
            window.toggleInsightroomView = () => { const nv = insightroomView==='normal' ? 'folded' : 'normal'; saveInsightroomSettings(insightroomFeed, nv); };
            // expose wallpaper helper for global shortcuts
            window.setWallpaperFromSettings = selectWallpaper;

            sereineFrequency = localStorage.getItem('materio_sereine_frequency') || 'everytime';
            const cachedSereine = localStorage.getItem('materio_sereine_cache');
            if (cachedSereine) {
                try {
                    const parsed = JSON.parse(cachedSereine);
                    if (parsed.imageUrl) currentSereineImageUrl = parsed.imageUrl;
                    if (parsed.artistName) sereineArtistName = parsed.artistName;
                } catch {}
            }
            // init redirects prefs
            try {
                redirectStart = getLandingAppStart();
                redirectSkip = getLandingSkip();
            } catch {}

            window.closeSereineWallpaperModal = () => { showSereineModal = false; };
            window.openSereineWallpaperModal = () => { showSereineModal = true; };

            // Auto check for updates on app launch for Android
            if (isCapacitor) {
                setTimeout(() => {
                    checkAppUpdate(false);
                }, 2500);
            }
        }

        const handleDocClick = (e) => {
            if (!e.target.closest('#themeModeSelector') && !e.target.closest('#themeDropdown')) themeDropdownOpen=false;
            if (!e.target.closest('#soundMaterialSelector') && !e.target.closest('#soundMaterialDropdown')) soundMaterialDropdownOpen=false;
            if (!e.target.closest('#accentColorSelector') && !e.target.closest('#accentDropdown')) accentDropdownOpen=false;
            if (!e.target.closest('#viewStyleDropdownWrapper')) viewStyleDropdownOpen=false;
            if (!e.target.closest('#redirectStartSelector') && !e.target.closest('#redirectStartDropdown')) redirectDropdownOpen=false;
            const pd=document.getElementById('paperTextureDropdown'); if (pd && !e.target.closest('#paperTextureDropdownWrapper') && !e.target.closest('#paperTextureDropdown')) pd.classList.remove('show');
        };
        const handleEsc = (e) => {
            if (e.key==='Escape'){
                if (showWallpaperStore) showWallpaperStore=false;
                if (showSereineModal) showSereineModal=false;
                themeDropdownOpen=false; accentDropdownOpen=false;
                soundMaterialDropdownOpen=false;
                viewStyleDropdownOpen=false;
                redirectDropdownOpen=false;
                const pd=document.getElementById('paperTextureDropdown'); if(pd) pd.classList.remove('show');
            }
        };
        document.addEventListener('click', handleDocClick);
        window.addEventListener('keydown', handleEsc);
        return ()=>{ document.removeEventListener('click', handleDocClick); window.removeEventListener('keydown', handleEsc); };
    });

    function cycleTheme(){
        window.cycleTheme?.();
    }
    function applyThemeBasedOnConditions(){
        window.applyThemeBasedOnConditions?.();
    }
    function setTheme(t) {
        selectedTheme = t;
        themeDropdownOpen = false;
        setCookie('theme', t);
        themeStore.set(t);
        window.applyThemeBasedOnConditions?.();
        if (window.MaterioHaptics) window.MaterioHaptics.vibrate('tap');
    }

    const ACCENT_COLORS=['default','orange','yellow','green','teal','blue','pink','purple','lilac','grey'];
    function applyAccentColor(colorKey){
        document.body.classList.remove('accent-orange','accent-yellow','accent-green','accent-teal','accent-blue','accent-pink','accent-purple','accent-lilac','accent-grey');
        if(colorKey!=='default') document.body.classList.add(`accent-${colorKey}`);
        try { window.__materioApplyAccent?.(colorKey); } catch {}
        const currentText=document.getElementById('currentAccentText');
        const currentDot=document.getElementById('currentAccentDot');
        const names={default:'Default', orange:'Orange', yellow:'Yellow', green:'Green', teal:'Teal', blue:'Blue', pink:'Pink', purple:'Purple', lilac:'Lilac', grey:'Grey'};
        if(currentText) currentText.textContent=names[colorKey]||'Default';
        if(currentDot) currentDot.style.backgroundColor='var(--color-primary)';
        document.querySelectorAll('.accent-dropdown-item').forEach(el=> el.classList.toggle('active', el.dataset.color===colorKey));
    }
    function setAccent(id) {
        selectedAccent = id;
        accentDropdownOpen = false;
        applyAccentColor(id);
        setCookie('accentColor', id);
        if (window.MaterioHaptics) window.MaterioHaptics.vibrate('tap');
    }

    function setRedirectStart(val) {
        redirectStart = val === 'home' ? 'home' : 'root';
        redirectDropdownOpen = false;
        try { setLandingAppStart(redirectStart); } catch {}
        if (window.MaterioHaptics) window.MaterioHaptics.vibrate('tap');
    }
    function toggleRedirectSkip(e) {
        redirectSkip = e.target.checked;
        try { setLandingSkip(redirectSkip); } catch {}
        if (window.MaterioHaptics) window.MaterioHaptics.vibrate('tap');
    }

    function switchSettingsTab(tab) {
        settingsSubTab = tab;
    }

    async function clearAllSiteData() {
        const confirmed = typeof window !== 'undefined' && window.materioConfirm
            ? await window.materioConfirm(
                "This will clear all site data including:\n\n• Cookies and local storage\n• Cached files\n• Your Downloaded files\n• Service workers\n\nYou will be logged out and all preferences will be reset.",
                {
                    title: "Clear All Data?",
                    type: "danger",
                    confirmText: "Clear All Data",
                    cancelText: "Cancel",
                    danger: true,
                }
            )
            : confirm("This will clear all site data including cookies, caches, and offline downloads. Continue?");

        if (!confirmed) return;

        try {
            if (typeof document !== 'undefined' && document.cookie) {
                document.cookie.split(";").forEach(function (c) {
                    const name = c.split("=")[0].trim();
                    document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
                    document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=" + window.location.hostname;
                });
            }
            if (typeof localStorage !== 'undefined') localStorage.clear();
            if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
            if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
                try {
                    const databases = await indexedDB.databases();
                    for (const db of databases) {
                        if (db.name) indexedDB.deleteDatabase(db.name);
                    }
                } catch {}
            }
            if (typeof navigator !== 'undefined' && "serviceWorker" in navigator) {
                try {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const reg of registrations) await reg.unregister();
                } catch {}
            }
            if (typeof caches !== 'undefined') {
                try {
                    const cacheNames = await caches.keys();
                    for (const name of cacheNames) await caches.delete(name);
                } catch {}
            }

            if (typeof window !== 'undefined' && window.materioAlert) {
                await window.materioAlert(
                    "All site data has been cleared successfully.\n\nThe page will now reload.",
                    {
                        title: "Data Cleared",
                        type: "success",
                        buttonText: "Reload",
                    }
                );
            } else {
                alert("All site data has been cleared successfully.");
            }
            if (typeof window !== 'undefined') location.reload();
        } catch (e) {
            console.error("Clear site data failed:", e);
        }
    }

    function getThemeLabel(t) {
        const map = { system: 'System', light: 'Light', dark: 'Dark', coffee: 'Coffee' };
        return map[t] || 'System';
    }
    import HugeIcon from '$lib/components/HugeIcon.svelte';
</script>

<!-- Matches _includes/main.html lines 971-1693 -->
<h1>Settings</h1>

<!-- Version -->
<div class="card-layout" id="versionInfo"></div>

<!-- Account -->
<div class="card-layout" id="account">
    <div class="account-card" on:click={() => { window.location.href = isLoggedIn ? getOverviewUrl() : getLoginUrl(); }} style="cursor: pointer;">
        <div class="account-info">
            <img id="account-profile-image" src="/assets/img/default-avatar.svg" alt="Profile"
                class="account-profile-pic" width="50" height="50">
            <div class="account-details">
                <p class="account-name" id="account-name">Log in to Materio Account</p>
                <p class="account-username" id="account-username"></p>
            </div>
        </div>
        <a href={isLoggedIn ? overviewUrl : loginUrl} rel="external" class="account-link" aria-label={isLoggedIn ? "Manage Account" : "Log In to Materio Account"} on:click|stopPropagation>
            <HugeIcon name="arrow-right-01"  />
        </a>
    </div>
</div>

<!-- Appearance & Customization Section -->
<div class="settings-group-header"
    style="display: flex; align-items: center; gap: 8px; margin: 24px 0 12px 4px; font-size: 15px; font-weight: 600; color: var(--color-text-primary); opacity: 0.9;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"
        color="var(--color-primary)" fill="none" stroke="currentColor" stroke-width="2"
        style="display: inline-block; vertical-align: middle;">
        <path d="M10 4C10 2.89543 10.8954 2 12 2H13C14.1046 2 15 2.89543 15 4V6.55337C15 7.86603 15.8534 9.02626 17.1065 9.41722L17.8935 9.66278C19.1466 10.0537 20 11.214 20 12.5266V14C20 14.5523 19.5523 15 19 15H6C5.44772 15 5 14.5523 5 14V12.5266C5 11.214 5.85339 10.0537 7.10648 9.66278L7.89352 9.41722C9.14661 9.02626 10 7.86603 10 6.55337V4Z"></path>
        <path d="M6.00217 15C6.15797 16.3082 5.4957 19.5132 4 21.8679C4 21.8679 14.2924 23.0594 15.6851 17.9434V19.8712C15.6851 20.8125 15.6851 21.2831 15.9783 21.5755C16.5421 22.1377 19.1891 22.1531 19.7538 21.5521C20.0504 21.2363 20.0207 20.7819 19.9611 19.8731C19.8629 18.3746 19.5932 16.4558 18.8523 15"
            stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    <span>Appearance & Customization</span>
</div>

<!-- Theme mode dropdown -->
<div class="card-layout" id="themeCard" style="overflow: visible;">
    <div class="toggle-container"
        style="position: relative; flex-direction: column; align-items: stretch; gap: 8px; overflow: visible;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; position: relative;">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Theme</div>
                <div class="paper-mode-description" id="smartDarkModeStatus">Changes with the daylight</div>
            </div>

            <div class="accent-color-selector" id="themeModeSelector" style="flex-shrink: 0;"
                on:click={() => { themeDropdownOpen = !themeDropdownOpen; }}>
                <span id="currentThemeText" style="font-size: 13px; font-weight: 500; margin-left: 4px;">{getThemeLabel(selectedTheme)}</span>
                <HugeIcon name="arrow-down-01"  style="font-size: 11px; margin-left: 4px; color: #666;" />
            </div>

            <!-- Theme Dropdown Menu -->
            <div id="themeDropdown" class="accent-dropdown" class:show={themeDropdownOpen}>
                <div class="theme-dropdown-item" class:active={selectedTheme === 'system'} data-theme="system" on:click={() => setTheme('system')}>
                    <div class="theme-dropdown-item-left">
                        <span>System</span>
                    </div>
                    <HugeIcon name="tick-01"  class="accent-check" />
                </div>
                <div class="theme-dropdown-item" class:active={selectedTheme === 'light'} data-theme="light" on:click={() => setTheme('light')}>
                    <div class="theme-dropdown-item-left">
                        <span>Light</span>
                    </div>
                    <HugeIcon name="tick-01"  class="accent-check" />
                </div>
                <div class="theme-dropdown-item" class:active={selectedTheme === 'dark'} data-theme="dark" on:click={() => setTheme('dark')}>
                    <div class="theme-dropdown-item-left">
                        <span>Dark</span>
                    </div>
                    <HugeIcon name="tick-01"  class="accent-check" />
                </div>
                <div class="theme-dropdown-item" class:active={selectedTheme === 'coffee'} data-theme="coffee" on:click={() => setTheme('coffee')}>
                    <div class="theme-dropdown-item-left">
                        <span>Coffee</span>
                    </div>
                    <div class="coffee-toggle-container" style="display:flex;align-items:center;margin-left:auto;" on:click|stopPropagation>
                        <label class="coffee-toggle-switch" title="Toggle dark espresso / light latte" style="position:relative;display:inline-block;width:28px;height:16px;margin-right:8px;">
                            <input type="checkbox" id="coffeeDarkModeToggle" checked={getCookie('coffeeDarkMode')==='true'} on:change={(e)=>{ const on = e.target.checked; setCookie('coffeeDarkMode', on?'true':'false'); if (on) setTheme('coffee'); else applyThemeBasedOnConditions(); }}>
                            <span class="coffee-toggle-slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:var(--color-border-medium);transition:.2s;border-radius:16px;"></span>
                        </label>
                        <HugeIcon name="tick-01" class="accent-check" />
                    </div>
                </div>
            </div>
        </div>
        <div id="pureLightModeOptions" style="display:{selectedTheme==='system'||selectedTheme==='light' ? 'flex' : 'none'};flex-direction:row;flex-wrap:nowrap;gap:12px;justify-content:space-between;align-items:center;border-top:1px solid var(--color-border-light);padding-top:8px;margin-top:4px;width:100%;">
            <div class="paper-mode-info" style="min-width:0;">
                <div class="paper-mode-title" style="font-size:13px;">Pure Light Mode</div>
                <div class="paper-mode-description" style="font-size:11px;">Keep light even at night</div>
            </div>
            <label class="switch" style="flex:0 0 auto;">
                <input type="checkbox" id="pureLightModeToggle" checked={getCookie('pureLightMode')==='true'} on:change={(e)=>{ setCookie('pureLightMode', e.target.checked?'true':'false'); applyThemeBasedOnConditions(); }}>
                <span class="slider round"></span>
            </label>
        </div>

        <!-- Accent Color Options -->
        <div id="accentColorSection"
            style="display: flex; flex-direction: row; flex-wrap: nowrap; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border-light); padding-top: 8px; margin-top: 4px; width: 100%; position: relative;">
            <div class="paper-mode-info" style="min-width: 0;">
                <div class="paper-mode-title" style="font-size: 13px;">Accent</div>
            </div>

            <div class="accent-color-selector" id="accentColorSelector" style="flex-shrink: 0;"
                on:click={() => { accentDropdownOpen = !accentDropdownOpen; }}>
                <span class="accent-dot" id="currentAccentDot"
                    style="background-color: var(--color-primary);"></span>
                <span id="currentAccentText" style="font-size: 13px; font-weight: 500; margin-left: 4px;">
                    {accentColors.find(a => a.id === selectedAccent)?.name || 'Default'}
                </span>
                <HugeIcon name="arrow-down-01"  style="font-size: 11px; margin-left: 4px; color: #666;" />
            </div>

            <!-- Accent Dropdown Menu -->
            <div id="accentDropdown" class="accent-dropdown" class:show={accentDropdownOpen}>
                {#each accentColors as accent}
                    <div class="accent-dropdown-item" class:active={selectedAccent === accent.id} data-color={accent.id}
                        on:click={() => setAccent(accent.id)}>
                        <div class="accent-dropdown-item-left">
                            {#if accent.color}
                                <span class="accent-dot" style="background-color: {accent.color};"></span>
                            {:else}
                                <span style="margin-left: 28px;"></span>
                            {/if}
                            <span>{accent.name}</span>
                        </div>
                        <HugeIcon name="tick-01"  class="accent-check" />
                    </div>
                {/each}
            </div>
        </div>
    </div>
</div>

<div class="card-layout" id="wallpaperSelectionCard">
    <div class="wallpaper-section">
        <div class="paper-mode-info">
            <div class="paper-mode-title">Choose Background Wallpaper</div>
            <div class="paper-mode-description">Select from available wallpaper options</div>
        </div>
        <div class="wallpaper-grid">
            <div class="wallpaper-preview-card" class:selected={selectedWallpaper === 'default'} data-wallpaper="default" data-bg-image="" on:click={() => selectWallpaper('default')} on:keydown={(e) => e.key === 'Enter' && selectWallpaper('default')} tabindex="0" role="button">
                <div class="wallpaper-preview"
                    style="background-image: url('/assets/img/events/hero.webp'); background-size: cover; background-position: center;">
                    <div class="wallpaper-overlay">
                        <span class="wallpaper-name">Default</span>
                    </div>
                </div>
            </div>
            <div class="wallpaper-preview-card" class:selected={selectedWallpaper === 'dynamic'} data-wallpaper="dynamic" data-bg-image="dynamic" on:click={() => selectWallpaper('dynamic')} on:keydown={(e) => e.key === 'Enter' && selectWallpaper('dynamic')} tabindex="0" role="button">
                <div class="wallpaper-preview dynamic-preview" id="dynamicPreview">
                    <div class="wallpaper-overlay">
                        <span class="wallpaper-name">Dynamic Landscape</span>
                        <span class="dynamic-time" id="dynamicTime"></span>
                    </div>
                </div>
            </div>
            <div class="wallpaper-preview-card" class:selected={selectedWallpaper === 'h2'} data-wallpaper="h2"
                data-bg-image="url('/assets/img/events/h2.webp')" on:click={() => selectWallpaper('h2')} on:keydown={(e) => e.key === 'Enter' && selectWallpaper('h2')} tabindex="0" role="button">
                <div class="wallpaper-preview"
                    style="background-image: url('/assets/img/events/h2.webp'); background-size: cover; background-position: center;">
                    <div class="wallpaper-overlay">
                        <span class="wallpaper-name">Zen</span>
                    </div>
                </div>
            </div>
            <div class="wallpaper-preview-card" class:selected={selectedWallpaper === 'h5'} data-wallpaper="h5"
                data-bg-image="url('/assets/img/events/h5.webp')" on:click={() => selectWallpaper('h5')} on:keydown={(e) => e.key === 'Enter' && selectWallpaper('h5')} tabindex="0" role="button">
                <div class="wallpaper-preview"
                    style="background-image: url('/assets/img/events/h5.webp'); background-size: cover; background-position: center;">
                    <div class="wallpaper-overlay">
                        <span class="wallpaper-name">Dusk</span>
                    </div>
                </div>
            </div>
            <div class="wallpaper-preview-card" class:selected={selectedWallpaper === 'h3'} data-wallpaper="h3"
                data-bg-image="url('/assets/img/events/h3.webp')" on:click={() => selectWallpaper('h3')} on:keydown={(e) => e.key === 'Enter' && selectWallpaper('h3')} tabindex="0" role="button">
                <div class="wallpaper-preview"
                    style="background-image: url('/assets/img/events/h3.webp'); background-size: cover; background-position: center;">
                    <div class="wallpaper-overlay">
                        <span class="wallpaper-name">A Blissful Night</span>
                    </div>
                </div>
            </div>
            <div class="wallpaper-preview-card" class:selected={selectedWallpaper === 'christmas-dynamic'} data-wallpaper="christmas-dynamic"
                data-bg-image="christmas-dynamic" on:click={() => selectWallpaper('christmas-dynamic')} on:keydown={(e) => e.key === 'Enter' && selectWallpaper('christmas-dynamic')} tabindex="0" role="button">
                <div class="wallpaper-preview christmas-preview" id="christmasPreview"
                    style="background-image: url('/assets/img/events/dynamic/christmas/part_2.webp'); background-size: cover; background-position: center;">
                    <div class="wallpaper-overlay">
                        <span class="wallpaper-name">Christmas</span>
                        <span class="dynamic-time" id="christmasTime"></span>
                    </div>
                </div>
            </div>
            <div class="wallpaper-preview-card" class:selected={selectedWallpaper === 'sereine'} data-wallpaper="sereine" data-bg-image="sereine" on:click={() => { selectWallpaper('sereine'); showSereineModal=true; }} on:keydown={(e) => e.key === 'Enter' && selectWallpaper('sereine')} tabindex="0" role="button">
                <div class="wallpaper-preview sereine-preview" id="sereinePreview"
                    style="background-image: url('https://sereine.vercel.app/api/wallpapers/random?fallback=true'); background-size: cover; background-position: center;">
                    <div class="wallpaper-overlay">
                        <span class="wallpaper-name">Sereine Carousel</span>
                    </div>
                </div>
            </div>
            <div class="wallpaper-preview-card wallpaper-upload-card" class:selected={selectedWallpaper === 'custom'} data-wallpaper="custom"
                id="customWallpaperCard" on:click={() => { if(selectedWallpaper==='custom') showWallpaperStore=true; else selectWallpaper('custom'); }} on:keydown={(e) => e.key === 'Enter' && selectWallpaper('custom')} tabindex="0" role="button">
                <div class="wallpaper-preview custom-preview" id="customPreview">
                    <div class="wallpaper-upload-content">
                        <HugeIcon name="shopping-bag-01"  />
                        <span class="wallpaper-upload-text">Store</span>
                    </div>
                    <div class="wallpaper-overlay custom-wallpaper-overlay" style:display={selectedWallpaper==='custom' ? 'flex' : 'none'}>
                        <span class="wallpaper-name">Custom</span>
                        <button class="custom-wallpaper-remove" id="removeCustomWallpaper"
                            title="Remove custom wallpaper" on:click|stopPropagation={removeCustomWallpaper}>
                            <HugeIcon name="cancel-01"  />
                        </button>
                    </div>
                </div>
                <input type="file" id="customWallpaperInput" accept="image/*" style="display: none;" on:change={handleCustomWallpaperInput}>
            </div>
        </div>
    </div>
</div>

{#if showWallpaperStore}
<div class="promo-modal-overlay dynamic-form-overlay show" style="display:flex" on:click|self={()=>showWallpaperStore=false}>
  <div class="promo-modal dynamic-form-modal wallpaper-store-modal">
    <button type="button" class="promo-close-btn" on:click={()=>showWallpaperStore=false} aria-label="Close"><HugeIcon name="cancel-01" /></button>
    <div class="promo-content dynamic-form-content-wrapper">
      <div class="paper-mode-info" style="margin-bottom: 14px;">
        <div class="paper-mode-title">Custom Wallpaper Store</div>
      </div>
      <div id="customWallpaperStoreGrid" class="wallpaper-grid" style="margin-top:16px;">
        <div class="wallpaper-preview-card" on:click={()=> document.getElementById('customWallpaperInput')?.click()} style="cursor:pointer;">
          <div class="wallpaper-preview" style="display:flex;align-items:center;justify-content:center;background:var(--color-bg-card);">
            <HugeIcon name="plus" /><span style="margin-left:8px;">Add New</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
{/if}

{#if showSereineModal}
<div class="promo-modal-overlay dynamic-form-overlay show" id="sereineWallpaperModal" role="dialog" aria-hidden="true" style="display: flex;" on:click|self={()=>showSereineModal=false}>
    <div class="promo-modal dynamic-form-modal wallpaper-store-modal">
        <button type="button" class="promo-close-btn" on:click={()=>showSereineModal=false} aria-label="Close">
            <HugeIcon name="cancel-01" />
        </button>
        <div class="promo-content dynamic-form-content-wrapper">
            <div class="paper-mode-info" style="margin-bottom: 14px;">
                <div class="paper-mode-title">Sereine Settings</div>
            </div>
            <!-- Sereine image wrapped in skeuomorphic frame -->
            <div class="skeuomorphic-frame">
                <div class="skeuomorphic-frame-inner">
                    <div id="sereineModalPreview" style="width: 100%; height: 200px; background-size: cover; background-position: center; background-image: url('{currentSereineImageUrl || 'https://sereine.vercel.app/api/wallpapers/random?fallback=true'}');"></div>
                </div>
            </div>
            <div style="display: flex; gap: 8px; justify-content: center; margin-bottom: 20px;">
                <button class="promo-secondary-btn" id="sereineModalShuffleBtn" style="flex: 1; display: flex; align-items: center; justify-content: center; min-width: 0; padding: 12px; border-radius: 12px; cursor: pointer;" on:click={handleSereineShuffle}>
                    <span class="sereine-spin-icon" class:spinning={sereineShuffling} style="margin-right: 8px; display: inline-flex;"><HugeIcon name="shuffle" /></span> Shuffle
                </button>
                <button class="promo-secondary-btn" id="sereineModalSaveBtn" style="flex: 1; display: flex; align-items: center; justify-content: center; min-width: 0; padding: 12px; border-radius: 12px; cursor: pointer; transition: all 0.2s ease;" style:color={sereineLiked ? '#ff4d4f' : ''} style:border-color={sereineLiked ? '#ff4d4f' : ''} on:click={handleSereineSave}>
                    <span style="margin-right: 8px; display: inline-flex;"><HugeIcon name="favourite" color={sereineLiked ? '#ff4d4f' : 'currentColor'} fill={sereineLiked ? '#ff4d4f' : 'none'} /></span> {sereineLiked ? 'Liked' : 'Save'}
                </button>
            </div>
            <div class="paper-mode-title" style="font-size: 14px; margin-bottom: 10px;">Update Frequency</div>
            <div class="sereine-modal-frequency-options" id="sereineModalFreqContainer" style="display: flex; flex-direction: column; gap: 8px;">
                <div class="sereine-setting-item modal-freq-item" class:selected={sereineFrequency === 'everytime'} data-value="everytime" style="position: static;" on:click={() => setSereineFrequency('everytime')} on:keydown={(e) => e.key === 'Enter' && setSereineFrequency('everytime')} role="button" tabindex="0">Everytime</div>
                <div class="sereine-setting-item modal-freq-item" class:selected={sereineFrequency === 'everyday'} data-value="everyday" style="position: static;" on:click={() => setSereineFrequency('everyday')} on:keydown={(e) => e.key === 'Enter' && setSereineFrequency('everyday')} role="button" tabindex="0">Everyday</div>
                <div class="sereine-setting-item modal-freq-item" class:selected={sereineFrequency === 'random'} data-value="random" style="position: static;" on:click={() => setSereineFrequency('random')} on:keydown={(e) => e.key === 'Enter' && setSereineFrequency('random')} role="button" tabindex="0">Random</div>
                <div class="sereine-setting-item modal-freq-item" class:selected={sereineFrequency === '3days'} data-value="3days" style="position: static;" on:click={() => setSereineFrequency('3days')} on:keydown={(e) => e.key === 'Enter' && setSereineFrequency('3days')} role="button" tabindex="0">Every 3 days</div>
                <div class="sereine-setting-item modal-freq-item" class:selected={sereineFrequency === 'week'} data-value="week" style="position: static;" on:click={() => setSereineFrequency('week')} on:keydown={(e) => e.key === 'Enter' && setSereineFrequency('week')} role="button" tabindex="0">Every week</div>
            </div>
        </div>
    </div>
</div>
{/if}

<!-- Tabs: Preferences / About -->
<div class="card-layout" id="tabSwitcherCard">
    <div class="tab-switcher-container">
        <span class="tab-text" class:active={settingsSubTab === 'preferences'} data-target="preferences"
            on:click={() => switchSettingsTab('preferences')}><b>Preferences</b></span>
        <span class="tab-text" class:active={settingsSubTab === 'about-app'} data-target="about-app"
            on:click={() => switchSettingsTab('about-app')}><b>About the App</b></span>
        <div class="active-tab-indicator" id="activeTabIndicator"></div>
    </div>
</div>

<!-- Preferences Section -->
<div id="preferences-content" class="tab-content-section" class:active={settingsSubTab === 'preferences'}>
    <p style="margin-left: 5px;"><b>Reading Modes</b></p>

    <!-- Invert Colors Mode -->
    <div class="card-layout" id="invertMode">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Inversion</div>
                <div class="paper-mode-description">Reverses colors of content except some images and media</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="invertModeToggle" aria-label="Inversion Mode" bind:checked={invertMode} on:change={applyReadingToggles}>
                <span class="slider"></span>
            </label>
        </div>
    </div>

    <!-- Paper Mode -->
    <div class="card-layout" id="paperModeCard">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Paper Mode</div>
                <div class="paper-mode-description">Paper-like reading experience</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="paperModeToggle" aria-label="Paper Mode" bind:checked={paperMode} on:change={applyReadingToggles}>
                <span class="slider"></span>
            </label>
        </div>
        <details class="grain-details" id="grainDetails" open={paperMode} style="display:{paperMode ? 'block' : 'none'};">
            <summary class="grain-summary">Grain Settings</summary>
            <div class="grain-size-control" id="grainSizeControl">
                <div class="grain-size-label"><span>Grain Size</span><span class="grain-size-value" id="grainSizeValue">100%</span></div>
                <input type="range" id="grainSizeSlider" min="0" max="200" value="100" step="10" class="grain-slider" on:input={(e)=>{ document.documentElement.style.setProperty('--grain-size', e.target.value+'%'); const v=document.getElementById('grainSizeValue'); if(v) v.textContent=e.target.value+'%'; }}>
            </div>
        </details>
        <div class="paper-texture-options" id="paperTextureOptions" style="display:{paperMode ? 'block' : 'none'};margin-top:15px;padding-top:15px;border-top:1px solid rgba(0,0,0,0.08);">
            <div class="toggle-container">
                <div class="paper-mode-info"><div class="paper-mode-title" style="font-size:13px;">Paper Texture</div><div class="paper-mode-description" style="font-size:11px;">Choose the texture overlay</div></div>
                <div class="paper-texture-dropdown-wrapper" id="paperTextureDropdownWrapper">
                    <button class="paper-texture-trigger" id="paperTextureDropdownTrigger" on:click={()=> document.getElementById('paperTextureDropdown')?.classList.toggle('show')}><span id="paperTextureSelectedText">Black Paper</span><HugeIcon name="arrow-down-01" style="font-size:11px;margin-left:4px;" /></button>
                    <div class="paper-texture-dropdown" id="paperTextureDropdown">
                        {#each ['black-paper','cardboard-flat','light-paper-fibers','sandpaper','textured-paper','gaussian'] as tex}
                            <a href="#" class="dropdown-item paper-texture-item" data-value={tex} on:click|preventDefault={()=>{ document.getElementById('paperTextureSelectedText').textContent=tex; document.querySelectorAll('.paper-texture-item').forEach(el=>el.classList.toggle('selected', el.dataset.value===tex)); document.cookie=`paperTexture=${tex}; Max-Age=31536000; Path=/`; const url=`url('/assets/textures/${tex}.png')`; document.documentElement.style.setProperty('--paper-texture-url', url); }}>{tex}</a>
                        {/each}
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Night Mode -->
    <div class="card-layout" id="nightReadingCard">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Night Mode</div>
                <div class="paper-mode-description">Reduces eye strain</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="nightReadingToggle" aria-label="Night Mode" bind:checked={nightMode} on:change={applyReadingToggles}>
                <span class="slider"></span>
            </label>
        </div>
        <details class="grain-details" id="nightReadingDetails" open={nightMode} style="display:{nightMode ? 'block' : 'none'};">
            <summary class="grain-summary">Night Mode Settings</summary>
            <div class="grain-size-control" id="nightReadingControl">
                <div class="warmth-control" id="warmthControl"><div class="warmth-label"><span>Warmth</span><span class="warmth-value" id="warmthValue">50%</span></div><input type="range" id="warmthSlider" min="0" max="100" value="50" step="5" class="warmth-slider" on:input={(e)=>{ const v=document.getElementById('warmthValue'); if(v) v.textContent=e.target.value+'%'; document.documentElement.style.setProperty('--night-warmth', e.target.value+'%'); }}></div>
                <div class="night-schedule-container"><div class="time-input-group"><label for="nightStartTime">Start Time:</label><input type="time" id="nightStartTime" value="20:00" class="time-input"></div><div class="time-input-group"><label for="nightEndTime">End Time:</label><input type="time" id="nightEndTime" value="06:00" class="time-input"></div><div class="schedule-toggle-group"><span>Auto Schedule</span><label class="switch small-switch"><input type="checkbox" id="nightScheduleToggle"><span class="slider"></span></label></div></div>
            </div>
        </details>
    </div>

    <!-- E-Ink Mode -->
    <div class="card-layout" id="einkModeCard">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">E-Ink Mode</div>
                <div class="paper-mode-description">Grayscale filter like e-ink displays</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="einkModeToggle" aria-label="E-Ink Mode" bind:checked={einkMode} on:change={applyReadingToggles}>
                <span class="slider"></span>
            </label>
        </div>
    </div>

    <p style="margin-left: 5px;"><b>Advanced</b></p>

    <!-- Wallpaper Engine -->
    <div class="card-layout" id="bgToggleCard">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Wallpaper Engine</div>
                <div class="paper-mode-description">Enable home background image</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="enableBgToggle" aria-label="Wallpaper Engine" bind:checked={wallpaperEnabled} on:change={applyReadingToggles}>
                <span class="slider"></span>
            </label>
        </div>
    </div>


    <!-- Show Insightroom Feed -->
    <div class="card-layout" id="getinsights">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Show Insightroom Feed</div>
                <div class="paper-mode-description">Display smart posts from insightroom</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="insightroomToggle" aria-label="Show Insightroom Feed" checked={insightroomFeed} on:change={(e)=> saveInsightroomSettings(e.target.checked, insightroomView)}>
                <span class="slider"></span>
            </label>
        </div>
        {#if insightroomFeed}
            <div id="insightroomViewOptions" class="insightroom-view-options" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(0,0,0,0.08);">
                <div class="toggle-container">
                    <div class="paper-mode-info">
                        <div class="paper-mode-title" style="font-size: 13px;">View Style</div>
                        <div class="paper-mode-description" style="font-size: 11px;">Choose how the feed appears on homepage</div>
                    </div>
                    <!-- Dropdown using profile-dropdown styles -->
                    <div class="view-style-dropdown-wrapper" id="viewStyleDropdownWrapper" class:open={viewStyleDropdownOpen}>
                        <button type="button" class="view-style-trigger" id="viewStyleDropdownTrigger" on:click|stopPropagation={() => {
                            viewStyleDropdownOpen = !viewStyleDropdownOpen;
                            if (window.MaterioHaptics) {
                                window.MaterioHaptics.vibrate(viewStyleDropdownOpen ? 'dropdownOpen' : 'dropdownClose');
                            }
                        }}>
                            <span id="viewStyleSelectedText">{insightroomView === 'folded' ? 'Folded' : 'Normal'}</span>
                            <i class="fas fa-chevron-down" aria-hidden="true">
                                <HugeIcon name="arrow-down-01" style="font-size: 11px; margin-left: 4px;" />
                            </i>
                        </button>
                        <div class="view-style-dropdown" id="viewStyleDropdown" class:show={viewStyleDropdownOpen}>
                            <a href="#" class="dropdown-item view-style-item" class:selected={insightroomView === 'normal'} data-value="normal" on:click|preventDefault={() => {
                                viewStyleDropdownOpen = false;
                                if (window.MaterioHaptics) window.MaterioHaptics.vibrate('select');
                                saveInsightroomSettings(insightroomFeed, 'normal');
                            }}>
                                <i class="far fa-rectangle-wide" aria-hidden="true">
                                    <HugeIcon name="square-arrow-diagonal-01" />
                                </i>
                                <span>Normal</span>
                            </a>
                            <a href="#" class="dropdown-item view-style-item" class:selected={insightroomView === 'folded'} data-value="folded" on:click|preventDefault={() => {
                                viewStyleDropdownOpen = false;
                                if (window.MaterioHaptics) window.MaterioHaptics.vibrate('select');
                                saveInsightroomSettings(insightroomFeed, 'folded');
                            }}>
                                <i class="far fa-rectangle-list" aria-hidden="true">
                                    <HugeIcon name="list-view" />
                                </i>
                                <span>Folded</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <!-- Accept Cookies -->
    <div class="card-layout" id="cookiesToggleCard">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Accept Cookies</div>
                <div class="paper-mode-description">Opt in for analytics cookies</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="optOutCookiesToggle" aria-label="Accept Cookies" bind:checked={cookiesAccepted} on:change={(e)=>{cookiesAccepted=e.target.checked; document.cookie=`cookiesAccepted=${cookiesAccepted ? "true":"false"}; Max-Age=31536000; Path=/; SameSite=Lax`}}>
                <span class="slider"></span>
            </label>
        </div>
    </div>

    <!-- Interaction Sounds (native apps only; the website stays silent) -->
    {#if isNative}
    <div class="card-layout" id="soundsToggleCard">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Interaction Sounds</div>
                <div class="paper-mode-description">Subtle audio cues for taps, toggles, loading and results</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="soundsToggle" class="setting-toggle" aria-label="Interaction Sounds"
                    data-cuelume-toggle
                    bind:checked={$soundsEnabled}
                    on:change={(e)=>{ setSoundEnabled(e.target.checked); }}>
                <span class="slider"></span>
            </label>
        </div>
        {#if $soundsEnabled}
            <div id="soundsOptions" class="sounds-options">
                <!-- Material -->
                <div class="sounds-option-row">
                    <div class="paper-mode-info">
                        <div class="paper-mode-title" style="font-size: 13px;">Material</div>
                        <div class="paper-mode-description" style="font-size: 11px;">The character of every cue</div>
                    </div>
                    <div style="position: relative; display: inline-block;">
                        <div class="accent-color-selector" id="soundMaterialSelector"
                            data-cuelume-open="open" data-cuelume-emphasis="subtle"
                            on:click={() => { soundMaterialDropdownOpen = !soundMaterialDropdownOpen; }}
                            role="button" tabindex="0"
                            on:keydown={(e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); soundMaterialDropdownOpen = !soundMaterialDropdownOpen; } }}
                            aria-haspopup="listbox" aria-expanded={soundMaterialDropdownOpen}>
                            <span id="soundMaterialSelectedText">{MATERIALS.find(m => m.id === $soundMaterial)?.label || 'Default'}</span>
                            <span style="font-size:11px;margin-left:4px;color:var(--color-text-muted);"><HugeIcon name="arrow-down-01" /></span>
                        </div>
                        <div id="soundMaterialDropdown" class="accent-dropdown" class:show={soundMaterialDropdownOpen}
                            style="left: 0; right: auto; top: calc(100% + 5px);" role="listbox">
                            {#each MATERIALS as material (material.id)}
                                <div class="theme-dropdown-item" class:active={$soundMaterial === material.id}
                                    data-material={material.id} role="option" aria-selected={$soundMaterial === material.id}
                                    data-cuelume-select="select"
                                    on:click={() => { setSoundMaterial(material.id); soundMaterialDropdownOpen = false; }}>
                                    <div class="theme-dropdown-item-left">
                                        <span>{material.label}</span>
                                    </div>
                                    <HugeIcon name="tick-01" class="accent-check" />
                                </div>
                            {/each}
                        </div>
                    </div>
                </div>
                <!-- Volume -->
                <div class="sounds-option-row">
                    <div class="paper-mode-info">
                        <div class="paper-mode-title" style="font-size: 13px;">Volume</div>
                        <div class="paper-mode-description" style="font-size: 11px;">Overall loudness for all cues</div>
                    </div>
                    <div class="sounds-volume-control">
                        <input type="range" id="soundVolumeSlider" min="0" max="100" step="5"
                            value={Math.round($soundVolume * 100)} class="sounds-slider"
                            aria-label="Sound volume" data-cuelume-select="select" data-cuelume-emphasis="subtle"
                            on:input={(e)=>{ setSoundVolume(Number(e.target.value) / 100); }}
                            on:change={(e)=>{ setSoundVolume(Number(e.target.value) / 100); sfx('tap', { emphasis: 'subtle' }); }}>
                        <span class="sounds-volume-value" id="soundVolumeValue">{Math.round($soundVolume * 100)}%</span>
                    </div>
                </div>
            </div>
        {/if}
    </div>
    {/if}

    <!-- Notifications -->
    <div class="card-layout" id="notificationsToggleCard">
        <div class="toggle-container">
            <div class="paper-mode-info">
                <div class="paper-mode-title">Notifications</div>
                <div class="paper-mode-description">Receive notifications about new uploads and updates</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="notificationsToggle" class="setting-toggle" aria-label="Notifications" bind:checked={notificationsEnabled} on:change={(e)=>{notificationsEnabled=e.target.checked; localStorage.setItem("notificationsEnabled", notificationsEnabled ? "true":"false"); if(notificationsEnabled && "Notification" in window && Notification.permission==="default") Notification.requestPermission();}}>
                <span class="slider"></span>
            </label>
        </div>
    </div>

    {#if !isTauri && !isCapacitor}
        <!-- Redirects Section Header -->
        <div class="settings-group-header"
            style="display: flex; align-items: center; gap: 8px; margin: 24px 0 12px 4px; font-size: 15px; font-weight: 600; color: var(--color-text-primary); opacity: 0.9;">
            <span>Redirects</span>
        </div>

        <!-- Redirects (single merged card) -->
        <div class="card-layout" id="redirectsCard" style="overflow: visible;">
            <div class="toggle-container"
                style="position: relative; flex-direction: column; align-items: stretch; gap: 8px; overflow: visible;">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; position: relative;">
                    <div class="paper-mode-info">
                        <div class="paper-mode-title">Skip Landing Page</div>
                        <div class="paper-mode-description">Always open app directly, skip landing</div>
                    </div>
                    <label class="switch" style="flex-shrink: 0;">
                        <input type="checkbox" id="skipLandingToggle" aria-label="Skip Landing Page" bind:checked={redirectSkip} on:change={toggleRedirectSkip}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; position: relative; border-top: 1px solid var(--color-border-light); padding-top: 8px; margin-top: 4px;">
                    <div class="paper-mode-info">
                        <div class="paper-mode-title">App Start Location</div>
                        <div class="paper-mode-description">Where the app opens when skipping landing</div>
                    </div>

                    <div class="accent-color-selector" id="redirectStartSelector" style="flex-shrink: 0;"
                        on:click={() => { redirectDropdownOpen = !redirectDropdownOpen; }}>
                        <span id="currentRedirectText" style="font-size: 13px; font-weight: 500; margin-left: 4px;">{redirectStart === 'home' ? 'Home (/home)' : 'Root (/) '}</span>
                        <HugeIcon name="arrow-down-01"  style="font-size: 11px; margin-left: 4px; color: #666;" />
                    </div>

                    <!-- Redirect Dropdown Menu -->
                    <div id="redirectStartDropdown" class="accent-dropdown" class:show={redirectDropdownOpen}>
                        <div class="accent-dropdown-item" class:active={redirectStart === 'root'} data-value="root" on:click={() => setRedirectStart('root')}>
                            <div class="accent-dropdown-item-left">
                                <span>Root (/)</span>
                            </div>
                            <HugeIcon name="tick-01"  class="accent-check" />
                        </div>
                        <div class="accent-dropdown-item" class:active={redirectStart === 'home'} data-value="home" on:click={() => setRedirectStart('home')}>
                            <div class="accent-dropdown-item-left">
                                <span>Home (/home)</span>
                            </div>
                            <HugeIcon name="tick-01"  class="accent-check" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    {/if}

    {#if isTauri}
        <!-- Desktop: MCP Server Section -->
        <div class="card-layout" id="localMcpServerCard">
            <div class="toggle-container" style="justify-content: space-between; align-items: center; width: 100%;">
                <div class="card-title-row">
                    <HugeiconsIcon icon={McpServerIcon} size={18} style="color: var(--color-primary, #ff8200); flex-shrink: 0;" />
                    <div class="paper-mode-title" style="display: flex; align-items: center; gap: 8px; margin: 0;">
                        <span>MCP Server</span>
                        <span class="mcp-status-pill" class:running={mcpRunning}>
                            <span class="mcp-status-dot"></span>
                            {mcpRunning ? 'Running' : 'Stopped'}
                        </span>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                    <button
                        type="button"
                        class="mcp-copy-icon-btn"
                        title={copiedMcp ? 'Copied URL!' : 'Copy MCP URL'}
                        aria-label="Copy MCP URL"
                        on:click={copyMcpUrl}
                    >
                        <HugeiconsIcon icon={copiedMcp ? CheckmarkCircle01Icon : Copy01Icon} size={16} />
                    </button>
                    <button
                        type="button"
                        class="mcp-action-btn"
                        class:running={mcpRunning}
                        disabled={mcpLoading}
                        on:click={toggleMcpServer}
                    >
                        {mcpLoading ? '…' : (mcpRunning ? 'Stop Server' : 'Start Server')}
                    </button>
                </div>
            </div>
            {#if mcpError}
                <div class="mcp-error-text" style="margin-top: 8px; padding-left: 4px;">
                    {mcpError}
                </div>
            {/if}
        </div>
    {/if}

    <!-- Check for Updates (native apps only — the website updates itself) -->
    {#if isTauri || isCapacitor}
    <div
        class="card-layout"
        id="checkUpdatesCard"
        role="button"
        tabindex="0"
        style="cursor: var(--f-cursor-pointer); display: flex; align-items: center;"
        on:click={() => checkAppUpdate(true)}
        on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); checkAppUpdate(true); } }}
    >
        <div class="toggle-container" style="justify-content: space-between; align-items: center; width: 100%; margin: 0;">
            <div class="card-title-row" style="display: flex; align-items: center; gap: 10px;">
                <div style="display: flex; align-items: center; justify-content: center; height: 18px; width: 18px; flex-shrink: 0;">
                    <HugeiconsIcon icon={UploadCircle01Icon} size={18} style="color: var(--color-primary, #ff8200); display: block;" />
                </div>
                <div class="paper-mode-title" style="margin: 0; line-height: 1; display: flex; align-items: center;">Check for Updates</div>
            </div>
            {#if checkingAppUpdate}
                <span style="font-size: 12.5px; color: var(--color-primary, #ff8200); font-weight: 600; font-family: 'OpenRunde', 'Open Runde', sans-serif;">Checking…</span>
            {/if}
        </div>
    </div>
    {/if}

    <!-- Clear Site Data -->
    <div class="card-layout" id="clearSiteDataCard">
        <div class="toggle-container" style="cursor: var(--f-cursor-pointer);" on:click={clearAllSiteData}>
            <div class="paper-mode-info">
                <div class="paper-mode-title">Clear Data</div>
                <div class="paper-mode-description">Clear all data from storage</div>
            </div>
            <HugeIcon name="delete-02"  style="color: #DC3545; font-size: 18px;" />
        </div>
    </div>
</div>

<!-- About the App Section -->
<div id="about-app-content" class="tab-content-section" class:active={settingsSubTab === 'about-app'}>
    <p style="margin-left: 5px;"><b>Release Overview</b></p>
    <div class="card-layout" id="about">
        <p id="versionInfoText">Version: {releaseVersion || (loadingReleases ? 'Loading...' : '5.1')}</p>
        <p id="buildInfoText">Build: {releaseBuild || (loadingReleases ? 'Loading...' : '')}</p>
        <details id="changeLogDetails" open>
            <summary><HugeIcon name="telescope"  style="margin-right: 10px;" />What's New?</summary>
            <div id="changeLogContent">
                {#if releaseLogs && releaseLogs.length > 0}
                    {#each releaseLogs as log}
                        <p style="margin: 6px 0; font-size: 13.5px; line-height: 1.45;">{log}</p>
                    {/each}
                {:else if loadingReleases}
                    <p style="margin: 6px 0; opacity: 0.7;">Loading release notes...</p>
                {:else}
                    <p style="margin: 6px 0; opacity: 0.7;">No changelog available for this branch.</p>
                {/if}
            </div>
        </details>
        <a href="/changelog"
            style="display: block; margin-top: 10px; font-size: 14px; color: var(--color-primary-dark, #c85000); text-decoration: none;">Show all →</a>
    </div>

    <p style="margin-left: 5px;"><b>Legal</b></p>
    <div class="card-layout" id="notices">
        <p>
            <HugeIcon name="information-circle"  />
            <span><a href="/about" style="font-family:'OpenRunde', 'Open Runde', sans-serif; font-weight: 600; color: var(--color-text-primary, #333); text-decoration: none;">About</a></span>
            <HugeIcon name="arrow-right-01"  />
        </p>
        <hr>
        <p>
            <HugeIcon name="file-01"  />
            <span><a href="/privacy" style="font-family:'OpenRunde', 'Open Runde', sans-serif; font-weight:600; color: var(--color-text-primary, #333); text-decoration: none;">Privacy Policy</a></span>
            <HugeIcon name="arrow-right-01"  />
        </p>
        <hr>
        <p>
            <HugeIcon name="cookie"  />
            <span><a href="/cookies" style="font-family:'OpenRunde', 'Open Runde', sans-serif; font-weight: 600; color: var(--color-text-primary, #333); text-decoration: none;">Cookie Policy</a></span>
            <HugeIcon name="arrow-right-01"  />
        </p>
        <hr>
        <p>
            <HugeIcon name="github"  />
            <span><a href="https://github.com/Jinansh230705" style="font-family:'OpenRunde', 'Open Runde', sans-serif; font-weight: 600; color: var(--color-text-primary, #333); text-decoration: none;">Developer's Github</a></span>
            <HugeIcon name="arrow-right-01"  />
        </p>
    </div>
</div>

<!-- Creator Stamp -->
<div class="card-layout" id="creatorInfo">
    <p>&copy; Materio</p>
    <p>Crafted with ❤️ by Jinansh</p>
</div>

<!-- Opensource Licenses -->
<div id="licensesCard" style="text-align: center; margin: 20px 0;">
    <details>
        <summary style="list-style: none; cursor: var(--f-cursor-pointer); display: inline-block; background: none; border: none; font-size: 14px; color: #666; padding: 8px 0; transition: color 0.3s ease;">
            <HugeIcon name="arrow-down-01"  style="margin-left: 8px; transition: transform 0.3s ease; font-size: 12px;" />
            Opensource Licenses
        </summary>
        <div id="licensesContent"
            style="max-height: 300px; overflow-y: auto; background-color: #f3f3ee; border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin: 10px auto; text-align: center; max-width: 90%;">
            <pre id="licensesText"
                style="font-family: 'Berkeley Mono', 'Cascadia Mono', 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 12px; line-height: 1.4; margin: 0; white-space: pre-wrap; color: #333; text-align: center;">Loading licenses...</pre>
        </div>
    </details>
</div>

<details id="miscCard" style="text-align: center; margin: 20px 0;">
    <summary style="list-style: none; cursor: var(--f-cursor-pointer); display: inline-block; background: none; border: none; font-size: 14px; color: #666; padding: 8px 0; transition: color 0.3s ease;">
        <HugeIcon name="arrow-down-01"  style="margin-left: 8px; transition: transform 0.3s ease; font-size: 12px;" />
        Misc
    </summary>
    <div style="display: flex; flex-direction: column; gap: 4px; font-family: 'Berkeley Mono', 'Cascadia Mono', 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 12px; margin-top: 6px; align-items: center;">
        <span>Materio ID: <span id="buildId">{liveBuildId}</span></span>
        {#if isTauri}
            <span>App Version: Windows v{currentAppVersion}</span>
        {:else if isCapacitor}
            <span>App Version: Android v{currentAppVersion}</span>
        {:else}
            <span>Web Version: v{currentAppVersion}</span>
        {/if}
    </div>
</details>
<style>
    .card-title-row {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 10px !important;
    }
    .mcp-copy-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 10px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        background: #ffffff;
        color: var(--color-text-primary, #333);
        cursor: pointer;
        transition: all 0.18s ease;
    }
    :global(body.dark-mode) .mcp-copy-icon-btn {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.16);
        color: #eee;
    }
    .mcp-copy-icon-btn:hover {
        border-color: var(--color-primary, #ff8200);
        color: var(--color-primary, #ff8200);
    }
    .sereine-spin-icon {
        display: inline-flex;
        transition: transform 0.5s ease;
    }
    .sereine-spin-icon.spinning {
        transform: rotate(180deg);
    }

    /* MCP Status Pill & Action */
    #localMcpServerCard {
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .mcp-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 10px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.06);
        color: #777;
        letter-spacing: 0.02em;
    }
    :global(body.dark-mode) .mcp-status-pill {
        background: rgba(255, 255, 255, 0.08);
        color: #aaa;
    }
    .mcp-status-pill.running {
        background: rgba(16, 185, 129, 0.14) !important;
        color: #10b981 !important;
    }
    .mcp-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #999;
        display: inline-block;
    }
    .mcp-status-pill.running .mcp-status-dot {
        background: #10b981;
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
        animation: pulseDot 2s infinite ease-in-out;
    }
    @keyframes pulseDot {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.25); opacity: 0.7; }
    }
    .mcp-action-btn, .updater-check-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 7px 16px;
        border-radius: 12px;
        font-size: 12.5px;
        font-weight: 600;
        font-family: 'OpenRunde', 'Open Runde', sans-serif;
        border: 1px solid rgba(0, 0, 0, 0.14);
        background: #ffffff;
        color: #222222;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    :global(body.dark-mode) .mcp-action-btn,
    :global(body.dark-mode) .updater-check-btn {
        background: rgba(255, 255, 255, 0.09) !important;
        border-color: rgba(255, 255, 255, 0.16) !important;
        color: #ffffff !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
    }
    .mcp-action-btn:hover:not(:disabled), .updater-check-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        background: #f7f7f7;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
    }
    :global(body.dark-mode) .mcp-action-btn:hover:not(:disabled),
    :global(body.dark-mode) .updater-check-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.16) !important;
        border-color: rgba(255, 255, 255, 0.28) !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
    }
    .mcp-action-btn.running {
        border-color: rgba(239, 68, 68, 0.4) !important;
        color: #ef4444 !important;
        background: rgba(239, 68, 68, 0.08) !important;
    }
    :global(body.dark-mode) .mcp-action-btn.running {
        border-color: rgba(239, 68, 68, 0.5) !important;
        color: #f87171 !important;
        background: rgba(239, 68, 68, 0.16) !important;
    }
    .mcp-url-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(0, 0, 0, 0.03);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 12px;
        padding: 8px 12px;
        font-family: 'Berkeley Mono', 'Cascadia Mono', 'JetBrains Mono', monospace;
        font-size: 12px;
        color: var(--color-text-secondary, #666);
    }
    :global(body.dark-mode) .mcp-url-container {
        background: rgba(0, 0, 0, 0.4);
        border-color: rgba(255, 255, 255, 0.08);
        color: #ffaa55;
    }
    .mcp-copy-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 130, 0, 0.1);
        border: 1px solid rgba(255, 130, 0, 0.2);
        border-radius: 8px;
        font-size: 11px;
        font-weight: 700;
        color: var(--color-primary, #ff8200);
        cursor: pointer;
        padding: 4px 10px;
        transition: all 0.18s ease;
    }
    .mcp-copy-button:hover {
        background: rgba(255, 130, 0, 0.2);
        transform: translateY(-1px);
    }
    .mcp-error-text {
        font-size: 12px;
        color: #dc3545;
        font-weight: 500;
    }
</style>
