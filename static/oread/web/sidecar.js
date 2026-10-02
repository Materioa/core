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

    // Diagnostic marker: grep the app log for ANNOTDIAG.
    function diag() {
        try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
                var a = arguments[i];
                parts.push(typeof a === 'string' ? a : JSON.stringify(a));
            }
            console.log('[ANNOTDIAG] ' + parts.join(' '));
            try {
                parent.postMessage({ type: 'materioAnnotDiag', line: parts.join(' ') }, '*');
            } catch (e2) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }

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

    // editor.id -> last known-good serialized entry for an editor we restored.
    //
    // PDF.js builds editors from raw editor data WITHOUT setting _initialData
    // (that field is only populated when deserializing an existing PDF
    // annotation), but HighlightEditor.serialize() calls #hasElementChanged(),
    // which destructures _initialData - so serialize() THROWS on every restored
    // highlight. snapshotPlain() caught the throw, skipped the key, and returned
    // {} - which the parent read as "this PDF has no annotations", rebased its
    // baseline to it, and then persisted the empty record. The annotations were
    // rendered correctly and then destroyed on the next save. That is the whole
    // "saved, but never comes back" bug.
    //
    // Keeping the entry we fed in gives the snapshot a truthful value for an
    // editor PDF.js refuses to serialize, so no restored editor can ever blank
    // the record again.
    var restoredFallback = {};
    // One-shot flags so a polling snapshot cannot flood the diagnostic log.
    var fallbackLogged = {};

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

    // JSON-safe deep copy that PRESERVES typed arrays (Float32Array quad
    // points, ink paths, …). Plain JSON.stringify turns a Float32Array into
    // {"0":…} — no .length, no indexing — which silently corrupts every
    // highlight snapshot at capture time and makes restore build nothing.
    // DOM nodes, live editors, bitmaps and functions are dropped instead.
    function jsonSafe(v) {
        if (v === null || v === undefined) return v;
        var t = typeof v;
        if (t === 'number' || t === 'string' || t === 'boolean') return v;
        if (t !== 'object') return undefined;
        try {
            if (typeof Node !== 'undefined' && v instanceof Node) return undefined;
            if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) return undefined;
        } catch (e) { /* ignore */ }
        if (v instanceof Float32Array || v instanceof Float64Array ||
            v instanceof Uint8Array || v instanceof Uint8ClampedArray ||
            v instanceof Int32Array || v instanceof Uint32Array ||
            v instanceof Int16Array || v instanceof Uint16Array) {
            return Array.from(v);
        }
        if (typeof BigInt64Array !== 'undefined' && (v instanceof BigInt64Array || v instanceof BigUint64Array)) {
            return Array.from(v, function (n) { return Number(n); });
        }
        if (Array.isArray(v)) {
            var a = [];
            for (var i = 0; i < v.length; i++) {
                var c = jsonSafe(v[i]);
                if (c !== undefined) a.push(c);
            }
            return a;
        }
        // Live editor that slipped through (has DOM refs / serialize): drop.
        if (v.div || v.parent || v._uiManager) return undefined;
        var o = {};
        for (var k in v) {
            if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
            var cv = jsonSafe(v[k]);
            if (cv !== undefined) o[k] = cv;
        }
        return o;
    }
    // Plain-JSON snapshot of the viewer's EDITOR annotations. Each live
    // editor is serialized individually inside its own try/catch (one bad
    // editor can't kill the whole snapshot), then passed through jsonSafe
    // so typed arrays survive. Image bitmaps (stamp/signature photos)
    // still can't be persisted and are skipped.
    function snapshotPlain() {
        var st = storage();
        if (!st) return null;
        var raw = null;
        try {
            raw = st.getAll();
        } catch (e) {
            return null;
        }
        if (!raw) return {};
        var out = {};
        for (var k in raw) {
            if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
            var v = raw[k];
            if (v && typeof v.serialize === 'function') {
                // Live editor instance: serialize it in isolation.
                try {
                    var s = v.serialize(false);
                    if (!s || typeof s !== 'object') {
                        // serialize() returns null for an editor PDF.js considers
                        // unchanged or empty. Fall back rather than drop it.
                        var fb0 = restoredFallback[k] || restoredFallback[(v && v.id) || ''];
                        if (fb0) { out[k] = fb0; }
                        continue;
                    }
                    if (s.bitmap) continue;
                    var copy = jsonSafe(s);
                    if (copy && typeof copy === 'object' && isEditorData(copy)) {
                        out[k] = copy;
                    } else if (restoredFallback[k]) {
                        out[k] = restoredFallback[k];
                    }
                } catch (e) {
                    // PDF.js threw (typically _initialData being null on an
                    // editor we restored). Use the entry we restored from so the
                    // snapshot stays truthful - an empty snapshot is what
                    // destroys the saved record.
                    var fb = restoredFallback[k] || restoredFallback[(v && v.id) || ''];
                    if (fb) {
                        // Once per editor per document: snapshotPlain runs on a
                        // poll, and an unconditional line here buried the real
                        // signal under hundreds of identical entries.
                        if (!fallbackLogged[k]) {
                            fallbackLogged[k] = true;
                            diag('snap fallback used key=' + k, 'from=' +
                                (restoredFallback[k] ? k : (v && v.id)), 'err=' + String(e && e.message || e));
                        }
                        out[k] = fb;
                    } else {
                        diag('snap DROPPED key=' + k, String(e && e.message || e));
                    }
                }
            } else if (isEditorData(v)) {
                try {
                    var pv = jsonSafe(v);
                    if (pv && typeof pv === 'object') out[k] = pv;
                } catch (e) {
                    /* skip */
                }
            }
        }
        return out;
    }

    // Finalize any open drawing/highlight session so the visible strokes
    // become committable editors before a snapshot. Passive change
    // detection (debounce/poll) must NEVER mutate user state, so this runs
    // only on explicit save paths: Ctrl+S, parent flush (close/Ctrl+S).
    function commitOpenDrawing() {
        try {
            var v = viewer();
            if (!v) return;
            var ui = null;
            try {
                ui = v._layerProperties && v._layerProperties.annotationEditorUIManager;
            } catch (e) {
                ui = null;
            }
            if (ui && typeof ui.commitOrRemove === 'function') {
                ui.commitOrRemove();
            }
        } catch (e) { /* ignore */ }
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
                // Freehand highlights serialize their geometry as `outlines`
                // only (no quadPoints/inkLists), but HighlightEditor.deserialize
                // reads ONLY quadPoints and inkLists - it never looks at
                // `outlines`. So a free highlight restores as a bare editor with
                // no geometry: deserialize() returns a truthy editor, addOrRebuild
                // succeeds, the layer is unhidden, and nothing is drawn.
                //
                // `outlines` comes in two shapes and both are in the wild:
                //   outlines: [ [...], [...] ]        (older captures)
                //   outlines: { outline: [ [...] ] } (what the viewer writes)
                // The old guard was Array.isArray(outlines), which silently
                // rejected the object form - the common one.
                var entry = data;
                diag('restoreEntry key=' + key, 'page=' + pageIndex,
                    'ctor=' + entryCtor(data),
                    'fields=' + entryFields(data));
                var freehand = null;
                if (Array.isArray(data.outlines)) {
                    freehand = data.outlines;
                } else if (data.outlines && typeof data.outlines === 'object' &&
                    Array.isArray(data.outlines.outline)) {
                    freehand = data.outlines.outline;
                }
                if (!data.quadPoints && !data.inkLists && freehand && freehand.length) {
                    entry = {};
                    for (var dk in data) {
                        if (Object.prototype.hasOwnProperty.call(data, dk)) entry[dk] = data[dk];
                    }
                    entry.inkLists = freehand;
                    diag('freehand->inkLists key=' + key, 'rows=' + freehand.length,
                        'shape=' + (Array.isArray(data.outlines) ? 'array' : 'object'));
                }
                // Normalise the geometry before handing it to PDF.js.
                //
                // PDF.js indexes quadPoints directly (quadPoints[0]) and iterates
                // paths.lines, so both must be real arrays. Any JSON hop that
                // turns a typed array into {"0":..,"1":..} produces a record that
                // deserialize() cannot consume at all:
                //     TypeError: Cannot read properties of undefined (reading '0')
                // and the entry is retried forever and never appears. Records
                // written by older builds, or imported through anything that
                // stringified them, look exactly like this - so repair them
                // rather than refusing to restore them.
                try {
                    entry.quadPoints = toNumericArray(data.quadPoints);
                    if (data.inkLists) entry.inkLists = data.inkLists.map(toNumericArray);
                    if (data.paths && typeof data.paths === 'object') {
                        if (data.paths.lines) entry.paths = Object.assign({}, data.paths, { lines: data.paths.lines.map(toNumericArray) });
                        if (data.paths.points) {
                            entry.paths = Object.assign({}, entry.paths || data.paths,
                                { points: data.paths.points.map(toNumericArray) });
                        }
                    }
                } catch (e6) { /* keep the original entry if repair fails */ }

                var layer = null;
                try {
                    var pageView = v.getPageView ? v.getPageView(pageIndex) : null;
                    var builder = pageView && pageView.annotationEditorLayer;
                    layer = builder && builder.annotationEditorLayer;
                } catch (e) {
                    layer = null;
                }
                if (!layer || typeof layer.deserialize !== 'function') {
                    diag('SKIP noLayer key=' + key, 'page=' + pageIndex,
                        'pageView=' + !!pageView, 'builder=' + !!builder);
                    // PDF.js only builds a page's AnnotationEditorLayerBuilder
                    // while that page is being drawn. Reopening a document
                    // restores the LAST VIEWED page, so a page the reader has
                    // not scrolled to never draws, its builder never exists, and
                    // the annotation waiting on it can never be deserialized -
                    // no amount of retrying helps. Force the page to render.
                    try {
                        if (pageView && typeof pageView.draw === 'function' &&
                            (!pageView.div || pageView.div.getAttribute('data-rendered') !== 'true')) {
                            diag('forcing draw key=' + key, 'page=' + pageIndex);
                            var p = pageView.draw();
                            if (p && typeof p.catch === 'function') p.catch(function () { });
                        }
                    } catch (e5) { /* best effort */ }
                    remaining.push(key); // page not rendered yet: retry
                    continue;
                }
                try {
                    var editor = await layer.deserialize(entry);
                    diag('deserialize key=' + key, 'page=' + pageIndex,
                        'returned=' + !!editor, 'hasAddOrRebuild=' + (typeof layer.addOrRebuild === 'function'));
                    if (editor) {
                        // A restored editor is NOT backed by a PDF annotation
                        // element, so annotationElementId must be null. Leaving
                        // it set makes serialize() take the #hasElementChanged()
                        // path, which throws because _initialData is null.
                        try {
                            if (editor.annotationElementId && !editor._initialData) {
                                diag('neutralise annotationElementId key=' + key,
                                    'was=' + editor.annotationElementId);
                                editor.annotationElementId = null;
                            }
                        } catch (e2) { /* ignore */ }
                        // Remember what we fed in, keyed by the id PDF.js will
                        // store it under, so snapshotPlain can fall back to it.
                        try {
                            var safeEntry = jsonSafe(entry);
                            if (safeEntry && typeof safeEntry === 'object') {
                                var fallbackKey = editor.id || key;
                                restoredFallback[fallbackKey] = safeEntry;
                            }
                        } catch (e3) { /* ignore */ }
                    }
                    if (editor && typeof layer.addOrRebuild === 'function') {
                        layer.addOrRebuild(editor);
                        // PDF.js hides the editor layer's own container while it
                        // is empty:
                        //     render()  ->  if (this.isEmpty) this.div.hidden = true
                        // and nothing ever sets it back except updateMode(), which
                        // only runs when a user clicks an annotation tool:
                        //     updateMode(mode)  ->  this.div.hidden = false
                        //
                        // A document reopened with nobody touching the toolbar has
                        // mode NONE, so the layer renders empty and hidden. We then
                        // add a perfectly good editor into that hidden container:
                        // it exists, it is in annotationStorage, it serialises -
                        // and the reader sees a blank page. That is why highlights,
                        // drawings and text all "fail to restore" identically.
                        //
                        // Unhide the container rather than forcing a tool mode: that
                        // keeps the toolbar and text-selection behaviour untouched,
                        // and render() will not re-hide a non-empty layer.
                        //
                        // Deliberately NOT calling layer.render() here. It is
                        // redundant - add() already renders and positions the
                        // editor - and it re-adds and rebuilds every editor on the
                        // page, ending in updateMode(), which hides the layer again
                        // while the tool is inactive.
                        try {
                            if (layer.div && layer.div.hidden) {
                                diag('unhide layer key=' + key, 'page=' + pageIndex);
                                layer.div.hidden = false;
                            }
                        } catch (e4) { /* visibility is best-effort */ }
                        appliedIds[key] = true;
                    } else if (editor) {
                        appliedIds[key] = true;
                    } else {
                        appliedIds[key] = true; // unknown type: skip, never retry
                    }
                } catch (e) {
                    diag('deserialize THREW key=' + key, 'page=' + pageIndex, String(e && e.message || e));
                    remaining.push(key); // possibly transient (layer not
                    // ready): retry rather than dropping the annotation
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

    // Restore a typed array that some earlier JSON hop flattened into
    // {"0":..,"1":..}. Left alone, PDF.js reads undefined out of it and the
    // annotation silently never renders.
    function toNumericArray(v) {
        if (v == null) return v;
        if (Array.isArray(v)) return v;
        if (typeof v === 'object' && typeof v.length === 'number') return Array.prototype.slice.call(v);
        var keys = Object.keys(v);
        if (keys.length && keys.every(function (n) { return /^\d+$/.test(n); })) {
            keys.sort(function (a, b) { return +a - +b; });
            var out = new Float32Array(keys.length);
            for (var i = 0; i < keys.length; i++) out[i] = v[keys[i]];
            return out;
        }
        return v;
    }

    // Geometry helpers for diagnostics. PDF.js keys an editor's deserialize on
    // annotationType and reads very specific geometry fields, and the shape
    // differs per editor type (highlight uses quadPoints, freehand uses
    // paths.lines / paths.points). Knowing which one arrived is the difference
    // between a guess and a diagnosis, so log the field list - never the
    // coordinates themselves.
    var EDITOR_TYPE_NAMES = {
        0: 'NONE', 3: 'FREETEXT', 9: 'HIGHLIGHT', 13: 'STAMP', 15: 'INK', 101: 'SIGNATURE'
    };
    function entryCtor(v) {
        var t = v && (v.annotationType != null ? v.annotationType : v.annotationEditorType);
        return EDITOR_TYPE_NAMES[t] || String(t);
    }
    function entryFields(v) {
        try {
            var parts = [];
            for (var k in v) {
                if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
                var val = v[k];
                var kind = val === null ? 'null' : Array.isArray(val) ? 'arr' + val.length : typeof val;
                if (k === 'paths' && val) {
                    var sub = [];
                    for (var p in val) {
                        if (Object.prototype.hasOwnProperty.call(val, p)) {
                            var pv = val[p];
                            sub.push(p + ':' + (pv === null ? 'null' : Array.isArray(pv) ? 'arr' + pv.length : typeof pv));
                        }
                    }
                    kind = '{' + sub.join(',') + '}';
                }
                parts.push(k + '=' + kind);
            }
            return parts.join(' ');
        } catch (e) {
            return 'unreadable';
        }
    }

    function scheduleRestore(attempt, remaining) {
        if (!pending) return;
        if ((attempt || 0) > RESTORE_MAX_ATTEMPTS) {
            // Pages / editor layers never became available in time.
            //
            // This used to give up here and emit synced with whatever had been
            // applied so far - which at this point is usually NOTHING. The parent
            // treats a sync as the canonical snapshot and rebases its baseline to
            // it, so an empty sync told it "this PDF has no annotations". The next
            // save then wrote that empty snapshot OVER the real record and the
            // annotations were destroyed permanently. That is the "saved (N)" but
            // never comes back bug: data loss, not a rendering failure.
            //
            // PDF.js defaults annotationEditorMode to NONE (viewer.mjs), so
            // pageView.annotationEditorLayer only exists once a tool is activated
            // or the page carrying the annotation has rendered. A large PDF opened
            // near the end blows past the old 30 x 1s window easily.
            //
            // So: keep retrying quietly for as long as the document is open, and
            // do NOT emit a synced message we already know is incomplete. Silence
            // cannot destroy anything.
            restoreTimer = setTimeout(function () {
                restoreTimer = null;
                applyPending(attempt || 0);
            }, RESTORE_RETRY_MS);
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
            hookEditorModeChanges();
            window.parent.postMessage({ type: 'materioAnnotReady' }, '*');
        } catch (e) { /* ignore */ }
    }

    /**
     * Re-run a pending restore the moment the annotation editor mode changes.
     *
     * This is what actually unblocks restore. PDF.js defaults
     * annotationEditorMode to NONE, and only builds pageView.annotationEditorLayer
     * once a mode is active - so at load time the deserialize() target simply
     * does not exist and every entry lands in `remaining`. Polling cannot fix
     * that, because nothing will ever change the mode on its own: the user has
     * to pick the highlight / text / draw tool. PDF.js fires
     * `annotationeditormodechanged` at exactly that moment, so re-running
     * applyPending there means saved annotations appear as soon as the reader
     * touches any annotation tool, with no UI state forced from here.
     */
    function hookEditorModeChanges() {
        try {
            var bus = app() && app().eventBus;
            if (!bus || typeof bus.on !== 'function' || bus.__materioAnnotHooked) return;
            bus.__materioAnnotHooked = true;
            bus.on('annotationeditormodechanged', function () {
                if (!pending || applying) return;
                try {
                    appliedIds = {};
                    if (restoreTimer) {
                        clearTimeout(restoreTimer);
                        restoreTimer = null;
                    }
                    applyPending(0);
                } catch (e) { /* ignore */ }
            });
        } catch (e) { /* older bundles may not expose this */ }
    }

    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || typeof data.type !== 'string') return;
        if (data.type === 'materioAnnotInit') {
            var map = (data.annotations && data.annotations.storage) || {};
            diag('initReceived entries=' + Object.keys(map).length, 'pdfDoc=' + !!pdfDoc());
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
            commitOpenDrawing();
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
                commitOpenDrawing();
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
            restoredFallback = {}; // annotationStorage is per-document
            fallbackLogged = {};
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
