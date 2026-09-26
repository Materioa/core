<script>
    import { onMount } from 'svelte';
    import { activeModalStore, activeTab, pdfModalStore } from '$lib/stores.js';
    import HugeIcon from './HugeIcon.svelte';
    import { HugeiconsIcon } from '@hugeicons/svelte';
    import { LoaderIcon } from '@hugeicons/core-free-icons';
    import { getAllOfflinePdfs, deleteOfflinePdf } from '$lib/utils/offlineDb.js';

    export let embedded = false;

    let downloads = [];
    let loading = true;

    onMount(() => {
        loadDownloads();
    });

    activeModalStore.subscribe(val => {
        try {
            if (val === 'downloads') {
                loadDownloads();
            }
        } catch (err) {
            console.error('Downloads sync failed:', err);
        }
    });

    activeTab.subscribe(val => {
        try {
            if (val === 'downloads') {
                loadDownloads();
            }
        } catch (err) {
            console.error('Downloads tab sync failed:', err);
        }
    });

    async function loadDownloads() {
        loading = true;
        downloads = await getAllOfflinePdfs();
        loading = false;
    }

    function closeModal() {
        activeModalStore.set(null);
    }

    async function removeDownload(id) {
        const confirmed = typeof window !== 'undefined' && window.materioConfirm
            ? await window.materioConfirm('Delete this downloaded PDF?', { title: 'Delete Download', confirmText: 'Delete', cancelText: 'Cancel', danger: true, type: 'danger' })
            : confirm('Delete this downloaded PDF?');
        if (!confirmed) return;
        await deleteOfflinePdf(id);
        downloads = downloads.filter(d => d.id !== id);
    }

    function openOfflinePdf(item) {
        const originalUrl = item.url || item.id || '';
        pdfModalStore.set({
            isOpen: true,
            pdfUrl: originalUrl,
            title: item.title,
            subject: item.subject,
            category: item.category,
            semester: item.semester,
            readingMode: 'default',
            isBookmarked: true
        });
        if (!embedded) closeModal();
    }

</script>

{#if embedded}
    <div class="downloads-embedded-content">
        {#if loading}
            <div style="text-align: center; padding: 40px;">
                <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" />
                <p style="margin-top: 10px;">Loading downloads...</p>
            </div>
        {:else if downloads.length === 0}
            <div style="text-align: center; padding: 40px 20px; background: rgba(0,0,0,0.1); border-radius: 12px;">
                
                <h3 style="margin: 0 0 6px 0;">No offline PDFs saved yet</h3>
                <p style="opacity: 0.7; font-size: 0.9rem; margin: 0;">Bookmark materials while reading to save them here for offline access.</p>
            </div>
        {:else}
            <div class="downloads-list" style="display: flex; flex-direction: column; gap: 10px;">
                {#each downloads as item}
                    <div class="shimmer-button" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-radius: 12px; cursor: pointer;" on:click={() => openOfflinePdf(item)}>
                        <div>
                            <strong style="display: block; font-size: 1rem;">{item.title}</strong>
                            <small style="opacity: 0.7; font-size: 0.8rem;">{item.subject || ''} • {item.semester || ''}</small>
                        </div>
                        <button type="button" class="site-button secondary" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px;" on:click|stopPropagation={() => removeDownload(item.id)}>
                            <HugeIcon name="delete-02" /> Remove
                        </button>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{:else if $activeModalStore === 'downloads'}
    <div class="promo-modal-overlay" style="display: flex;" on:click={closeModal}>
        <div class="promo-modal dynamic-form-modal" on:click|stopPropagation>
            <button type="button" class="promo-close-btn" on:click={closeModal} aria-label="Close">
                <HugeIcon name="cancel-01" />
            </button>
            <div class="promo-content dynamic-form-content-wrapper">
                <h2><span class="promo-title">Offline Downloads</span></h2>
                {#if loading}
                    <div style="text-align: center; padding: 30px;">
                        <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" /> Loading downloads...
                    </div>
                {:else if downloads.length === 0}
                    <div style="text-align: center; padding: 30px;">
                        
                        <p>No offline PDFs saved yet.</p>
                        <small style="opacity: 0.6;">Bookmark materials while online to access them here without internet.</small>
                    </div>
                {:else}
                    <div class="downloads-list" style="display: flex; flex-direction: column; gap: 8px; margin-top: 15px;">
                        {#each downloads as item}
                            <div class="shimmer-button" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;" on:click={() => openOfflinePdf(item)}>
                                <div>
                                    <strong style="display: block;">{item.title}</strong>
                                    <small style="opacity: 0.7;">{item.subject || ''} • {item.semester || ''}</small>
                                </div>
                                <button type="button" class="site-button secondary" style="padding: 4px 8px; font-size: 0.75rem;" on:click|stopPropagation={() => removeDownload(item.id)}>
                                    Remove
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
