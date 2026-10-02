<script>
    import { onMount, onDestroy } from 'svelte';
    import HugeIcon from "./HugeIcon.svelte";
    import { HugeiconsIcon } from "@hugeicons/svelte";
    import { LoaderIcon } from "@hugeicons/core-free-icons";
    import { activeModalStore, activeTab } from '$lib/stores.js';
    import { sfx } from '$lib/sounds/index.js';
    // coverStyle and getRibbon are called from the template for every entry. They
// were missing here, so rendering the list threw `ReferenceError` and the whole
// panel died — the URL changed to /notebooks but the tab never rendered.
// coverStyle and getRibbon are called from the template for every entry. They
// were missing here, so rendering the list threw `ReferenceError` and the whole
// panel died — the URL changed to /notebooks but the tab never rendered.
import { NOTEBOOK_COVERS, DEFAULT_COVER, coverLabel, coverStyle, getRibbon } from '$lib/utils/notebookCover.js';

    let notebooks = [];
    let filter = 'all';
    let filterDropdownOpen = false;
    let loading = true;
    let isSyncing = false;
    let isLoggedIn = false;

    // Which card is showing its cover editor. One at a time — a picker open on
    // every card would turn the shelf back into a wall of boxes.
    let coverPickerFor = null;
    let renamingFor = null;
    let renameDraft = '';

    function toggleCoverPicker(id) {
        coverPickerFor = coverPickerFor === id ? null : id;
        if (coverPickerFor) renamingFor = null;
    }

    function pickCover(id, coverId) {
        const list = notebooks.map(n => (n.id === id ? { ...n, cover: coverId, updatedAt: new Date().toISOString() } : n));
        notebooks = list;
        try {
            localStorage.setItem('materio_notebooks', JSON.stringify(list));
        } catch {}
        window.dispatchEvent(new CustomEvent('notebook:update', { detail: { action: 'cover', notebook: list.find(n => n.id === id) } }));
        sfx('toggle', { emphasis: 'subtle' });
    }

    function startRename(note) {
        renamingFor = note.id;
        renameDraft = note.title || '';
        coverPickerFor = null;
    }

    function commitRename(note) {
        const next = (renameDraft || '').trim() || 'Untitled Note';
        renamingFor = null;
        if (next === (note.title || 'Untitled Note')) return;
        const list = notebooks.map(n => (n.id === note.id ? { ...n, title: next, updatedAt: new Date().toISOString() } : n));
        notebooks = list;
        try {
            localStorage.setItem('materio_notebooks', JSON.stringify(list));
        } catch {}
        window.dispatchEvent(new CustomEvent('notebook:update', { detail: { action: 'rename', notebook: list.find(n => n.id === note.id) } }));
        sfx('success', { emphasis: 'subtle' });
    }

    function cycleCover(note) {
        // Cycles through the palette rather than opening a picker: the fastest
        // path to "give this one a different cover" is one more click.
        const current = note.cover || DEFAULT_COVER;
        const index = NOTEBOOK_COVERS.findIndex(c => c.id === current);
        const next = NOTEBOOK_COVERS[(index + 1) % NOTEBOOK_COVERS.length];
        pickCover(note.id, next.id);
    }

    function createNoteWithCover() {
        // The editor owns note creation (it resets title/content and assigns
        // the id), so creating a stub note here just to stamp a cover produced
        // TWO notes per click — a blank shelf entry plus the real one. The
        // editor now assigns a cover itself on first save.
        //
        // Go through __materioNotebookCreate, the canonical implementation
        // NotebookEditor publishes. window.createNewNotebook is written by BOTH
        // NotebookEditor and MainApp (which wraps it) and MainApp deletes it on
        // destroy, so calling it through optional chaining could silently do
        // nothing at all — which is what made "New Note" do nothing.
        try {
            if (typeof window.__materioNotebookCreate === 'function') {
                window.__materioNotebookCreate(true);
                return;
            }
            if (typeof window.createNewNotebook === 'function') {
                window.createNewNotebook(true);
                return;
            }
        } catch (e) {
            console.error('New note failed:', e);
        }
        // Last resort: open the editor directly so the click is never a no-op.
        activeModalStore.set('notebook');
    }

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

    function checkLoginStatus() {
        isLoggedIn = !!getAuthToken();
    }

    function loadLocalNotebooks() {
        if (typeof localStorage !== 'undefined') {
            try {
                const saved = localStorage.getItem('materio_notebooks');
                if (saved) {
                    notebooks = JSON.parse(saved);
                } else {
                    notebooks = [];
                }
            } catch (e) {
                console.error('Error parsing local notebooks:', e);
            }
        }
        loading = false;
    }

    async function fetchCloudNotebooks() {
        const token = getAuthToken();
        if (!token) {
            loading = false;
            return;
        }
        isSyncing = true;
        try {
            const res = await fetch('/api/v2/features?action=notebooks&subAction=list', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                const data = await res.json();
                const cloudNotes = data.notebooks || [];
                mergeNotebooks(cloudNotes);
            }
        } catch (e) {
            console.error('Failed to load notebooks from cloud:', e);
        } finally {
            isSyncing = false;
            loading = false;
        }
    }

    function mergeNotebooks(cloudNotes) {
        const localNotes = notebooks || [];
        const map = new Map();

        // 1. Put local notes into map
        for (const note of localNotes) {
            if (note && note.id) {
                map.set(note.id, note);
            }
        }

        // 2. Merge cloud notes
        for (const cloudNote of cloudNotes) {
            if (!cloudNote || !cloudNote.id) continue;
            const existing = map.get(cloudNote.id);
            if (!existing) {
                map.set(cloudNote.id, { ...cloudNote, syncedToCloud: true });
            } else {
                const cloudTime = new Date(cloudNote.updatedAt || 0).getTime();
                const localTime = new Date(existing.updatedAt || 0).getTime();
                if (cloudTime >= localTime) {
                    map.set(cloudNote.id, { ...cloudNote, syncedToCloud: true });
                }
            }
        }

        notebooks = Array.from(map.values()).sort(
            (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
        );

        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem('materio_notebooks', JSON.stringify(notebooks));
            } catch (e) {}
        }
    }

    function loadNotebooks() {
        checkLoginStatus();
        loadLocalNotebooks();
        if (isLoggedIn) {
            fetchCloudNotebooks();
        }
    }

    function handleNotebookUpdate(e) {
        loadLocalNotebooks();
        if (isLoggedIn && e?.detail?.action !== 'delete') {
            fetchCloudNotebooks();
        }
    }

    function handleStorageChange(e) {
        if (e.key === 'materio_notebooks') {
            loadLocalNotebooks();
        }
    }

    function handleAuthEvent() {
        checkLoginStatus();
        loadNotebooks();
    }

    onMount(() => {
        loadNotebooks();

        if (typeof window !== 'undefined') {
            window.addEventListener('notebook:update', handleNotebookUpdate);
            window.addEventListener('storage', handleStorageChange);
            window.addEventListener('auth:login', handleAuthEvent);
            window.addEventListener('auth:logout', handleAuthEvent);
        }
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('notebook:update', handleNotebookUpdate);
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('auth:login', handleAuthEvent);
            window.removeEventListener('auth:logout', handleAuthEvent);
        }
    });

    // Reactively refresh when active tab switches to notebooks
    let prevTab = null;
    $: if ($activeTab === 'notebooks' && prevTab !== 'notebooks') {
        prevTab = 'notebooks';
        loadNotebooks();
    } else if ($activeTab !== 'notebooks') {
        prevTab = $activeTab;
    }

    function createNewNotebook() {
        if (typeof window !== 'undefined' && window.createNewNotebook) {
            window.createNewNotebook(true);
        } else {
            activeModalStore.set('notebook');
        }
    }

    // window.materioToast has never existed, so every toast here was a
    // silent no-op on the success path and an alert() on the failure path.
    // materioAlert (MaterioModal) is the app's real notification channel.
    function notify(message, type = 'info') {
        if (typeof window !== 'undefined' && window.materioAlert) {
            window.materioAlert(message, { type });
        } else {
            console.info('[notebooks]', message);
        }
    }

    async function syncNotebooks() {
        checkLoginStatus();
        const token = getAuthToken();
        if (!token) {
            notify('Please log in to sync notebooks with cloud', 'warning');
            return;
        }

        isSyncing = true;
        try {
            // First push any unsynced local notes
            const unsynced = notebooks.filter(n => !n.syncedToCloud);
            for (const n of unsynced) {
                await fetch('/api/v2/features?action=notebooks', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        subAction: 'sync',
                        notebook: n
                    })
                }).catch(() => {});
            }

            // Then fetch all cloud notes
            await fetchCloudNotebooks();
            notify('Notebooks synced successfully', 'success');
            sfx('success', { emphasis: 'subtle' });
        } catch (e) {
            console.error('Sync failed:', e);
            notify('Sync failed. Please try again.', 'danger');
            sfx('error', { emphasis: 'subtle' });
        } finally {
            isSyncing = false;
        }
    }

    function setFilter(f) {
        filter = f;
        filterDropdownOpen = false;
    }

    function toggleFilterDropdown() {
        filterDropdownOpen = !filterDropdownOpen;
    }

    // Closes any open cover picker / rename field when the user clicks away,
    // otherwise the popover stays floating over the shelf.
    function handleShelfKeydown(e) {
        if (e.key === 'Escape') {
            coverPickerFor = null;
            renamingFor = null;
        }
    }

    async function deleteNote(id) {
        const confirmed = typeof window !== 'undefined' && window.materioConfirm
            ? await window.materioConfirm('Are you sure you want to delete this note? This cannot be undone.', { title: 'Delete Note', confirmText: 'Delete', cancelText: 'Cancel', danger: true, type: 'danger' })
            : confirm('Are you sure you want to delete this note?');
        if (!confirmed) return;

        notebooks = notebooks.filter(n => n.id !== id);
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem('materio_notebooks', JSON.stringify(notebooks));
            } catch (e) {}
        }

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('notebook:update', { detail: { id, action: 'delete' } }));
        }
        coverPickerFor = null;
        renamingFor = null;

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
                    id
                })
            }).catch(console.error);
        }
    }

    function stripHtml(html) {
        if (!html) return 'Empty note';
        try {
            const d = document.createElement('div');
            d.innerHTML = html;
            // textContent, not innerText: innerText is layout-dependent and
            // returns '' for a detached node, so previews silently vanished.
            const t = (d.textContent || '').replace(/\s+/g, ' ').trim();
            return t.substring(0, 140) || 'Empty note';
        } catch {
            return String(html).replace(/<[^>]*>/g, '').substring(0, 140) || 'Empty note';
        }
    }

    function openNote(note) {
        if (typeof window !== 'undefined' && window.openNotebook) {
            window.openNotebook(note.id);
        } else {
            activeModalStore.set('notebook');
        }
    }

    $: filteredNotebooks = filter === 'all'
        ? notebooks
        : notebooks.filter(n => n.linkedPdf);

    </script>

