// Materio PDF sidecar bridge for the oread (PDF.js) viewer.
// Persists the viewer’s OWN annotations (text, highlight, ink/draw, …)
// without touching the PDF file itself.
//
// How it works:
// - PDF.js keeps every annotation edit in pdfDocument.annotationStorage,
//   but the live values are AnnotationEditor *instances* (not cloneable),
//   and `onSetModified` fires only once per document. So this bridge:
//     1. snapshots via `annotationStorage.serializable` (plain JSON per
//        editor) instead of `getAll()` (live class instances that fail
//        structured-clone across postMessage);
//     2. detects edits by wrapping setValue/remove + all storage hooks +
//        a polling fallback (ink sessions mutate editors in place);
//     3. restores by deserializing each saved entry through its page's
//        AnnotationEditorLayer (plain setValue would store data but never
//        render anything).
// - The parent stores the snapshot locally (IndexedDB sidecar keyed by the
//   SHA-256 of the PDF bytes), so annotations reappear on next open.
//
// Parent -> viewer:
//   { type:'materioAnnotInit', annotations:{ storage:{...} } }
//   { type:'materioAnnotFlush' }  (parent asks for an immediate snapshot,
//     e.g. right before the close-prompt / Ctrl+S so no stroke is lost)
// Viewer -> parent:
//   { type:'materioAnnotReady' }
//   { type:'materioAnnotChanged', annotations:{ storage:{...} } }
//   { type:'materioAnnotSynced', annotations:{ storage:{...} } }
//     (sent right after a restore with the new canonical snapshot so the
//     parent can rebase its clean baseline instead of flagging dirty)
//   { type:'materioAnnotSaveRequest' } (Ctrl/Cmd+S pressed inside the viewer)

