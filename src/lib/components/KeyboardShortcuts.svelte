<script>
    import { onMount } from 'svelte';
    import { activeModalStore, pdfModalStore, themeStore, activeTab } from '$lib/stores.js';
    import HugeIcon from './HugeIcon.svelte';
    import { getOverviewUrl } from '$lib/utils/app-urls.js';

    let showShortcutsDialog = false;
    let showEditModal = false;
    let editShortcutId = null;
    let editActionName = '';
    let editKeysDisplay = 'Press new key combination...';
    let capturedKeys = null;
    let capturedDisplay = '';

    const isMac = typeof navigator !== 'undefined' && (navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.toUpperCase().indexOf('MAC') >= 0);
    const keyLabels = { ctrl: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: '⇧', escape: 'Esc', backspace: '⌫', enter: '↵' };

    const defaultShortcuts = {
        nav_home: { keys: { alt: true, key: 'h' }, display: 'Alt+H' },
        nav_chat: { keys: { alt: true, key: 'c' }, display: 'Alt+C' },
        nav_notifications: { keys: { alt: true, key: 'n' }, display: 'Alt+N' },
        nav_settings: { keys: { alt: true, key: 's' }, display: 'Alt+S' },
        nav_profile: { keys: { alt: true, key: 'p' }, display: 'Alt+P' },
        nav_downloads: { keys: { alt: true, key: 'd' }, display: 'Alt+D' },
        toggle_notebook: { keys: { alt: true, key: 'o' }, display: 'Alt+O' },
        reading_start: { keys: { shift: true, key: 'Enter' }, display: 'Shift+Enter' },
        reading_fullscreen: { keys: { shift: true, key: 'f' }, display: 'Shift+F' },
        reading_bookmark: { keys: { shift: true, key: 'b' }, display: 'Shift+B' },
        reading_mode_inversion: { keys: { alt: true, key: 'i' }, display: 'Alt+I' },
        reading_mode_paper: { keys: { alt: true, shift: true, key: 'p' }, display: 'Alt+Shift+P' },
        reading_cycle_texture: { keys: { ctrl: true, shift: true, key: '1' }, display: 'Ctrl+Shift+!' },
        reading_mode_eink: { keys: { alt: true, key: 'e' }, display: 'Alt+E' },
        search_finder: { keys: { ctrl: true, key: 'k' }, display: 'Ctrl+K' },
        search_ai_mode: { keys: { ctrl: true, shift: true, key: 'k' }, display: 'Ctrl+Shift+K' },
        clear_search: { keys: { shift: true, key: 'Backspace' }, display: 'Shift+Backspace' },
        show_shortcuts: { keys: { shift: true, key: '?' }, display: 'Shift+?' },
        close_popup: { keys: { key: 'Escape' }, display: 'Escape' },
        toggle_dark_mode: { keys: { ctrl: true, shift: true, key: 'd' }, display: 'Ctrl+Shift+D' },
        toggle_wallpaper: { keys: { ctrl: true, alt: true, key: 'w' }, display: 'Ctrl+Alt+W' },
        toggle_insightroom: { keys: { alt: true, shift: true, key: 'n' }, display: 'Alt+Shift+N' },
        toggle_insightroom_view: { keys: { ctrl: true, shift: true, key: 'i' }, display: 'Ctrl+Shift+I' },
        clear_data: { keys: { ctrl: true, key: 'Backspace' }, display: 'Ctrl+Backspace' },
        clear_all_data: { keys: { ctrl: true, shift: true, key: 'Backspace' }, display: 'Ctrl+Shift+Backspace' }
    };

    let shortcuts = JSON.parse(JSON.stringify(defaultShortcuts));
    let activeKeys = new Set();

    function formatKeyDisplay(display) {
        if (!display) return '';
        return display.split('+').map(key => {
            const lk = key.toLowerCase();
            if (lk === 'ctrl') return keyLabels.ctrl;
            if (lk === 'alt') return keyLabels.alt;
            if (lk === 'shift') return keyLabels.shift;
            if (lk === 'escape') return keyLabels.escape;
            if (lk === 'backspace') return keyLabels.backspace;
            if (lk === 'enter') return keyLabels.enter;
            return key;
        }).join(' + ');
    }

    function formatKbd(display) {
        if (!display) return '';
        return display.split('+').map(key => {
            const lk = key.toLowerCase();
            let label = key;
            if (lk === 'ctrl') label = keyLabels.ctrl;
            else if (lk === 'alt') label = keyLabels.alt;
            else if (lk === 'shift') label = keyLabels.shift;
            else if (lk === 'escape') label = keyLabels.escape;
            else if (lk === 'backspace') label = keyLabels.backspace;
            else if (lk === 'enter') label = keyLabels.enter;
            return `<kbd>${label}</kbd>`;
        }).join(' ');
    }

    function loadShortcuts() {
        try {
            const saved = localStorage.getItem('materioKeyboardShortcuts');
            if (saved) {
                const parsed = JSON.parse(saved);
                for (const id in parsed) if (shortcuts[id]) { shortcuts[id].keys = parsed[id].keys; shortcuts[id].display = parsed[id].display; }
            }
        } catch {}
    }
    function saveShortcuts() {
        const customized = {};
        for (const id in shortcuts) if (shortcuts[id].display !== defaultShortcuts[id].display) customized[id]={keys:shortcuts[id].keys, display:shortcuts[id].display};
        if (Object.keys(customized).length) localStorage.setItem('materioKeyboardShortcuts', JSON.stringify(customized));
        else localStorage.removeItem('materioKeyboardShortcuts');
    }
    function resetShortcuts() {
        shortcuts = JSON.parse(JSON.stringify(defaultShortcuts));
        localStorage.removeItem('materioKeyboardShortcuts');
    }

    activeModalStore.subscribe(val => {
        try {
            showShortcutsDialog = (val === 'shortcuts');
        } catch (err) {
            console.error('Shortcuts sync failed:', err);
        }
    });

    onMount(() => {
        loadShortcuts();
        const click = (id) => document.getElementById(id)?.click();
        const toggleShortcutDialog = () => activeModalStore.update((modal) => modal === "shortcuts" ? null : "shortcuts");
        const isTyping = (target) => target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);

        const handleKeyDown = (event) => {
            const ignoreKeys = ['control','alt','shift','meta'];
            if (!ignoreKeys.includes(event.key.toLowerCase())) {
                const code = event.code?.toLowerCase() || '';
                let norm = null;
                if (code.startsWith('key')) norm = code.slice(3);
                else if (code.startsWith('digit')) norm = code.slice(5);
                else norm = event.key.toLowerCase();
                activeKeys.add(norm);
            }
            if (editShortcutId) { handleEditKeyDown(event); return; }
            if (isTyping(event.target) && event.key !== "Escape") return;
            const key = event.key.toLowerCase();
            const ctrl = event.ctrlKey || event.metaKey;
            const alt = event.altKey;
            const shift = event.shiftKey;
            const prevent = () => { event.preventDefault(); event.stopPropagation(); };
            if (event.key === "Escape") {
                prevent();
                if (showEditModal) { closeEditModal(); return; }
                if ($pdfModalStore.isOpen) pdfModalStore.update((state) => ({ ...state, isOpen: false }));
                else activeModalStore.set(null);
                return;
            }
            if (ctrl && shift && key === "k") { prevent(); click("aiSearchToggle"); document.getElementById("quickSearchInput")?.focus(); return; }
            if (ctrl && key === "k") { prevent(); document.getElementById("quickSearchInput")?.focus(); return; }
            if (ctrl && key === "s") {
                // Save PDF annotations when the reader is open (blocks the
                // browser's Save-page dialog for an explicit in-app save).
                try {
                    if ($pdfModalStore.isOpen && typeof window.__materioSavePdfAnnotations === 'function') {
                        prevent();
                        window.__materioSavePdfAnnotations();
                        return;
                    }
                } catch {}
            }
            if ((shift && key === "?") || (ctrl && key === "/")) { prevent(); toggleShortcutDialog(); return; }
            if (alt && shift && key === "n") { 
                prevent(); 
                if (typeof window !== 'undefined' && typeof window.toggleInsightroomFeed === 'function') {
                    window.toggleInsightroomFeed();
                } else {
                    click("insightroomToggle"); 
                }
                return; 
            }
            if (alt && shift && key === "p") { prevent(); click("paperModeToggle"); return; }
            if (ctrl && shift && (key === "1" || event.code === "Digit1")) { prevent(); click("paperTextureSelectedText"); return; }
            if (ctrl && shift && key === "d") { prevent(); if (window.cycleTheme) window.cycleTheme(); else themeStore.update((theme) => theme === "dark" ? "light" : "dark"); return; }
            if (ctrl && shift && key === "i") { 
                prevent(); 
                if (typeof window !== 'undefined' && typeof window.toggleInsightroomView === 'function') {
                    window.toggleInsightroomView();
                } else {
                    click("viewStyleSelectedText"); 
                }
                return; 
            }
            if (ctrl && shift && event.key === "Backspace") {
                prevent();
                const doClear = async () => {
                    const confirmed = typeof window !== 'undefined' && window.materioConfirm
                        ? await window.materioConfirm("Are you sure you want to clear all data? This cannot be undone.", { title: "Clear All Data?", type: "danger", danger: true, confirmText: "Clear All Data" })
                        : confirm("Are you sure you want to clear all data? This cannot be undone.");
                    if (confirmed) {
                        localStorage.clear(); sessionStorage.clear(); location.reload();
                    }
                };
                doClear();
                return;
            }
            if (ctrl && event.key === "Backspace") { prevent(); document.querySelector("#clearSiteDataCard .toggle-container")?.click(); return; }
            if (ctrl && alt && key === "w") { prevent(); click("enableBgToggle"); return; }
            if (shift && event.key === "Enter") { prevent(); click("submitButton"); return; }
            if (shift && key === "f") { prevent(); click("fullscreenButton"); return; }
            if (shift && key === "b") { prevent(); click("downloadButton"); return; }
            if (alt && key === "h") { prevent(); activeTab.set("home"); return; }
            if (alt && key === "c") { prevent(); window.location.href='https://chat.getmaterio.app'; return; }
            if (alt && key === "n") { prevent(); activeTab.set("notifications"); return; }
            if (alt && key === "s") { prevent(); document.querySelector('[data-action="settings"]')?.click(); return; }
            if (alt && key === "p") { prevent(); location.assign(getOverviewUrl()); return; }
            if (alt && key === "d") { prevent(); activeTab.set("downloads"); return; }
            if (alt && key === "o") { prevent(); $pdfModalStore.isOpen ? activeModalStore.set("notebook") : activeTab.set("notebooks"); return; }
            if (alt && key === "i") { prevent(); click("invertModeToggle"); return; }
            if (alt && key === "e") { prevent(); click("einkModeToggle"); }
        };
        const handleKeyUp = (e) => {
            const code = e.code?.toLowerCase() || '';
            let norm = code.startsWith('key') ? code.slice(3) : code.startsWith('digit') ? code.slice(5) : e.key.toLowerCase();
            activeKeys.delete(norm); activeKeys.delete(e.key.toLowerCase());
        };
        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("blur", () => activeKeys.clear());
        return () => { window.removeEventListener("keydown", handleKeyDown, true); window.removeEventListener("keyup", handleKeyUp, true); };
    });

    function openEditModal(id) {
        editShortcutId = id;
        capturedKeys = null; capturedDisplay='';
        editKeysDisplay = 'Press new key combination...';
        const item = document.querySelector(`[data-shortcut-id="${id}"]`);
        if (item) editActionName = item.querySelector('.shortcut-action')?.textContent || id;
        showEditModal = true;
    }
    function closeEditModal() { showEditModal=false; editShortcutId=null; capturedKeys=null; capturedDisplay=''; }
    function handleEditKeyDown(e) {
        e.preventDefault(); e.stopPropagation();
        const keys = { ctrl: e.ctrlKey||e.metaKey, alt: e.altKey, shift: e.shiftKey };
        const displayParts=[];
        if (keys.ctrl) displayParts.push(isMac ? 'Cmd':'Ctrl');
        if (keys.alt) displayParts.push(isMac ? 'Option':'Alt');
        if (keys.shift) displayParts.push('Shift');
        const currentKeys = Array.from(activeKeys);
        currentKeys.forEach(k=>{
            let keyName=k;
            if(keyName==='space') keyName='Space'; else if(keyName==='enter') keyName='Enter'; else if(keyName==='backspace') keyName='Backspace'; else if(keyName==='escape') keyName='Escape'; else if(keyName.length===1) keyName=keyName.toUpperCase();
            displayParts.push(keyName);
        });
        if(displayParts.length){
            const currentDisplay=displayParts.join('+');
            editKeysDisplay = formatKbd(currentDisplay);
            if(currentKeys.length){ keys.keys=currentKeys; capturedKeys=keys; capturedDisplay=currentDisplay; }
        }
    }
    function saveEdit() {
        if(!editShortcutId || !capturedKeys){ closeEditModal(); return; }
        let normalized = capturedDisplay.replace('Cmd','Ctrl').replace('Option','Alt');
        shortcuts[editShortcutId].keys=capturedKeys; shortcuts[editShortcutId].display=normalized;
        saveShortcuts(); shortcuts={...shortcuts}; closeEditModal();
    }
    async function handleReset() {
        const confirmed = typeof window !== 'undefined' && window.materioConfirm
            ? await window.materioConfirm('Reset all shortcuts to defaults?', { title: 'Reset Shortcuts', type: 'warning', confirmText: 'Reset', cancelText: 'Cancel' })
            : confirm('Reset all shortcuts to defaults?');
        if (confirmed) {
            resetShortcuts();
            shortcuts = { ...shortcuts };
        }
    }
    function closeModal() { showShortcutsDialog=false; activeModalStore.set(null); }
