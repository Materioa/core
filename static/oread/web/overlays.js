// Overlay Handler for PDF.js Viewer
// Handles Paper Mode and Night Reading overlays for PDF content

(function () {
    'use strict';

    const ACTIVITY_THROTTLE_MS = 1000;
    let lastActivityPing = 0;

    function reportPdfActivity(source = 'viewer') {
        const now = Date.now();
        if (now - lastActivityPing < ACTIVITY_THROTTLE_MS) return;
        lastActivityPing = now;
        try {
            window.parent.postMessage({
                type: 'pdfUserActivity',
                source,
                ts: now
            }, '*');
        } catch (e) {
            // ignore
        }
    }

    // Listen for overlay mode messages from parent window
    window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'overlayMode') {
            const { mode, enable } = event.data;

            if (mode && typeof enable === 'boolean') {
                // For most modes we apply to body (paper/night/eink)
                if (mode === 'invert') {
                    // Invert applies to the viewer element (PDF canvas)
                    const viewerElem = document.getElementById('viewer');
                    if (viewerElem) {
                        if (enable) {
                            viewerElem.classList.add('invert');
                        } else {
                            viewerElem.classList.remove('invert');
                        }
                        // Force PDF.js to repaint so canvas pages pick up the CSS filter.
                        setTimeout(() => {
                            try {
                                if (window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer) {
                                    window.PDFViewerApplication.pdfViewer.update();
                                }
                            } catch (e) {
                                // ignore
                            }
                        }, 50);
                    }
                } else {
                    if (enable) {
                        document.body.classList.add(mode);
                    } else {
                        document.body.classList.remove(mode);
                    }
                }
            }
        }        // Handle theme synchronization
        if (event.data && event.data.type === 'themeMode') {
            const { isDark, actualMode } = event.data;

            if (typeof isDark === 'boolean') {
                document.body.classList.remove('dark-mode', 'light-mode', 'coffee-mode', 'coffee-dark-mode');
                
                if (actualMode === 'coffee') {
                    document.body.classList.add('coffee-mode');
                    document.documentElement.classList.remove('is-dark');
                    document.documentElement.classList.add('is-light');
                } else if (actualMode === 'coffee-dark') {
                    document.body.classList.add('coffee-dark-mode');
                    document.body.classList.add('dark-mode');
                    document.documentElement.classList.add('is-dark');
                    document.documentElement.classList.remove('is-light');
                } else if (isDark) {
                    document.body.classList.add('dark-mode');
                    document.documentElement.classList.add('is-dark');
                    document.documentElement.classList.remove('is-light');
                } else {
                    document.body.classList.add('light-mode');
                    document.documentElement.classList.remove('is-dark');
                    document.documentElement.classList.add('is-light');
                }

                // For debugging
                // console.log('PDF viewer theme changed to: ' + (isDark ? 'dark' : 'light'));

                // Force repaint of viewer elements to ensure theme is applied
                setTimeout(() => {
                    if (window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer) {
                        window.PDFViewerApplication.pdfViewer.update();
                    }
                }, 100);
            }
        }
        // Handle night mode warmth adjustment
        if (event.data && event.data.type === 'nightWarmth') {
            const { opacity } = event.data;

            if (typeof opacity === 'number') {
                document.documentElement.style.setProperty('--warmth-opacity', opacity);
                // console.log('PDF viewer night warmth updated:', opacity);

                // Apply warmth immediately if night reading mode is active
                if (document.body.classList.contains('night-reading')) {
                    // Force repaint of viewer elements to ensure warmth changes are applied
                    setTimeout(() => {
                        if (window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer) {
                            window.PDFViewerApplication.pdfViewer.update();
                        }
                    }, 50);
                }
            }
        }

        // Handle paper texture changes
        if (event.data && event.data.type === 'paperTexture') {
            const { textureUrl } = event.data;

            if (textureUrl) {
                // Set the paper texture CSS variable on the body
                document.body.style.setProperty('--paper-texture-url', `url('${textureUrl}')`);
                // console.log('PDF viewer paper texture updated:', textureUrl);

                // Force repaint of viewer elements to ensure texture changes are applied
                if (document.body.classList.contains('paper-mode')) {
                    setTimeout(() => {
                        if (window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer) {
                            window.PDFViewerApplication.pdfViewer.update();
                        }
                    }, 50);
                }
            }
        }

        // Handle grain size changes
        if (event.data && event.data.type === 'grainSize') {
            const { sizePx } = event.data;

            if (sizePx) {
                // Set the grain size CSS variable on the body
                document.body.style.setProperty('--grain-size', `${sizePx}px`);
                // console.log('PDF viewer grain size updated:', sizePx);

                // Force repaint of viewer elements to ensure size changes are applied
                if (document.body.classList.contains('paper-mode')) {
                    setTimeout(() => {
                        if (window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer) {
                            window.PDFViewerApplication.pdfViewer.update();
                        }
                    }, 50);
                }
            }
        }
    });

    // Function to request current overlay modes from parent
    function requestOverlayModes() {
        try {
            window.parent.postMessage({
                type: 'applyOverlayModes'
            }, '*');
        } catch (e) {
            // console.log('Could not request overlay modes from parent');
        }
    }
    // Notify parent window about PDF loading events for haptic feedback
    function setupPdfLoadingNotifications() {
        if (!window.PDFViewerApplication) return;

        // Listen for PDF.js events
        const eventBus = window.PDFViewerApplication.eventBus;
        if (!eventBus) {
            // Fallback: try using domcontentloaded on the document
            waitForPdfLoad();
            return;
        }

        // Progress event during PDF download
        eventBus.on('progress', function (evt) {
            if (evt.loaded && evt.total) {
                try {
                    window.parent.postMessage({
                        type: 'pdfProgress',
                        loaded: evt.loaded,
                        total: evt.total
                    }, '*');
                } catch (e) { }
            }
        });

        // Document loaded event - PDF file fully downloaded
        eventBus.on('documentloaded', function () {
            reportPdfActivity('documentloaded');
            try {
                window.parent.postMessage({
                    type: 'pdfLoaded'
                }, '*');
            } catch (e) { }
        });

        eventBus.on('pagesloaded', function () {
            reportPdfActivity('pagesloaded');
            try {
                window.parent.postMessage({
                    type: 'pdfLoaded'
                }, '*');
            } catch (e) { }
        });

        eventBus.on('pagechanging', function () {
            reportPdfActivity('pagechanging');
        });

        eventBus.on('updateviewarea', function () {
            reportPdfActivity('updateviewarea');
        });

        // Error event
        eventBus.on('documenterror', function (evt) {
            try {
                window.parent.postMessage({
                    type: 'pdfError',
                    message: evt.message || 'Unknown error'
                }, '*');
            } catch (e) { }
        });
    }

    // Fallback for when eventBus is not available
    function waitForPdfLoad() {
        // Check periodically if PDF is loaded
        let checkCount = 0;
        const maxChecks = 60; // 30 seconds max

        const checkInterval = setInterval(function () {
            checkCount++;

            if (window.PDFViewerApplication && window.PDFViewerApplication.pdfDocument) {
                clearInterval(checkInterval);
                try {
                    window.parent.postMessage({
                        type: 'pdfLoaded'
                    }, '*');
                } catch (e) { }
            } else if (checkCount >= maxChecks) {
                clearInterval(checkInterval);
            }
        }, 500);
    }

    // Initialize theme based on system preference if not set by parent
    function initializeTheme() {
        // If no theme class is present, check system preference
        if (!document.body.classList.contains('dark-mode') && !document.body.classList.contains('light-mode')) {
            const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (prefersDarkMode) {
                document.body.classList.add('dark-mode');
                document.documentElement.classList.add('is-dark');
                document.documentElement.classList.remove('is-light');
            } else {
                document.body.classList.add('light-mode');
                document.documentElement.classList.remove('is-dark');
                document.documentElement.classList.add('is-light');
            }
            // console.log('PDF viewer initial theme set based on system preference: ' + 
            //             (prefersDarkMode ? 'dark' : 'light'));
        }
    }

    function setupUserActivityNotifications() {
        const viewerContainer = document.getElementById('viewerContainer');
        const viewer = document.getElementById('viewer');

        const mark = () => reportPdfActivity('interaction');

        if (viewerContainer) {
            viewerContainer.addEventListener('scroll', mark, { passive: true });
            viewerContainer.addEventListener('wheel', mark, { passive: true });
            viewerContainer.addEventListener('touchmove', mark, { passive: true });
        }

        if (viewer) {
            viewer.addEventListener('scroll', mark, { passive: true });
            viewer.addEventListener('wheel', mark, { passive: true });
            viewer.addEventListener('touchmove', mark, { passive: true });
        }

        document.addEventListener('keydown', mark, { passive: true });
        document.addEventListener('mousedown', mark, { passive: true });
    }

    // Call setupUserActivityNotifications in initializeOverlays
    function initializeOverlays() {
        // Check if PDF.js viewer is ready
        if (window.PDFViewerApplication && window.PDFViewerApplication.initialized) {
            requestOverlayModes();
            initializeTheme();
            setupPdfLoadingNotifications();
            setupUserActivityNotifications();
        } else {
            // Wait for PDF.js to initialize
            document.addEventListener('webviewerloaded', function () {
                requestOverlayModes();
                initializeTheme();
                setupPdfLoadingNotifications();
                setupUserActivityNotifications();
            });

            // Fallback: try after a short delay
            setTimeout(function () {
                requestOverlayModes();
                initializeTheme();
                setupPdfLoadingNotifications();
                setupUserActivityNotifications();
            }, 1000);
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeOverlays);
    } else {
        initializeOverlays();
    }
})();


document.addEventListener('DOMContentLoaded', () => {
    const toggleInvertBtn = document.getElementById('toggleInvert');
    if (toggleInvertBtn) {
        toggleInvertBtn.addEventListener('click', () => {
            const viewer = document.getElementById('viewer');
            if (viewer) {
                viewer.classList.toggle('invert');

                if (window.PDFViewerApplication && window.PDFViewerApplication.pdfViewer) {
                    setTimeout(() => {
                        try {
                            window.PDFViewerApplication.pdfViewer.update();
                        } catch (e) {
                        }
                    }, 50);
                }
            }
        });
    }
});