(function () {
    'use strict';

    var SAVE_DEBOUNCE_MS = 400;
    var RESTORE_RETRY_MS = 1000;
    var RESTORE_MAX_ATTEMPTS = 30;

    var pending = null; // snapshot waiting for a document
    var applying = false; // true while restoring (suppresses echo saves)
    var saveTimer = null;
    var hookedDoc = null;
    var lastEmitted = '';
    var appliedIds = {}; // oldId -> true for the current document
    var restoreTimer = null;
    var pollTimer = null;

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

    function stableStringify(obj) {
        try {
            var keys = Object.keys(obj || {}).sort();
            var parts = [];
            for (var i = 0; i < keys.length; i++) {
                parts.push(JSON.stringify(keys[i]) + ':' + JSON.stringify(obj[keys[i]]));
            }
            return '{' + parts.join(',') + '}';
        } catch (e) {
            try {
                return JSON.stringify(obj || {});
            } catch (e2) {
                return '';
            }
        }
    }

    // Plain-JSON snapshot of the viewer's editor annotations. Uses the
    // `serializable` getter (each editor's serialize()) so the result is
    // postMessage/IndexedDB-safe. Entries whose image bitmap can't be
    // persisted (stamp/signature photos) are skipped rather than failing
    // the whole snapshot.
    function snapshotPlain() {
        var st = storage();
        if (!st) return null;
        try {
            var s = null;
            try {
                s = st.serializable;
            } catch (e) {
                s = null;
            }
            if (s && s.map && typeof s.map.forEach === 'function' && s.map.size > 0) {
                var out = {};
                var ok = false;
                s.map.forEach(function (val, key) {
                    if (!val || typeof val !== 'object') return;
                    if (val.bitmap) return; // can't persist ImageBitmap reliably; skip
                    try {
                        var copy = JSON.parse(JSON.stringify(val));
                        if (copy && typeof copy === 'object') {
                            out[key] = copy;
                            ok = true;
                        }
                    } catch (e) {
                        /* skip uncloneable entry */
                    }
                });
                return out;
            }
            // No serializable editors (or empty) — fall back to getAll for
            // plain form-field values, dropping live editor instances.
            try {
                var all = st.getAll();
                if (!all) return {};
                var plain = {};
                for (var k in all) {
                    if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
                    var v = all[k];
                    if (v && typeof v === 'object' && (v.div || v.parent || v._uiManager)) continue;
                    try {
                        plain[k] = JSON.parse(JSON.stringify(v));
                    } catch (e) {
                        /* skip */
                    }
                }
                return plain;
            } catch (e) {
                return {};
            }
        } catch (e) {
            return null;
        }
    }

    function emitChangedNow() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        if (applying) return;
        var snap = snapshotPlain();
        if (!snap) return;
        var str = stableStringify(snap);
        if (str === lastEmitted) return;
        lastEmitted = str;
        try {
            window.parent.postMessage({ type: 'materioAnnotChanged', annotations: { storage: snap } }, '*');
        } catch (e) { /* ignore */ }
    }

    function emitChanged() {
        if (applying) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            saveTimer = null;
            emitChangedNow();
        }, SAVE_DEBOUNCE_MS);
    }

    function hookStorage() {
        var st = storage();
        if (!st || st.__materioSidecar) return;
        try {
            st.__materioSidecar = true;
        } catch (e) {
            return;
        }
        // Wrap mutators: onSetModified fires only on the FIRST edit per
        // document, so every subsequent edit would otherwise be missed.
        try {
            var origSet = st.setValue.bind(st);
            st.setValue = function (k, v) {
                var r = origSet(k, v);
                if (!applying) emitChanged();
                return r;
            };
        } catch (e) { /* ignore */ }
        try {
            var origRemove = st.remove.bind(st);
            st.remove = function (k) {
                var r = origRemove(k);
                if (!applying) emitChanged();
                return r;
            };
        } catch (e) { /* ignore */ }
        try {
            st.onSetModified = function () {
                if (!applying) emitChanged();
            };
            st.onResetModified = function () {
                if (!applying) emitChanged();
            };
            st.onAnnotationEditor = function () {
                if (!applying) emitChanged();
            };
        } catch (e) { /* ignore */ }
    }

    function ensurePoll() {
        if (pollTimer) return;
        pollTimer = setInterval(function () {
            if (applying || !pdfDoc()) return;
            try {
                var snap = snapshotPlain();
                if (!snap) return;
                var str = stableStringify(snap);
                if (str !== lastEmitted) {
                    lastEmitted = str;
                    try {
                        window.parent.postMessage({ type: 'materioAnnotChanged', annotations: { storage: snap } }, '*');
                    } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
        }, 2000);
    }

    function viewer() {
        var a = app();
        return (a && a.pdfViewer) || null;
    }

    // Restore saved entries by creating real editors through each page's
    // AnnotationEditorLayer. Retries until pages are rendered.
    async function applyPending(attempt) {
        if (!pending) return;
        var v = viewer();
        var st = storage();
        if (!v || !pdfDoc() || !st) {
            scheduleRestore((attempt || 0) + 1);
            return;
        }
        var keys = Object.keys(pending);
        if (!keys.length) {
            pending = null;
            return;
        }
        applying = true;
        var remaining = [];
        try {
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (appliedIds[key]) continue;
                var data = pending[key];
                if (!data || typeof data !== 'object') {
                    appliedIds[key] = true;
                    continue;
                }
                var pageIndex = (data.pageIndex != null) ? data.pageIndex : 0;
                var layer = null;
                try {
                    var pageView = v.getPageView ? v.getPageView(pageIndex) : null;
                    var builder = pageView && pageView.annotationEditorLayer;
                    layer = builder && builder.annotationEditorLayer;
                } catch (e) {
                    layer = null;
                }
                if (!layer || typeof layer.deserialize !== 'function') {
                    remaining.push(key);
                    continue;
                }
                try {
                    var editor = await layer.deserialize(data);
                    if (editor && typeof layer.addOrRebuild === 'function') {
                        layer.addOrRebuild(editor);
                        appliedIds[key] = true;
                    } else if (editor) {
                        appliedIds[key] = true;
                    } else {
                        remaining.push(key);
                    }
                } catch (e) {
                    remaining.push(key);
                }
            }
        } finally {
            applying = false;
        }
        if (!remaining.length) {
            pending = null;
            if (restoreTimer) {
                clearTimeout(restoreTimer);
                restoreTimer = null;
            }
            hookStorage();
            // Rebase: report the canonical post-restore snapshot (fresh ids)
            // so the parent treats restored annotations as clean.
            try {
                var snap = snapshotPlain() || {};
                lastEmitted = stableStringify(snap);
                window.parent.postMessage({ type: 'materioAnnotSynced', annotations: { storage: snap } }, '*');
            } catch (e) { /* ignore */ }
        } else {
            scheduleRestore((attempt || 0) + 1);
        }
    }

    function scheduleRestore(attempt) {
        if (!pending) return;
        if ((attempt || 0) > RESTORE_MAX_ATTEMPTS) return;
        if (restoreTimer) clearTimeout(restoreTimer);
        restoreTimer = setTimeout(function () {
            restoreTimer = null;
            applyPending(attempt || 0);
        }, RESTORE_RETRY_MS);
    }

    function onDocReady() {
        hookStorage();
        ensurePoll();
        if (pending) {
            applyPending(0);
        } else {
            // Baseline the empty state so the first real edit is detected
            // even if hooks were attached late.
            try {
                var snap = snapshotPlain();
                if (snap) lastEmitted = stableStringify(snap);
            } catch (e) { /* ignore */ }
        }
        try {
            window.parent.postMessage({ type: 'materioAnnotReady' }, '*');
        } catch (e) { /* ignore */ }
    }

    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || typeof data.type !== 'string') return;
        if (data.type === 'materioAnnotInit') {
            var map = (data.annotations && data.annotations.storage) || {};
            appliedIds = {};
            if (pdfDoc()) {
                pending = map;
                hookStorage();
                applyPending(0);
            } else {
                pending = map;
                scheduleRestore(0);
            }
        } else if (data.type === 'materioAnnotFlush') {
            emitChangedNow();
        }
    });

    // Ctrl/Cmd+S inside the viewer never reaches the parent (iframe focus),
    // so forward it explicitly. capture=true beats the viewer's own handler.
    document.addEventListener('keydown', function (e) {
        try {
            var mod = e.ctrlKey || e.metaKey;
            if (mod && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
                e.preventDefault();
                e.stopPropagation();
                emitChangedNow();
                try {
                    window.parent.postMessage({ type: 'materioAnnotSaveRequest' }, '*');
                } catch (err) { /* ignore */ }
                return false;
            }
        } catch (err) { /* ignore */ }
    }, true);

    // Poll until the viewer app exists, then follow document swaps.
    // (annotationStorage is per-document, so every new PDF needs a re-hook.)
    setInterval(function () {
        var d = pdfDoc();
        if (d !== hookedDoc) {
            hookedDoc = d;
            if (d) {
                try {
                    var a = app();
                    if (a && a.eventBus && !a.eventBus.__materioSidecar) {
                        a.eventBus.__materioSidecar = true;
                        try {
                            a.eventBus.on('documentloaded', onDocReady);
                        } catch (e) { /* ignore */ }
                    }
                } catch (e) { /* ignore */ }
                onDocReady();
            } else {
                appliedIds = {};
            }
        }
    }, 500);
})();
