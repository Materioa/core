<script>
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment';
    import { activeTab } from '$lib/stores.js';
    import HugeIcon from '$lib/components/HugeIcon.svelte';

    let dynamicWallpaperInterval = null;
    let christmasWallpaperInterval = null;
    let sereineWallpaperInterval = null;
    let currentSereineImageUrl = null;
    let sereineArtistName = '';
    let currentWallpaperType = 'dynamic';
    let isWallpaperEnabled = true;

    function getCookie(name) {
        if (!browser) return null;
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    function checkWallpaperEnabled() {
        if (!browser) return true;
        const enableBg = getCookie("enableBg");
        if (enableBg !== null) return enableBg !== "false";
        const we = getCookie("wallpaperEnabled");
        if (we !== null) return we !== "false";
        return true;
    }

    function setCookie(name, value) {
        if (!browser) return;
        const maxAge = 365 * 24 * 60 * 60;
        document.cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) + "; Max-Age=" + maxAge + "; Path=/; SameSite=Lax";
    }

    async function fetchSereineWallpaper(force = false) {
        if (!browser) return;
        const frequency = localStorage.getItem('materio_sereine_frequency') || 'everytime';
        const lastFetchTime = parseInt(localStorage.getItem('materio_sereine_last_fetch') || '0', 10);
        const cachedWallpaperStr = localStorage.getItem('materio_sereine_cache');
        const now = Date.now();

        let shouldFetch = force;
        
        if (!shouldFetch) {
            if (frequency === 'everytime') {
                const sessionFetch = sessionStorage.getItem('materio_sereine_session_fetch');
                if (!sessionFetch) {
                    shouldFetch = true;
                }
            } else if (frequency === 'everyday') {
                shouldFetch = (now - lastFetchTime) > 24 * 60 * 60 * 1000;
            } else if (frequency === '3days') {
                shouldFetch = (now - lastFetchTime) > 72 * 60 * 60 * 1000;
            } else if (frequency === 'week') {
                shouldFetch = (now - lastFetchTime) > 7 * 24 * 60 * 60 * 1000;
            } else if (frequency === 'random') {
                let nextTarget = parseInt(localStorage.getItem('materio_sereine_next_random') || '0', 10);
                if (now >= nextTarget) {
                    shouldFetch = true;
                }
            }
        }

        let wallpaperData = null;

        if (shouldFetch) {
            try {
                const response = await fetch('https://sereine.vercel.app/api/wallpapers/random');
                if (response.ok) {
                    wallpaperData = await response.json();
                    localStorage.setItem('materio_sereine_cache', JSON.stringify(wallpaperData));
                    localStorage.setItem('materio_sereine_last_fetch', now.toString());
                    if (frequency === 'everytime') {
                        sessionStorage.setItem('materio_sereine_session_fetch', 'true');
                    }
                    
                    if (frequency === 'random') {
                        const min = 45 * 60 * 1000;
                        const max = 72 * 60 * 60 * 1000;
                        const randomDelay = Math.floor(Math.random() * (max - min + 1) + min);
                        localStorage.setItem('materio_sereine_next_random', (now + randomDelay).toString());
                    }
                }
            } catch (err) {
                console.error("Failed to fetch Sereine wallpaper", err);
            }
        }

        if (!wallpaperData && cachedWallpaperStr) {
            try {
                wallpaperData = JSON.parse(cachedWallpaperStr);
            } catch (e) {}
        }

        if (wallpaperData && wallpaperData.imageUrl) {
            currentSereineImageUrl = wallpaperData.imageUrl;
            if (wallpaperData.artistName) sereineArtistName = wallpaperData.artistName;
            const homeElem = document.getElementById('home');
            if (homeElem) homeElem.style.setProperty("--bg-img", `url('${currentSereineImageUrl}')`);
            
            const sereinePreview = document.getElementById('sereinePreview');
            if (sereinePreview) {
                sereinePreview.style.backgroundImage = `url('${currentSereineImageUrl}')`;
            }

            const sereineModalPreview = document.getElementById('sereineModalPreview');
            if (sereineModalPreview) {
                sereineModalPreview.style.backgroundImage = `url('${currentSereineImageUrl}')`;
            }

            const artistElem = document.getElementById('sereineArtistName');
            if (artistElem && sereineArtistName) {
                artistElem.textContent = sereineArtistName;
            }
        }
    }

    function applySereineWallpaper() {
        fetchSereineWallpaper();
    }

    function startSereineWallpaperTimer() {
        if (!browser) return;
        if (sereineWallpaperInterval) clearInterval(sereineWallpaperInterval);
        sereineWallpaperInterval = setInterval(() => {
            const selectedWallpaper = getCookie("selectedWallpaper");
            if (selectedWallpaper === 'sereine') {
                const frequency = localStorage.getItem('materio_sereine_frequency') || 'everytime';
                if (frequency !== 'everytime') {
                    fetchSereineWallpaper(false);
                }
            }
        }, 10 * 60 * 1000);
    }

    function stopSereineWallpaperTimer() {
        if (sereineWallpaperInterval) {
            clearInterval(sereineWallpaperInterval);
            sereineWallpaperInterval = null;
        }
    }

    function getDynamicImageIndex() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const totalMinutes = hours * 60 + minutes;

        if (totalMinutes >= 345 && totalMinutes < 360) return 0;
        else if (totalMinutes >= 360 && totalMinutes < 405) return 1;
        else if (totalMinutes >= 405 && totalMinutes < 1065) return 2;
        else if (totalMinutes >= 1065 && totalMinutes < 1080) return 3;
        else if (totalMinutes >= 1080 && totalMinutes < 1140) return 4;
        else if (totalMinutes >= 1140 && totalMinutes < 1185) return 5;
        else if (totalMinutes >= 1185 && totalMinutes < 1430) return 6;
        else if (totalMinutes >= 1430 || totalMinutes < 30) return 7;
        else if (totalMinutes >= 30 && totalMinutes < 345) return 8;

        return 0;
    }

    function applyDynamicWallpaper() {
        if (!browser) return;
        const index = getDynamicImageIndex();
        const imageUrl = `url('/assets/img/events/dynamic/part_${index}.webp')`;
        const homeElem = document.getElementById('home');
        if (homeElem) homeElem.style.setProperty("--bg-img", imageUrl);

        updateDynamicPreview();
    }

    function updateDynamicPreview() {
        if (!browser) return;
        const dynamicPreview = document.getElementById('dynamicPreview');
        const dynamicTime = document.getElementById('dynamicTime');

        if (dynamicPreview) {
            const index = getDynamicImageIndex();
            const imageUrl = `/assets/img/events/dynamic/part_${index}.webp`;
            dynamicPreview.style.backgroundImage = `url('${imageUrl}')`;
            dynamicPreview.style.backgroundSize = 'cover';
            dynamicPreview.style.backgroundPosition = 'center';
            dynamicPreview.style.animation = 'none';
        }

        if (dynamicTime) {
            const now = new Date();
            dynamicTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    function startDynamicWallpaperTimer() {
        if (!browser) return;
        if (dynamicWallpaperInterval) clearInterval(dynamicWallpaperInterval);
        dynamicWallpaperInterval = setInterval(() => {
            const selectedWallpaper = getCookie("selectedWallpaper");
            if (selectedWallpaper === 'dynamic') {
                applyDynamicWallpaper();
            }
        }, 60000);
    }

    function stopDynamicWallpaperTimer() {
        if (dynamicWallpaperInterval) {
            clearInterval(dynamicWallpaperInterval);
            dynamicWallpaperInterval = null;
        }
    }

    function getChristmasImageUrl() {
        const now = new Date();
        const totalMinutes = now.getHours() * 60 + now.getMinutes();

        if (totalMinutes >= 405 && totalMinutes < 1065) return `url('/assets/img/events/dynamic/christmas/part_2.webp')`;
        else if (totalMinutes >= 1065 && totalMinutes < 1080) return `url('/assets/img/events/dynamic/christmas/part_3.webp')`;
        else if (totalMinutes >= 1080 && totalMinutes < 1140) return `url('/assets/img/events/dynamic/christmas/part_4.webp')`;
        else if (totalMinutes >= 1140 && totalMinutes < 1280) return `url('/assets/img/events/dynamic/christmas/part_5.webp')`;
        else if (totalMinutes >= 1280 && totalMinutes < 1430) return `url('/assets/img/events/dynamic/christmas/part_6.webp')`;
        else if (totalMinutes >= 1430 || totalMinutes < 345) return `url('/assets/img/events/dynamic/christmas/part_8.webp')`;
        
        return `url('/assets/img/events/dynamic/christmas/part_2.webp')`;
    }

    function applyChristmasDynamicWallpaper() {
        if (!browser) return;
        const imageUrl = getChristmasImageUrl();
        const homeElem = document.getElementById('home');
        if (homeElem) homeElem.style.setProperty("--bg-img", imageUrl);

        updateChristmasPreview();
    }

    function updateChristmasPreview() {
        if (!browser) return;
        const christmasPreview = document.getElementById('christmasPreview');
        const christmasTime = document.getElementById('christmasTime');

        if (christmasPreview) {
            const bgStyle = getChristmasImageUrl();
            const imageUrl = bgStyle.slice(5, -2);
            christmasPreview.style.backgroundImage = `url('${imageUrl}')`;
            christmasPreview.style.backgroundSize = 'cover';
            christmasPreview.style.backgroundPosition = 'center';
        }

        if (christmasTime) {
            const now = new Date();
            christmasTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    function startChristmasWallpaperTimer() {
        if (!browser) return;
        if (christmasWallpaperInterval) clearInterval(christmasWallpaperInterval);
        christmasWallpaperInterval = setInterval(() => {
            const selectedWallpaper = getCookie("selectedWallpaper");
            if (selectedWallpaper === 'christmas-dynamic') {
                applyChristmasDynamicWallpaper();
            }
        }, 60000);
    }

    function stopChristmasWallpaperTimer() {
        if (christmasWallpaperInterval) {
            clearInterval(christmasWallpaperInterval);
            christmasWallpaperInterval = null;
        }
    }

    function applyCustomWallpaper() {
        if (!browser) return;
        const customUrl = localStorage.getItem('materio_custom_wallpaper');
        if (customUrl) {
            const homeElem = document.getElementById('home');
            if (homeElem) homeElem.style.setProperty("--bg-img", `url('${customUrl}')`);
            
            const customPreview = document.getElementById('customPreview');
            if (customPreview) {
                customPreview.style.backgroundImage = `url('${customUrl}')`;
                customPreview.style.backgroundSize = 'cover';
                customPreview.style.backgroundPosition = 'center';
            }
        } else {
            setCookie("selectedWallpaper", "dynamic");
            applyDynamicWallpaper();
        }
    }

    function setWallpaperAsBackground(wallpaperType) {
        if (!browser) return;
        const homeElem = document.getElementById('home');
        if (!homeElem) return;

        if (!isWallpaperEnabled) {
            homeElem.style.setProperty("--bg-img", "none");
            updateSelectedCardUI(wallpaperType);
            return;
        }

        setTimeout(() => {
            if (!isWallpaperEnabled) {
                homeElem.style.setProperty("--bg-img", "none");
                updateSelectedCardUI(wallpaperType);
                return;
            }
            const selectedCard = document.querySelector(`[data-wallpaper="${wallpaperType}"]`);
            
            if (wallpaperType === 'dynamic') {
                applyDynamicWallpaper();
            } else if (wallpaperType === 'christmas-dynamic') {
                applyChristmasDynamicWallpaper();
            } else if (wallpaperType === 'sereine') {
                applySereineWallpaper();
            } else if (wallpaperType === 'custom') {
                applyCustomWallpaper();
            } else if (selectedCard && selectedCard.dataset.bgImage && selectedCard.dataset.bgImage !== '') {
                homeElem.style.setProperty("--bg-img", selectedCard.dataset.bgImage);
            } else if (wallpaperType === 'default') {
                homeElem.style.setProperty("--bg-img", "url('/assets/img/events/hero.webp')");
            }
            
            updateSelectedCardUI(wallpaperType);
        }, 10);
    }
    
    function updateSelectedCardUI(wallpaperType) {
        if (!browser) return;
        const wallpaperCards = document.querySelectorAll('.wallpaper-preview-card');
        wallpaperCards.forEach(card => {
            card.classList.remove('selected');
            if (card.dataset.wallpaper === wallpaperType) {
                card.classList.add('selected');
            }
        });
    }

    function handleWallpaperChange(e) {
        if (!browser) return;
        if (e.detail) {
            if (typeof e.detail.enabled === 'boolean') {
                isWallpaperEnabled = e.detail.enabled;
            } else {
                isWallpaperEnabled = checkWallpaperEnabled();
            }

            const homeElem = document.getElementById('home');

            if (!isWallpaperEnabled) {
                stopDynamicWallpaperTimer();
                stopChristmasWallpaperTimer();
                stopSereineWallpaperTimer();
                if (homeElem) homeElem.style.setProperty("--bg-img", "none");
                return;
            }

            const wallpaperType = e.detail.wallpaperType || currentWallpaperType;
            currentWallpaperType = wallpaperType;
            setCookie("selectedWallpaper", wallpaperType);
            setWallpaperAsBackground(wallpaperType);
            
            stopDynamicWallpaperTimer();
            stopChristmasWallpaperTimer();
            stopSereineWallpaperTimer();
            
            if (wallpaperType === 'dynamic') {
                startDynamicWallpaperTimer();
            } else if (wallpaperType === 'christmas-dynamic') {
                startChristmasWallpaperTimer();
            } else if (wallpaperType === 'sereine') {
                startSereineWallpaperTimer();
            }
        }
    }

    function handleWatermarkSave() {
        if (!browser) return;
        if (window.MaterioHaptics) window.MaterioHaptics.vibrate('tick');
        if (currentSereineImageUrl) {
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
            } catch (err) {}
        }
    }

    onMount(() => {
        if (browser) {
            isWallpaperEnabled = checkWallpaperEnabled();
            const savedWallpaper = getCookie("selectedWallpaper") || 'dynamic';
            currentWallpaperType = savedWallpaper;
            const cachedStr = localStorage.getItem('materio_sereine_cache');
            if (cachedStr) {
                try {
                    const parsed = JSON.parse(cachedStr);
                    if (parsed.imageUrl) currentSereineImageUrl = parsed.imageUrl;
                    if (parsed.artistName) sereineArtistName = parsed.artistName;
                } catch {}
            }
            
            setTimeout(() => {
                const homeElem = document.getElementById('home');
                if (isWallpaperEnabled) {
                    setWallpaperAsBackground(savedWallpaper);
                    if (savedWallpaper === 'dynamic') {
                        startDynamicWallpaperTimer();
                    } else if (savedWallpaper === 'christmas-dynamic') {
                        startChristmasWallpaperTimer();
                    } else if (savedWallpaper === 'sereine') {
                        startSereineWallpaperTimer();
                    }
                } else {
                    if (homeElem) homeElem.style.setProperty("--bg-img", "none");
                }
            }, 100);
            
            updateDynamicPreview();
            updateChristmasPreview();
            
            window.addEventListener('materioWallpaperChange', handleWallpaperChange);
            window.addEventListener('materioWallpaperToggle', handleWallpaperChange);
        }
    });

    onDestroy(() => {
        if (browser) {
            stopDynamicWallpaperTimer();
            stopChristmasWallpaperTimer();
            stopSereineWallpaperTimer();
            window.removeEventListener('materioWallpaperChange', handleWallpaperChange);
            window.removeEventListener('materioWallpaperToggle', handleWallpaperChange);
        }
    });
</script>

{#if $activeTab === 'home' && isWallpaperEnabled && currentWallpaperType === 'sereine'}
<div id="sereineWatermark">
    <span id="sereineArtistText">Image by<br><strong id="sereineArtistName">{sereineArtistName || 'Curated'}</strong></span>
    <div class="sereine-actions">
        <button id="sereineShuffleBtn" title="Shuffle Wallpaper" on:click={() => fetchSereineWallpaper(true)}>
            <HugeIcon name="shuffle" />
        </button>
        <button id="sereineSaveBtn" title="Save to Store" on:click={handleWatermarkSave}>
            <HugeIcon name="favourite" />
        </button>
    </div>
</div>
{/if}
