// Materio PDF sidecar bridge for the oread (PDF.js) viewer.
// Persists the viewer’s OWN annotations (text, highlight, ink/draw, …)
// without touching the PDF file itself.
//
// How it works:
// - PDF.js keeps every annotation edit in pdfDocument.annotationStorage.
// - This script forwards a snapshot to the parent app on every change and
//   applies snapshots the parent sends back when the same PDF is opened.
// - The parent stores the snapshot locally (IndexedDB sidecar keyed by the
//   SHA-256 of the PDF bytes), so annotations reappear on next open.
//
// Parent -> viewer:
//   { type:'materioAnnotInit', annotations:{ storage:{...} } }
// Viewer -> parent:
//   { type:'materioAnnotReady' }
//   { type:'materioAnnotChanged', annotations:{ storage:{...} } }

(function () {
    'use strict';

    var SAVE_DEBOUNCE_MS = 500;

    var pending = null; // snapshot waiting for a document
    var applying = false; // true while restoring (suppresses echo saves)
    var saveTimer = null;
    var hookedDoc = null;
    var busHooked = false;

    function app() {
        return window.PDFViewerApplication || null;
    }

    function pdfDoc() {
        var a = app();
        return (a && a.pdfDocument) || null;
    }

    function storage() {
        var d = pdfDoc();
        return (d && d.annotationStorage) || null;
    }

    function snapshot() {
        var st = storage();
        if (!st) return null;
        try {
            return st.getAll() || {};
        } catch (e) {
            return null;
        }
    }

    function apply(map) {
        var st = storage();
        if (!st || !map) return;
        applying = true;
        try {
            for (var key in map) {
                if (Object.prototype.hasOwnProperty.call(map, key)) {
                    st.setValue(key, map[key]);
                }
            }
        } catch (e) { /* ignore malformed entries */ }
        applying = false;
    }

    function emitChanged() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            saveTimer = null;
            if (applying) return;
            var all = snapshot();
            if (!all) return;
            try {
                window.parent.postMessage({ type: 'materioAnnotChanged', annotations: { storage: all } }, '*');
            } catch (e) { /* ignore */ }
        }, SAVE_DEBOUNCE_MS);
    }

    function hookStorage() {
        var st = storage();
        if (!st || st.__materioSidecar) return;
        st.__materioSidecar = true;
        try {
            st.onSetModified = emitChanged;
            st.onResetModified = emitChanged;
        } catch (e) { /* ignore */ }
    }

    function onDocReady() {
        hookStorage();
        if (pending) {
            var p = pending;
            pending = null;
            apply(p);
        }
        try {
            window.parent.postMessage({ type: 'materioAnnotReady' }, '*');
        } catch (e) { /* ignore */ }
    }

    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || typeof data.type !== 'string') return;
        if (data.type === 'materioAnnotInit') {
            var map = data.annotations && data.annotations.storage;
            if (pdfDoc()) {
                apply(map || {});
                hookStorage();
            } else {
                pending = map || {};
            }
        }
    });

    // Poll until the viewer app exists, then follow document swaps.
    // (annotationStorage is per-document, so every new PDF needs a re-hook.)
    setInterval(function () {
        var d = pdfDoc();
        if (d !== hookedDoc) {
            hookedDoc = d;
            busHooked = false;
            if (d) {
                try {
                    var a = app();
                    if (a && a.eventBus && !a.eventBus.__materioSidecar) {
                        a.eventBus.__materioSidecar = true;
                        busHooked = true;
                        a.eventBus.on('documentloaded', onDocReady);
                    }
                } catch (e) { /* ignore */ }
                onDocReady();
            }
        }
    }, 500);
})();