</script>

{#if showShortcutsDialog}
    <div class="keyboard-shortcuts-modal visible" id="keyboardShortcutsModal" role="dialog" aria-modal="true">
        <div class="keyboard-shortcuts-backdrop" id="keyboardShortcutsBackdrop" on:click={closeModal}></div>
        <div class="keyboard-shortcuts-dialog">
            <button type="button" class="shortcuts-close-btn" id="shortcutsCloseBtn" aria-label="Close" on:click={closeModal}>
                <HugeIcon name="cancel-01" />
            </button>
            <div class="keyboard-shortcuts-content">
                <div class="shortcuts-header">
                    <h2><HugeIcon name="keyboard" aria-hidden="true" /> Keyboard Shortcuts</h2>
                </div>
                <div class="shortcuts-list-container">
                    <div class="shortcuts-category">Navigation</div>
                    <div class="shortcut-item" data-shortcut-id="nav_home"><span class="shortcut-action">Go to Home</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.nav_home.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('nav_home')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="nav_chat"><span class="shortcut-action">Go to Chat</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.nav_chat.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('nav_chat')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="nav_notifications"><span class="shortcut-action">Go to Notifications</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.nav_notifications.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('nav_notifications')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="nav_settings"><span class="shortcut-action">Go to Settings</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.nav_settings.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('nav_settings')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="nav_profile"><span class="shortcut-action">Go to Profile</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.nav_profile.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('nav_profile')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="nav_downloads"><span class="shortcut-action">Go to Downloads</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.nav_downloads.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('nav_downloads')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="toggle_notebook"><span class="shortcut-action">Toggle Notebooks / Active Note</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.toggle_notebook.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('toggle_notebook')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcuts-divider"></div>
                    <div class="shortcuts-category">Reading</div>
                    <div class="shortcut-item" data-shortcut-id="reading_start"><span class="shortcut-action">Start Reading (Open PDF)</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.reading_start.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('reading_start')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="reading_fullscreen"><span class="shortcut-action">Toggle Viewer Fullscreen</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.reading_fullscreen.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('reading_fullscreen')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="reading_bookmark"><span class="shortcut-action">Download / Bookmark</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.reading_bookmark.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('reading_bookmark')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="reading_mode_inversion"><span class="shortcut-action">Toggle Inversion Mode</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.reading_mode_inversion.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('reading_mode_inversion')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="reading_mode_paper"><span class="shortcut-action">Toggle Paper Mode</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.reading_mode_paper.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('reading_mode_paper')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="reading_cycle_texture"><span class="shortcut-action">Cycle Paper Texture</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.reading_cycle_texture.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('reading_cycle_texture')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="reading_mode_eink"><span class="shortcut-action">Toggle E-ink Mode</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.reading_mode_eink.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('reading_mode_eink')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcuts-divider"></div>
                    <div class="shortcuts-category">Search</div>
                    <div class="shortcut-item" data-shortcut-id="search_finder"><span class="shortcut-action">Open Finder/Search</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.search_finder.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('search_finder')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="search_ai_mode"><span class="shortcut-action">Toggle AI Search Mode</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.search_ai_mode.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('search_ai_mode')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="clear_search"><span class="shortcut-action">Clear Search Query</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.clear_search.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('clear_search')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcuts-divider"></div>
                    <div class="shortcuts-category">Actions</div>
                    <div class="shortcut-item" data-shortcut-id="show_shortcuts"><span class="shortcut-action">Show Keyboard Shortcuts</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.show_shortcuts.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('show_shortcuts')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="close_popup"><span class="shortcut-action">Close Popup/Dialog</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.close_popup.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('close_popup')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="toggle_dark_mode"><span class="shortcut-action">Toggle Dark/Light Mode</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.toggle_dark_mode.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('toggle_dark_mode')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcuts-divider"></div>
                    <div class="shortcuts-category">Settings</div>
                    <div class="shortcut-item" data-shortcut-id="toggle_wallpaper"><span class="shortcut-action">Toggle Wallpaper Engine</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.toggle_wallpaper.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('toggle_wallpaper')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="toggle_insightroom"><span class="shortcut-action">Toggle Insightroom Feed</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.toggle_insightroom.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('toggle_insightroom')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="toggle_insightroom_view"><span class="shortcut-action">Change Insightroom View</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.toggle_insightroom_view.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('toggle_insightroom_view')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="clear_data"><span class="shortcut-action">Clear Data</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.clear_data.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('clear_data')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                    <div class="shortcut-item" data-shortcut-id="clear_all_data"><span class="shortcut-action">Hard Reset (Clear All)</span><div class="shortcut-right"><code class="shortcut-keys">{formatKeyDisplay(shortcuts.clear_all_data.display)}</code><button class="shortcut-edit-btn" title="Edit shortcut" on:click={() => openEditModal('clear_all_data')}><HugeIcon name="pencil-edit-02" /></button></div></div>
                </div>
                <div class="shortcuts-footer">
                    <button class="reset-shortcuts-btn" id="resetShortcutsBtn" on:click={handleReset}>
                        <HugeIcon name="undo" /> Reset to Defaults
                    </button>
                </div>
            </div>
        </div>
    </div>
    {#if showEditModal}
        <div class="shortcut-edit-modal visible" id="shortcutEditModal" on:click|self={closeEditModal}>
            <div class="shortcut-edit-dialog">
                <h3>Edit Shortcut</h3>
                <p class="edit-action-name" id="editActionName">{editActionName}</p>
                <div class="edit-keys-display" id="editKeysDisplay">{@html editKeysDisplay}</div>
                <p class="edit-hint">Press the key combination you want to use, then click Save</p>
                <div class="edit-buttons">
                    <button class="edit-cancel-btn" id="editCancelBtn" on:click={closeEditModal}>Cancel</button>
                    <button class="edit-save-btn" id="editSaveBtn" on:click={saveEdit}>Save</button>
                </div>
            </div>
        </div>
    {/if}
{/if}
