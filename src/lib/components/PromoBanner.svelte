<script>
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment';
import HugeIcon from './HugeIcon.svelte';
    import { trackModalView, trackModalEvent, runMagicJs } from '$lib/utils/promoMagic.js';

    let promoData = null;
    let magicCleanup = null;
    let currentImageIndex = 0;
    let imageRotationTimer = null;
    let isVideoPaused = false;
    let isVideoMuted = true;
    let isVideo = false;
    let currentMediaSrc = '';

    // UI state variables
    let promoTitle = 'Special Offer';
    let parsedDescription = '';
    let dateInfoText = '';
    let showPrimaryBtn = false;
    let primaryText = 'View Offer';
    let primaryHref = '#';
    let primaryTarget = '_blank';
    let showPrimaryIcon = true;
    let primaryIconName = 'tag';

    let showSecondaryBtn = false;
    let secondaryText = 'Remind me later';
    let showSecondaryIcon = true;
    let secondaryIconName = 'clock';

    let showDisclaimer = false;
    let disclaimerText = '*Terms and conditions apply.';
    let disclaimerLinkText = 'Read more';
    let disclaimerLinkUrl = '#';

    let showDontShowAgain = false;
    let dontShowAgainText = "Don't show this again";
    let dontShowAgainChecked = false;

    let isVertical = false;
    let mediaFit = 'cover';
    let hasMedia = false;

    // DOM references
    let modalOverlay;
    let modalElement;
    let promoImageContainer;
    let promoCoverImg;
    let promoVideoEl;

    // --- Magic actions + per-modal tracking ---
    function promoMagicId(data) {
        return data?.id || data?._id || data?.title || 'promo';
    }
    function firePromoMagic(stage, extra = {}) {
        if (!promoData) return;
        const id = promoMagicId(promoData);
        const title = promoData.title || 'Promotion';
        const trackingId = promoData.trackingId || promoData.gaId || promoData.gtmId || '';
        const trackViews = promoData.trackViews ?? true;
        const root = modalElement || (typeof document !== 'undefined' ? document.querySelector('#promoModal .promo-modal') : null) || (browser ? document.body : null);
        const overlay = modalOverlay || (root?.closest?.('.promo-modal-overlay') ?? null) || (browser ? document.body : null);
        if (stage === 'open') {
            trackModalView({ id, title, kind: 'promotion', trackingId, trackViews });
        } else if (stage === 'close' || stage === 'cta_click' || stage === 'remind_later') {
            if (trackingId) trackModalEvent({ id, title, kind: 'promotion', trackingId, action: stage === 'cta_click' ? 'promo_cta_click' : stage === 'remind_later' ? 'promo_remind_later' : 'promo_close', params: extra });
        }
        const code = promoData.magicJs || promoData.magic?.js || '';
        const enabled = promoData.magicEnabled ?? promoData.magic?.enabled ?? !!String(code).trim();
        if (stage === 'close') {
            try { if (typeof magicCleanup === 'function') magicCleanup(); } catch {}
            magicCleanup = null;
            return;
        }
        if (stage !== 'open' || !code || !enabled) return;
        const cleanup = runMagicJs(code, {
            root, overlay, data: promoData, id, title, kind: 'promotion', stage,
            trackingId,
            close: () => closePromoModal()
        }, { enabled: true });
        if (stage === 'open' && typeof cleanup === 'function') magicCleanup = cleanup;
    }

    // --- Markdown Parser (exact match to parent promotions.js) ---
    function parseMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.+?)__/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/_(.+?)_/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 4px; font-family: &quot;Berkeley Mono&quot;, &quot;Cascadia Mono&quot;, monospace;">$1</code>')
            .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" style="color: #ff6b00; text-decoration: underline;">$1</a>')
            .replace(/\n/g, '<br>')
            .replace(/^(\d+)\.\s+(.+)$/gm, '<div style="margin: 8px 0; padding-left: 20px;"><strong>$1.</strong> $2</div>')
            .replace(/^[-*]\s+(.+)$/gm, '<div style="margin: 8px 0; padding-left: 20px;">• $1</div>');
    }

    // --- Device Detection (exact match to parent promotions.js) ---
    function detectDeviceType() {
        if (!browser) return 'desktop';
        const userAgent = navigator.userAgent;
        const isIPad = /iPad/i.test(userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(userAgent));
        if (isIPad) return 'tablet';
        if (/iPhone|iPod/i.test(userAgent)) return 'mobile';
        if (/Android/i.test(userAgent)) {
            return /Mobile/i.test(userAgent) ? 'mobile' : 'tablet';
        }
        if (/webOS|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) return 'mobile';
        if (/Windows|Macintosh|Mac OS X|Linux|CrOS/i.test(userAgent)) return 'desktop';
        return 'desktop';
    }

    function checkDeviceType(showOn) {
        if (!showOn) return true;
        const allowedDevices = Array.isArray(showOn) ? showOn : [showOn];
        const normalizedDevices = allowedDevices.map(d => String(d).toLowerCase());
        if (normalizedDevices.includes('all')) return true;
        const currentDevice = detectDeviceType();
        return normalizedDevices.includes(currentDevice);
    }

    // --- Frequency Check (exact match to parent promotions.js) ---
    function checkFrequency(frequency, customFrequencyHours) {
        if (!frequency) frequency = 'once';
        if (!browser || typeof localStorage === 'undefined') return true;

        const now = Date.now();
        const lastShown = localStorage.getItem('promoLastShown');
        const lastShownTime = lastShown ? parseInt(lastShown, 10) : 0;

        switch (frequency) {
            case 'once':
                if (lastShown) return false;
                break;
            case 'custom':
                if (!customFrequencyHours || customFrequencyHours <= 0) {
                    if (lastShown) return false;
                } else {
                    const customDelay = customFrequencyHours * 60 * 60 * 1000;
                    if (lastShown && (now - lastShownTime) < customDelay) return false;
                }
                break;
            case 'every-3hr': {
                const threeHours = 3 * 60 * 60 * 1000;
                if (lastShown && (now - lastShownTime) < threeHours) return false;
                break;
            }
            case 'every-6hr': {
                const sixHours = 6 * 60 * 60 * 1000;
                if (lastShown && (now - lastShownTime) < sixHours) return false;
                break;
            }
            case 'every-12hr': {
                const twelveHours = 12 * 60 * 60 * 1000;
                if (lastShown && (now - lastShownTime) < twelveHours) return false;
                break;
            }
            case 'daily': {
                const oneDay = 24 * 60 * 60 * 1000;
                if (lastShown && (now - lastShownTime) < oneDay) return false;
                break;
            }
            case 'every-3days': {
                const threeDays = 3 * 24 * 60 * 60 * 1000;
                if (lastShown && (now - lastShownTime) < threeDays) return false;
                break;
            }
            case 'random': {
                const remindLaterTime = localStorage.getItem('promoRemindLaterTime');
                if (remindLaterTime) {
                    const reminderTime = parseInt(remindLaterTime, 10);
                    if (now < reminderTime) {
                        return false;
                    } else {
                        localStorage.removeItem('promoRemindLaterTime');
                    }
                }
                break;
            }
            case 'everytime':
                return true;
            default:
                if (lastShown) return false;
        }
        return true;
    }

    // --- Should Display Check ---
    function shouldDisplayPromotion(data) {
        if (!data || data.enabled === false || data.isActive === false) return false;
        if (!checkDeviceType(data.showOn)) return false;

        if (data.isLimitedOffer && data.startDate && data.endDate) {
            const now = new Date();
            const startDate = new Date(data.startDate);
            const endDate = new Date(data.endDate);
            if (!isNaN(startDate.getTime()) && now < startDate) return false;
            if (!isNaN(endDate.getTime()) && now > endDate) return false;
        }

        if (browser && typeof localStorage !== 'undefined') {
            const dontShowAgain = localStorage.getItem('promoDoNotShowAgain');
            if (dontShowAgain === 'true') return false;
        }

        if (!checkFrequency(data.frequency, data.customFrequencyHours)) {
            return false;
        }

        return true;
    }

    // --- Video helper ---
    function isVideoFile(url) {
        if (!url) return false;
        const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv', '.flv', '.mkv'];
        const urlLower = url.toLowerCase();
        return videoExtensions.some(ext => urlLower.endsWith(ext));
    }

    // --- Map icon name helper for HugeIcon ---
    function normalizeIconName(iconStr, defaultName) {
        if (!iconStr) return defaultName;
        const s = iconStr.toLowerCase();
        if (s.includes('tag')) return 'tag';
        if (s.includes('clock')) return 'clock';
        if (s.includes('gift')) return 'gift';
        if (s.includes('star')) return 'star';
        if (s.includes('sparkle')) return 'sparkles';
        if (s.includes('heart')) return 'favourite';
        if (s.includes('arrow-right')) return 'arrow-right-01';
        if (s.includes('close') || s.includes('times')) return 'cancel-01';
        return defaultName;
    }

    // --- Display Logic ---
    function populateAndShowPromotion(data) {
        promoData = data;
        promoTitle = data.title || 'Special Announcement';
        parsedDescription = parseMarkdown(data.description || '');

        const orientation = (data.orientation || 'horizontal').toLowerCase();
        const isMobileBottomSheet = browser && window.matchMedia('(max-width: 500px)').matches;
        isVertical = orientation === 'vertical' && !isMobileBottomSheet;

        mediaFit = data.mediaFit || 'cover';

        // Limited offer date info
        const shouldShowDateInfo = data.showDateInfo !== undefined ? data.showDateInfo : true;
        if (shouldShowDateInfo && data.isLimitedOffer && data.startDate && data.endDate) {
            const endDate = new Date(data.endDate);
            if (!isNaN(endDate.getTime())) {
                dateInfoText = `Offer valid till ${endDate.toLocaleDateString()}`;
            } else {
                dateInfoText = '';
            }
        } else {
            dateInfoText = '';
        }

        // Primary button
        if (data.buttons && data.buttons.primary && data.buttons.primary.show) {
            showPrimaryBtn = true;
            primaryText = (data.buttons.primary.text && data.buttons.primary.text.trim() !== '')
                ? data.buttons.primary.text
                : 'View Offer';
            
            const rawIcon = data.buttons.primary.icon;
            if (rawIcon && rawIcon.trim() !== '' && rawIcon !== '&#8206;' && rawIcon !== '\u200E') {
                showPrimaryIcon = true;
                primaryIconName = normalizeIconName(rawIcon, 'tag');
            } else if (rawIcon === '&#8206;' || rawIcon === '\u200E' || rawIcon === '') {
                showPrimaryIcon = false;
            } else {
                showPrimaryIcon = true;
                primaryIconName = 'tag';
            }

            if (data.link && data.link !== 'null' && data.link !== null) {
                primaryHref = data.link;
                primaryTarget = data.link.startsWith('#') ? '_self' : '_blank';
            } else {
                primaryHref = '#';
                primaryTarget = '_self';
            }
        } else {
            showPrimaryBtn = false;
        }

        // Secondary button
        if (data.buttons && data.buttons.secondary && data.buttons.secondary.show) {
            showSecondaryBtn = true;
            secondaryText = (data.buttons.secondary.text && data.buttons.secondary.text.trim() !== '')
                ? data.buttons.secondary.text
                : 'Remind me later';
            
            const rawSecIcon = data.buttons.secondary.icon;
            if (rawSecIcon && rawSecIcon.trim() !== '' && rawSecIcon !== '&#8206;' && rawSecIcon !== '\u200E') {
                showSecondaryIcon = true;
                secondaryIconName = normalizeIconName(rawSecIcon, 'clock');
            } else if (rawSecIcon === '&#8206;' || rawSecIcon === '\u200E' || rawSecIcon === '') {
                showSecondaryIcon = false;
            } else {
                showSecondaryIcon = true;
                secondaryIconName = 'clock';
            }
        } else {
            showSecondaryBtn = false;
        }

        // Disclaimer
        if (data.disclaimer && data.disclaimer.show) {
            showDisclaimer = true;
            disclaimerText = (data.disclaimer.text && data.disclaimer.text.trim() !== '')
                ? data.disclaimer.text
                : '*Terms and conditions apply.';
            disclaimerLinkText = (data.disclaimer.linkText && data.disclaimer.linkText.trim() !== '')
                ? data.disclaimer.linkText
                : 'Read more';
            disclaimerLinkUrl = (data.disclaimer.linkUrl && data.disclaimer.linkUrl.trim() !== '')
                ? data.disclaimer.linkUrl
                : '#';
        } else {
            showDisclaimer = false;
        }

        // Don't show again option
        if (data.options && data.options.showDontShowAgain) {
            showDontShowAgain = true;
            dontShowAgainText = (data.options.dontShowAgainText && data.options.dontShowAgainText.trim() !== '')
                ? data.options.dontShowAgainText
                : "Don't show this again";
        } else {
            showDontShowAgain = false;
        }

        // Media handling
        const mediaItems = data.media || data.images || (data.imageUrl ? [data.imageUrl] : []);
        if (mediaItems && mediaItems.length > 0) {
            hasMedia = true;
            currentImageIndex = 0;
            currentMediaSrc = mediaItems[0];
            isVideo = isVideoFile(currentMediaSrc);

            if (mediaItems.length > 1) {
                setupImageRotation(mediaItems, data.imageRotationInterval || 5000, data.imageAnimation);
            }
        } else {
            hasMedia = false;
            currentMediaSrc = '';
            isVideo = false;
        }

        // Open modal with delay matching parent (1000ms)
        setTimeout(() => {
            if (modalOverlay) {
                modalOverlay.style.display = 'flex';
                modalOverlay.classList.add('show');
                if (browser) {
                    document.body.classList.add('modal-open');
                    localStorage.setItem('promoLastShown', Date.now().toString());
                }
                firePromoMagic('open');
            }
        }, 1000);
    }

    function setupImageRotation(images, interval, animationConfig) {
        if (!images || images.length <= 1) return;
        if (imageRotationTimer) clearInterval(imageRotationTimer);

        const defaultAnimation = { type: 'fade', duration: 600, direction: 'left' };
        const animation = { ...defaultAnimation, ...animationConfig };

        imageRotationTimer = setInterval(() => {
            currentImageIndex = (currentImageIndex + 1) % images.length;
            const newSrc = images[currentImageIndex];
            applyMediaAnimation(newSrc, animation);
        }, interval);
    }

    function applyMediaAnimation(newSrc, animationConfig) {
        const activeEl = isVideo ? promoVideoEl : promoCoverImg;
        if (activeEl) {
            activeEl.style.opacity = '0';
        }

        setTimeout(() => {
            currentMediaSrc = newSrc;
            isVideo = isVideoFile(newSrc);

            let animationClass = 'fade';
            if (typeof animationConfig.type === 'string' && animationConfig.type.startsWith('slide-')) {
                animationClass = animationConfig.type;
            } else if (animationConfig.type === 'slide') {
                animationClass = `slide-${animationConfig.direction || 'left'}`;
            } else if (animationConfig.type) {
                animationClass = animationConfig.type;
            }

            setTimeout(() => {
                const targetEl = isVideo ? promoVideoEl : promoCoverImg;
                if (targetEl) {
                    targetEl.classList.add(animationClass);
                    targetEl.style.opacity = '1';
                    setTimeout(() => {
                        targetEl.classList.remove(animationClass);
                    }, (animationConfig.duration || 600) + 50);
                }
            }, 50);
        }, 100);
    }

    // Video Controls
    function togglePlayPause() {
        if (!promoVideoEl) return;
        if (promoVideoEl.paused) {
            promoVideoEl.play();
            isVideoPaused = false;
        } else {
            promoVideoEl.pause();
            isVideoPaused = true;
        }
    }

    function toggleMute() {
        if (!promoVideoEl) return;
        if (promoVideoEl.muted) {
            promoVideoEl.muted = false;
            isVideoMuted = false;
        } else {
            promoVideoEl.muted = true;
            isVideoMuted = true;
        }
    }

    // Modal Close
    export function closePromoModal() {
        firePromoMagic('close');
        if (dontShowAgainChecked && browser && typeof localStorage !== 'undefined') {
            localStorage.setItem('promoDoNotShowAgain', 'true');
        }

        if (promoVideoEl) {
            promoVideoEl.pause();
            promoVideoEl.currentTime = 0;
            promoVideoEl.muted = true;
        }

        if (modalOverlay) {
            const promoModalElement = modalOverlay.querySelector('.promo-modal');
            if (promoModalElement) {
                promoModalElement.style.willChange = 'transform, opacity';
                promoModalElement.classList.add('closing');

                modalOverlay.style.transition = 'opacity 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
                modalOverlay.style.opacity = '0';

                setTimeout(() => {
                    modalOverlay.style.display = 'none';
                    modalOverlay.classList.remove('show');
                    modalOverlay.style.opacity = '';
                    modalOverlay.style.transition = '';
                    promoModalElement.classList.remove('closing');
                    promoModalElement.style.willChange = '';
                    promoModalElement.style.transform = '';
                    if (browser) {
                        document.body.classList.remove('modal-open');
                    }
                }, 400);
            } else {
                modalOverlay.style.display = 'none';
                modalOverlay.classList.remove('show');
                if (browser) {
                    document.body.classList.remove('modal-open');
                }
            }
        }

        if (imageRotationTimer) {
            clearInterval(imageRotationTimer);
            imageRotationTimer = null;
        }
    }

    export function remindMeLater() {
        firePromoMagic('remind_later');
        if (promoVideoEl) {
            promoVideoEl.pause();
            promoVideoEl.currentTime = 0;
            promoVideoEl.muted = true;
        }

        if (modalOverlay) {
            modalOverlay.style.display = 'none';
            modalOverlay.classList.remove('show');
            if (browser) {
                document.body.classList.remove('modal-open');
            }
        }

        if (imageRotationTimer) {
            clearInterval(imageRotationTimer);
            imageRotationTimer = null;
        }

        let delayHours = 6;
        if (promoData && promoData.frequency === 'random') {
            delayHours = Math.random() < 0.3 ? 6 : Math.floor(Math.random() * 10) + 3;
        }

        if (browser && typeof localStorage !== 'undefined') {
            const remindLaterTime = Date.now() + (delayHours * 60 * 60 * 1000);
            localStorage.setItem('promoRemindLaterTime', remindLaterTime.toString());
        }
    }

    function handlePrimaryClick(e) {
        firePromoMagic('cta_click', { href: primaryHref });
        if (primaryHref.startsWith('#')) {
            e.preventDefault();
            closePromoModal();
            setTimeout(() => {
                const target = document.querySelector(primaryHref);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    if (target.focus) target.focus();
                }
            }, 300);
        } else if (primaryHref === '#' || !primaryHref) {
            e.preventDefault();
            closePromoModal();
        }
    }

    // Load Promotion via API
    async function loadAndDisplayPromotion() {
        try {
            const timestamp = Date.now();
            let response = await fetch(`/api/v2/promotions?t=${timestamp}`);
            if (!response.ok) {
                response = await fetch(`/assets/data/promo.json?t=${timestamp}`);
            }
            if (!response.ok) return;

            const data = await response.json();
            if (shouldDisplayPromotion(data)) {
                populateAndShowPromotion(data);
            }
        } catch (error) {
            console.error('Error loading promotion:', error);
        }
    }

    // --- Mobile Drag-to-Dismiss Gesture Handling ---
    function initMobileSwipe() {
        if (!browser || !modalOverlay) return;

        const MOBILE_BREAKPOINT = 500;
        const DISMISS_THRESHOLD = 80;
        const VELOCITY_THRESHOLD = 0.5;

        let startY = 0;
        let currentY = 0;
        let startTime = 0;
        let isDragging = false;
        let canDismiss = false;

        function handleTouchStart(e) {
            if (window.innerWidth > MOBILE_BREAKPOINT) return;
            const modalEl = modalOverlay.querySelector('.promo-modal');
            if (!modalEl) return;

            const touchY = e.touches[0].clientY;
            const modalRect = modalEl.getBoundingClientRect();
            const handleAreaHeight = 80;

            const isNearTop = touchY < (modalRect.top + handleAreaHeight);
            const isScrolledToTop = modalEl.scrollTop <= 5;
            canDismiss = isNearTop || isScrolledToTop;

            if (!canDismiss) return;

            startY = touchY;
            currentY = touchY;
            startTime = Date.now();
            isDragging = true;

            modalEl.style.transition = 'none';
            modalEl.style.willChange = 'transform';
        }

        function handleTouchMove(e) {
            if (!isDragging || window.innerWidth > MOBILE_BREAKPOINT) return;
            const modalEl = modalOverlay.querySelector('.promo-modal');
            if (!modalEl) return;

            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;

            if (deltaY > 0 && canDismiss) {
                const resistance = 0.6;
                const dampedDeltaY = deltaY * resistance;
                modalEl.style.transform = `translateY(${dampedDeltaY}px)`;
                const opacity = Math.max(0.2, 1 - (deltaY / 300));
                modalOverlay.style.backgroundColor = `rgba(0, 0, 0, ${0.5 * opacity})`;
                e.preventDefault();
            } else if (deltaY < 0 && canDismiss) {
                isDragging = false;
                canDismiss = false;
                modalEl.style.transform = '';
                modalEl.style.willChange = '';
            }
        }

        function handleTouchEnd() {
            if (!isDragging || window.innerWidth > MOBILE_BREAKPOINT) {
                isDragging = false;
                canDismiss = false;
                return;
            }

            const modalEl = modalOverlay.querySelector('.promo-modal');
            if (!modalEl) return;

            const deltaY = currentY - startY;
            const elapsedTime = Date.now() - startTime;
            const velocity = deltaY / (elapsedTime || 1);

            modalEl.style.transition = 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
            modalOverlay.style.transition = 'background-color 0.4s cubic-bezier(0.32, 0.72, 0, 1)';

            const shouldDismiss = canDismiss && (deltaY > DISMISS_THRESHOLD || velocity > VELOCITY_THRESHOLD);

            if (shouldDismiss) {
                modalEl.style.transform = 'translateY(100%)';
                modalOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';

                setTimeout(() => {
                    modalEl.style.willChange = '';
                    closePromoModal();
                    modalEl.style.transform = '';
                    modalEl.style.transition = '';
                    modalOverlay.style.backgroundColor = '';
                    modalOverlay.style.transition = '';
                }, 400);
            } else {
                modalEl.style.transform = 'translateY(0)';
                modalOverlay.style.backgroundColor = '';

                setTimeout(() => {
                    modalEl.style.transform = '';
                    modalEl.style.transition = '';
                    modalEl.style.willChange = '';
                    modalOverlay.style.transition = '';
                }, 400);
            }

            isDragging = false;
            canDismiss = false;
            startY = 0;
            currentY = 0;
        }

        modalOverlay.addEventListener('touchstart', handleTouchStart, { passive: true });
        modalOverlay.addEventListener('touchmove', handleTouchMove, { passive: false });
        modalOverlay.addEventListener('touchend', handleTouchEnd, { passive: true });
        modalOverlay.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    }

    onMount(() => {
        // Expose parent global methods on window
        window.closePromoModal = closePromoModal;
        window.remindMeLater = remindMeLater;
        window.loadAndDisplayPromotion = loadAndDisplayPromotion;
        window.reloadPromotionData = () => loadAndDisplayPromotion();
        window.testPromoModal = () => {
            if (modalOverlay) {
                modalOverlay.style.display = 'flex';
                modalOverlay.classList.add('show');
                document.body.classList.add('modal-open');
            }
        };
        window.resetPromoSettings = () => {
            localStorage.removeItem('promoDoNotShowAgain');
            localStorage.removeItem('promoLastShown');
            localStorage.removeItem('promoRemindLaterTime');
            loadAndDisplayPromotion();
        };
        window.forceLoadPromo = () => loadAndDisplayPromotion();

        initMobileSwipe();
        loadAndDisplayPromotion();
    });

    onDestroy(() => {
        try { if (typeof magicCleanup === 'function') magicCleanup(); } catch {}
        magicCleanup = null;
        if (imageRotationTimer) {
            clearInterval(imageRotationTimer);
            imageRotationTimer = null;
        }
    });
