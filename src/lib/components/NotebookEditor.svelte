<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { activeModalStore, pdfModalStore, activeTab } from '$lib/stores.js';
    import { pushState } from '$app/navigation';
    import { loadNotebookAssets, renderFormulasAndCode } from '$lib/utils/asset-loader.js';
    import HugeIcon from './HugeIcon.svelte';
    import { HugeiconsIcon } from '@hugeicons/svelte';
    import { LoaderIcon } from '@hugeicons/core-free-icons';

    // Lazy load KaTeX, Highlight.js, and Mermaid when the notebook modal opens
    $: if ($activeModalStore === 'notebook') {
        loadNotebookAssets();
    }

    export let noteId = null;

    let title = 'Untitled Note';
    let contentHtml = '';
    let isSaving = false;
    let saveStatusText = 'Saved locally';
    let wordCount = 0;
    let notebooks = [];
    let currentNotebookId = null;
    let currentLinkedPdf = null;
    let isViewMode = false;
    let showLinkPdfModal = false;
    let showPreviewModal = false;
    let showExportModal = false;
    let linkedPdfName = '';
    let showAiOverlay = false;
    let aiPrompt = '';
    let showDelete = false;

    let editorEl;

    onMount(() => {
        if (typeof localStorage !== 'undefined') {
            try {
                const saved = localStorage.getItem('materio_notebooks');
                if (saved) notebooks = JSON.parse(saved);
            } catch (e) {}
        }
        if (noteId) {
            const existing = notebooks.find(n => n.id === noteId);
            if (existing) {
                title = existing.title;
                contentHtml = existing.content;
                currentNotebookId = existing.id;
                currentLinkedPdf = existing.linkedPdf || null;
                linkedPdfName = existing.linkedPdf?.name || '';
                showDelete = true;
                setTimeout(()=> { if(editorEl) editorEl.innerHTML = contentHtml; updateWordCount(); }, 0);
            }
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('notebook:update', () => {
                try {
                    const saved = localStorage.getItem('materio_notebooks');
                    if (saved) notebooks = JSON.parse(saved);
                } catch (e) {}
            });

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
                        showDelete = true;
                        if (editorEl) { editorEl.innerHTML = contentHtml; updateWordCount(); }
                        activeModalStore.set('notebook');
                        return;
                    }
                    title = `Notes on ${pdfState.topic || pdfState.title || 'PDF'}`;
                    contentHtml = '';
                    currentNotebookId = null;
                    currentLinkedPdf = { url: pdfState.pdfUrl, name: pdfState.topic || pdfState.title, subject: pdfState.subject, semester: pdfState.semester, category: pdfState.category };
                    linkedPdfName = currentLinkedPdf.name;
                    showDelete = false;
                    if (editorEl) { editorEl.innerHTML = ''; updateWordCount(); }
                    activeModalStore.set('notebook');
                    return;
                }
                title = 'Untitled Note';
                contentHtml = '';
                currentNotebookId = null;
                currentLinkedPdf = null;
                linkedPdfName = '';
                showDelete = false;
                if (editorEl) { editorEl.innerHTML = ''; updateWordCount(); }
                activeModalStore.set('notebook');
            };
            window.openNotebook = (id) => {
                try {
                    const saved = localStorage.getItem('materio_notebooks');
                    if (saved) notebooks = JSON.parse(saved);
                } catch (e) {}

                const existing = notebooks.find(n => n.id === id);
                if (existing) {
                    title = existing.title;
                    contentHtml = existing.content;
                    currentNotebookId = id;
                    currentLinkedPdf = existing.linkedPdf || null;
                    linkedPdfName = existing.linkedPdf?.name || '';
                    showDelete = true;
                    setTimeout(()=> { if(editorEl) { editorEl.innerHTML = contentHtml; updateWordCount(); } }, 0);
                }
                activeModalStore.set('notebook');
            };
            window.MaterioNotebook = {
                get isOpen() { let v; activeModalStore.subscribe(x=>v=x)(); return v==='notebook'; },
                open: window.openNotebook, close: ()=>activeModalStore.set(null), create: window.createNewNotebook
            };
        }
        activeModalStore.subscribe(val => {
            try {
                if (val === 'notebook') {
                    setTimeout(()=> { if(editorEl && !editorEl.innerHTML && contentHtml) editorEl.innerHTML = contentHtml; updateWordCount(); }, 50);
                }
            } catch (err) {
                console.error('Notebook open sync failed:', err);
            }
        });
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

    function closeModal() { activeModalStore.set(null); showLinkPdfModal=false; showPreviewModal=false; showExportModal=false; showAiOverlay=false; }

    function updateWordCount() {
        const text = editorEl ? editorEl.innerText : '';
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        wordCount = words;
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

    function saveNote(closeAfter=false) {
        isSaving = true;
        const id = currentNotebookId || `note_${Date.now()}`;
        const now = new Date().toISOString();
        const existsIdx = notebooks.findIndex(n => n.id === id);
        // Prefer currentLinkedPdf (from linked creation) else fallback to linkedPdfName
        let linked = currentLinkedPdf;
        if (!linked && linkedPdfName) linked = { name: linkedPdfName };
        // If we have a new linkedPdf from popup but editing existing, preserve
        const nb = {
            id,
            title: title.trim() || 'Untitled Note',
            content: editorEl ? editorEl.innerHTML : contentHtml,
            tag: 'General',
            updatedAt: now,
            createdAt: existsIdx>=0 ? notebooks[existsIdx].createdAt : now,
            linkedPdf: linked,
            syncedToCloud: existsIdx>=0 ? !!notebooks[existsIdx].syncedToCloud : false
        };
        if (existsIdx>=0) notebooks[existsIdx]=nb;
        else notebooks.unshift(nb);
        currentNotebookId = id;
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

    function doPreview() { showPreviewModal = true; }
    function doExport(format) {
        const data = editorEl ? editorEl.innerText : contentHtml;
        const blob = new Blob([format==='html' ? (editorEl?.innerHTML||'') : data], { type: format==='html'?'text/html':'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href=url; a.download=`${title.replace(/[^a-z0-9]/gi,'_')}.${format==='html'?'html':format==='txt'?'txt':'md'}`; a.click(); URL.revokeObjectURL(url);
        showExportModal=false;
    }
</script>

<svelte:head>
    {#if $activeModalStore === 'notebook'}
        <link rel="stylesheet" href="/assets/style/notebook.css" />
    {/if}
</svelte:head>

{#if $activeModalStore === 'notebook'}
    <div class="notebook-modal visible" id="notebookModal" role="dialog" aria-modal="true">
        <div class="notebook-backdrop" id="notebookBackdrop" on:click={closeModal}></div>
        <div class="notebook-dialog">
            <button type="button" class="notebook-close-btn" id="notebookCloseBtn" aria-label="Close Notebook" on:click={closeModal}>
                <HugeIcon name="cancel-01" />
            </button>

            <div class="notebook-header">
                <div class="notebook-title-section">
                    <span class="notebook-icon"><HugeIcon name="book-open-02"  /></span>
                    <input type="text" id="notebookTitleInput" class="notebook-title-input" placeholder="Untitled Note" bind:value={title} on:blur={()=>saveNote(false)} maxlength="100" autocomplete="off">
                </div>
                <div class="notebook-meta">
                    <span class="notebook-date" id="notebookDate">{new Date().toLocaleDateString()}</span>
                    {#if linkedPdfName}
                        <span class="notebook-link" id="notebookLinkBadge" style="display: inline-flex;"><HugeIcon name="link-01" /><span id="notebookLinkText">{linkedPdfName}</span></span>
                    {/if}
                </div>
            </div>

            <div class="notebook-toolbar" id="notebookToolbar">
                <div class="toolbar-group toolbar-formatting">
                    <button type="button" class="toolbar-btn" data-action="bold" title="Bold" on:click={()=>handleToolbar('bold')}><HugeIcon name="text-bold" /></button>
                    <button type="button" class="toolbar-btn" data-action="italic" title="Italic" on:click={()=>handleToolbar('italic')}><HugeIcon name="text-italic" /></button>
                    <button type="button" class="toolbar-btn" data-action="underline" title="Underline" on:click={()=>handleToolbar('underline')}><HugeIcon name="text-underline" /></button>
                    <button type="button" class="toolbar-btn" data-action="strikethrough" title="Strikethrough" on:click={()=>handleToolbar('strikethrough')}><HugeIcon name="text-strikethrough" /></button>
                </div>
                <div class="toolbar-divider"></div>
                <div class="toolbar-group toolbar-headings">
                    <button type="button" class="toolbar-btn" data-action="heading1" on:click={()=>handleToolbar('heading1')}><span class="heading-text">H1</span></button>
                    <button type="button" class="toolbar-btn" data-action="heading2" on:click={()=>handleToolbar('heading2')}><span class="heading-text">H2</span></button>
                    <button type="button" class="toolbar-btn" data-action="heading3" on:click={()=>handleToolbar('heading3')}><span class="heading-text">H3</span></button>
                </div>
                <div class="toolbar-divider"></div>
                <div class="toolbar-group toolbar-lists">
                    <button type="button" class="toolbar-btn" data-action="bulletList" on:click={()=>handleToolbar('bulletList')}><HugeIcon name="list-bullet" /></button>
                    <button type="button" class="toolbar-btn" data-action="numberedList" on:click={()=>handleToolbar('numberedList')}><HugeIcon name="list-number" /></button>
                    <button type="button" class="toolbar-btn" data-action="checkbox" on:click={()=>handleToolbar('checkbox')}><HugeIcon name="checkmark-square-01" /></button>
                </div>
                <div class="toolbar-divider"></div>
                <div class="toolbar-group toolbar-insert">
                    <button type="button" class="toolbar-btn" data-action="link" on:click={()=>handleToolbar('link')}><HugeIcon name="link-01" /></button>
                    <button type="button" class="toolbar-btn" data-action="image" on:click={()=>handleToolbar('image')}><HugeIcon name="image-01" /></button>
                    <button type="button" class="toolbar-btn" data-action="code" on:click={()=>handleToolbar('code')}><HugeIcon name="code-01" /></button>
                    <button type="button" class="toolbar-btn" data-action="math" on:click={()=>handleToolbar('math')}><HugeIcon name="math" /></button>
                    <button type="button" class="toolbar-btn" data-action="quote" on:click={()=>handleToolbar('quote')}><HugeIcon name="quote-up" /></button>
                    <button type="button" class="toolbar-btn" data-action="divider" on:click={()=>handleToolbar('divider')}><HugeIcon name="minus-sign" /></button>
                </div>
                <div class="toolbar-divider"></div>
                <div class="toolbar-group toolbar-actions">
                    <button type="button" class="toolbar-btn" data-action="linkPdf" id="notebookLinkPdfBtn" on:click={()=>handleToolbar('linkPdf')}><HugeIcon name="pdf-01" /></button>
                    <button type="button" class="toolbar-btn" data-action="attachment" on:click={()=>handleToolbar('attachment')}><HugeIcon name="attachment-01" /></button>
                    <input type="file" id="notebookAttachmentInput" style="display:none" on:change={handleAttachment} />
                </div>
                <div class="toolbar-group toolbar-ai" id="notebookAiToolbar" style="display: flex;">
                    <div class="toolbar-divider"></div>
                    <button type="button" class="toolbar-btn toolbar-btn-ai" data-action="aiWrite" on:click={()=>handleToolbar('aiWrite')}><HugeIcon name="magic-wand-01" /><span>AI</span></button>
                </div>
            </div>

            <div class="notebook-editor-container">
                <div class="notebook-editor" id="notebookEditor" contenteditable="true" data-placeholder="Start writing your note..." bind:this={editorEl} on:input={handleEditorInput}></div>

                {#if showAiOverlay}
                    <div class="ai-input-overlay" id="aiInputOverlay" style="display: flex;">
                        <div class="ai-input-container">
                            <div class="ai-sparkle-indicator"><HugeIcon name="magic-wand-01" /></div>
                            <input type="text" id="aiPromptInput" class="ai-prompt-input" placeholder="Describe what you want AI to write..." bind:value={aiPrompt} on:keydown={(e)=> e.key==='Enter' && submitAi()}>
                            <button type="button" class="ai-submit-btn" id="aiSubmitBtn" on:click={submitAi}><HugeIcon name="arrow-right-01" /></button>
                            <button type="button" class="ai-cancel-btn" id="aiCancelBtn" on:click={()=> showAiOverlay=false}><HugeIcon name="cancel-01" /></button>
                        </div>
                        <div class="ai-suggestions">
                            <span class="ai-suggestion" data-prompt="Summarize the linked PDF" on:click={()=> {aiPrompt='Summarize the linked PDF'; submitAi();}}>Summarize PDF</span>
                            <span class="ai-suggestion" data-prompt="Create a study guide" on:click={()=> {aiPrompt='Create a study guide'; submitAi();}}>Study Guide</span>
                            <span class="ai-suggestion" data-prompt="Generate key takeaways" on:click={()=> {aiPrompt='Generate key takeaways'; submitAi();}}>Key Takeaways</span>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="notebook-footer">
                <div class="notebook-status">
                    <a href="/notebooks" class="notebook-manage-link" id="notebookManageBtn" on:click|preventDefault={() => {
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
                    <span class="save-status" id="notebookSaveStatus">
                        <span class="status-icon-container" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:4px;">
                            {#if isSaving}<HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" />{:else}<HugeIcon name="cloud-check" />{/if}
                        </span>
                        <span class="save-status-text">{saveStatusText}</span>
                    </span>
                    <span class="word-count" id="notebookWordCount">{wordCount} words</span>
                </div>
                <div class="notebook-footer-actions">
                    {#if showDelete}
                    <button type="button" class="notebook-btn notebook-btn-secondary" id="notebookDeleteBtn" style="display:inline-flex;color:var(--notebook-error);" on:click={deleteCurrent}><HugeIcon name="delete-02" /><span>Delete</span></button>
                    {/if}
                    <button type="button" class="notebook-btn notebook-btn-secondary" id="notebookPreviewBtn" on:click={doPreview}><HugeIcon name="eye" /><span>Preview</span></button>
                    <button type="button" class="notebook-btn notebook-btn-secondary" id="notebookExportBtn" on:click={()=>showExportModal=true}><HugeIcon name="download-01" /><span>Export</span></button>
                    <button type="button" class="notebook-btn notebook-btn-primary" id="notebookSaveBtn" on:click={()=>saveNote(true)}><HugeIcon name="disk" /><span>Save</span></button>
                </div>
            </div>
        </div>
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

    {#if showPreviewModal}
        <div class="notebook-preview-modal" id="notebookPreviewModal" style="display:flex" on:click|self={()=>showPreviewModal=false}>
            <div class="notebook-preview-dialog">
                <div class="notebook-preview-header"><h3><HugeIcon name="eye" /> Preview</h3><button type="button" class="notebook-preview-close" id="notebookPreviewCloseBtn" on:click={()=>showPreviewModal=false}><HugeIcon name="cancel-01" /></button></div>
                <div class="notebook-preview-content" id="notebookPreviewContent">{@html editorEl ? editorEl.innerHTML : ''}</div>
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
