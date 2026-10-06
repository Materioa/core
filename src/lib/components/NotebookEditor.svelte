<script>
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { activeModalStore, pdfModalStore, activeTab } from '$lib/stores.js';
    import { pushState } from '$app/navigation';
    import { loadNotebookAssets, renderFormulasAndCode } from '$lib/utils/asset-loader.js';
    import HugeIcon from './HugeIcon.svelte';
    import { HugeiconsIcon } from '@hugeicons/svelte';
    import { LoaderIcon } from '@hugeicons/core-free-icons';
    import { sfx } from '$lib/sounds/index.js';
    import { NOTEBOOK_COVERS, DEFAULT_COVER, randomCover, getCover, getRibbon, coverStyle } from '$lib/utils/notebookCover.js';

    // Lazy load KaTeX, Highlight.js, and Mermaid when the notebook modal opens
    $: if ($activeModalStore === 'notebook') {
        loadNotebookAssets();
    }

    // Every open starts in edit mode. Read mode is a deliberate per-session
    // choice, so reopening a note should never drop the user into a view pane
    // they cannot type in.
    $: if ($activeModalStore !== 'notebook') {
        isViewMode = false;
        showCoverPicker = false;
        showBlockMenu = false;
        showMoreMenu = false;
    }

    export let noteId = null;

    let title = 'Untitled Note';
    let contentHtml = '';
    let isSaving = false;
    let isLoadingContent = false;
    let saveStatusText = 'Saved locally';
    let wordCount = 0;
    let notebooks = [];
    let currentNotebookId = null;
    let currentLinkedPdf = null;
    // Read mode. The editor and the view pane are mutually exclusive surfaces —
    // the view pane is never mounted alongside a live contenteditable, which
    // is what previously left the editor underneath a read-only overlay.
    let isViewMode = false;
    let viewEl;
    let showLinkPdfModal = false;
    let showExportModal = false;
    let linkedPdfName = '';
    let showAiOverlay = false;
    let aiPrompt = '';
    let showDelete = false;

    // --- toolbar popovers ------------------------------------------------
    // The strip used to be ~20 buttons that wrapped onto three rows. Only the
    // tools used while writing stay inline now; headings and the occasional
    // inserts live behind these two, and at most one is open at a time so the
    // two can never overlap.
    let showBlockMenu = false;
    let showMoreMenu = false;

    const BLOCK_LEVELS = [
        { key: '¶', label: 'Body text', action: 'paragraph' },
        { key: 'H1', label: 'Heading 1', action: 'heading1' },
        { key: 'H2', label: 'Heading 2', action: 'heading2' },
        { key: 'H3', label: 'Heading 3', action: 'heading3' }
    ];

    function toggleMenu(which) {
        if (which === 'block') {
            showBlockMenu = !showBlockMenu;
            showMoreMenu = false;
        } else {
            showMoreMenu = !showMoreMenu;
            showBlockMenu = false;
        }
    }

    function closeMenus() {
        showBlockMenu = false;
        showMoreMenu = false;
    }

    /** Applies a toolbar action and dismisses the menu it came from. */
    function runAndClose(which, action) {
        if (which === 'block') showBlockMenu = false;
        else showMoreMenu = false;
        handleToolbar(action);
    }
    let currentCover = DEFAULT_COVER;
    let createdAt = null;
    let updatedAt = null;
    let showCoverPicker = false;

    let editorEl;
    // Named so onDestroy can remove it — it used to be an anonymous listener
    // that accumulated one entry per mount.
    let onNotebookUpdate = null;

    // --- read mode ------------------------------------------------------

    /**
     * Renders the note into the read pane. KaTeX/highlight.js are loaded
     * asynchronously, so this has to run after they resolve — calling it
     * synchronously is why formulas never appeared: the renderers simply were
     * not on `window` yet. The pane deliberately lacks the `notebook-editor`
     * class, which renderMathInElement ignores by design.
     */
    async function renderView() {
        if (!viewEl) return;
        viewEl.innerHTML = contentHtml || '';
        try {
            await loadNotebookAssets();
        } catch {}
        // KaTeX swaps the raw text for rendered nodes, so the saved HTML must
        // still be the source of truth. Re-read the model, not the DOM.
        renderFormulasAndCode(viewEl);
    }

    function setViewMode(next) {
        if (isViewMode === next) return;
        if (next) {
            // Commit whatever is in the editor before reading it back.
            if (editorEl) contentHtml = editorEl.innerHTML;
            isViewMode = true;
            updateWordCount();
            // The pane mounts on the next tick; render once it exists.
            tick().then(() => renderView());
        } else {
            isViewMode = false;
            // Returning to edit: put the raw HTML back in a live editor so the
            // caret has something to work with.
            tick().then(() => {
                if (editorEl) {
                    editorEl.innerHTML = contentHtml || '';
                    editorEl.focus();
                }
            });
        }
        sfx(next ? 'open' : 'tap', { emphasis: 'subtle' });
    }

    // svelte 4-compatible tick
    function tick() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Renders read mode whenever the pane mounts or its content changes.
    // The `{@html}`-free view is written imperatively because KaTeX swaps raw
    // text for rendered nodes; a reactive `{@html}` would fight that.
    $: if (isViewMode && viewEl !== undefined && contentHtml !== undefined) {
        renderView();
    }

    // --- cover / title --------------------------------------------------

    function setCover(coverId) {
        currentCover = coverId;
        showCoverPicker = false;
        sfx('toggle', { emphasis: 'subtle' });
        saveNote(false);
    }

    function formatDate(value) {
        if (!value) return '';
        try {
            return new Date(value).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            });
        } catch {
            return '';
        }
    }

    onMount(() => {
        if (typeof localStorage !== 'undefined') {
            try {
                const saved = localStorage.getItem('materio_notebooks');
                if (saved) notebooks = JSON.parse(saved);
            } catch (e) {}
        }
        if (noteId) {
            loadSpecificNotebook(noteId);
        }
        if (typeof window !== 'undefined') {
            onNotebookUpdate = () => {
                try {
                    const saved = localStorage.getItem('materio_notebooks');
                    if (saved) notebooks = JSON.parse(saved);
                } catch (e) {}
            };
            window.addEventListener('notebook:update', onNotebookUpdate);

            window.createNewNotebook = (isGeneral) => {
                try {
                    const saved = localStorage.getItem('materio_notebooks');
                    if (saved) notebooks = JSON.parse(saved);
                } catch (e) {}

                const pdfState = get(pdfModalStore);
                const isPopupOpen = pdfState && pdfState.isOpen && pdfState.pdfUrl;
                if (!isGeneral && isPopupOpen) {
                    const existing = notebooks.find(n => n.linkedPdf && (n.linkedPdf.url === pdfState.pdfUrl || n.linkedPdf.name === (pdfState.topic || pdfState.title)));
                    if (existing) {
                        title = existing.title;
                        contentHtml = existing.content;
                        currentNotebookId = existing.id;
                        currentLinkedPdf = existing.linkedPdf;
                        linkedPdfName = existing.linkedPdf?.name || '';
                        currentCover = existing.cover || DEFAULT_COVER;
                        createdAt = existing.createdAt || null;
                        updatedAt = existing.updatedAt || null;
                        showDelete = true;
                        isViewMode = false;
                        openEditor();
                        return;
                    }
                    title = `Notes on ${pdfState.topic || pdfState.title || 'PDF'}`;
                    contentHtml = '';
                    currentNotebookId = null;
                    currentLinkedPdf = { url: pdfState.pdfUrl, name: pdfState.topic || pdfState.title, subject: pdfState.subject, semester: pdfState.semester, category: pdfState.category };
                    linkedPdfName = currentLinkedPdf.name;
                    showDelete = false;
                    isViewMode = false;
                    createdAt = null;
                    updatedAt = null;
                    if (editorEl) { editorEl.innerHTML = ''; updateWordCount(); }
                    openEditor();
                    return;
                }
                title = 'Untitled Note';
                contentHtml = '';
                currentNotebookId = null;
                currentLinkedPdf = null;
                linkedPdfName = '';
                showDelete = false;
                isViewMode = false;
                createdAt = null;
                updatedAt = null;
                if (editorEl) { editorEl.innerHTML = ''; updateWordCount(); }
                openEditor();
            };
            window.openNotebook = (id) => {
                loadSpecificNotebook(id);
            };
            window.MaterioNotebook = {
                get isOpen() { let v; activeModalStore.subscribe(x=>v=x)(); return v==='notebook'; },
                open: window.openNotebook, close: ()=>activeModalStore.set(null), create: window.createNewNotebook
            };
            // Canonical implementation other shells delegate to (see MainApp).
            window.__materioNotebookCreate = window.createNewNotebook;
        }
        activeModalStore.subscribe(val => {
            try {
                if (val === 'notebook') {
                    setTimeout(()=> {
                        if (editorEl && !editorEl.innerHTML && contentHtml) editorEl.innerHTML = contentHtml;
                        updateWordCount();
                    }, 50);
                }
            } catch (err) {
                console.error('Notebook open sync failed:', err);
            }
        });

        return () => {
            if (typeof window === 'undefined') return;
            if (onNotebookUpdate) window.removeEventListener('notebook:update', onNotebookUpdate);
        };
    });

    onDestroy(() => {
        clearTimeout(saveTimeout);
    });

    function getAuthToken() {
        if (typeof localStorage !== 'undefined') {
            const t = localStorage.getItem('token') || localStorage.getItem('materio_auth_token');
            if (t) return t;
        }
        if (typeof document !== 'undefined') {
            const match = document.cookie.match(/(?:^|;\s*)(?:materio_auth_token|token)=([^;]+)/);
            if (match) return decodeURIComponent(match[1]);
        }
        return null;
    }

    function closeModal() { activeModalStore.set(null); showLinkPdfModal=false; showExportModal=false; showAiOverlay=false; showCoverPicker=false; isViewMode=false; }

    /** Writes the current note state into the live contenteditable. */
    function paintEditor() {
        if (isViewMode) { renderView(); updateWordCount(); return; }
        if (editorEl) { editorEl.innerHTML = contentHtml || ''; updateWordCount(); }
    }

    /**
     * Opens the editor, guaranteeing the note actually renders.
     *
     * `activeModalStore.set('notebook')` when the store is ALREADY 'notebook'
     * notifies nobody — writable stores skip equal values — so opening from
     * inside the editor (or reopening the same note) left the PREVIOUS note on
     * screen with the new note's title, and the editor looked stuck. Closing
     * first forces a real null -> 'notebook' transition, then the DOM is
     * repainted once the editor is actually mounted.
     */
    function openEditor() {
        const reopen = () => { activeModalStore.set('notebook'); tick().then(paintEditor); };
        if (get(activeModalStore) === 'notebook') {
            activeModalStore.set(null);
            tick().then(reopen);
        } else {
            reopen();
        }
        sfx('open', { emphasis: 'subtle' });
    }

    /**
     * Loads a specific notebook on demand.
     * If content is cached locally, it presents it immediately for zero latency.
     * If content is missing (metadata-only from list) or if the note is synced to cloud,
     * it fetches the full notebook content from the server for this note only.
     */
    async function loadSpecificNotebook(id) {
        if (!id) return;

        try {
            const saved = localStorage.getItem('materio_notebooks');
            if (saved) notebooks = JSON.parse(saved);
        } catch (e) {}

        const existing = notebooks.find(n => n.id === id);
        currentNotebookId = id;

        if (existing) {
            title = existing.title || 'Untitled Note';
            currentLinkedPdf = existing.linkedPdf || null;
            linkedPdfName = existing.linkedPdf?.name || '';
            currentCover = existing.cover || DEFAULT_COVER;
            createdAt = existing.createdAt || null;
            updatedAt = existing.updatedAt || null;
            showDelete = true;
            isViewMode = false;

            if (existing.content !== undefined && existing.content !== null) {
                contentHtml = existing.content;
                saveStatusText = existing.syncedToCloud ? 'Synced to cloud' : 'Saved locally';
                isLoadingContent = false;
            } else {
                contentHtml = '';
                saveStatusText = 'Loading note...';
                isLoadingContent = true;
            }
        } else {
            // Not in local cache - show loading skeleton and load from cloud
            title = 'Loading...';
            contentHtml = '';
            currentLinkedPdf = null;
            linkedPdfName = '';
            currentCover = DEFAULT_COVER;
            createdAt = null;
            updatedAt = null;
            showDelete = false;
            isViewMode = false;
            saveStatusText = 'Loading note...';
            isLoadingContent = true;
        }

        openEditor();

        // If content is not present locally, or if the note is synced to cloud,
        // fetch the full document (including content) on-demand for this specific notebook.
        const token = getAuthToken();
        const needsCloudFetch = token && (!existing || existing.content === undefined || existing.syncedToCloud);

        if (needsCloudFetch) {
            try {
                const res = await fetch(`/api/v2/features?action=notebooks&subAction=get&id=${encodeURIComponent(id)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    const note = data.notebook;
                    if (note && currentNotebookId === id) {
                        title = note.title || title;
                        contentHtml = note.content || '';
                        currentCover = note.cover || currentCover;
                        currentLinkedPdf = note.linkedPdf || currentLinkedPdf;
                        createdAt = note.createdAt || createdAt;
                        updatedAt = note.updatedAt || updatedAt;
                        showDelete = true;
                        saveStatusText = 'Synced to cloud';

                        // Cache in memory and localStorage so subsequent opens have content
                        const idx = notebooks.findIndex(n => n.id === id);
                        if (idx >= 0) {
                            notebooks[idx] = { ...notebooks[idx], ...note, syncedToCloud: true };
                        } else {
                            notebooks.unshift({ ...note, syncedToCloud: true });
                        }
                        try {
                            localStorage.setItem('materio_notebooks', JSON.stringify(notebooks));
                        } catch {}

                        paintEditor();
                    }
                }
            } catch (err) {
                console.error('Failed to load notebook content:', err);
                if (existing && existing.content !== undefined) {
                    saveStatusText = 'Offline (cached)';
                } else {
                    saveStatusText = 'Could not load cloud note';
                }
            } finally {
                if (currentNotebookId === id) {
                    isLoadingContent = false;
                }
            }
        }
    }

    function updateWordCount() {
        // In read mode the live editor is unmounted, so the model HTML is the
        // only source — reading editorEl here reported 0 words the moment the
        // user switched to reading view.
        const text = editorEl ? editorEl.innerText : stripTags(contentHtml || '');
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        wordCount = words;
    }

    function stripTags(html) {
        return String(html || '')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ');
    }

    function handleEditorInput() {
        if (editorEl) contentHtml = editorEl.innerHTML;
        updateWordCount();
        saveStatusText = 'Saving...';
        debouncedSave();
    }

    let saveTimeout;
    function debouncedSave() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(()=> saveNote(false), 800);
    }

    function assignCoverForNewNote() {
        // A brand-new note gets its own colour instead of every blank note
        // sharing the default slate. Only runs when the note has never been
        // saved, so reopening an existing note never reshuffles its cover.
        currentCover = randomCover();
    }

    function saveNote(closeAfter=false) {
        isSaving = true;
        const id = currentNotebookId || `note_${Date.now()}`;
        const now = new Date().toISOString();
        const existsIdx = notebooks.findIndex(n => n.id === id);
        // First save of a new note: give it its own cover.
        if (existsIdx < 0 && (!currentCover || currentCover === DEFAULT_COVER)) assignCoverForNewNote();
        // Prefer currentLinkedPdf (from linked creation) else fallback to linkedPdfName
        let linked = currentLinkedPdf;
        if (!linked && linkedPdfName) linked = { name: linkedPdfName };
        // If we have a new linkedPdf from popup but editing existing, preserve
        const nb = {
            id,
            title: title.trim() || 'Untitled Note',
            // The editor is unmounted in read mode; saving a cover or the title
            // from there must not blank the note's content.
            content: editorEl ? editorEl.innerHTML : contentHtml,
            tag: 'General',
            cover: currentCover || DEFAULT_COVER,
            updatedAt: now,
            createdAt: existsIdx>=0 ? notebooks[existsIdx].createdAt : now,
            linkedPdf: linked,
            syncedToCloud: existsIdx>=0 ? !!notebooks[existsIdx].syncedToCloud : false
        };
        if (existsIdx>=0) notebooks[existsIdx]=nb;
        else notebooks.unshift(nb);
        currentNotebookId = id;
        createdAt = nb.createdAt;
        updatedAt = now;
        showDelete = true;
        try { localStorage.setItem('materio_notebooks', JSON.stringify(notebooks)); } catch {}

        // Notify other components (like NotebooksTab) immediately so it appears without refresh
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('notebook:update', { detail: { notebook: nb, action: 'save' } }));
        }

        const token = getAuthToken();
        if (token) {
            fetch('/api/v2/features?action=notebooks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    subAction: 'sync',
                    notebook: nb
                })
            }).then(r => r.json()).then(data => {
                if (data.success) {
                    nb.syncedToCloud = true;
                    saveStatusText = 'Synced to cloud';
                    try {
                        const saved = JSON.parse(localStorage.getItem('materio_notebooks') || '[]');
                        const idx = saved.findIndex(n => n.id === nb.id);
                        if (idx >= 0) {
                            saved[idx].syncedToCloud = true;
                            localStorage.setItem('materio_notebooks', JSON.stringify(saved));
                        }
                    } catch {}
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('notebook:update', { detail: { notebook: nb, action: 'sync' } }));
                    }
                }
            }).catch(err => {
                console.error('Notebook cloud sync error:', err);
            });
        }

        saveStatusText = token ? 'Saved (syncing...)' : 'Saved locally';
        isSaving = false;
        if (closeAfter) closeModal();
    }

    function handleToolbar(action) {
        if (!editorEl) return;
        editorEl.focus();
        switch(action) {
            case 'bold': document.execCommand('bold', false, null); break;
            case 'italic': document.execCommand('italic', false, null); break;
            case 'underline': document.execCommand('underline', false, null); break;
            case 'strikethrough': document.execCommand('strikeThrough', false, null); break;
            case 'heading1': document.execCommand('formatBlock', false, '<h1>'); break;
            case 'heading2': document.execCommand('formatBlock', false, '<h2>'); break;
            case 'heading3': document.execCommand('formatBlock', false, '<h3>'); break;
            // Back to a plain paragraph. Needed because the Block menu offers
            // "Body text" as a destination — without this case it was a dead
            // item, since <p> is not one of the three H buttons.
            case 'paragraph': document.execCommand('formatBlock', false, '<p>'); break;
            case 'bulletList': document.execCommand('insertUnorderedList', false, null); break;
            case 'numberedList': document.execCommand('insertOrderedList', false, null); break;
            case 'checkbox': {
                const sel = window.getSelection();
                document.execCommand('insertHTML', false, '<div class="checkbox-item"><input type="checkbox"> <span> Task</span></div>');
                break;
            }
            case 'link': {
                const url = prompt('Enter URL:');
                if (url) document.execCommand('createLink', false, url);
                break;
            }
            case 'image': {
                const url = prompt('Enter image URL:');
                if (url) document.execCommand('insertImage', false, url);
                break;
            }
            case 'code': document.execCommand('formatBlock', false, '<pre>'); break;
            case 'math': {
                const expr = prompt('Enter LaTeX:');
                // \( \) is what renderMathInElement is now configured to accept
                // alongside $...$, so toolbar formulas actually render.
                if (expr) document.execCommand('insertHTML', false, `<span class="math-inline">\\(${expr}\\)</span>`);
                break;
            }
            case 'quote': document.execCommand('formatBlock', false, '<blockquote>'); break;
            case 'divider': document.execCommand('insertHorizontalRule', false, null); break;
            case 'linkPdf': showLinkPdfModal=true; break;
            case 'attachment': document.getElementById('notebookAttachmentInput')?.click(); break;
            case 'aiWrite': showAiOverlay = !showAiOverlay; break;
        }
        handleEditorInput();
    }

    /**
     * Click-away and Escape for the toolbar popovers and the cover palette.
     * Without this the open menu stays floating over the page, because
     * `document.execCommand` moves the selection away from the trigger as soon
     * as a format is applied — so the usual "blur to dismiss" never fires.
     */
    function handleDialogPointer(e) {
        if (get(activeModalStore) !== 'notebook') return;
        const t = e.target;
        if (!t || !t.closest) return;
        // Clicks outside the dialog land on the backdrop, which closes the
        // modal on its own; there is nothing to dismiss out there.
        if (!t.closest('#notebookDialog')) return;
        if (t.closest('.nb-menu-wrap')) return;
        if (t.closest('.notebook-cover-picker-wrap')) return;
        closeMenus();
        if (!t.closest('#notebookCoverBtn')) showCoverPicker = false;
    }

    function handleDialogKeydown(e) {
        if (e.key !== 'Escape') return;
        // Bound to the window, so Escape works even when focus is on the board
        // rather than in the editor — a dialog-scoped listener would go deaf
        // exactly when the user has clicked away from the text.
        if (get(activeModalStore) !== 'notebook') return;
        // Innermost first: a popover, then the cover palette, then the AI
        // prompt, and only when nothing else is open does Escape leave. That
        // ordering is what stops one keypress from closing the note while the
        // user is only trying to dismiss a menu.
        if (showBlockMenu || showMoreMenu) {
            closeMenus();
            return;
        }
        if (showCoverPicker) {
            showCoverPicker = false;
            return;
        }
        if (showAiOverlay) {
            showAiOverlay = false;
            return;
        }
        if (showLinkPdfModal) {
            showLinkPdfModal = false;
            return;
        }
        if (showExportModal) {
            showExportModal = false;
            return;
        }
        closeModal();
    }

    function handleAttachment(e) {
        const file = e.target.files?.[0];
        if (!file || !editorEl) return;
        const reader = new FileReader();
        reader.onload = () => {
            editorEl.focus();
            document.execCommand('insertHTML', false, `<div class="file-attachment"><HugeIcon name="file-02"/> ${file.name}</div>`);
            handleEditorInput();
        };
        reader.readAsDataURL(file);
    }

    function submitAi() {
        if (!aiPrompt.trim() || !editorEl) return;
        editorEl.focus();
        document.execCommand('insertHTML', false, `<p>${aiPrompt} <em>(AI generated)</em></p>`);
        showAiOverlay = false; aiPrompt='';
        handleEditorInput();
    }

    async function deleteCurrent() {
        if (!currentNotebookId) { closeModal(); return; }
        const ok = window.materioConfirm ? await window.materioConfirm('Delete this note? This cannot be undone.', { title:'Delete Note', danger:true, confirmText:'Delete' }) : confirm('Delete?');
        if (!ok) return;
        const deletedId = currentNotebookId;
        notebooks = notebooks.filter(n=> n.id !== deletedId);
        try { localStorage.setItem('materio_notebooks', JSON.stringify(notebooks)); } catch {}

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('notebook:update', { detail: { id: deletedId, action: 'delete' } }));
        }

        const token = getAuthToken();
        if (token) {
            fetch('/api/v2/features?action=notebooks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    subAction: 'delete',
                    id: deletedId
                })
            }).catch(console.error);
        }

        closeModal();
    }

    function doExport(format) {
        // Export must read the model, not the live editor: in read mode the
        // editor is unmounted, so `editorEl?.innerHTML` was an empty export.
        const html = editorEl ? editorEl.innerHTML : contentHtml;
        const data = editorEl ? editorEl.innerText : stripTags(contentHtml);
        const blob = new Blob([format==='html' ? html : data], { type: format==='html'?'text/html':'text/markdown' });
        const url = URL.createObjectURL(blob);
        const ext = format === 'html' ? 'html' : format === 'txt' ? 'txt' : 'md';
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(title || 'note').replace(/[^a-z0-9]/gi,'_')}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        showExportModal = false;
        sfx('ready', { emphasis: 'subtle' });
    }
</script>

<svelte:head>
    {#if $activeModalStore === 'notebook'}
        <link rel="stylesheet" href="/assets/style/notebook.css" />
    {/if}
</svelte:head>

<!-- Both dismiss handlers are on the window, not the dialog. Escape has to
     work when focus is on the board rather than in the editor, and a
     click-away listener on the dialog div would drag an ARIA role and a key
     handler onto a plain container that has no keyboard equivalent to
     declare. Each handler no-ops unless this modal is the open one. -->
<svelte:window on:keydown={handleDialogKeydown} on:click={handleDialogPointer} />

{#if $activeModalStore === 'notebook'}
    <div class="notebook-modal visible" id="notebookModal" role="dialog" aria-modal="true">
        <div class="notebook-backdrop" id="notebookBackdrop" on:click={closeModal}></div>
        <div class="notebook-dialog" id="notebookDialog">
            <!-- A clipboard, not an app window. The board is the dialog, the
                 clip is its top edge, and everything the note actually needs
                 lives on one sheet of cream paper clipped to it. -->
            <div class="notebook-spine" style={coverStyle(currentCover)} aria-hidden="true"></div>
            <div class="notebook-clip" aria-hidden="true"></div>

            <!-- Outside the sheet on purpose. The sheet is position:relative,
                 so a button nested inside it is anchored to the PAPER — a
                 white glyph on cream paper, which is why this read as "no
                 close button at all". On the board it has dark wood behind
                 it and can actually be seen. -->
            <button type="button" class="notebook-close-btn" id="notebookCloseBtn"
                aria-label="Close notebook" title="Close (Esc)"
                data-cuelume-close="close" data-cuelume-emphasis="subtle"
                on:click={closeModal}>
                <HugeIcon name="cancel-01" />
            </button>

            <div class="notebook-sheet">
            <div class="notebook-header">
                <div class="notebook-title-section">
                    <span class="notebook-icon" style={coverStyle(currentCover)}><HugeIcon name="book-open-02" /></span>
                    <input type="text" id="notebookTitleInput" class="notebook-title-input" placeholder="Untitled Note"
                        data-cuelume-type
                        bind:value={title} on:blur={()=>saveNote(false)} maxlength="100" autocomplete="off">
                </div>
                <div class="notebook-meta">
                    <!-- The real created date, not today's date rendered on every open. -->
                    <span class="notebook-date" id="notebookDate">{formatDate(updatedAt || createdAt) || formatDate(new Date().toISOString())}</span>
                    {#if linkedPdfName}
                        <span class="notebook-link" id="notebookLinkBadge" style="display: inline-flex;"><HugeIcon name="link-01" /><span id="notebookLinkText">{linkedPdfName}</span></span>
                    {/if}
                </div>
            </div>

            <!-- Formatting belongs to writing. In read mode the whole strip is
                 replaced by nothing at all rather than left enabled over a pane
                 that cannot be typed into.

                 One row, never wrapped. The tools used while writing are
                 inline; headings and the occasional inserts live in two
                 popovers. The old strip was ~20 buttons and folded onto three
                 rows, which is most of why the editor felt like a toolbar app
                 rather than a page of paper. -->
            {#if !isViewMode}
            <div class="notebook-toolbar" id="notebookToolbar">
                <div class="toolbar-group toolbar-formatting">
                    <button type="button" class="toolbar-btn" data-action="bold" title="Bold" aria-label="Bold" on:click={()=>handleToolbar('bold')}><HugeIcon name="text-bold" /></button>
                    <button type="button" class="toolbar-btn" data-action="italic" title="Italic" aria-label="Italic" on:click={()=>handleToolbar('italic')}><HugeIcon name="text-italic" /></button>
                    <button type="button" class="toolbar-btn" data-action="underline" title="Underline" aria-label="Underline" on:click={()=>handleToolbar('underline')}><HugeIcon name="text-underline" /></button>
                    <button type="button" class="toolbar-btn" data-action="strikethrough" title="Strikethrough" aria-label="Strikethrough" on:click={()=>handleToolbar('strikethrough')}><HugeIcon name="text-strikethrough" /></button>
                </div>
                <div class="toolbar-divider"></div>

                <!-- Block style: one trigger instead of three H1/H2/H3 buttons.
                     It does not claim to show the current level — tracking that
                     needs a caret listener to stay honest, and a stale
                     "H2" on a paragraph is worse than no readout at all. -->
                <div class="nb-menu-wrap">
                    <button type="button" class="toolbar-btn nb-tool-wide" data-action="blockStyle"
                        aria-haspopup="true" aria-expanded={showBlockMenu}
                        title="Block style" aria-label="Block style"
                        on:click={()=> toggleMenu('block')}>
                        <HugeIcon name="list-view" />
                        <HugeIcon name="arrow-down-01" class="nb-tool-caret" />
                    </button>
                    {#if showBlockMenu}
                        <div class="nb-menu" role="menu" aria-label="Block style">
                            {#each BLOCK_LEVELS as level (level.action)}
                                <button type="button" class="nb-menu-item" role="menuitem"
                                    on:click={()=> runAndClose('block', level.action)}>
                                    <span class="nb-menu-key">{level.key}</span>
                                    <span>{level.label}</span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>

                <div class="toolbar-divider"></div>
                <div class="toolbar-group toolbar-lists">
                    <button type="button" class="toolbar-btn" data-action="bulletList" title="Bulleted list" aria-label="Bulleted list" on:click={()=>handleToolbar('bulletList')}><HugeIcon name="list-bullet" /></button>
                    <button type="button" class="toolbar-btn" data-action="numberedList" title="Numbered list" aria-label="Numbered list" on:click={()=>handleToolbar('numberedList')}><HugeIcon name="list-number" /></button>
                    <button type="button" class="toolbar-btn" data-action="quote" title="Quote" aria-label="Quote" on:click={()=>handleToolbar('quote')}><HugeIcon name="quote-up" /></button>
                </div>

                <div class="toolbar-divider"></div>
                <div class="toolbar-group toolbar-actions">
                    <button type="button" class="toolbar-btn" data-action="link" title="Link" aria-label="Insert link" on:click={()=>handleToolbar('link')}><HugeIcon name="link-01" /></button>

                    <!-- AI sits on its own, at the far end of the row: it is
                         a mode you drop into, not a formatting toggle. -->
                    <button type="button" class="toolbar-btn toolbar-btn-ai" data-action="aiWrite"
                        data-cuelume-open="open" data-cuelume-emphasis="subtle"
                        aria-pressed={showAiOverlay}
                        title="Write with AI" aria-label="Write with AI"
                        on:click={()=>handleToolbar('aiWrite')}><HugeIcon name="magic-wand-01" /><span>AI</span></button>
                </div>

                <!-- The occasional tools: checkbox, image, code, math, rule,
                     link a PDF, attach a file. -->
                <!-- is-right: right-aligned, so the menu grows leftwards from
                     the trigger instead of off the right edge of the screen. -->
                <div class="nb-menu-wrap is-right" style="margin-left:auto">
                    <button type="button" class="toolbar-btn" data-action="insertMore"
                        aria-haspopup="true" aria-expanded={showMoreMenu}
                        title="More tools" aria-label="More tools"
                        on:click={()=> toggleMenu('more')}>
                        <HugeIcon name="menu-01" />
                    </button>
                    {#if showMoreMenu}
                        <div class="nb-menu" role="menu" aria-label="More tools">
                            <button type="button" class="nb-menu-item" role="menuitem" on:click={()=> runAndClose('more', 'checkbox')}><HugeIcon name="checkmark-square-01" /><span>Checklist</span></button>
                            <button type="button" class="nb-menu-item" role="menuitem" on:click={()=> runAndClose('more', 'code')}><HugeIcon name="code-01" /><span>Code block</span></button>
                            <button type="button" class="nb-menu-item" role="menuitem" on:click={()=> runAndClose('more', 'math')}><HugeIcon name="math" /><span>Formula</span></button>
                            <button type="button" class="nb-menu-item" role="menuitem" on:click={()=> runAndClose('more', 'image')}><HugeIcon name="image-01" /><span>Image</span></button>
                            <button type="button" class="nb-menu-item" role="menuitem" on:click={()=> runAndClose('more', 'divider')}><HugeIcon name="minus-sign" /><span>Divider</span></button>
                            <button type="button" class="nb-menu-item" role="menuitem" on:click={()=> runAndClose('more', 'linkPdf')}><HugeIcon name="pdf-01" /><span>Link a PDF</span></button>
                            <button type="button" class="nb-menu-item" role="menuitem" on:click={()=> runAndClose('more', 'attachment')}><HugeIcon name="attachment-01" /><span>Attach a file</span></button>
                        </div>
                    {/if}
                </div>
                <input type="file" id="notebookAttachmentInput" style="display:none" on:change={handleAttachment} />
            </div>
            {/if}

            <div class="notebook-editor-container" class:reading={isViewMode}>
                <!-- The page is the ruled paper. It grows with the content, so
                     the rules scroll with the text instead of being pinned to
                     the scroller — which is what makes them read as paper. -->
                <div class="notebook-page" id="notebookPage">
                {#if isViewMode}
                    <!-- Read mode. A separate surface, not an overlay: the
                         contenteditable is not in the DOM while this is up. It
                         also deliberately does NOT carry the `notebook-editor`
                         class, which renderMathInElement ignores — that is what
                         lets KaTeX render here. -->
                    <div class="notebook-view" id="notebookView" bind:this={viewEl}></div>
                    {#if !contentHtml}
                        <div class="notebook-view-empty">
                            <HugeIcon name="note-01" size="28" />
                            <p>This note is empty.</p>
                        </div>
                    {/if}
                {:else}
                    {#if isLoadingContent && !contentHtml}
                        <div class="notebook-loading" style="padding: 2.5rem 1rem; text-align: center; color: var(--color-text-muted, #888); display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <HugeiconsIcon icon={LoaderIcon} size="1.2em" class="hgi spin" />
                            <span>Loading note content...</span>
                        </div>
                    {/if}
                    <div class="notebook-editor" id="notebookEditor" contenteditable="true" data-placeholder="Start writing your note..." data-cuelume-type bind:this={editorEl} on:input={handleEditorInput} style={isLoadingContent && !contentHtml ? 'display: none;' : ''}></div>

                    {#if showAiOverlay}
                    <div class="ai-input-overlay" id="aiInputOverlay" style="display: flex;">
                        <div class="ai-input-container">
                            <div class="ai-sparkle-indicator"><HugeIcon name="magic-wand-01" /></div>
                            <input type="text" id="aiPromptInput" class="ai-prompt-input" placeholder="Describe what you want AI to write..." data-cuelume-type bind:value={aiPrompt} on:keydown={(e)=> e.key==='Enter' && submitAi()}>
                            <button type="button" class="ai-submit-btn" id="aiSubmitBtn" data-cuelume-tap="tap" data-cuelume-emphasis="subtle" on:click={submitAi}><HugeIcon name="arrow-right-01" /></button>
                            <button type="button" class="ai-cancel-btn" id="aiCancelBtn" data-cuelume-close="close" data-cuelume-emphasis="subtle" on:click={()=> showAiOverlay=false}><HugeIcon name="cancel-01" /></button>
                        </div>
                        <div class="ai-suggestions">
                            <span class="ai-suggestion" data-prompt="Summarize the linked PDF" data-cuelume-select="select" on:click={()=> {aiPrompt='Summarize the linked PDF'; submitAi();}}>Summarize PDF</span>
                            <span class="ai-suggestion" data-prompt="Create a study guide" data-cuelume-select="select" on:click={()=> {aiPrompt='Create a study guide'; submitAi();}}>Study Guide</span>
                            <span class="ai-suggestion" data-prompt="Generate key takeaways" data-cuelume-select="select" on:click={()=> {aiPrompt='Generate key takeaways'; submitAi();}}>Key Takeaways</span>
                        </div>
                    </div>
                    {/if}
                {/if}
                </div>
            </div>

            <div class="notebook-footer">
                <div class="notebook-status">
                    <a href="/notebooks" class="notebook-manage-link" id="notebookManageBtn" data-cuelume-navigate="navigate" data-cuelume-emphasis="subtle" on:click|preventDefault={() => {
                        try {
                            activeModalStore.set(null);
                        } catch (e) {
                            console.error('Close notebook failed:', e);
                        }
                        if (typeof window !== 'undefined' && window.__materioSetTab) {
                            try {
                                window.__materioSetTab('notebooks');
                            } catch (e) {
                                console.error('Tab switch failed:', e);
                            }
                        } else {
                            // Keep URL and tab store in sync (URL-only change
                            // used to desync navigation until refresh).
                            try {
                                activeTab.set('notebooks');
                            } catch (e) {
                                console.error('Tab switch failed:', e);
                            }
                            if (typeof window !== 'undefined') {
                                try {
                                    pushState('/notebooks', { tab: 'notebooks' });
                                } catch (e) {
                                    try {
                                        window.history.pushState({ tab: 'notebooks' }, '', '/notebooks');
                                    } catch (e2) {
                                        console.error('Tab navigation failed:', e2);
                                    }
                                }
                            }
                        }
                    }}><HugeIcon name="folder-open" /><span>Manage Notebooks</span></a>
                    <span class="word-count" id="notebookWordCount">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
                    <span class="save-status" id="notebookSaveStatus">
                        <span class="status-icon-container" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:4px;">
                            {#if isSaving || isLoadingContent}<HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" />{:else}<HugeIcon name="cloud-check" />{/if}
                        </span>
                        <span class="save-status-text">{saveStatusText}</span>
                    </span>
                </div>
                <div class="notebook-footer-actions">
                    <!-- Read / write and cover live down here, not in the title
                         bar: the header stays a title and a date, and these two
                         stay reachable however long the note gets. -->
                    <button type="button" class="notebook-mode-btn" id="notebookModeBtn"
                        data-cuelume-toggle="toggle"
                        aria-pressed={isViewMode}
                        title={isViewMode ? 'Switch to editing' : 'Read this note'}
                        on:click={()=> setViewMode(!isViewMode)}>
                        <HugeIcon name={isViewMode ? 'edit-02' : 'eye'} />
                        <span>{isViewMode ? 'Edit' : 'Read'}</span>
                    </button>
                    <div class="notebook-cover-picker-wrap">
                        <button type="button" class="notebook-mode-btn" id="notebookCoverBtn"
                            data-cuelume-open="open" data-cuelume-emphasis="subtle"
                            aria-expanded={showCoverPicker} title="Change cover colour"
                            on:click={()=> { showCoverPicker = !showCoverPicker; }}>
                            <span class="notebook-cover-swatch" style={coverStyle(currentCover)}></span>
                            <span>Cover</span>
                        </button>
                        {#if showCoverPicker}
                            <div class="notebook-cover-picker" role="listbox" aria-label="Cover colour">
                                {#each NOTEBOOK_COVERS as cover (cover.id)}
                                    <button type="button" class="notebook-cover-option"
                                        class:selected={currentCover === cover.id}
                                        style={coverStyle(cover.id)}
                                        data-cuelume-select="select"
                                        role="option" aria-selected={currentCover === cover.id}
                                        title={cover.label} aria-label={cover.label}
                                        on:click={()=> setCover(cover.id)}></button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                    {#if showDelete}
                    <button type="button" class="notebook-btn notebook-btn-secondary" id="notebookDeleteBtn" style="display:inline-flex;color:var(--notebook-error);" data-cuelume-close="close" data-cuelume-emphasis="strong" on:click={deleteCurrent}><HugeIcon name="delete-02" /><span>Delete</span></button>
                    {/if}
                    {#if !isViewMode}
                    <button type="button" class="notebook-btn notebook-btn-secondary" id="notebookExportBtn" data-cuelume-open="open" data-cuelume-emphasis="subtle" on:click={()=>showExportModal=true}><HugeIcon name="download-01" /><span>Export</span></button>
                    <button type="button" class="notebook-btn notebook-btn-primary" id="notebookSaveBtn" data-cuelume-tap="tap" on:click={()=>saveNote(true)}><HugeIcon name="disk" /><span>Save</span></button>
                    {:else}
                    <button type="button" class="notebook-btn notebook-btn-primary" id="notebookEditBtn" data-cuelume-toggle="toggle" on:click={()=> setViewMode(false)}><HugeIcon name="edit-02" /><span>Edit</span></button>
                    {/if}
                </div>
            </div><!-- /notebook-footer -->
            </div><!-- /notebook-sheet -->
        </div><!-- /notebook-dialog -->
    </div>

    {#if showLinkPdfModal}
        <div class="notebook-link-pdf-modal" id="linkPdfModal" style="display:flex" on:click|self={()=>showLinkPdfModal=false}>
            <div class="link-pdf-dialog">
                <div class="link-pdf-header">
                    <h3><HugeIcon name="link-01" /> Link to PDF</h3>
                    <div class="link-pdf-actions">
                        <button class="link-new-note-btn" id="linkNewNoteBtn" on:click={()=>{linkedPdfName='Current PDF'; showLinkPdfModal=false}}><HugeIcon name="plus-sign-circle" /> New Note</button>
                        <button type="button" class="link-pdf-close" id="linkPdfCloseBtn" on:click={()=>showLinkPdfModal=false}><HugeIcon name="cancel-01" /></button>
                    </div>
                </div>
                <div class="link-pdf-content">
                    <p class="link-pdf-description">Select a PDF to link this note with:</p>
                    <div class="link-pdf-search-container"><input type="text" placeholder="Search downloaded PDFs..." class="link-pdf-search" bind:value={linkedPdfName}></div>
                    <div class="link-pdf-list">
                        <button class="link-pdf-select-btn" on:click={()=>showLinkPdfModal=false}>Link</button>
                    </div>
                </div>
            </div>
        </div>
    {/if}

    {#if showExportModal}
        <div class="notebook-export-modal" id="notebookExportModal" style="display:flex" on:click|self={()=>showExportModal=false}>
            <div class="notebook-export-dialog">
                <div class="notebook-export-header"><h3><HugeIcon name="download-01" /> Export Note</h3><button type="button" class="notebook-export-close" id="notebookExportCloseBtn" on:click={()=>showExportModal=false}><HugeIcon name="cancel-01" /></button></div>
                <div class="notebook-export-content">
                    <div class="export-option" data-format="markdown" on:click={()=>doExport('md')}><HugeIcon name="file-02" /><span>Markdown (.md)</span></div>
                    <div class="export-option" data-format="html" on:click={()=>doExport('html')}><HugeIcon name="code-01" /><span>HTML (.html)</span></div>
                    <div class="export-option" data-format="txt" on:click={()=>doExport('txt')}><HugeIcon name="file-02" /><span>Plain Text (.txt)</span></div>
                    <div class="export-option" data-format="pdf" on:click={()=>doExport('html')}><HugeIcon name="pdf-01" /><span>PDF (.pdf)</span></div>
                </div>
            </div>
        </div>
    {/if}
{/if}