<svelte:window onkeydown={handleShelfKeydown} />

<svelte:head>
    {#if $activeTab === 'notebooks'}
        <link rel="stylesheet" href="/assets/style/notebook.css" />
    {/if}
</svelte:head>

<div class="notebooks-tab-header notebooks-shelf-header">
    <div class="notebooks-shelf-heading">
        <h1>Notebook</h1>
        <span class="notebooks-count">{filteredNotebooks.length} {filteredNotebooks.length === 1 ? 'entry' : 'entries'}</span>
    </div>
    <div class="notebooks-tab-actions">
        <select id="notebookFilter" class="notebook-filter-select" aria-label="Filter Notebooks" style="display: none;"
            data-cuelume-select
            bind:value={filter}>
            <option value="all">All Notes</option>
            <option value="linked">Linked to PDFs</option>
        </select>
        <div style="position: relative; display: inline-block;">
            <div class="accent-color-selector" id="notebookFilterSelector"
                data-cuelume-select="select" role="button" tabindex="0"
                aria-haspopup="listbox" aria-expanded={filterDropdownOpen}
                onclick={toggleFilterDropdown}
                onkeydown={(e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); toggleFilterDropdown(); } }}>
                <span id="currentNotebookFilterText">{filter === 'all' ? 'All Notes' : 'Linked to PDFs'}</span>
                <span style="font-size:11px;margin-left:4px;color:var(--color-text-muted, #666);"><HugeIcon name="arrow-down-01" /></span>
            </div>
            <div id="notebookFilterDropdown" class="accent-dropdown" class:show={filterDropdownOpen} role="listbox"
                style="left: 0; right: auto; top: calc(100% + 5px);">
                <div class="theme-dropdown-item" class:active={filter === 'all'} data-filter="all" role="option" aria-selected={filter==='all'} data-cuelume-select="select" onclick={() => setFilter('all')}>
                    <div class="theme-dropdown-item-left">
                        <span>All Notes</span>
                    </div>
                    <HugeIcon name="tick-01" class="accent-check" />
                </div>
                <div class="theme-dropdown-item" class:active={filter === 'linked'} data-filter="linked" role="option" aria-selected={filter==='linked'} data-cuelume-select="select" onclick={() => setFilter('linked')}>
                    <div class="theme-dropdown-item-left">
                        <span>Linked to PDFs</span>
                    </div>
                    <HugeIcon name="tick-01" class="accent-check" />
                </div>
            </div>
        </div>
        <button class="site-button" data-cuelume-tap="tap" onclick={createNoteWithCover}>
            <HugeIcon name="plus" /> New Note
        </button>
        {#if isLoggedIn}
            <button class="site-button secondary" id="syncBtnInTab"
                data-cuelume-tap="loading" data-cuelume-emphasis="subtle"
                style="display: inline-flex;" onclick={syncNotebooks} disabled={isSyncing}>
                <HugeIcon name="refresh" class={isSyncing ? "fa-spin" : ""} /> {isSyncing ? "Syncing..." : "Sync"}
            </button>
        {/if}
    </div>
</div>

<!-- Shelf of entries. Each card is one flat surface: a colour spine, the title
     on the page background, and a single hover-revealed action row. No nested
     panels, no gradients — the depth comes from the cover colour and a hairline. -->
<div id="notebooksGridInTab" class="notebooks-grid notebooks-shelf">
    {#if loading}
        <div class="notebook-loading">
            <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" /> Loading notebooks...
        </div>
    {:else if filteredNotebooks.length > 0}
        {#each filteredNotebooks as note (note.id || note.updatedAt)}
            <div class="notebook-card notebook-entry"
                style={coverStyle(note.cover)}
                role="button" tabindex="0"
                data-cuelume-navigate="navigate" data-cuelume-emphasis="subtle"
                onclick={() => openNote(note)}
                onkeydown={(e)=>{ if (e.key==='Enter') { e.preventDefault(); openNote(note); } }}>
                <div class="notebook-entry-spine" aria-hidden="true"></div>

                {#if getRibbon(note.ribbon)}
                    <span class="notebook-ribbon" data-ribbon={note.ribbon} title={getRibbon(note.ribbon).label} aria-label={getRibbon(note.ribbon).label}></span>
                {/if}

                <div class="notebook-entry-body">
                    <div class="notebook-entry-head">
                        {#if renamingFor === note.id}
                            <!-- Inline rename: the title is already on screen, so
                                 it becomes an input in place rather than opening a
                                 dialog to ask for a string that is already visible. -->
                            <input class="notebook-entry-title-input" type="text" maxlength="100"
                                data-cuelume-type
                                bind:value={renameDraft}
                                onclick={(e)=> e.stopPropagation()}
                                onblur={()=> commitRename(note)}
                                onkeydown={(e)=>{ if (e.key==='Enter') { e.preventDefault(); commitRename(note); } if (e.key==='Escape') { renamingFor = null; } }}
                                aria-label="Note title" />
                        {:else}
                            <h3 class="notebook-entry-title">{note.title || 'Untitled Note'}</h3>
                        {/if}
                        <span class="notebook-entry-cover-name">{coverLabel(note.cover)}</span>
                    </div>

                    <p class="notebook-entry-preview">{stripHtml(note.content)}</p>

                    <div class="notebook-entry-meta">
                        <span class="notebook-entry-date">{note.updatedAt ? new Date(note.updatedAt).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : ''}</span>
                        <span class="notebook-entry-flags">
                            {#if note.linkedPdf}
                                <span class="notebook-entry-flag" title={note.linkedPdf.name || 'Linked to a PDF'}><HugeIcon name="link-01" /></span>
                            {/if}
                            {#if note.syncedToCloud}
                                <span class="notebook-entry-flag is-synced" title="Synced"><HugeIcon name="cloud-check" /></span>
                            {/if}
                        </span>
                    </div>
                </div>

                <div class="notebook-entry-actions">
                    <button class="notebook-entry-btn" data-cuelume-select="select" title="Change cover"
                        aria-label="Change cover of {note.title || 'Untitled Note'}"
                        onclick={(e)=> { e.stopPropagation(); toggleCoverPicker(note.id); }}>
                        <span class="notebook-cover-swatch" style={coverStyle(note.cover)}></span>
                    </button>
                    <button class="notebook-entry-btn" data-cuelume-select="select" title="Rename"
                        aria-label="Rename {note.title || 'Untitled Note'}"
                        onclick={(e)=> { e.stopPropagation(); startRename(note); }}>
                        <HugeIcon name="pencil-edit-02" />
                    </button>
                    <button class="notebook-entry-btn" data-cuelume-tap="navigate" data-cuelume-emphasis="subtle" title="Open"
                        aria-label="Open {note.title || 'Untitled Note'}"
                        onclick={(e)=> { e.stopPropagation(); openNote(note); }}>
                        <HugeIcon name="eye" />
                    </button>
                    <button class="notebook-entry-btn is-danger" data-cuelume-close="close" data-cuelume-emphasis="strong" title="Delete"
                        aria-label="Delete {note.title || 'Untitled Note'}"
                        onclick={(e)=> { e.stopPropagation(); deleteNote(note.id); }}>
                        <HugeIcon name="delete-02" />
                    </button>
                </div>

                {#if coverPickerFor === note.id}
                    <div class="notebook-entry-covers" role="listbox" aria-label="Cover colour"
                        onclick={(e)=> e.stopPropagation()}>
                        {#each NOTEBOOK_COVERS as cover (cover.id)}
                            <button type="button" class="notebook-entry-cover-option"
                                class:selected={(note.cover || DEFAULT_COVER) === cover.id}
                                style={coverStyle(cover.id)}
                                data-cuelume-select="select"
                                role="option" aria-selected={(note.cover || DEFAULT_COVER) === cover.id}
                                title={cover.label} aria-label={cover.label}
                                onclick={()=> pickCover(note.id, cover.id)}></button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}
    {/if}
</div>

{#if !loading && filteredNotebooks.length === 0}
    <div id="emptyStateInTab" class="notebooks-empty">
        <div class="empty-icon"><HugeIcon name="book-open-02" size="34" /></div>
        <h3>{filter === 'linked' ? 'Nothing linked yet' : 'No notes yet'}</h3>
        <p>{filter === 'linked' ? 'Notes you create from inside a PDF will collect here.' : 'Create your first note to get started.'}</p>
        {#if filter === 'all'}
            <button class="site-button" data-cuelume-tap="tap" onclick={createNoteWithCover}>Create Note</button>
        {:else}
            <button class="site-button secondary" data-cuelume-close="close" data-cuelume-emphasis="subtle" onclick={()=> setFilter('all')}>Show all notes</button>
        {/if}
    </div>
{/if}
