<script>
    import { onMount, onDestroy } from 'svelte';
    import HugeIcon from "./HugeIcon.svelte";
    import { HugeiconsIcon } from "@hugeicons/svelte";
    import { LoaderIcon } from "@hugeicons/core-free-icons";
    import { activeModalStore, activeTab } from '$lib/stores.js';

    let notebooks = [];
    let filter = 'all';
    let filterDropdownOpen = false;
    let loading = true;
    let isSyncing = false;
    let isLoggedIn = false;

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

    async function syncNotebooks() {
        checkLoginStatus();
        const token = getAuthToken();
        if (!token) {
            if (typeof window !== 'undefined' && window.materioToast) {
                window.materioToast('Please log in to sync notebooks with cloud', 'warning');
            } else {
                alert('Please log in to sync notebooks with cloud');
            }
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
            if (typeof window !== 'undefined' && window.materioToast) {
                window.materioToast('Notebooks synced successfully', 'success');
            }
        } catch (e) {
            console.error('Sync failed:', e);
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
            const t = (d.innerText || d.textContent || '').trim();
            return t.substring(0, 120) || 'Empty note';
        } catch {
            return String(html).replace(/<[^>]*>/g, '').substring(0, 120) || 'Empty note';
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

<svelte:head>
    {#if $activeTab === 'notebooks'}
        <link rel="stylesheet" href="/assets/style/notebook.css" />
    {/if}
</svelte:head>

<!-- Matches _includes/main.html lines 861-916 -->
<div class="notebooks-tab-header">
    <h1>My Notebooks</h1>
    <div class="notebooks-tab-actions">
        <select id="notebookFilter" class="notebook-filter-select" aria-label="Filter Notebooks" style="display: none;"
            bind:value={filter}>
            <option value="all">All Notes</option>
            <option value="linked">Linked to PDFs</option>
        </select>
        <div style="position: relative; display: inline-block;">
            <div class="accent-color-selector" id="notebookFilterSelector" on:click={toggleFilterDropdown}>
                <span id="currentNotebookFilterText">{filter === 'all' ? 'All Notes' : 'Linked to PDFs'}</span>
                <span style="font-size:11px;margin-left:4px;color:#666;"><HugeIcon name="arrow-down-01" /></span>
            </div>
            <div id="notebookFilterDropdown" class="accent-dropdown" class:show={filterDropdownOpen}
                style="left: 0; right: auto; top: calc(100% + 5px);">
                <div class="theme-dropdown-item" class:active={filter === 'all'} data-filter="all" on:click={() => setFilter('all')}>
                    <div class="theme-dropdown-item-left">
                        <span>All Notes</span>
                    </div>
                    <HugeIcon name="tick-01" class="accent-check" />
                </div>
                <div class="theme-dropdown-item" class:active={filter === 'linked'} data-filter="linked" on:click={() => setFilter('linked')}>
                    <div class="theme-dropdown-item-left">
                        <span>Linked to PDFs</span>
                    </div>
                    <HugeIcon name="tick-01" class="accent-check" />
                </div>
            </div>
        </div>
        <button class="site-button" on:click={createNewNotebook}>
            <HugeIcon name="plus" /> New Note
        </button>
        {#if isLoggedIn}
            <button class="site-button secondary" id="syncBtnInTab"
                style="display: inline-flex;" on:click={syncNotebooks} disabled={isSyncing}>
                <HugeIcon name="refresh" class={isSyncing ? "fa-spin" : ""} /> {isSyncing ? "Syncing..." : "Sync"}
            </button>
        {/if}
    </div>
</div>

<!-- Notebooks Grid -->
<div id="notebooksGridInTab" class="notebooks-grid">
    {#if loading}
        <div class="notebook-loading">
            <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" /> Loading notebooks...
        </div>
    {:else if filteredNotebooks.length > 0}
        {#each filteredNotebooks as note (note.id || note.updatedAt)}
            <div class="notebook-card" on:click={() => openNote(note)}>
                <div class="notebook-card-content">
                    <h3 class="notebook-card-title"><HugeIcon name="file-02" /> {note.title || 'Untitled Note'}</h3>
                    <p class="notebook-card-preview">{stripHtml(note.content)}...</p>
                    <div class="notebook-card-meta">
                        {#if note.linkedPdf}
                            <span class="notebook-card-link"><HugeIcon name="link-01" /> PDF</span>
                        {/if}
                        {#if note.syncedToCloud}
                            <span class="notebook-card-link" style="margin-left: 6px; background: var(--notebook-accent-light, rgba(255, 130, 0, 0.15)); color: var(--notebook-accent, #ff8200);"><HugeIcon name="cloud" /></span>
                        {/if}
                        <span>{note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : ''}</span>
                    </div>
                </div>
                <div class="notebook-card-actions-quick">
                    <button class="card-action-btn delete" on:click|stopPropagation={() => deleteNote(note.id)} title="Delete"><HugeIcon name="delete-02" /></button>
                    <button class="card-action-btn" on:click|stopPropagation={() => openNote(note)} title="Open"><HugeIcon name="eye" /></button>
                </div>
            </div>
        {/each}
    {/if}
</div>

<!-- Empty State -->
{#if !loading && filteredNotebooks.length === 0}
    <div id="emptyStateInTab" class="notebooks-empty">
        <div class="empty-icon" style="font-size:48px; margin-bottom:16px; opacity:0.5;">
            <HugeIcon name="book-open-02" size="48" />
        </div>
        <h3>No notebooks yet</h3>
        <p>Create your first note to get started.</p>
        <button class="site-button" on:click={createNewNotebook}>Create Note</button>
    </div>
{/if}
