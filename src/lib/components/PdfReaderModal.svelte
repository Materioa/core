<script>
    import { onMount, onDestroy } from "svelte";
    import { get } from 'svelte/store';
    import { pdfModalStore, bookmarksStore, actualThemeStore } from "$lib/stores.js";
    import { activeModalStore } from '$lib/stores.js';
    import { savePdfOffline, isPdfOffline, getOfflinePdf } from '$lib/utils/offlineDb.js';
    import { isNative } from '$lib/config/api.js';
    import { bindSounds, autoAnnotate, sfx } from '$lib/sounds/index.js';
    import * as cue from '$lib/sounds/events.js';
    import { hashPdfBuffer, hashPdfUrl, getPdfAnnotations, savePdfAnnotations } from '$lib/utils/pdfAnnotations.js';
    import { toApiUrl } from '$lib/config/api.js';
    import HugeIcon from "./HugeIcon.svelte";
    import { HugeiconsIcon } from "@hugeicons/svelte";
    import { LoaderIcon } from "@hugeicons/core-free-icons";

    let popup;
    let isFullscreen = false;
    let isClosing = false;
    let showShareModal = false;
    let shareUrl = '';
    let copyText = 'Copy';
    let shareLoading = true;
    let isDownloaded = false;

    let invertMode = false;
    let paperMode = false;
    let nightMode = false;
    let einkMode = false;

    function readReadingModes() {
        if (typeof document === 'undefined') return;
        const getCookie = (name) => {
            const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
            return match ? match[2] : null;
        };
        invertMode = getCookie('invertMode') === 'true';
        paperMode = getCookie('paperMode') === 'true';
        nightMode = getCookie('nightMode') === 'true';
        einkMode = getCookie('einkMode') === 'true';
    }

    function syncThemeToIframe() {
        const iframe = document.getElementById("pdf-iframe");
        if (iframe?.contentWindow) {
            const actualMode = get(actualThemeStore);
            const isDark = (actualMode === 'dark' || actualMode === 'coffee-dark' || actualMode === 'amoled');
            try {
                iframe.contentWindow.postMessage({
                    type: 'themeMode',
                    isDark: isDark,
                    actualMode: actualMode
                }, '*');

                readReadingModes();
                if (paperMode) {
                    iframe.contentWindow.postMessage({ type: 'overlayMode', mode: 'paper-mode', enable: true }, '*');
                    const match = document.cookie.match(/(^| )paperTexture=([^;]+)/);
                    const savedTexture = match ? match[2] : 'black-paper';
                    iframe.contentWindow.postMessage({ type: 'paperTexture', textureUrl: `/assets/textures/${savedTexture}.png` }, '*');
                    const matchGrain = document.cookie.match(/(^| )grainSize=([^;]+)/);
                    const savedGrain = matchGrain ? matchGrain[2] : '100';
                    iframe.contentWindow.postMessage({ type: 'grainSize', sizePx: Math.round((parseInt(savedGrain) / 100) * 200) }, '*');
                }
                if (nightMode) {
                    iframe.contentWindow.postMessage({ type: 'overlayMode', mode: 'night-reading', enable: true }, '*');
                }
                if (einkMode) {
                    iframe.contentWindow.postMessage({ type: 'overlayMode', mode: 'eink-mode', enable: true }, '*');
                }
                if (invertMode) {
                    iframe.contentWindow.postMessage({ type: 'overlayMode', mode: 'invert', enable: true }, '*');
                }
            } catch (e) {}
        }
    }

    let activeViewerUrl = '';
    let currentOfflineRecord = null;
    let offlineArrayBuffer = null;
    let hasOfflineData = false;
    let lastHandledPdfUrl = '';

    // --- PDF annotations: viewer-native data saved locally per PDF (file untouched) ---
    let pdfHash = null;
    let annotIdentityReady = false;
    let pendingAnnotStorage = {};
    let annotInitFor = '';
    // Explicit-save model: edits accumulate in memory; nothing is written
    // until Ctrl+S or the close-prompt confirms. Compared against the last
    // flushed snapshot so the prompt only appears on real changes.
    let annotDirty = false;
    let lastSavedSnapshot = '';

    function annotSnapshot(storage) {
        try {
            return JSON.stringify(storage || {});
        } catch {
            return '';
        }
    }

    function postToViewer(msg) {
        try {
            const iframe = document.getElementById('pdf-iframe');
            iframe?.contentWindow?.postMessage(msg, '*');
        } catch {}
    }

    function annotDiag(...args) {
        const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        try { console.log('[ANNOTDIAG] ' + line); } catch {}
        try {
            window.__materioAnnotDiag = window.__materioAnnotDiag || [];
            window.__materioAnnotDiag.push(line);
        } catch {}
        // Persist to the app's annot-diag.log. tauri-plugin-log's Webview
        // target only forwards calls made through its own JS package, which is
        // not installed, so console.* alone never reached a file.
        try {
            const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
            if (typeof invoke === 'function') invoke('annot_diag', { line }).catch(() => {});
        } catch {}
    }

    function ensureAnnotInit() {
        if (!annotIdentityReady || !pdfHash) return;
        const key = pdfHash + '|' + (get(pdfModalStore).pdfUrl || '');
        if (annotInitFor === key) return;
        annotInitFor = key;
        const msg = { type: 'materioAnnotInit', annotations: { storage: pendingAnnotStorage } };
        annotDiag('postInit key=', key, 'entries=', Object.keys(pendingAnnotStorage || {}).length);
        postToViewer(msg);
        // The viewer listener may not exist yet on first load; retry so the
        // restore is never lost. Guarded by annotInitFor so each PDF inits once.
        setTimeout(() => { if (annotInitFor === key) postToViewer(msg); }, 600);
        setTimeout(() => { if (annotInitFor === key) postToViewer(msg); }, 1800);
    }

    async function setupAnnotIdentity(buffer, url) {
        annotIdentityReady = false;
        annotInitFor = '';
        annotDirty = false;
        try {
            // Which key the sidecar is stored under depends on which branch ran:
            // the offline copy, a fresh fetch, or (when fetch is unavailable) a
            // hash of the URL. Those live in DIFFERENT namespaces — a byte hash
            // is 64 hex chars, a URL hash is "url-…" — so if one session can
            // read the bytes and the next cannot, the lookup silently misses
            // even though the record is sitting right there in IndexedDB. That
            // is exactly the "saved (N)" but never-restored symptom.
            //
            // So compute both and read whichever has the record, preferring the
            // byte hash (stable across sessions). Saving still writes under the
            // byte hash, so this only ever adds a fallback lookup.
            const byteHash = buffer ? await hashPdfBuffer(buffer) : null;
            const urlHash = url ? await hashPdfUrl(url) : null;

            let existing = null;
            for (const candidate of [byteHash, urlHash]) {
                if (!candidate) continue;
                const found = await getPdfAnnotations(candidate);
                if (found && found.storage && Object.keys(found.storage).length) {
                    existing = found;
                    break;
                }
            }

            // Always save under the byte hash when we have one: it is the only
            // form that is stable for the same file across opens.
            pdfHash = byteHash || urlHash;
            if (!pdfHash) throw new Error('no usable annotation identity');

            pendingAnnotStorage = (existing && existing.storage) || {};
            lastSavedSnapshot = annotSnapshot(pendingAnnotStorage);
            annotDiag('identity byteHash=', byteHash, 'urlHash=', urlHash,
                'chosen=', pdfHash, 'foundRecord=', !!existing,
                'entries=', Object.keys(pendingAnnotStorage).length);
        } catch (e) {
            annotDiag('identity FAILED', String(e && e.message || e));
            pdfHash = null;
            pendingAnnotStorage = {};
            lastSavedSnapshot = '';
        }
        annotIdentityReady = true;
        ensureAnnotInit();
    }

    function queueAnnotSave(storage, opts = {}) {
        if (!pdfHash) return;
        const incoming = storage || {};

        // Never let an EMPTY snapshot replace a non-empty one we already hold.
        //
        // The viewer emits a sync after restore; if its restore could not reach
        // every page (PDF.js only builds editor layers for rendered pages, and
        // the editor mode defaults to NONE) that sync can legitimately be empty
        // or partial. Adopting it rebases the baseline to "no annotations", and
        // the next save then writes that emptiness over the real record -
        // destroying annotations the user never touched. So a shrink to empty is
        // treated as "the viewer has not caught up yet", not as a deletion.
        const incomingEmpty = Object.keys(incoming).length === 0;
        const held = Object.keys(pendingAnnotStorage || {}).length;
        if (incomingEmpty && held > 0 && !opts.allowEmpty) {
            return;
        }

        pendingAnnotStorage = incoming;
        if (opts.synced) {
            // Post-restore canonical snapshot (fresh editor ids): rebase the
            // clean baseline instead of flagging dirty.
            lastSavedSnapshot = annotSnapshot(pendingAnnotStorage);
            annotDirty = false;
            return;
        }
        // Only real changes mark dirty (viewer echoes init back verbatim).
        annotDirty = annotSnapshot(pendingAnnotStorage) !== lastSavedSnapshot;
    }

    // Ask the viewer for an immediate snapshot (flushes its debounce) and
    // wait briefly so Ctrl+S / close use the very latest strokes.
    let flushWaiter = null;
    let flushWaiterResolve = null;
    function requestViewerFlush(timeoutMs = 800) {
        postToViewer({ type: 'materioAnnotFlush' });
        if (flushWaiter) return flushWaiter;
        flushWaiter = new Promise((resolve) => {
            const done = () => {
                flushWaiter = null;
                flushWaiterResolve = null;
                resolve();
            };
            const timer = setTimeout(done, timeoutMs);
            flushWaiterResolve = () => { clearTimeout(timer); done(); };
        });
        return flushWaiter;
    }
    function resolveFlushWaiter() {
        if (flushWaiterResolve) {
            const r = flushWaiterResolve;
            flushWaiterResolve = null;
            r();
        }
    }

    // Returns the saved annotation count, or -1 on failure. Re-reads the
    // sidecar after writing so a silent store failure can never report
    // success ("saved" must mean "readable back on next open").
    async function flushAnnotSave() {
        if (!pdfHash) return -1;
        const s = get(pdfModalStore);
        try {
            const ok = await savePdfAnnotations({
                pdfHash,
                pdfUrl: s.pdfUrl || '',
                title: s.title || s.topic || '',
                storage: pendingAnnotStorage
            });
            if (!ok) return -1;
            const reread = await getPdfAnnotations(pdfHash);
            const count = reread && reread.storage ? Object.keys(reread.storage).length : 0;
            const want = pendingAnnotStorage ? Object.keys(pendingAnnotStorage).length : 0;
            if (!reread || count !== want) return -1;
            lastSavedSnapshot = annotSnapshot(pendingAnnotStorage);
            annotDirty = false;
            return count;
        } catch {
            return -1;
        }
    }

    async function saveAnnotationsNow() {
        if (!pdfHash) return;
        // Pull the latest strokes out of the viewer first (debounce-proof),
        // otherwise a Ctrl+S right after drawing saves a stale snapshot.
        try { await requestViewerFlush(700); } catch {}
        if (!annotDirty && lastSavedSnapshot === annotSnapshot(pendingAnnotStorage)) {
            if (window.materioAlert) {
                window.materioAlert('No annotation changes to save yet — use the text, highlight or draw tools in the viewer.', { type: 'info', title: 'Annotations' });
            }
            return;
        }
        const count = await flushAnnotSave();
        // The dialog cue already reports the outcome, so these two are left to
        // it rather than doubling up on the same moment.
        if (window.materioAlert) {
            if (count >= 0) window.materioAlert(`Annotations saved for this PDF (${count}). They will reappear next time you open it.`, { type: 'success', title: 'Annotations Saved' });
            else window.materioAlert('Could not save annotations. Please try again.', { type: 'danger', title: 'Save Failed' });
        }
    }

    function resetAnnotState() {
        pdfHash = null;
        annotIdentityReady = false;
        pendingAnnotStorage = {};
        annotInitFor = '';
        annotDirty = false;
        lastSavedSnapshot = '';
    }

    function sendBufferToIframe(url, buffer) {
        if (!buffer || !url) return;
        const iframe = document.getElementById("pdf-iframe");
        if (iframe?.contentWindow) {
            try {
                iframe.contentWindow.postMessage({
                    type: 'blobDataResponse',
                    originalUrl: url,
                    arrayBuffer: buffer,
                    size: buffer.byteLength,
                    fromDownload: true
                }, '*');
                setTimeout(() => {
                    iframe.contentWindow?.postMessage({
                        type: 'loadFile',
                        url: url
                    }, '*');
                }, 50);
            } catch (err) {
                console.warn('[PdfReader] Failed to post buffer to iframe:', err);
            }
        }
    }

    async function setupPdfSource(url) {
        // Persist the previous PDF's unsaved edits before switching identity.
        // Awaited so resetAnnotState() can't wipe the snapshot mid-flush.
        try {
            if (pdfHash && annotDirty) await flushAnnotSave();
        } catch {}
        resetAnnotState();
        resetPdfSounds();
        // A new document is being fetched: slow work has started.
        cue.pdfOpening();
        lastHandledPdfUrl = url;
        currentOfflineRecord = null;
        offlineArrayBuffer = null;
        hasOfflineData = false;
        // Drop the content crossfade so the next PDF fades in fresh.
        try { document.getElementById('popup')?.classList.remove('loaded'); } catch {}

        if (!url) {
            activeViewerUrl = '';
            isDownloaded = false;
            return;
        }

        if (url.startsWith('blob:')) {
            activeViewerUrl = url;
            isDownloaded = true;
            // blob: URLs are per-session (a fresh UUID every open), so a
            // URL-derived hash would never match on reopen. Hash the bytes
            // instead so the sidecar key stays stable for the same file.
            try {
                const res = await fetch(url);
                if (res.ok) {
                    const buf = await res.arrayBuffer();
                    if (buf && buf.byteLength > 0) {
                        setupAnnotIdentity(buf.slice(0), url);
                        return;
                    }
                }
            } catch {}
            setupAnnotIdentity(null, url);
            return;
        }

        try {
            const offlineRecord = await getOfflinePdf(url);
            if (offlineRecord && (offlineRecord.blob || offlineRecord.data)) {
                currentOfflineRecord = offlineRecord;
                // Pre-extract the ArrayBuffer so it's ready for postMessage
                if (offlineRecord.data instanceof ArrayBuffer) {
                    offlineArrayBuffer = offlineRecord.data;
                } else if (offlineRecord.blob) {
                    offlineArrayBuffer = await offlineRecord.blob.arrayBuffer();
                } else if (offlineRecord.data) {
                    // Must normalise a VIEW, not take .buffer raw.
                    //
                    // `data.buffer` is the whole underlying ArrayBuffer, which
                    // for a Uint8Array that is a subarray view is larger than
                    // the PDF: it can carry the bytes of a neighbouring write.
                    // setupAnnotIdentity() SHA-256s exactly what it is given, so
                    // over-reading changed the sidecar key — the annotation was
                    // SAVED under one hash and looked up under another, which
                    // presented as "saved (1)" but never restored, on the very
                    // same file. Slice the view to its own bytes.
                    const view = ArrayBuffer.isView(offlineRecord.data)
                        ? new Uint8Array(
                              offlineRecord.data.buffer,
                              offlineRecord.data.byteOffset,
                              offlineRecord.data.byteLength
                          )
                        : offlineRecord.data;
                    offlineArrayBuffer = view instanceof ArrayBuffer
                        ? view
                        : view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
                }
                hasOfflineData = true;
                activeViewerUrl = url;
                isDownloaded = true;
                pdfModalStore.update(s => ({ ...s, isBookmarked: true }));
                sendBufferToIframe(url, offlineArrayBuffer);
                setupAnnotIdentity(offlineArrayBuffer, url);
                return;
            }
        } catch (e) {
            console.warn('Offline check error:', e);
        }

        activeViewerUrl = url;
        isDownloaded = false;

        // In native apps and web, pre-fetch the array buffer and stream into iframe cache
        // This guarantees zero cross-origin/range-origin failures in WebViews!
        try {
            const resp = await fetch(url);
            if (resp.ok) {
                const buffer = await resp.arrayBuffer();
                offlineArrayBuffer = buffer;
                hasOfflineData = true;
                sendBufferToIframe(url, buffer);
                setupAnnotIdentity(buffer, url);
            }
        } catch (fetchErr) {
            console.warn('[PdfReader] Main fetch failed, viewer will try direct fetch:', fetchErr);
        }
    }

    $: if ($pdfModalStore.isOpen && $pdfModalStore.pdfUrl) {
        if ($pdfModalStore.pdfUrl !== lastHandledPdfUrl) {
            setupPdfSource($pdfModalStore.pdfUrl);
        }
    } else if (!$pdfModalStore.isOpen) {
        offlineArrayBuffer = null;
        currentOfflineRecord = null;
        hasOfflineData = false;
        lastHandledPdfUrl = '';
    }

    // PDF lifecycle sounds. The viewer (static/oread/web/overlays.js) already
    // posts pdfProgress / pdfLoaded / pdfError up for exactly this purpose —
    // nothing consumed them until now, which is why the viewer was silent.
    const onPdfProgress = cue.createPdfProgressCue();
    let pdfReadyPlayed = false;

    function resetPdfSounds() {
        pdfReadyPlayed = false;
    }

    // The viewer runs in its own document (same-origin), so cuelume's
    // delegated bindings can be installed in there too. That covers the
    // pdf.js toolbar — highlight and freehand tool switches, page navigation,
    // zoom — without touching the oread build itself.
    function bindViewerSounds() {
        if (!isNative) return;
        try {
            const doc = document.getElementById('pdf-iframe')?.contentDocument;
            if (!doc?.body) return;
            bindSounds(doc);
            autoAnnotate(doc.body);
        } catch {}
    }

    async function handleIframeLoad() {
        bindViewerSounds();
        syncThemeToIframe();
        setTimeout(syncThemeToIframe, 150);
        setTimeout(syncThemeToIframe, 500);

        if (offlineArrayBuffer) {
            sendBufferToIframe($pdfModalStore.pdfUrl, offlineArrayBuffer);
        }
        // Crossfade the viewer content in (see #pdf-iframe opacity rules).
        try { document.getElementById('popup')?.classList.add('loaded'); } catch {}
        ensureAnnotInit();
    }

    $: if ($actualThemeStore && popup && $pdfModalStore.isOpen) {
        syncThemeToIframe();
    }

    onMount(() => {
        if (typeof window !== 'undefined') {
            window.openPdfModal = (url, metadata) => openPdfModal(url, metadata);
            window.loadPdfWithCache = (url, metadata) => openPdfModal(url, metadata);
            window.__materioSavePdfAnnotations = () => saveAnnotationsNow();
            window.__materioClosePdfModal = () => closeModal();
        }

        const syncFullscreen = () => {
            isFullscreen = Boolean(document.fullscreenElement);
            if (popup) {
                if (isFullscreen) popup.classList.add('fullscreen');
                else popup.classList.remove('fullscreen');
            }
        };
        document.addEventListener("fullscreenchange", syncFullscreen);
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                if (showShareModal) { showShareModal = false; e.preventDefault(); e.stopPropagation(); return; }
                if (document.fullscreenElement) {
                    return; // browser exits fullscreen natively; next Escape closes
                }
                closeModal();
            }
        };
        window.addEventListener('keydown', handleEsc, true);

        const handleMsg = (e) => {
            if (e.data && (e.data.type === 'applyOverlayModes' || e.data.type === 'requestOverlayModes')) {
                syncThemeToIframe();
            }
            if (e.data && e.data.type === 'materioAnnotDiag') {
                annotDiag('viewer>', e.data.line);
            }
            if (e.data && e.data.type === 'pdfProgress') {
                onPdfProgress(e.data.loaded, e.data.total);
            }
            if (e.data && e.data.type === 'pdfLoaded') {
                // documentloaded and pagesloaded both fire; one cue per
                // document, not per event.
                if (!pdfReadyPlayed) {
                    pdfReadyPlayed = true;
                    cue.pdfReady();
                }
                bindViewerSounds();
            }
            if (e.data && e.data.type === 'pdfError') {
                cue.pdfFailed();
            }
            if (e.data && e.data.type === 'materioAnnotReady') {
                // The viewer (re)loaded: any earlier init post may have been
                // lost before its listener existed, so force a fresh post.
                annotInitFor = '';
                ensureAnnotInit();
            }
            if (e.data && e.data.type === 'materioAnnotChanged') {
                // A highlight or a drawing landed. Throttled inside the cue:
                // one stroke can emit a long run of these.
                cue.annotationCommitted();
                queueAnnotSave(e.data.annotations?.storage);
                resolveFlushWaiter();
            }
            if (e.data && e.data.type === 'materioAnnotSynced') {
                cue.annotationCommitted();
                queueAnnotSave(e.data.annotations?.storage, { synced: true });
                resolveFlushWaiter();
            }
            if (e.data && e.data.type === 'materioAnnotSaveRequest') {
                // Ctrl/Cmd+S pressed inside the viewer iframe (parent key
                // handlers never fire while the iframe has focus).
                saveAnnotationsNow();
            }
        };
        window.addEventListener('message', handleMsg);

        return () => { 
            document.removeEventListener("fullscreenchange", syncFullscreen); 
            window.removeEventListener('keydown', handleEsc, true); 
            window.removeEventListener('message', handleMsg);
            cleanupActiveBlob();
        };
    });

    onDestroy(() => {
        cleanupActiveBlob();
    });

    // Releases offline PDF buffers held for iframe postMessage injection.
    // Total function: must never throw, closeModal depends on it.
    function cleanupActiveBlob() {
        try {
            offlineArrayBuffer = null;
            currentOfflineRecord = null;
            hasOfflineData = false;
            activeViewerUrl = '';
        } catch (e) {
            console.warn('PDF cleanup error:', e);
        }
    }

    let closeInProgress = false;
    async function closeModal() {
        if (closeInProgress) return;
        closeInProgress = true;
        try {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(()=>{});
        }
        // Flush the viewer's debounce first so a close right after drawing
        // still sees the latest strokes before deciding to prompt.
        if (pdfHash) {
            try { await requestViewerFlush(700); } catch {}
        }
        // Prompt to save annotation changes, like the linked-notebook flow.
        if (pdfHash && annotDirty) {
            let save = true;
            try {
                if (window.materioConfirm) {
                    const res = await window.materioConfirm(
                        'Do you want to save your annotations for this PDF? They will reappear next time you open it.',
                        { title: 'Save Annotations?', confirmText: 'Save', cancelText: "Don't Save", type: 'info' }
                    );
                    save = res === true || res === 'confirm';
                }
            } catch {}
            if (save) {
                await flushAnnotSave();
            }
        }
        resetAnnotState();
        cleanupActiveBlob();
        cue.pdfClosing();
        isClosing = true;
        setTimeout(() => {
            pdfModalStore.update((state) => ({ ...state, isOpen: false }));
            isClosing = false;
            showShareModal = false;
            closeInProgress = false;
        }, 220);
        } catch {
            closeInProgress = false;
        }
    }


    function clickPdfViewerControl(id){
        const iframe = document.getElementById("pdf-iframe");
        try{
            const control = iframe?.contentDocument?.getElementById(id);
            if(control && !control.disabled){ control.click(); return true; }
        }catch(e){}
        return false;
    }

    function handleCreateNote(){
        // Parent logic: create linked note, ask if exists
        const state = get(pdfModalStore);
        if (!state.pdfUrl) { window.createNewNotebook?.(true); return; }
        // Check for existing linked note
        let notebooks = [];
        try{ const saved = localStorage.getItem('materio_notebooks'); if(saved) notebooks = JSON.parse(saved); }catch{}
        const existing = notebooks.find(n => n.linkedPdf && (n.linkedPdf.url === state.pdfUrl || n.linkedPdf.name === state.topic));
        if (existing) {
            // use MaterioConfirm if available
            const confirmFn = window.materioConfirm || window.confirm;
            const msg = `A note for "${state.topic || state.title}" already exists. Open existing?`;
            const result = window.materioConfirm ? window.materioConfirm(msg, { title:'Linked Note Found', confirmText:'Open Existing', cancelText:'Create New', type:'info' }) : Promise.resolve(confirm(msg));
            Promise.resolve(result).then((res)=>{
                if(res === true || res === 'confirm' || res){ // materioConfirm resolves true/false, confirm resolves true/false
                    // open existing: need to handle boolean vs true
                    // Our materioConfirm returns true for confirm
                    if (res === true || res === 'confirm') {
                        window.openNotebook?.(existing.id);
                    } else {
                        // create new linked
                        window.createNewNotebook?.(false);
                        // after creation, set linked info
                        setTimeout(()=>{
                            // update the newly created notebook's linkedPdf
                            try{
                                const saved2 = localStorage.getItem('materio_notebooks');
                                let nbs = saved2 ? JSON.parse(saved2) : [];
                                const latest = nbs[0];
                                if(latest && !latest.linkedPdf){
                                    latest.linkedPdf = { url: state.pdfUrl, name: state.topic || state.title, subject: state.subject, semester: state.semester };
                                    localStorage.setItem('materio_notebooks', JSON.stringify(nbs));
                                }
                            }catch{}
                        }, 200);
                    }
                } else {
                    // user chose Create New (when materioConfirm returns false)
                    window.createNewNotebook?.(false);
                    setTimeout(()=>{
                        try{
                            const saved2 = localStorage.getItem('materio_notebooks');
                            let nbs = saved2 ? JSON.parse(saved2) : [];
                            const latest = nbs[0];
                            if(latest && !latest.linkedPdf){
                                latest.linkedPdf = { url: state.pdfUrl, name: state.topic || state.title, subject: state.subject, semester: state.semester };
                                localStorage.setItem('materio_notebooks', JSON.stringify(nbs));
                            }
                        }catch{}
                    }, 200);
                }
            });
            // For sync confirm (native confirm) we already handled above, but need to handle native case
            if (!window.materioConfirm) {
                const nativeRes = confirm(`A note for "${state.topic || state.title}" already exists. Open existing?`);
                if (nativeRes) window.openNotebook?.(existing.id);
                else {
                    window.createNewNotebook?.(false);
                }
                return;
            }
            return;
        }
        // no existing, create new linked
        window.createNewNotebook?.(false);
        setTimeout(()=>{
            try{
                const saved2 = localStorage.getItem('materio_notebooks');
                let nbs = saved2 ? JSON.parse(saved2) : [];
                const latest = nbs[0];
                if(latest && !latest.linkedPdf){
                    latest.linkedPdf = { url: state.pdfUrl, name: state.topic || state.title, subject: state.subject, semester: state.semester };
                    localStorage.setItem('materio_notebooks', JSON.stringify(nbs));
                }
            }catch{}
        }, 200);
    }

    let isDownloading = false;

    async function handleDownloadPdf() {
        const state = get(pdfModalStore);
        if (!state.pdfUrl || isDownloading) return;

        if (isDownloaded) {
            if (window.materioAlert) {
                window.materioAlert('This material is already saved in offline downloads.', { type: 'info', title: 'Already Saved' });
            }
            return;
        }

        try {
            isDownloading = true;

            let blob = null;

            if (state.pdfUrl.startsWith('blob:')) {
                try {
                    const res = await fetch(state.pdfUrl);
                    if (res.ok) blob = await res.blob();
                } catch (e) {
                    console.warn('Could not read blob url directly:', e);
                }
            }

            if (!blob) {
                try {
                    const res = await fetch(state.pdfUrl);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    blob = await res.blob();
                } catch (directErr) {
                    console.warn('Direct fetch failed, trying proxy:', directErr);
                    const proxyRes = await fetch(`/api/v2/cors?url=${encodeURIComponent(state.pdfUrl)}`);
                    if (!proxyRes.ok) throw new Error(`Proxy HTTP ${proxyRes.status}`);
                    blob = await proxyRes.blob();
                }
            }

            if (!blob || blob.size === 0) {
                throw new Error('Received empty PDF data.');
            }

            // Save into offline IndexedDB (with 128MB cap check)
            const savedRecord = await savePdfOffline({
                pdfUrl: state.pdfUrl,
                title: state.title || state.topic,
                subject: state.subject,
                category: state.category,
                semester: state.semester
            }, blob);

            isDownloaded = true;
            currentOfflineRecord = savedRecord;
            pdfModalStore.update(s => ({ ...s, isBookmarked: true }));

            // Sync bookmark store
            bookmarksStore.update((bookmarks) => {
                const exists = bookmarks.some((item) => item.pdfUrl === state.pdfUrl);
                return exists
                    ? bookmarks
                    : [...bookmarks, {
                        pdfUrl: state.pdfUrl,
                        title: state.title || "Untitled Material",
                        semester: state.semester,
                        subject: state.subject,
                        category: state.category,
                        topic: state.topic,
                        addedAt: new Date().toISOString()
                    }];
            });

            if (window.materioAlert) {
                window.materioAlert('PDF saved for offline reading! You can access it anytime without internet.', { type: 'success', title: 'Saved Offline' });
            }

        } catch (err) {
            console.error('Download error:', err);
            if (window.materioAlert) {
                window.materioAlert(`Failed to save PDF offline: ${err.message}`, { type: 'danger', title: 'Save Notice' });
            } else {
                alert(`Failed to save PDF offline: ${err.message}`);
            }
        } finally {
            isDownloading = false;
        }
    }

    async function toggleFullscreen() {
        const btn = document.getElementById('fullscreenButton');
        if (!popup) return;
        if (document.fullscreenElement) {
            await document.exitFullscreen();
            popup.classList.remove('fullscreen');
            if(btn){ const icon=btn.querySelector('svg'); if(icon) btn.setAttribute('aria-label','Enter fullscreen'); }
        } else if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
            popup.classList.add('fullscreen');
            if(btn){ const icon=btn.querySelector('svg'); if(icon) btn.setAttribute('aria-label','Exit fullscreen'); }
        }
    }

    function handlePresentation(){
        if(!clickPdfViewerControl('presentationMode')){
            // fallback to fullscreen if presentation not available
            toggleFullscreen();
        }
    }

    function handleInvert(){
        // Try iframe control first, fallback to settings toggle
        if(!clickPdfViewerControl('toggleInvert')){
            document.getElementById("invertModeToggle")?.click();
            // also toggle popup class for immediate feedback
            const p=document.getElementById('popup');
            if(p) p.classList.toggle('invert');
            // notify iframe via postMessage
            const iframe=document.getElementById('pdf-iframe');
            try{ iframe?.contentWindow?.postMessage({type:'toggleInvert'}, '*'); }catch{}
        }
    }

    async function sharePdf() {
        const state = get(pdfModalStore);
        if (!state.pdfUrl) return;
        // Use parent's masked URL generation
        let actualUrl = state.pdfUrl;
        // Try to get from global if available
        if (typeof window !== 'undefined' && window.materioCurrentPdfUrl) {
            actualUrl = window.materioCurrentPdfUrl;
        }
        shareUrl = 'Generating link...';
        showShareModal = true;
        shareLoading = true;
        copyText = 'Copy';
        // Fetch masked URL
        try {
            const res = await fetch(toApiUrl('/api/v2/features?action=pdf-share&subAction=create'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actualUrl })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.maskId) {
                const publicOrigin = (typeof window !== 'undefined' && window.location.hostname && !window.location.hostname.includes('localhost') && !window.location.protocol.includes('tauri') && !window.location.protocol.includes('capacitor'))
                    ? window.location.origin
                    : 'https://getmaterio.app';
                shareUrl = `${publicOrigin}/?share=${data.maskId}`;
            } else {
                shareUrl = actualUrl.startsWith('http') && !actualUrl.includes('localhost') ? actualUrl : `https://getmaterio.app`;
            }
        } catch (e) {
            console.error('Share error', e);
            shareUrl = actualUrl.startsWith('http') && !actualUrl.includes('localhost') ? actualUrl : `https://getmaterio.app`;
        } finally {
            shareLoading = false;
        }
    }
    async function copyShareUrl(){
        try{ await navigator.clipboard.writeText(shareUrl); copyText='Copied!'; setTimeout(()=>copyText='Copy',2000); }catch{
            const ta=document.createElement('textarea'); ta.value=shareUrl; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); copyText='Copied!'; setTimeout(()=>copyText='Copy',2000);
        }
    }

    // NOTE: keep this same-origin relative. It resolves to THIS app's own
    // `static/oread` copy on every host (dev, workers.dev, beta) — never
    // point it at the parent Jekyll site's oread path.
    function viewerUrl(pdfUrl, skipFile = false) {
        const base = `/oread/web/viewer.html?disableStream=true&disableRange=true`;
        if (skipFile) {
            return base;
        }
        return `${base}&file=${encodeURIComponent(pdfUrl)}`;
    }
