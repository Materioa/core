<script>
    import { activeModalStore, themeStore } from '$lib/stores.js';
    import HugeIcon from "./HugeIcon.svelte";

    export let embedded = false;

    let selectedTheme = 'dark';
    $: if ($themeStore && selectedTheme !== $themeStore) selectedTheme = $themeStore;

    function closeModal() {
        activeModalStore.set(null);
    }

    function setTheme(t) {
        selectedTheme = t;
        themeStore.set(t);
        if (typeof document !== 'undefined') {
            document.cookie = `theme=${t}; path=/; max-age=31536000`;
            try { localStorage.setItem('theme', t); } catch {}
            window.applyThemeBasedOnConditions?.();
        }
    }

    async function clearCacheData() {
        const confirmed = typeof window !== 'undefined' && window.materioConfirm
            ? await window.materioConfirm(
                "Clear all cached files and offline preferences?",
                {
                    title: "Clear Cache",
                    type: "warning",
                    confirmText: "Clear Cache",
                    cancelText: "Cancel",
                    danger: true,
                }
            )
            : confirm("Clear cache data?");

        if (!confirmed) return;

        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
        if (typeof caches !== 'undefined') {
            try {
                const names = await caches.keys();
                await Promise.all(names.map(name => caches.delete(name)));
            } catch {}
        }
        if (typeof window !== 'undefined' && window.materioAlert) {
            await window.materioAlert('Site data and caches cleared successfully.', { title: 'Success', type: 'success' });
        } else {
            alert('Site data and caches cleared successfully.');
        }
        if (!embedded) closeModal();
    }
</script>

{#if embedded}
    <div class="settings-embedded-content">
        <div class="shortcuts-category" style="font-weight: 600; font-size: 1.1rem; margin-bottom: 10px;">Appearance Theme</div>
        <div class="theme-switcher" style="display: flex; gap: 10px; margin-bottom: 1.5rem;">
            <button type="button" class="site-button" class:active={selectedTheme === 'dark'} on:click={() => setTheme('dark')} style="flex: 1; padding: 10px;">Dark</button>
            <button type="button" class="site-button" class:active={selectedTheme === 'light'} on:click={() => setTheme('light')} style="flex: 1; padding: 10px;">Light</button>
            <button type="button" class="site-button" class:active={selectedTheme === 'amoled'} on:click={() => setTheme('amoled')} style="flex: 1; padding: 10px;">AMOLED</button>
        </div>

        <div class="shortcuts-divider" style="height: 1px; background: rgba(255,255,255,0.1); margin: 1.5rem 0;"></div>

        <div class="shortcuts-category" style="font-weight: 600; font-size: 1.1rem; margin-bottom: 10px;">Storage & Data</div>
        <p style="font-size: 0.9rem; opacity: 0.7; margin-bottom: 12px;">Clear cached PDF files and stored offline preferences.</p>
        <button type="button" class="site-button promo-secondary-btn" on:click={clearCacheData} style="color: #ff5555; border-color: rgba(255,85,85,0.4); padding: 10px 18px;">
            <HugeIcon name="delete-02" /> Clear Cached Data
        </button>
    </div>
{:else if $activeModalStore === 'settings'}
    <div class="keyboard-shortcuts-modal show" role="dialog" style="display: flex;">
        <div class="keyboard-shortcuts-backdrop" on:click={closeModal}></div>
        <div class="keyboard-shortcuts-dialog" style="max-width: 500px;">
            <button type="button" class="shortcuts-close-btn" on:click={closeModal}>
                <HugeIcon name="cancel-01" />
            </button>

            <div class="keyboard-shortcuts-content">
                <div class="shortcuts-header">
                    <h2> Settings & Preferences</h2>
                </div>

                <div class="shortcuts-list-container">
                    <div class="shortcuts-category">Appearance Theme</div>
                    <div class="theme-switcher" style="display: flex; gap: 8px; margin-bottom: 1rem;">
                        <button type="button" class="site-button" class:active={selectedTheme === 'dark'} on:click={() => setTheme('dark')}>Dark</button>
                        <button type="button" class="site-button" class:active={selectedTheme === 'light'} on:click={() => setTheme('light')}>Light</button>
                        <button type="button" class="site-button" class:active={selectedTheme === 'amoled'} on:click={() => setTheme('amoled')}>AMOLED</button>
                    </div>

                    <div class="shortcuts-divider"></div>

                    <div class="shortcuts-category">Storage & Data</div>
                    <p style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 8px;">Clear cached PDF files and stored offline preferences.</p>
                    <button type="button" class="site-button promo-secondary-btn" on:click={clearCacheData} style="color: #ff5555; border-color: rgba(255,85,85,0.4);">
                        <HugeIcon name="delete-02" /> Clear Cached Data
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
