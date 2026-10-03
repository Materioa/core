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
    // key -> { editor, layer, pageIndex } for editors we restored, so
    // healEditors() can re-assert the ones PDF.js's #cleanup() destroys.
    var trackedEditors = {};
    // key -> attempts, for editors that restored but came back empty.
    var emptyRetries = {};
    // One-shot flags so a polling snapshot cannot flood the diagnostic log.
    var fallbackLogged = {};
    // key -> ORIGINAL saved entry for an annotation that is currently NOT
    // represented in annotationStorage: its page has not rendered yet, its
    // deserialize() threw, or we decided not to retry it. Every snapshot
    // carries these forward, so a restore that only half succeeds can never
    // shrink the record and destroy the half that is still pending.
    var unrestored = {};
    // key -> true for entries we have given up retrying but still preserve.
    var noRetry = {};
    // One-shot: have we already emitted the "restore finished (best effort)"
    // sync after blowing past RESTORE_MAX_ATTEMPTS?
    var maxAttemptSynced = false;
    // keys the READER deleted (real user action) since the last snapshot we
    // posted. The parent uses this to tell a deliberate deletion apart from a
    // snapshot that merely failed to reach every page - it refuses the second
    // and accepts the first.
    var removedSinceEmit = {};

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
    // ---------------------------------------------------------------- entry
    // repair helpers.
    //
    // Everything below runs BEFORE an entry is handed to PDF.js's
    // deserialize(). A saved record can be months old, may have crossed a JSON
    // hop at some point, and PDF.js is unforgiving: a null quadPoints, a NaN
    // coordinate or a missing colour turns a good annotation into either
    // "deserialize THREW, retried forever" or - worse - a restored editor that
    // is in the layer, serialises, and paints NOTHING. That last one is the
    // "it comes back but it's invisible" bug: an SVG path containing NaN does
    // not render, and `fill="#undefined..."` is not a colour at all.

    function isFiniteNum(n) {
        return typeof n === 'number' && isFinite(n);
    }

    // Flat [x,y,x,y,...] coordinate list with non-finite POINTS dropped as a
    // pair. Used for stroke polylines, where skipping one bad point is safe;
    // never for quadPoints, whose stride-8 grouping would shift.
    function cleanPolyline(arr) {
        if (!arr || typeof arr !== 'object') return null;
        var raw = Array.isArray(arr) ? arr
            : (typeof arr.length === 'number' ? Array.prototype.slice.call(arr) : null);
        if (!raw) return null;
        var out = [];
        for (var i = 0; i + 1 < raw.length; i += 2) {
            if (!isFiniteNum(raw[i]) || !isFiniteNum(raw[i + 1])) continue;
            out.push(raw[i], raw[i + 1]);
        }
        return out.length >= 4 ? out : null;
    }

    // Stride-8 quadPoints, dropping any quad that is not 8 finite numbers.
    // A partially-NaN quad cannot be dropped by filtering individual values -
    // that would shift every later quad onto the wrong stride.
    function cleanQuads(arr) {
        var raw = toNumericArray(arr);
        if (!raw || typeof raw.length !== 'number') return null;
        var out = [];
        for (var i = 0; i + 7 < raw.length; i += 8) {
            var ok = true;
            for (var j = 0; j < 8; j++) {
                if (!isFiniteNum(raw[i + j])) { ok = false; break; }
            }
            if (!ok) continue;
            for (var k = 0; k < 8; k++) out.push(raw[i + k]);
        }
        return out.length >= 8 ? out : null;
    }

    function clamp255(n) {
        var v = Math.round(Number(n));
        if (!isFinite(v)) return null;
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    function parseColorString(c) {
        if (typeof c !== 'string') return null;
        var s = c.trim().toLowerCase();
        var m = /^#([0-9a-f]{3})$/.exec(s);
        if (m) {
            return [parseInt(m[1][0] + m[1][0], 16),
                parseInt(m[1][1] + m[1][1], 16),
                parseInt(m[1][2] + m[1][2], 16)];
        }
        m = /^#([0-9a-f]{6})$/.exec(s);
        if (m) {
            return [parseInt(m[1].slice(0, 2), 16),
                parseInt(m[1].slice(2, 4), 16),
                parseInt(m[1].slice(4, 6), 16)];
        }
        m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,.*)?\)$/.exec(s);
        if (m) {
            var r = clamp255(m[1]), g = clamp255(m[2]), b = clamp255(m[3]);
            if (r === null || g === null || b === null) return null;
            return [r, g, b];
        }
        return null;
    }

    // HighlightEditor.deserialize does `Util.makeHexColor(...color)`, and
    // makeHexColor is `hexNumbers[r]` over a 256-entry table: an undefined,
    // fractional or out-of-range component yields the literal string
    // "#undefinedundefinedundefined", which is not a colour, so the highlight
    // comes back black-less / unpaintable. Always return three integers.
    function normalizeColor(c, fallback) {
        var p = parseColorString(c);
        if (p) return p;
        if (c && (Array.isArray(c) || typeof c.length === 'number')) {
            var r = c[0], g = c[1], b = c[2];
            if (isFiniteNum(r) && isFiniteNum(g) && isFiniteNum(b)) {
                // PDF.js itself writes 0..255 integers, but a capture that went
                // through a 0..1 float pipeline would otherwise become "#010100"
                // - near black on white paper, i.e. "the colour is gone".
                if (r >= 0 && g >= 0 && b >= 0 && r <= 1 && g <= 1 && b <= 1 &&
                    (r % 1 !== 0 || g % 1 !== 0 || b % 1 !== 0)) {
                    r *= 255; g *= 255; b *= 255;
                }
                var rr = clamp255(r), gg = clamp255(g), bb = clamp255(b);
                if (rr !== null && gg !== null && bb !== null) return [rr, gg, bb];
            }
        }
        return fallback ? fallback.slice(0) : null;
    }

    // The viewer's own default highlight colour when we can reach it, so a
    // record with a broken colour still comes back looking like a highlight
    // rather than black. Falls back to pdf.js's built-in #fff066.
    function defaultColorFor(type) {
        if (type === 9 /* HIGHLIGHT */) {
            try {
                var props = viewer() && viewer()._layerProperties;
                var ui = props && props.annotationEditorUIManager;
                var colors = ui && ui.highlightColors;
                if (colors && typeof colors.values === 'function') {
                    var v = colors.values().next().value;
                    var p = parseColorString(v);
                    if (p) return p;
                }
            } catch (e) { /* fall through */ }
            return [255, 240, 102];
        }
        return [0, 0, 0];
    }

    function normalizeRotation(r) {
        var n = Number(r);
        if (!isFinite(n)) return 0;
        var d = ((n % 360) + 360) % 360;
        return (d === 0 || d === 90 || d === 180 || d === 270) ? d : 0;
    }

    // Polyline out of the cubic-bezier path that HighlightEditor serialises
    // as `outlines.outline`. The path is [NaN,NaN,NaN,NaN, x,y, c1x,c1y,c2x,
    // c2y,x,y, ...] - every group of six ends on the on-curve point, which is
    // exactly what toSVGPath() draws a `C`/`L` to. The NaNs are sentinels and
    // must never be copied into geometry.
    function polylineFromOutlinePath(flat) {
        if (!flat || flat.length < 6) return null;
        var out = [];
        var x0 = flat[4], y0 = flat[5];
        if (isFiniteNum(x0) && isFiniteNum(y0)) out.push(x0, y0);
        for (var i = 6; i + 5 < flat.length; i += 6) {
            var x = flat[i + 4], y = flat[i + 5];
            if (isFiniteNum(x) && isFiniteNum(y)) out.push(x, y);
        }
        return out.length >= 4 ? out : null;
    }

    // The stroke polyline for a FREE (freehand) highlight, in page coordinates
    // - the exact shape HighlightEditor.deserialize's `inkLists` branch feeds
    // back into a FreeHighlightOutliner.
    //
    // `outlines.points[0]` is the authoritative one: FreeDrawOutline.serialize
    // writes `{ outline: <bezier path>, points: [<stroke points>] }`, and
    // points is already rescaled through the same rect that `rect` and
    // `quadPoints` use, so it drops straight into the inkLists branch.
    function freeStrokeFromOutlines(outlines) {
        if (!outlines) return null;
        if (Array.isArray(outlines)) {
            // Older captures stored a bare array of polygons (the BOX
            // highlight shape), not a stroke. Caller handles those separately.
            return null;
        }
        if (typeof outlines !== 'object') return null;
        var p = outlines.points;
        if (p && typeof p === 'object') {
            var first = (p.length && p[0] !== undefined) ? p[0] : p;
            var flat = cleanPolyline(first);
            if (flat) return flat;
        }
        if (Array.isArray(outlines.outline)) {
            return polylineFromOutlinePath(outlines.outline);
        }
        return null;
    }

    // Box-highlight outlines are an array of rectilinear polygons in page
    // coordinates. Used only when quadPoints itself was lost: each polygon
    // collapses to its bounding-box quad, which is what
    // HighlightEditor.deserialize reads anyway.
    function quadsFromOutlinePolygons(polys) {
        if (!Array.isArray(polys) || !polys.length) return null;
        var out = [];
        for (var i = 0; i < polys.length; i++) {
            var poly = cleanPolyline(polys[i]);
            if (!poly) continue;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (var j = 0; j < poly.length; j += 2) {
                if (poly[j] < minX) minX = poly[j];
                if (poly[j] > maxX) maxX = poly[j];
                if (poly[j + 1] < minY) minY = poly[j + 1];
                if (poly[j + 1] > maxY) maxY = poly[j + 1];
            }
            if (!(maxX > minX) || !(maxY > minY)) continue;
            out.push(minX, maxY, maxX, maxY, minX, minY, maxX, minY);
        }
        return out.length >= 8 ? out : null;
    }

    // Repair one saved record into something PDF.js can actually deserialize,
    // or return null when it is not restorable (the caller keeps the ORIGINAL
    // record around rather than dropping it, so nothing is ever lost).
    function prepareEntry(data) {
        if (!data || typeof data !== 'object') return null;
        var entry = {};
        for (var k in data) {
            if (Object.prototype.hasOwnProperty.call(data, k)) entry[k] = data[k];
        }
        var type = entry.annotationType != null ? entry.annotationType : entry.annotationEditorType;

        // --- scalars -------------------------------------------------------
        entry.color = normalizeColor(entry.color, defaultColorFor(type));
        if (isFiniteNum(entry.opacity) && entry.opacity > 0 && entry.opacity <= 1) {
            // keep
        } else if (entry.opacity !== undefined && entry.opacity !== null) {
            var op = Number(entry.opacity);
            entry.opacity = (isFinite(op) && op > 0 && op <= 1) ? op : 1;
        }
        // HighlightEditor's inkLists branch does `thickness / 2`; an undefined
        // thickness makes an all-NaN stroke width and nothing renders.
        if (type === 9 || type === 15 || entry.thickness !== undefined) {
            var th = Number(entry.thickness);
            entry.thickness = (isFinite(th) && th > 0) ? th : (type === 9 ? 12 : 1);
        }
        entry.rotation = normalizeRotation(entry.rotation);

        var rect = toNumericArray(entry.rect);
        if (!rect || typeof rect.length !== 'number' || rect.length < 4 ||
            !isFiniteNum(rect[0]) || !isFiniteNum(rect[1]) ||
            !isFiniteNum(rect[2]) || !isFiniteNum(rect[3])) {
            return null; // base deserialize() slices data.rect: unusable
        }
        entry.rect = [rect[0], rect[1], rect[2], rect[3]];

        // --- geometry ------------------------------------------------------
        if (type === 9 /* HIGHLIGHT */) {
            var quads = cleanQuads(data.quadPoints);
            if (quads) {
                entry.quadPoints = quads;
                delete entry.inkLists;
            } else {
                // No usable boxes: this is a FREE highlight. Feed the stroke
                // back through the inkLists branch, which rebuilds the exact
                // FreeHighlightOutliner shape it was created with.
                var stroke = freeStrokeFromOutlines(data.outlines) ||
                    (Array.isArray(data.inkLists) ? cleanPolyline(data.inkLists[0]) : null);
                if (stroke) {
                    entry.inkLists = [stroke];
                    entry.quadPoints = null;
                    diag('free stroke key=' + (data.id || '?'),
                        'points=' + (stroke.length / 2));
                } else {
                    // Legacy captures: `outlines` is (or contains) an ARRAY OF
                    // POLYGON ROWS rather than a flat bezier path. Each row
                    // collapses to its bounding-box quad - what the box branch
                    // of deserialize reads anyway.
                    var polys = Array.isArray(data.outlines) ? data.outlines
                        : (data.outlines && Array.isArray(data.outlines.outline) &&
                            data.outlines.outline.length &&
                            Array.isArray(data.outlines.outline[0]))
                            ? data.outlines.outline : null;
                    var alt = quadsFromOutlinePolygons(polys);
                    if (alt) {
                        entry.quadPoints = alt;
                        delete entry.inkLists;
                        diag('outline polygons->quads key=' + (data.id || '?'),
                            'quads=' + (alt.length / 8));
                    } else {
                        return null;
                    }
                }
            }
        } else if (type === 15 /* INK */) {
            if (data.paths && typeof data.paths === 'object') {
                var paths = {};
                for (var pk in data.paths) {
                    if (Object.prototype.hasOwnProperty.call(data.paths, pk)) paths[pk] = data.paths[pk];
                }
                if (Array.isArray(paths.lines)) paths.lines = paths.lines.map(toNumericArray);
                if (Array.isArray(paths.points)) paths.points = paths.points.map(toNumericArray);
                entry.paths = paths;
            } else if (Array.isArray(data.inkLists)) {
                entry.inkLists = data.inkLists.map(cleanPolyline).filter(Boolean);
                if (!entry.inkLists.length) return null;
                delete entry.quadPoints;
            } else {
                return null;
            }
        } else {
            // FreeText / Stamp / Signature: normalise whatever geometry they
            // happen to carry, but never invent any.
            if (entry.quadPoints !== undefined && entry.quadPoints !== null) {
                var q2 = cleanQuads(entry.quadPoints);
                if (q2) entry.quadPoints = q2; else delete entry.quadPoints;
            }
            if (Array.isArray(entry.inkLists)) {
                entry.inkLists = entry.inkLists.map(cleanPolyline).filter(Boolean);
                if (!entry.inkLists.length) delete entry.inkLists;
            }
        }
        return entry;
    }

    // Plain-JSON snapshot of the viewer's EDITOR annotations. Each live
    // editor is serialized individually inside its own try/catch (one bad
    // editor can't kill the whole snapshot), then passed through jsonSafe
    // so typed arrays survive. Image bitmaps (stamp/signature photos)
    // still can't be persisted and are skipped.
    //
    // It is ALSO a completeness guarantee: an entry that PDF.js does not
    // currently hold - because its page has not rendered yet, because
    // deserialize threw, or because cleanup() destroyed the editor - is merged
    // back in from `unrestored` / `restoredFallback`. Without that, a partial
    // restore silently SHRINKS the snapshot, the parent adopts the smaller
    // record, and annotations the reader never touched are overwritten away.
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
                        // Keep the retained copy in step with edits, so a later
                        // cleanup()-destroy of this editor preserves the CURRENT
                        // geometry rather than the shape it was first restored
                        // with.
                        if (restoredFallback[k]) restoredFallback[k] = copy;
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
        // Anything PDF.js is not currently holding must survive the round-trip
        // or it is destroyed on the next save.
        var keepKeys = Object.keys(unrestored);
        for (var ui = 0; ui < keepKeys.length; ui++) {
            var uk = keepKeys[ui];
            if (!(uk in out) && unrestored[uk]) out[uk] = unrestored[uk];
        }
        var fbKeys = Object.keys(restoredFallback);
        for (var fi = 0; fi < fbKeys.length; fi++) {
            var fk = fbKeys[fi];
            if (!(fk in out) && restoredFallback[fk]) out[fk] = restoredFallback[fk];
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
        // Nothing may leave the viewer before this document's init has been
        // seen. Between a document swap and the parent's materioAnnotInit,
        // annotationStorage is empty while `unrestored` still holds entries
        // from the previous document - emitting there would hand the parent a
        // record belonging to a DIFFERENT PDF hash. The parent's init is what
        // establishes which record this document talks about. (`lastInitStr` is
        // cleared on every document swap and set by every init.)
        if (lastInitStr === null) return;
        var snap = snapshotPlain();
        if (!snap) return;
        var str = stableStringify(snap);
        if (str === lastEmitted) {
            // No change to report - keep `removedSinceEmit` for the next post
            // rather than burning the credit on a snapshot that says nothing.
            return;
        }
        lastEmitted = str;
        var removed = Object.keys(removedSinceEmit);
        removedSinceEmit = {};
        try {
            window.parent.postMessage({
                type: 'materioAnnotChanged',
                annotations: { storage: snap },
                removed: removed,
                // true while entries are still waiting for their page/layer.
                // `pending === null` means every editor-data entry is now
                // either a live editor or carried in the snapshot itself, so
                // what we are sending IS the whole truth.
                restoring: !!pending,
            }, '*');
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
            var removed = Object.keys(removedSinceEmit);
            removedSinceEmit = {};
            window.parent.postMessage({
                type: 'materioAnnotSynced',
                annotations: { storage: snap },
                removed: removed,
                restoring: !!pending,
            }, '*');
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
                // Two very different things call remove():
                //   a) AnnotationEditorLayer.#cleanup() destroying an EMPTY
                //      editor (a transient, not-yet-ready restore) - the data
                //      is still wanted, so the fallback must be KEPT or the
                //      snapshot silently loses it;
                //   b) the reader deleting a real annotation - the data must
                //      go, including the fallback that snapshotPlain() would
                //      otherwise resurrect, and the heal entry that would put
                //      the editor back on the next poll.
                //
                // Read the value with getRawValue(). AnnotationStorage.getValue()
                // is literally `Object.assign(defaultValue, value)`, so calling
                // it the obvious way - st.getValue(k) - THROWS the moment the
                // entry exists ("Cannot convert undefined or null to object").
                // The catch below then sets victim = null, which reads as "no
                // editor here", so EVERY deletion fell through to case (a):
                // the fallback survived, nothing was reported in `removed`, and
                // healEditors() restored the highlight two seconds later. That
                // is why deleting a restored annotation had no effect at all.
                // getRawValue() returns the stored AnnotationEditor itself, so
                // isEmpty() below is the real emptiness test.
                var victim = null;
                var wasEmpty = false;
                try {
                    if (typeof st.getRawValue === 'function') {
                        victim = st.getRawValue(k);
                    } else if (typeof st.getValue === 'function') {
                        // Older PDF.js: hand getValue a target so it cannot
                        // throw. The copy has no isEmpty(), so emptiness is
                        // reported as false - i.e. treated as a real deletion,
                        // which is the side that must never be swallowed.
                        victim = st.getValue(k, {});
                    }
                    wasEmpty = !!(victim && typeof victim.isEmpty === 'function' && victim.isEmpty());
                } catch (e0) { victim = null; }
                var r = origRemove(k);
                if (victim && !wasEmpty) {
                    delete restoredFallback[k];
                    for (var tk in trackedEditors) {
                        if (!Object.prototype.hasOwnProperty.call(trackedEditors, tk)) continue;
                        var rec = trackedEditors[tk];
                        if (rec && rec.editor && (rec.editor === victim || rec.editor.id === k)) {
                            delete trackedEditors[tk];
                        }
                    }
                    // Tell the parent this shrink is deliberate. Without an
                    // explicit signal it cannot tell "the reader deleted a
                    // highlight" from "the restore never reached that page",
                    // and the only safe answer to the second one is to refuse
                    // the smaller snapshot.
                    removedSinceEmit[k] = true;
                    diag('user removed key=' + k, 'wasEmpty=false');
                } else {
                    diag('cleanup removed key=' + k, 'wasEmpty=' + wasEmpty);
                }
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

    // Attach a restored (or re-attached) editor WITHOUT letting PDF.js focus
    // it, so opening a document never lands on an annotation the reader did
    // not click.
    //
    // AnnotationEditorLayer.add() always ends in onceAdded(!#isEnabling). PDF.js
    // passes FALSE while it batches editors in through enable(), which is why
    // reopening a document through its own code leaves nothing selected. Every
    // path here runs outside enable(), so it passes TRUE:
    //
    //     HighlightEditor.onceAdded(focus) { ...; if (focus) this.div.focus(); }
    //
    // and a focused editor selects itself:
    //
    //     focusin() -> parent.setSelected(this) -> classList.add('selectedEditor')
    //                                      -> addEditToolbar().then(() => show())
    //
    // The result is exactly the reported symptom: the highlight comes back
    // wearing the selection outline, with the floating colour toolbar over it,
    // before the reader has touched anything. Free text and ink select even
    // more directly - straight from onceAdded() - so silencing focusin alone
    // would not be enough.
    //
    // So do what enable() does: force focus=false for the one call add() makes,
    // then clear any selection that appeared anyway. Only undo a selection that
    // APPEARED during this add - never one the reader already had.
    function attachRestored(layer, editor) {
        if (!layer || !editor) return;
        var mgr = null;
        var wasSelected = false;
        try {
            mgr = editor._uiManager || null;
            wasSelected = !!(mgr && typeof mgr.isSelected === 'function' && mgr.isSelected(editor));
        } catch (e0) { mgr = null; }

        // Shadow onceAdded for the duration of add(): it takes focus as an
        // argument, so this is the same lever #isEnabling pulls, just from
        // outside the class. Hand the prototype back afterwards so later adds
        // behave exactly as stock PDF.js.
        var hadOwn = false;
        var saved = null;
        var shadowed = false;
        try {
            hadOwn = Object.prototype.hasOwnProperty.call(editor, 'onceAdded');
            saved = editor.onceAdded;
            editor.onceAdded = function (focus) { return saved.call(this, false); };
            shadowed = true;
        } catch (e1) { shadowed = false; }
        try {
            if (typeof layer.addOrRebuild === 'function') layer.addOrRebuild(editor);
            else if (typeof layer.add === 'function') layer.add(editor);
        } finally {
            if (shadowed) {
                try {
                    if (hadOwn) editor.onceAdded = saved;
                    else delete editor.onceAdded;
                } catch (e2) { /* prototype lookup still resolves */ }
            }
        }

        try {
            if (mgr && !wasSelected && typeof mgr.isSelected === 'function' &&
                mgr.isSelected(editor) && typeof mgr.unselect === 'function') {
                mgr.unselect(editor);
                diag('unselect after attach id=' + (editor.id || ''));
            }
        } catch (e3) { /* an unselect that throws still leaves it usable */ }

        // If focus did land on it anyway, park it on the layer container rather
        // than leaving the caret sitting inside an annotation.
        try {
            var ae = document.activeElement;
            if (ae && editor.div && typeof editor.div.contains === 'function' &&
                editor.div.contains(ae) && layer.div) {
                layer.div.focus({ preventScroll: true });
            }
        } catch (e4) { /* ignore */ }
    }

    // Re-assert restored editors that PDF.js has dropped.
    //
    // AnnotationEditorLayer.#cleanup() runs on every ordinary page draw and on
    // updateMode(), and it DESTROYS any editor whose isEmpty() is true:
    //
    //     #cleanup() { for (const e of this.#editors.values())
    //                     if (e.isEmpty()) e.remove(); }
    //
    //     remove(editor) { this.detach(editor); this.#uiManager.removeEditor(editor);
    //                      editor.div.remove(); editor.isAttachedToDOM = false; }
    //
    // That is unrecoverable on its own: the div is gone AND the editor is
    // de-registered from the uiManager, so even a later layer.render() - which
    // re-adds from uiManager.getEditors(pageIndex) - will not bring it back.
    // Meanwhile appliedIds says this entry is done, so applyPending never
    // revisits it. Net effect: the annotation is restored, visible for a
    // moment, then vanishes and is never retried. That is the difference
    // between "deserialize returned true" and "the reader sees it".
    //
    // healEditors() re-adds via layer.add(editor), which re-registers with the
    // uiManager and re-appends the div. Cheap: it is a no-op for healthy editors.
    function healEditors() {
        var keys = Object.keys(trackedEditors);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var rec = trackedEditors[k];
            var ed = rec && rec.editor;
            if (!ed) { delete trackedEditors[k]; continue; }
            var dropped = !ed.isAttachedToDOM || !ed.div || !ed.div.isConnected;
            if (!dropped) continue;
            try {
                if (rec.layer && typeof rec.layer.add === 'function') {
                    attachRestored(rec.layer, ed);
                    if (rec.layer.div && rec.layer.div.hidden) rec.layer.div.hidden = false;
                    var r = ed.div && ed.div.getBoundingClientRect ? ed.div.getBoundingClientRect() : null;
                    diag('heal key=' + k, 'page=' + rec.pageIndex,
                        'rect=' + (r ? Math.round(r.width) + 'x' + Math.round(r.height) : 'null'));
                }
            } catch (e) { /* leave it for the next tick */ }
        }
    }

    function ensurePoll() {
        if (pollTimer) return;
        pollTimer = setInterval(function () {
            if (applying || !pdfDoc()) return;
            // Same gate as emitChangedNow: never emit for a document whose
            // init has not been seen yet (see there for the reasoning).
            if (lastInitStr === null) return;
            try { healEditors(); } catch (e) { /* ignore */ }
            try {
                var snap = snapshotPlain();
                if (!snap) return;
                var str = stableStringify(snap);
                if (str !== lastEmitted) {
                    lastEmitted = str;
                    var prend = Object.keys(removedSinceEmit);
                    removedSinceEmit = {};
                    try {
                        window.parent.postMessage({
                            type: 'materioAnnotChanged',
                            annotations: { storage: snap },
                            removed: prend,
                            restoring: !!pending,
                        }, '*');
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
                if (noRetry[key]) continue; // preserved in the record, never
                // retried (unrestorable payload - see prepareEntry)
                var data = pending[key];
                // Seed the safety net: while this entry is not represented in
                // annotationStorage, snapshotPlain() carries it forward from
                // `unrestored` so a partial restore can never shrink the record.
                // Only real editor data is carried (form values / stale junk
                // must not be re-injected into the snapshot forever).
                if (isEditorData(data)) unrestored[key] = data;
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
                // Repair the record into a shape PDF.js can actually
                // deserialize (see prepareEntry). This is where two real bugs
                // used to live:
                //
                //   1. Freehand highlights serialize geometry as `outlines`
                //      ONLY (quadPoints is null). HighlightEditor.deserialize
                //      reads quadPoints and inkLists and never looks at
                //      `outlines`, so a free highlight used to restore as a
                //      bare editor with no geometry - in the layer, serializing,
                //      painting nothing.
                //   2. The old conversion flattened `outlines.outline` (a
                //      cubic-bezier path full of NaN sentinels) into stride-8
                //      quads, producing NaN geometry that no SVG path can draw.
                //      The real stroke is `outlines.points[0]`, already in page
                //      coordinates, which is exactly what the `inkLists`
                //      branch consumes.
                //   3. An unconditional `entry.quadPoints =
                //      toNumericArray(data.quadPoints)` afterwards overwrote the
                //      freehand conversion with null, undoing it.
                //
                // prepareEntry returns null only for a truly unrestorable
                // payload (no usable rect / no geometry at all); the ORIGINAL
                // record is then kept in `unrestored` so the snapshot never
                // shrinks, and we stop retrying it.
                diag('restoreEntry key=' + key, 'page=' + pageIndex,
                    'ctor=' + entryCtor(data),
                    'fields=' + entryFields(data));
                var entry = prepareEntry(data);
                if (!entry) {
                    diag('restoreEntry UNRESTORABLE key=' + key,
                        'type=' + entryCtor(data), 'page=' + pageIndex);
                    unrestored[key] = data;
                    noRetry[key] = true;
                    appliedIds[key] = true; // preserved, but never retried
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
                        // The entry now has a live representation in
                        // annotationStorage: stop carrying it from `unrestored`
                        // (otherwise the snapshot would keep BOTH the raw
                        // record and the live editor - a duplicate annotation).
                        delete unrestored[key];
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
                        // FreeText is the ONE editor whose emptiness is read from
                        // the DOM rather than from the deserialized data:
                        //
                        //   FreeTextEditor.isEmpty() {
                        //     return !this.editorDiv || this.editorDiv.innerText.trim() === "";
                        //   }
                        //
                        // and render() only fills editorDiv (#setContent, the
                        // per-line <div>s holding #content) on the
                        // `_isCopy || annotationElementId` branch. A sidecar
                        // restore takes the OTHER branch every time:
                        // annotationElementId was deliberately nulled two blocks
                        // up, and _isCopy is false. The saved text therefore
                        // lands in #content but renders as an EMPTY box:
                        // isEmpty() stays true, uiManager.addToAnnotationStorage()
                        // skips the editor (it only stores non-empty editors),
                        // snapshotPlain() never sees it, and after five empty
                        // retries the sidecar logs "empty gave up" and moves on -
                        // the reader's text never reappears, while highlights and
                        // drawings (geometry-based isEmpty) restore fine. That is
                        // exactly the reported bug, in the reader's own
                        // annot-diag.log: `vis ... edCls=freeTextEditor EMPTY=true
                        // ... empty retry x5 ... empty gave up`.
                        //
                        // Flipping _isCopy routes the first render through the
                        // copy branch: it fills editorDiv from #content, leaves
                        // the box non-editable and draggable until the reader
                        // clicks it - the same state a pasted text box starts in -
                        // and _moveAfterPaste() re-sets the position it already
                        // has, so geometry is untouched. It is left ON after the
                        // attach deliberately: if PDF.js later destroys and
                        // re-renders this editor (cleanup + heal), render() fills
                        // the content again instead of the box coming back empty.
                        try {
                            if (entryCtor(entry) === 'FREETEXT') {
                                editor._isCopy = true;
                                diag('freetext copy-branch key=' + key);
                            }
                        } catch (e4) { /* ignore */ }
                    }
                    if (editor && (typeof layer.addOrRebuild === 'function' ||
                        typeof layer.add === 'function')) {
                        attachRestored(layer, editor);
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
                        diag('vis key=' + key, editorVisibilityReport(editor, layer));
                        trackedEditors[key] = { editor: editor, layer: layer, pageIndex: pageIndex };
                        // An EMPTY editor is the thing that makes annotations
                        // vanish: #cleanup() destroys any editor whose
                        // isEmpty() is true, and it does so on the next ordinary
                        // page draw. Emptiness here is usually transient - the
                        // layer existed but its viewport/geometry was not ready
                        // yet - so do NOT mark it applied. Retry instead, a few
                        // times, then accept it so a genuinely unreadable
                        // payload cannot spin forever.
                        var isEmptyNow = false;
                        try { isEmptyNow = !!(editor && editor.isEmpty && editor.isEmpty()); } catch (e7) { }
                        if (isEmptyNow) {
                            emptyRetries[key] = (emptyRetries[key] || 0) + 1;
                            if (emptyRetries[key] <= 5) {
                                diag('empty retry key=' + key, 'attempt=' + emptyRetries[key],
                                    'page=' + pageIndex);
                                remaining.push(key);
                                continue;
                            }
                            diag('empty gave up key=' + key, 'attempts=' + emptyRetries[key]);
                        }
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

    // Why is a restored editor still not on screen?
    //
    // Every previous check looked at div.hidden alone, which is necessary but
    // nowhere near sufficient: PDF.js also gates editor visibility on mode-
    // specific CSS classes, and an editor can sit in a visible container and
    // still paint nothing. Report the full chain so the next log names the cause
    // instead of requiring another guess - class chain, computed style, and the
    // geometry that actually gets laid out.
    function editorVisibilityReport(editor, layer) {
        try {
            var ed = editor && editor.div;
            var ld = layer && layer.div;
            var cs = null;
            if (ed && typeof window.getComputedStyle === 'function') {
                cs = window.getComputedStyle(ed);
            }
            var r = ed && ed.getBoundingClientRect ? ed.getBoundingClientRect() : null;
            var cls = ed ? (typeof ed.className === 'string' ? ed.className : String(ed.className)) : 'none';
            var empty = '?';
            try { empty = String(editor.isEmpty()); } catch (e2) { empty = 'threw'; }
            return [
                'EMPTY=' + empty,
                'edCls=' + cls,
                'edInDom=' + !!(ed && ed.isConnected),
                'rect=' + (r ? Math.round(r.width) + 'x' + Math.round(r.height) : 'null'),
                'pos=' + (r ? Math.round(r.left) + ',' + Math.round(r.top) : 'null'),
                'disp=' + (cs ? cs.display : '?'),
                'vis=' + (cs ? cs.visibility : '?'),
                'opac=' + (cs ? cs.opacity : '?'),
                'zIdx=' + (cs ? cs.zIndex : '?'),
                'layerHidden=' + (ld ? ld.hidden : 'no-layer'),
                'layerCls=' + (ld ? ld.className : '?'),
            ].join(' ');
        } catch (e) {
            return 'report failed: ' + String(e && e.message || e);
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
            // Emit ONE synced snapshot here: the parent treats a sync as the
            // canonical record and rebases clean, and it is safe now because
            // snapshotPlain() carries every not-yet-restored entry forward
            // from `unrestored`, so this snapshot is COMPLETE - it can no
            // longer arrive as "{}" and talk the parent into overwriting the
            // real record with nothing. Before that guarantee existed, silence
            // was the only safe option (see git history).
            //
            // PDF.js defaults annotationEditorMode to NONE (viewer.mjs), so
            // pageView.annotationEditorLayer only exists once a tool is
            // activated or the page carrying the annotation has rendered. A
            // large PDF opened near the end blows past the old 30 x 1s window
            // easily - so keep retrying quietly for as long as the document is
            // open, and only sync once.
            if (!maxAttemptSynced) {
                maxAttemptSynced = true;
                diag('restore max attempts reached', 'remaining=' +
                    ((remaining && remaining.length) || 0), 'emitting sync once');
                emitSynced();
            }
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
                    // Deliberately NOT clearing `appliedIds` here. Entries that
                    // are still waiting are already outside appliedIds (they
                    // were pushed to `remaining`), so they retry on their own.
                    // Clearing it re-deserialized the entries that SUCCEEDED,
                    // adding a second, identical editor to the page every time
                    // the reader touched an annotation tool.
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
            maxAttemptSynced = false;
            removedSinceEmit = {};
            // Rename incoming keys to a collision-free prefix.
            //
            // Saved keys are pdf.js editor ids, and those IDs RESTART FROM 1
            // for every document: a record saved from a previous session can
            // hold `pdfjs_internal_editor_9_p0_1`, and a live editor created
            // during THIS session's restore gets exactly the same id. With the
            // original keys, the pending entry and the freshly restored editor
            // fight over one id - the snapshot drops or duplicates one of them.
            // Keeping the raw record under `materio_pending_*` means pending
            // entries can never shadow a live editor id.
            var renamed = {};
            var ik = Object.keys(map);
            for (var ii = 0; ii < ik.length; ii++) {
                renamed['materio_pending_' + ii] = map[ik[ii]];
            }
            // Seed the completeness net: every incoming entry is carried in
            // snapshots until an editor actually exists for it.
            unrestored = {};
            noRetry = {};
            for (var uk2 in renamed) {
                if (Object.prototype.hasOwnProperty.call(renamed, uk2)) unrestored[uk2] = renamed[uk2];
            }
            if (pdfDoc()) {
                pending = renamed;
                hookStorage();
                applyPending(0);
            } else {
                pending = renamed;
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
            maxAttemptSynced = false;
            restoredFallback = {}; // annotationStorage is per-document
            fallbackLogged = {};
            trackedEditors = {};
            emptyRetries = {};
            // Per-document as well: entries carried for the PREVIOUS document
            // must never leak into this document's snapshot (they are keyed to
            // a different PDF hash on the parent side). Exception: entries we
            // already gave up retrying (bad payload, not bad document) stay -
            // they are the whole reason a partial snapshot cannot shrink the
            // record, and init re-seeds everything anyway.
            var keepUnrestored = {};
            var keepNoRetry = {};
            for (var uk3 in unrestored) {
                if (Object.prototype.hasOwnProperty.call(unrestored, uk3) && noRetry[uk3]) {
                    keepUnrestored[uk3] = unrestored[uk3];
                    keepNoRetry[uk3] = true;
                }
            }
            unrestored = keepUnrestored;
            noRetry = keepNoRetry;
            removedSinceEmit = {};
            if (pending) {
                for (var pk in pending) {
                    if (Object.prototype.hasOwnProperty.call(pending, pk) && isEditorData(pending[pk])) {
                        unrestored[pk] = pending[pk];
                    }
                }
            }
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
                            // A page finishing its draw is the moment its
                            // AnnotationEditorLayerBuilder finally exists -
                            // exactly what "SKIP noLayer" is waiting for.
                            // Retrying here turns a page the reader scrolls to
                            // into an immediate restore instead of waiting for
                            // the next 1s poll.
                            a.eventBus.on('pagerendered', function () {
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
