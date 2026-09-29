// Materio PDF sidecar bridge for the oread (PDF.js) viewer.
// Persists the viewer’s OWN editor annotations (text, highlight, ink/draw)
// without touching the PDF file itself.
//
// How it works:
// - PDF.js keeps every editor annotation in pdfDocument.annotationStorage,
//   but the live values are AnnotationEditor *instances* (not cloneable),
//   and `onSetModified` fires only once per document. So this bridge:
//     1. snapshots via `annotationStorage.serializable` (each editor's
//        serialize() = plain JSON) instead of `getAll()` (live class
//        instances that fail structured-clone across postMessage);
//     2. snapshots and restores EDITOR data only (entries carrying
//        annotationType/annotationEditorType). Plain form-field values are
//        excluded so untouched PDFs never look "dirty";
//     3. detects edits by wrapping setValue/remove + all storage hooks +
//        a polling fallback (ink sessions mutate editors in place);
//     4. restores by deserializing each saved entry through its page's
//        AnnotationEditorLayer (plain setValue would store data but never
//        render anything). Entries that are not editor data, or point at
//        pages that never become available, are SKIPPED — one bad entry
//        must never poison the whole restore or the clean rebase;
//     5. dedupes repeated inits for the same document (the parent reposts
//        init as insurance against a lost first post; re-applying would
//        duplicate every editor and flag phantom changes).
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
//     (sent after every restore — including empty/partial ones — with the
//     canonical snapshot so the parent rebases its clean baseline instead
//     of flagging dirty)
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
    var lastInitStr = null; // dedupe key for repeated inits of one document
    var initApplied = false;
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

    function viewer() {
        var a = app();
        return (a && a.pdfViewer) || null;
    }

    // Only real editor annotations are sidecar material. Anything else
    // (form-field values, scripting details, …) is ignored so an untouched
    // PDF never reports changes and stale junk can never poison a restore.
    function isEditorData(v) {
        return !!v && typeof v === 'object' &&
            (v.annotationType != null || v.annotationEditorType != null);
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

    // Plain-JSON snapshot of the viewer's EDITOR annotations. Uses the
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
                s.map.forEach(function (val, key) {
                    if (!isEditorData(val)) return;
                    if (val.bitmap) return; // can't persist ImageBitmap reliably; skip
                    try {
                        var copy = JSON.parse(JSON.stringify(val));
                        if (copy && typeof copy === 'object') {
                            out[key] = copy;
                        }
                    } catch (e) {
                        /* skip uncloneable entry */
                    }
                });
                return out;
            }
            // No serializable editors — fall back to getAll, keeping editor
            // data only and dropping live editor instances.
            try {
                var all = st.getAll();
                if (!all) return {};
                var plain = {};
                for (var k in all) {
                    if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
                    var v = all[k];
                    if (v && typeof v === 'object' && (v.div || v.parent || v._uiManager)) continue;
                    if (!isEditorData(v)) continue;
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

    // Canonical post-restore snapshot. Always sent after a restore attempt
    // (full, partial or empty) so the parent rebases clean — a restore must
    // never leave the document looking dirty.
    function emitSynced() {
        try {
            var snap = snapshotPlain() || {};
            lastEmitted = stableStringify(snap);
            window.parent.postMessage({ type: 'materioAnnotSynced', annotations: { storage: snap } }, '*');
        } catch (e) { /* ignore */ }
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
        // (The snapshot-equality guard in emitChangedNow/poll keeps
        // no-op writes from ever reaching the parent.)
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

    function pageCount() {
        try {
            var v = viewer();
            if (v && typeof v.pagesCount === 'number') return v.pagesCount;
            var d = pdfDoc();
            if (d && typeof d.numPages === 'number') return d.numPages;
        } catch (e) { /* ignore */ }
        return -1;
    }

    // Restore saved entries by creating real editors through each page's
    // AnnotationEditorLayer. Entries that are not editor data, or target
    // pages that never become available, are skipped — never retried
    // forever, so one bad entry can't block the rebase.
    //
    // The viewer routinely loads a document TWICE per open (the initial
    // ?file= load, then the parent's loadFile closes + reopens it), so the
    // loop is pinned to the document it started on: if the document swaps
    // mid-restore it aborts immediately and leaves `pending` intact for the
    // new document's onDocReady. Without this, entries land in the doomed
    // document while appliedIds claims them done — nothing ever displays.
    async function applyPending(attempt) {
        if (!pending) return;
        var v = viewer();
        var myDoc = pdfDoc();
        var st = storage();
        if (!v || !myDoc || !st) {
            scheduleRestore((attempt || 0) + 1);
            return;
        }
        var keys = Object.keys(pending);
        if (!keys.length) {
            pending = null;
            initApplied = true;
            if (restoreTimer) {
                clearTimeout(restoreTimer);
                restoreTimer = null;
            }
            hookStorage();
            emitSynced();
            return;
        }
        var pages = pageCount();
        applying = true;
        var remaining = [];
        try {
            for (var i = 0; i < keys.length; i++) {
                if (pdfDoc() !== myDoc) return; // document swapped: abort,
                // keep pending + appliedIds for the new document's pass.
                var key = keys[i];
                if (appliedIds[key]) continue;
                var data = pending[key];
                if (!isEditorData(data)) {
                    appliedIds[key] = true; // stale junk: skip, never retry
                    continue;
                }
                var pageIndex = data.pageIndex;
                if (typeof pageIndex !== 'number' || !(pageIndex >= 0) ||
                    (pages > 0 && pageIndex >= pages)) {
                    appliedIds[key] = true; // unmappable: skip, never retry
                    continue;
                }
                var layer = null;
                try {
                    var pageView = v.getPageView ? v.getPageView(pageIndex) : null;
                    var builder = pageView && pageView.annotationEditorLayer;
                    layer = builder && builder.annotationEditorLayer;
                } catch (e) {
                    layer = null;
                }
                if (!layer || typeof layer.deserialize !== 'function') {
                    remaining.push(key); // page not rendered yet: retry
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
                        appliedIds[key] = true; // undeserializable: skip
                    }
                } catch (e) {
                    appliedIds[key] = true; // undeserializable: skip
                }
            }
        } finally {
            applying = false;
        }
        if (!remaining.length) {
            pending = null;
            initApplied = true;
            if (restoreTimer) {
                clearTimeout(restoreTimer);
                restoreTimer = null;
            }
            hookStorage();
            emitSynced();
        } else {
            scheduleRestore((attempt || 0) + 1, remaining);
        }
    }

    function scheduleRestore(attempt, remaining) {
        if (!pending) return;
        if ((attempt || 0) > RESTORE_MAX_ATTEMPTS) {
            // Pages never became available: restore what we could and rebase
            // anyway. A stuck pending restore must never leave phantom dirt.
            try {
                if (remaining) {
                    for (var i = 0; i < remaining.length; i++) {
                        appliedIds[remaining[i]] = true;
                    }
                }
            } catch (e) { /* ignore */ }
            pending = null;
            initApplied = true;
            hookStorage();
            emitSynced();
            return;
        }
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
            var str = stableStringify(map);
            if (str === lastInitStr && initApplied) {
                // Repeat post of an already-applied init (parent retries as
                // insurance): do NOT re-apply (that would duplicate every
                // editor) — just rebase the parent clean again.
                emitSynced();
                return;
            }
            lastInitStr = str;
            initApplied = false;
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
            lastInitStr = null;
            initApplied = false;
            appliedIds = {};
            if (d) {
                try {
                    var a = app();
                    if (a && a.eventBus && !a.eventBus.__materioSidecar) {
                        a.eventBus.__materioSidecar = true;
                        try {
                            a.eventBus.on('documentloaded', onDocReady);
                        } catch (e) { /* ignore */ }
                    }
                    // Pages render lazily: resume a pending restore whenever
                    // the user navigates, so annotations on later pages are
                    // restored once their layer exists.
                    if (a && a.eventBus && !a.eventBus.__materioSidecarPages) {
                        a.eventBus.__materioSidecarPages = true;
                        try {
                            a.eventBus.on('pagechanging', function () {
                                if (pending && !applying) {
                                    try { applyPending(0); } catch (e) { /* ignore */ }
                                }
                            });
                        } catch (e) { /* ignore */ }
                    }
                } catch (e) { /* ignore */ }
                onDocReady();
            }
        }
    }, 500);
})();
