// Custom navigation for oread - Override default spacebar scrolling behavior
// Use spacebar for next page and shift+spacebar for previous page

(function() {
    'use strict';
    
    // Override default spacebar scroll behavior and implement page navigation
    document.addEventListener("keydown", function (e) {
        if (
            e.code === "Space" &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            !e.target.closest("input, textarea, [contenteditable]") // prevent when typing
        ) {
            e.preventDefault();

            // Wait for PDFViewerApplication to be available
            if (window.PDFViewerApplication) {
                if (e.shiftKey) {
                    // Shift + Space = previous page
                    if (window.PDFViewerApplication.page > 1) {
                        window.PDFViewerApplication.page--;
                    }
                } else {
                    // Space = next page
                    if (window.PDFViewerApplication.page < window.PDFViewerApplication.pagesCount) {
                        window.PDFViewerApplication.page++;
                    }
                }
            }
        }
    }, true); // Use capture phase to ensure we catch it first
})();
