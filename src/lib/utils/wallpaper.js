    function setWallpaperAsBackground(wallpaperType) {
        const selectedCard = document.querySelector(`[data-wallpaper="${wallpaperType}"]`);
        updateSereineWatermarkVisibility();

        if (selectedCard) {
            const bgImage = selectedCard.dataset.bgImage;
            if (wallpaperType === 'dynamic') {
                // Apply dynamic wallpaper
                applyDynamicWallpaper();
            } else if (wallpaperType === 'christmas-dynamic') {
                // Apply Christmas dynamic wallpaper
                applyChristmasDynamicWallpaper();
            } else if (wallpaperType === 'sereine') {
                // Apply Sereine Carousel
                applySereineWallpaper();
            } else if (wallpaperType === 'custom') {
                // Apply custom uploaded wallpaper
                applyCustomWallpaper();
            } else if (bgImage && bgImage !== '') {
                homeElem.style.setProperty("--bg-img", bgImage);
            } else {
                // Default background - apply event background directly
                if (cachedEventToApply) {
                    updateBgFromEvent(cachedEventToApply);
                } else {
                    // Load and apply event background
                    initEventData();
                }
            }
        } else {

        }
    }

    // Dynamic wallpaper functionality
    function getDynamicImageIndex() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const totalMinutes = hours * 60 + minutes;

        // Custom time mappings for part_0 to part_8
        // part_0: 5:45 AM - 6:00 AM
        if ((totalMinutes >= 345 && totalMinutes < 360)) { // 5:45-6:00 AM
            return 0;
        }
        // part_1: 6:00 AM - 6:45 AM
        else if (totalMinutes >= 360 && totalMinutes < 405) { // 6:00-6:45 AM
            return 1;
        }
        // part_2: 6:45 AM - 5:45 AM (next day) - This seems like it should be PM, assuming 6:45 AM - 5:45 PM
        else if (totalMinutes >= 405 && totalMinutes < 1065) { // 6:45 AM - 5:45 PM
            return 2;
        }
        // part_3: 5:45 PM - 6:00 PM
        else if (totalMinutes >= 1065 && totalMinutes < 1080) { // 5:45-6:00 PM
            return 3;
        }
        // part_4: 6:00 PM - 7:00 PM
        else if (totalMinutes >= 1080 && totalMinutes < 1140) { // 6:00-7:00 PM
            return 4;
        }
        // part_5: 7:00 PM - 7:45 PM
        else if (totalMinutes >= 1140 && totalMinutes < 1185) { // 7:00-7:45 PM
            return 5;
        }
        // part_6: 7:45 PM - 11:50 PM
        else if (totalMinutes >= 1185 && totalMinutes < 1430) { // 7:45-11:50 PM
            return 6;
        }
        // part_7: 11:50 PM - 12:30 AM (next day)
        else if (totalMinutes >= 1430 || totalMinutes < 30) { // 11:50 PM - 12:30 AM
            return 7;
        }
        // part_8: 12:30 AM - 5:45 AM
        else if (totalMinutes >= 30 && totalMinutes < 345) { // 12:30-5:45 AM
            return 8;
        }

        // Fallback to part_0
        return 0;
    }

    function getDynamicImageUrl(customEventConfig) {
        if (customEventConfig && customEventConfig.dynamic_config) {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const totalMinutes = hours * 60 + minutes;

            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateString = `${year}-${month}-${day}`;

            for (const config of customEventConfig.dynamic_config) {
                // Check for exclusive dates
                if (config.exclusive_dates) {
                    if (!config.exclusive_dates.includes(dateString)) {
                        continue;
                    }
                }

                const [startHour, startMinute] = config.start.split(':').map(Number);
                const [endHour, endMinute] = config.end.split(':').map(Number);

                const startTotal = startHour * 60 + startMinute;
                const endTotal = endHour * 60 + endMinute;

                // Handle ranges that cross midnight (e.g. 23:00 to 01:00)
                if (startTotal > endTotal) {
                    if (totalMinutes >= startTotal || totalMinutes < endTotal) {
                        return `url('${config.image}')`;
                    }
                } else {
                    if (totalMinutes >= startTotal && totalMinutes < endTotal) {
                        return `url('${config.image}')`;
                    }
                }
            }
        }

        const index = getDynamicImageIndex();
        return `url('/assets/img/events/dynamic/part_${index}.webp')`;
    }

    function applyDynamicWallpaper(customEventConfig = null) {
        // If no config passed, try to use cached event if it's dynamic
        if (!customEventConfig && cachedEventToApply && (cachedEventToApply.url_pc === 'dynamic' || cachedEventToApply.url_mobile === 'dynamic')) {
            customEventConfig = cachedEventToApply;
        }

        const imageUrl = getDynamicImageUrl(customEventConfig);
        homeElem.style.setProperty("--bg-img", imageUrl);

        // Update preview card to show current image
        updateDynamicPreview(customEventConfig);
    }
    // Expose for debugging/testing
    window.applyDynamicWallpaper = applyDynamicWallpaper;

    function updateDynamicPreview(customEventConfig = null) {
        const dynamicPreview = document.getElementById('dynamicPreview');
        const dynamicTime = document.getElementById('dynamicTime');

        if (dynamicPreview) {
            let imageUrl;
            if (customEventConfig && customEventConfig.dynamic_config) {
                // Extract URL from the result of getDynamicImageUrl which returns "url('...')"
                const bgStyle = getDynamicImageUrl(customEventConfig);
                // Remove url('') wrapper
                imageUrl = bgStyle.slice(5, -2);
            } else {
                const index = getDynamicImageIndex();
                imageUrl = `/assets/img/events/dynamic/part_${index}.webp`;
            }

            dynamicPreview.style.backgroundImage = `url('${imageUrl}')`;
            dynamicPreview.style.backgroundSize = 'cover';
            dynamicPreview.style.backgroundPosition = 'center';

            // Remove the animated gradient
            dynamicPreview.style.animation = 'none';
        }

        if (dynamicTime) {
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            dynamicTime.textContent = timeString;
        }
    }

    // Dynamic wallpaper timer
    let dynamicWallpaperInterval = null;

    function startDynamicWallpaperTimer() {
        // Clear any existing interval
        if (dynamicWallpaperInterval) {
            clearInterval(dynamicWallpaperInterval);
        }

        // Update every minute to check for time changes
        dynamicWallpaperInterval = setInterval(() => {
            const selectedWallpaper = getCookie("selectedWallpaper");
            if (selectedWallpaper === 'dynamic') {
                applyDynamicWallpaper();
            }
        }, 60000); // Update every minute
    }

    function stopDynamicWallpaperTimer() {
        if (dynamicWallpaperInterval) {
            clearInterval(dynamicWallpaperInterval);
            dynamicWallpaperInterval = null;
        }
    }

    // Christmas Dynamic Wallpaper Functions
    function getChristmasImageUrl() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const totalMinutes = hours * 60 + minutes;

        // Christmas dynamic wallpaper time mappings
        // part_2: 6:45 AM - 5:45 PM (daytime)
        if (totalMinutes >= 405 && totalMinutes < 1065) {
            return `url('/assets/img/events/dynamic/christmas/part_2.webp')`;
        }
        // part_3: 5:45 PM - 6:00 PM (sunset start)
        else if (totalMinutes >= 1065 && totalMinutes < 1080) {
            return `url('/assets/img/events/dynamic/christmas/part_3.webp')`;
        }
        // part_4: 6:00 PM - 7:00 PM (sunset)
        else if (totalMinutes >= 1080 && totalMinutes < 1140) {
            return `url('/assets/img/events/dynamic/christmas/part_4.webp')`;
        }
        // part_5: 7:00 PM - 9:20 PM (evening)
        else if (totalMinutes >= 1140 && totalMinutes < 1280) {
            return `url('/assets/img/events/dynamic/christmas/part_5.webp')`;
        }
        // part_6: 9:20 PM - 11:50 PM (night)
        else if (totalMinutes >= 1280 && totalMinutes < 1430) {
            return `url('/assets/img/events/dynamic/christmas/part_6.webp')`;
        }
        // part_8: 11:50 PM - 5:45 AM (late night)
        else if (totalMinutes >= 1430 || totalMinutes < 345) {
            return `url('/assets/img/events/dynamic/christmas/part_8.webp')`;
        }
        // Fallback to daytime
        return `url('/assets/img/events/dynamic/christmas/part_2.webp')`;
    }

    function applyChristmasDynamicWallpaper() {
        const imageUrl = getChristmasImageUrl();
        homeElem.style.setProperty("--bg-img", imageUrl);

        // Update Christmas preview card
        updateChristmasPreview();
    }

    function updateChristmasPreview() {
        const christmasPreview = document.getElementById('christmasPreview');
        const christmasTime = document.getElementById('christmasTime');

        if (christmasPreview) {
            const bgStyle = getChristmasImageUrl();
            // Remove url('') wrapper
            const imageUrl = bgStyle.slice(5, -2);
            christmasPreview.style.backgroundImage = `url('${imageUrl}')`;
            christmasPreview.style.backgroundSize = 'cover';
            christmasPreview.style.backgroundPosition = 'center';
        }

        if (christmasTime) {
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            christmasTime.textContent = timeString;
        }
    }

    // Christmas wallpaper timer
    let christmasWallpaperInterval = null;

    function startChristmasWallpaperTimer() {
        if (christmasWallpaperInterval) {
            clearInterval(christmasWallpaperInterval);
        }

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

    // Sereine Carousel Wallpaper Functions
    let sereineWallpaperInterval = null;
    let currentSereineImageUrl = null;

    async function fetchSereineWallpaper(force = false) {
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
                // Fetch if 24 hours have passed
                shouldFetch = (now - lastFetchTime) > 24 * 60 * 60 * 1000;
            } else if (frequency === '3days') {
                // Fetch if 72 hours have passed
                shouldFetch = (now - lastFetchTime) > 72 * 60 * 60 * 1000;
            } else if (frequency === 'week') {
                // Fetch if 7 days have passed
                shouldFetch = (now - lastFetchTime) > 7 * 24 * 60 * 60 * 1000;
            } else if (frequency === 'random') {
                // For random, we'll assign a random interval next target time in localStorage
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
                        // random between 45 min and 3 days (45 * 60 * 1000 to 72 * 60 * 60 * 1000)
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
            homeElem.style.setProperty("--bg-img", `url('${currentSereineImageUrl}')`);
            
            const sereinePreview = document.getElementById('sereinePreview');
            if (sereinePreview) {
                sereinePreview.style.backgroundImage = `url('${currentSereineImageUrl}')`;
            }

            const sereineModalPreview = document.getElementById('sereineModalPreview');
            if (sereineModalPreview) {
                sereineModalPreview.style.backgroundImage = `url('${currentSereineImageUrl}')`;
            }

            const artistNameElem = document.getElementById('sereineArtistName');
            if (artistNameElem && wallpaperData.artistName) {
                artistNameElem.textContent = wallpaperData.artistName;
            }
        }
    }

    function applySereineWallpaper() {
        // Fetch or apply cached based on rules
        fetchSereineWallpaper();
    }

    function startSereineWallpaperTimer() {
        if (sereineWallpaperInterval) {
            clearInterval(sereineWallpaperInterval);
        }

        // Check every 10 minutes if we should fetch (useful for everyday/random/week intervals while app is open)
        sereineWallpaperInterval = setInterval(() => {
            const selectedWallpaper = getCookie("selectedWallpaper");
            if (selectedWallpaper === 'sereine') {
                const frequency = localStorage.getItem('materio_sereine_frequency') || 'everytime';
                if (frequency !== 'everytime') {
                    fetchSereineWallpaper(false);
                }
            }
        }, 10 * 60 * 1000); // 10 mins
    }

    function stopSereineWallpaperTimer() {
        if (sereineWallpaperInterval) {
            clearInterval(sereineWallpaperInterval);
            sereineWallpaperInterval = null;
        }
    }

    window.closeSereineWallpaperModal = function() {
        const modal = document.getElementById('sereineWallpaperModal');
        if (modal) modal.style.display = 'none';
    };

    // Initialize Sereine UI Interactions
    function initSereineUI() {
        const items = document.querySelectorAll('.sereine-setting-item');
        const shuffleBtns = [document.getElementById('sereineShuffleBtn'), document.getElementById('sereineModalShuffleBtn')].filter(Boolean);
        const saveBtns = [document.getElementById('sereineSaveBtn'), document.getElementById('sereineModalSaveBtn')].filter(Boolean);

        const sereinePreview = document.getElementById('sereinePreview');
        if (sereinePreview) {
            sereinePreview.addEventListener('click', (e) => {
                const modal = document.getElementById('sereineWallpaperModal');
                if (modal) {
                    modal.style.display = 'flex';
                    const preview = document.getElementById('sereineModalPreview');
                    if (preview && currentSereineImageUrl) {
                        preview.style.backgroundImage = `url('${currentSereineImageUrl}')`;
                    }