</script>

{#if $pdfModalStore.isOpen}
    <div
        bind:this={popup}
        id="popup"
        class:fullscreen={isFullscreen}
        class:closing={isClosing}
        class:dark-mode={$actualThemeStore === 'dark' || $actualThemeStore === 'coffee-dark' || $actualThemeStore === 'amoled'}
        class:light-mode={$actualThemeStore === 'light'}
        class:coffee-mode={$actualThemeStore === 'coffee'}
        class:coffee-dark-mode={$actualThemeStore === 'coffee-dark'}
        class:amoled-mode={$actualThemeStore === 'amoled'}
        class:invert-mode={invertMode}
        class:paper-mode={paperMode}
        class:night-mode={nightMode}
        class:eink-mode={einkMode}
        style="display: block;"
    >
        <div class="popup-controls">
            <button id="createNoteButton" title="Create Note" aria-label="Create Note" on:click={handleCreateNote}>
                <HugeIcon name="edit-02" />
            </button>
            <div class="popup-share-tooltip-anchor">
                <button id="sharePdfButton" title="Share PDF" aria-label="Share PDF" on:click={sharePdf}>
                    <HugeIcon name="share-01" />
                </button>
            </div>
            <button
                id="downloadButton"
                title={isDownloading ? "Downloading PDF..." : (isDownloaded ? "Downloaded for offline reading (click to download again)" : "Download for offline reading")}
                aria-label="Download for offline reading"
                disabled={isDownloading}
                on:click={handleDownloadPdf}
                style={isDownloaded ? "color: var(--color-success, #8dac49);" : ""}
            >
                {#if isDownloading}
                    <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" />
                {:else}
                    <HugeIcon name="bookmark-02" fill={isDownloaded || $pdfModalStore.isBookmarked ? "currentColor" : "none"} />
                {/if}
            </button>
            <button id="pdfPresentationButton" title="Presentation mode" aria-label="Enter presentation mode" on:click={handlePresentation}>
                <HugeIcon name="projector-01" />
            </button>
            <button id="pdfInvertButton" title="Invert colors" aria-label="Invert colors" on:click={handleInvert}>
                <HugeIcon name="invert-01" />
            </button>
            <button id="fullscreenButton" aria-label="Enter fullscreen" on:click={toggleFullscreen}>
                <HugeIcon name="square-arrow-diagonal-01" />
            </button>
            <button id="closePopup" aria-label="Close PDF viewer" on:click={closeModal}>
                <HugeIcon name="cancel-01" />
            </button>
        </div>
        <div id="popupContent">
            {#if $pdfModalStore.pdfUrl}
                <iframe
                    id="pdf-iframe"
                    scrolling="no"
                    allowfullscreen
                    webkitallowfullscreen
                    src={viewerUrl(activeViewerUrl || $pdfModalStore.pdfUrl, hasOfflineData)}
                    title={$pdfModalStore.title || "PDF Viewer"}
                    on:load={handleIframeLoad}
                ></iframe>
            {:else}
                <p style="padding: 20px;">No valid PDF URL specified.</p>
            {/if}
        </div>
        {#if showShareModal}
        <div class="materio-modal-overlay visible" style="display:flex" on:click|self={()=>showShareModal=false}>
            <div class="materio-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
                <button class="promo-close-btn" style="position:absolute;top:16px;right:16px;" on:click={()=>showShareModal=false} aria-label="Close"><HugeIcon name="cancel-01" /></button>
                <h3 class="materio-modal-title" id="share-modal-title">Share PDF</h3>
                <div class="share-input-container" id="share-input-container">
                    <input class="share-url-input" id="share-url-input" value={shareUrl} readonly on:click={(e)=>e.target.select()} />
                    <button class="share-copy-btn" id="share-copy-btn" on:click={copyShareUrl} disabled={shareLoading}>
                        {#if shareLoading}
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="hgi-spin"><path d="M11.9961 3V6"></path><path d="M11.9961 18V21"></path><path d="M20.9961 12H17.9961"></path><path d="M5.99609 12H2.99609"></path><path d="M18.3596 5.63672L16.2383 7.75804"></path><path d="M7.75413 16.2422L5.63281 18.3635"></path><path d="M18.3596 18.3635L16.2383 16.2422"></path><path d="M7.75413 7.75804L5.63281 5.63672"></path></svg>
                        {:else if copyText==='Copied!'}
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 10.6667C11 10.6667 11.75 10.6667 12.5 12C12.5 12 14.8824 8.66667 17 8"></path><path d="M7 11V9C7 5.70017 7 4.05025 8.02513 3.02513C9.05025 2 10.7002 2 14 2C17.2998 2 18.9497 2 19.9749 3.02513C21 4.05025 21 5.70017 21 9V11C21 14.2998 21 15.9497 19.9749 16.9749C18.9497 18 17.2998 18 14 18C10.7002 18 9.05025 18 8.02513 16.9749C7 15.9497 7 14.2998 7 11Z"></path><path d="M3 6V15C3 18.2998 3 19.9497 4.02513 20.9749C5.05025 22 6.70017 22 10 22H17"></path></svg>
                        {:else}
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V9C7 5.70017 7 4.05025 8.02513 3.02513C9.05025 2 10.7002 2 14 2C17.2998 2 18.9497 2 19.9749 3.02513C21 4.05025 21 5.70017 21 9V11C21 14.2998 21 15.9497 19.9749 16.9749C18.9497 18 17.2998 18 14 18C10.7002 18 9.05025 18 8.02513 16.9749C7 15.9497 7 14.2998 7 11Z"></path><path d="M3 6V15C3 18.2998 3 19.9497 4.02513 20.9749C5.05025 22 6.70017 22 10 22H17"></path></svg>
                        {/if}
                    </button>
                </div>
                <div class="ai-ask-divider"><span>Share Context with</span></div>
                <div class="ai-ask-buttons">
                    <button class="ai-ask-btn chatgpt-btn" id="ai-chatgpt-btn" on:click={()=> window.open(`https://chatgpt.com/g/g-69b90f449ff08191a3d32d3c0bec0591-materio?prompt=${encodeURIComponent(shareUrl)}`, '_blank')}>
                        <svg class="ai-btn-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.843-3.372L15.115 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.403-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
                        <span>ChatGPT</span>
                    </button>
                    <button class="ai-ask-btn claude-btn" id="ai-claude-btn" on:click={async (e)=>{ const prompt=`@materio Help me with ${shareUrl}`; try{await navigator.clipboard.writeText(prompt);}catch{ const ta=document.createElement('textarea'); ta.value=prompt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } const original=e.currentTarget.innerHTML; e.currentTarget.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" color="currentColor" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M5 14.5C5 14.5 6.5 14.5 8.5 18C8.5 18 14.0588 8.83333 19 7"></path></svg><span>Paste in Claude App</span>'; e.currentTarget.disabled=true; const iframe=document.createElement('iframe'); iframe.style.display='none'; document.body.appendChild(iframe); try{iframe.src='claude://open';}catch{} setTimeout(()=>{iframe.remove(); e.currentTarget.innerHTML=original; e.currentTarget.disabled=false;},3000); window.open('https://claude.ai/new','_blank'); }}>
                        <svg class="ai-btn-icon" viewBox="0 0 1200 1200" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845"/></svg>
                        <span>Claude</span>
                    </button>
                </div>
                <div class="ai-mcp-hint"><a href="https://materioa.vercel.app/docs/mcp" target="_blank" rel="noopener">Setup MCP in Claude Desktop →</a></div>
                <div class="materio-modal-buttons">
                    <button class="materio-modal-btn primary" id="share-modal-close" style="max-width:100%;flex:1;" on:click={()=>showShareModal=false}>Back</button>
                </div>
            </div>
        </div>
        {/if}
    </div>
{/if}