</script>

<!-- Promotional Modal (Content Dynamically Loaded) matching parent _includes/main.html lines 507-567 -->
<div class="promo-modal-overlay" id="promoModal" bind:this={modalOverlay} style="display: none;">
    <div
        class="promo-modal"
        bind:this={modalElement}
        class:promo-orientation-vertical={isVertical}
        class:no-image={!hasMedia}
    >
        <!-- Close Button -->
        <button
            type="button"
            class="promo-close-btn"
            on:click={closePromoModal}
            aria-label="Close"
            style="background: none; border: none; cursor: pointer; color: inherit; display: flex; align-items: center; justify-content: center;"
        >
            <HugeIcon name="cancel-01" />
        </button>

        <!-- Left Section: Media Panel -->
        <div
            class="promo-image"
            bind:this={promoImageContainer}
            style={hasMedia ? 'display: flex;' : 'display: none;'}
        >
            {#if currentMediaSrc && !isVideo}
                <img
                    bind:this={promoCoverImg}
                    src={currentMediaSrc}
                    class="promo-cover"
                    alt={promoTitle}
                    style="display: block; object-fit: {mediaFit};"
                />
            {/if}

            {#if currentMediaSrc && isVideo}
                <video
                    bind:this={promoVideoEl}
                    class="promo-video"
                    muted
                    autoplay
                    loop
                    playsinline
                    style="display: block; object-fit: {mediaFit};"
                >
                    <source src={currentMediaSrc} type="video/mp4" />
                    <source src={currentMediaSrc} type="video/webm" />
                    Your browser does not support the video tag.
                </video>
                <div class="video-controls" style="display: flex;">
                    <button class="video-control-btn play-pause-btn" title="Play/Pause" type="button" on:click={togglePlayPause}>
                        <HugeIcon name={isVideoPaused ? 'play' : 'pause'} />
                    </button>
                    <button class="video-control-btn mute-unmute-btn" title="Mute/Unmute" type="button" on:click={toggleMute}>
                        <HugeIcon name={isVideoMuted ? 'volume-xmark' : 'volume-high'} />
                    </button>
                </div>
            {/if}
        </div>

        <!-- Right Section: Content Panel -->
        <div class="promo-content">
            <h2><span class="promo-title">{promoTitle}</span></h2>
            <p class="promo-description">{@html parsedDescription}</p>

            {#if dateInfoText}
                <p class="promo-date-info" style="font-style: italic; color: #888; font-size: 0.9em; margin-top: 10px;">
                    {dateInfoText}
                </p>
            {/if}

            <!-- Action Buttons -->
            <div class="promo-actions">
                {#if showPrimaryBtn}
                    <a
                        href={primaryHref}
                        target={primaryTarget}
                        class="promo-link"
                        on:click={handlePrimaryClick}
                        style="display: inline-block;"
                    >
                        <button id="offerButton" class="site-button promo-primary-btn" type="button">
                            {#if showPrimaryIcon}
                                <span class="promo-primary-icon" style="margin-left: 5px; margin-right: 10px; display: inline-flex; align-items: center;">
                                    <HugeIcon name={primaryIconName} />
                                </span>
                            {/if}
                            <span class="promo-button-text">{primaryText}</span>
                        </button>
                    </a>
                {/if}
                {#if showSecondaryBtn}
                    <button
                        id="remindLaterBtn"
                        class="site-button promo-secondary-btn"
                        type="button"
                        on:click={remindMeLater}
                        style="display: flex;"
                    >
                        {#if showSecondaryIcon}
                            <span class="promo-secondary-icon" style="margin-right: 8px; display: inline-flex; align-items: center;">
                                <HugeIcon name={secondaryIconName} />
                            </span>
                        {/if}
                        <span class="promo-secondary-text">{secondaryText}</span>
                    </button>
                {/if}
            </div>

            <!-- Disclaimer / Link Row -->
            {#if showDisclaimer}
                <small class="promo-disclaimer" style="display: block;">
                    <span class="promo-disclaimer-text">{disclaimerText}</span>
                    {#if disclaimerLinkText}
                        {' '}<a href={disclaimerLinkUrl} target="_blank" rel="noopener noreferrer" class="promo-disclaimer-link">{disclaimerLinkText}</a>.
                    {/if}
                </small>
            {/if}

            <!-- Don't show again option -->
            {#if showDontShowAgain}
                <div class="promo-options" style="display: block;">
                    <label class="promo-checkbox-label">
                        <input type="checkbox" id="dontShowAgainCheckbox" bind:checked={dontShowAgainChecked} class="promo-checkbox" />
                        <span class="promo-checkbox-text">{dontShowAgainText}</span>
                    </label>
                </div>
            {/if}
        </div>
    </div>
</div>
