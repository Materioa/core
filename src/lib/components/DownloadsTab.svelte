<script>
    import { onMount } from 'svelte';
    import HugeIcon from "./HugeIcon.svelte";
    import { HugeiconsIcon } from "@hugeicons/svelte";
    import { LoaderIcon } from "@hugeicons/core-free-icons";
    import { activeTab, pdfModalStore } from '$lib/stores.js';
    import { getAllOfflinePdfs, deleteOfflinePdf, MAX_STORAGE_BYTES } from '$lib/utils/offlineDb.js';

    let downloads = [];
    let loading = true;
    let storageUsed = 0;
    let storageTotal = MAX_STORAGE_BYTES;
    let storagePercent = 0;

    onMount(() => {
        loadDownloads();
        loadStorageInfo();
    });

    activeTab.subscribe(val => {
        if (val === 'downloads') {
            loadDownloads();
            loadStorageInfo();
        }
    });

    async function loadDownloads() {
        loading = true;
        downloads = await getAllOfflinePdfs();
        loading = false;
        await loadStorageInfo();
    }

    async function loadStorageInfo() {
        let used = 0;
        for (const d of downloads) {
            if (d.blob && d.blob.size) {
                used += d.blob.size;
            } else if (d.size) {
                used += d.size;
            } else if (d.fileSize) {
                used += d.fileSize;
            }
        }
        storageUsed = used;
        storageTotal = MAX_STORAGE_BYTES; // Strictly capped to 128MB
        storagePercent = Math.min(100, Math.round((storageUsed / storageTotal) * 100));
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async function clearAllDownloads() {
        for (const d of downloads) {
            await deleteOfflinePdf(d.id);
        }
        downloads = [];
        await loadStorageInfo();
    }

    async function removeDownload(id) {
        await deleteOfflinePdf(id);
        downloads = downloads.filter(d => d.id !== id);
        await loadStorageInfo();
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
    }

</script>

<!-- Matches _includes/main.html lines 919-969 -->
<h1>
    Downloads
    
</h1>

<!-- Storage Info Card -->
<div class="card-layout" id="storageInfoCard" style="margin-bottom: 20px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <div>
            <h3 style="margin: 0; font-size: 16px;">Storage Usage</h3>
            <p id="storageStats" style="margin: 5px 0; color: #666; font-size: 14px;">
                {downloads.length} files • {formatBytes(storageUsed)} of {formatBytes(storageTotal)} used
            </p>
        </div>
        <button id="clearAllDownloadsBtn" class="btn"
            style="background: #dc3545; color: white; padding: 8px 16px; border-radius: 25px; border: none; cursor: var(--f-cursor-pointer); font-size: 14px;"
            on:click={clearAllDownloads}>
            <HugeIcon name="delete-02" /> Clear All
        </button>
    </div>
    <div style="background: #f0f0f0; border-radius: 8px; height: 8px; overflow: hidden;">
        <div id="storageBar"
            style="background: linear-gradient(to right, #ffd54f, #ffc540, #ffb530, #ffa520, #ff9510, #ff6f00); height: 100%; width: {storagePercent}%; transition: width 0.3s ease;">
        </div>
    </div>
</div>

<div id="downloadsBoard">
    {#if loading}
        <div id="downloadsLoading" class="loading-state">
            <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" /> Loading downloads...
        </div>
    {:else if downloads.length === 0}
        <div id="downloadsEmpty" class="empty-state"
            style="text-align: center; padding: 60px 20px;">
            
            <p style="font-size: 18px; font-weight: 600; margin: 10px 0;">No downloads yet</p>
            <p style="color: #666; font-size: 14px;">Downloaded PDFs will appear here for offline access</p>
        </div>
    {:else}
        <div id="downloadsTableWrapper">
            <div id="downloadsTableHeader"
                style="display: grid; grid-template-columns: 1fr 150px 120px 100px 100px; gap: 15px; padding: 12px 16px; background: rgba(255, 130, 0, 0.1); border-radius: 8px; margin-bottom: 10px; font-weight: 600; font-size: 14px;">
                <div style="text-align: left;">Name</div>
                <div style="text-align: left;">Subject</div>
                <div style="text-align: left;">Semester</div>
                <div style="text-align: left;">Size</div>
                <div style="text-align: center;">Actions</div>
            </div>
            <div id="downloadsList">
                {#each downloads as item}
                    <div class="download-row" style="display: grid; grid-template-columns: 1fr 150px 120px 100px 100px; gap: 15px; padding: 12px 16px; border-bottom: 1px solid var(--color-border-light, rgba(0,0,0,0.06)); align-items: center; cursor: pointer;"
                        on:click={() => openOfflinePdf(item)}>
                        <div style="text-align: left; font-weight: 500;">{item.title || 'Untitled'}</div>
                        <div style="text-align: left; font-size: 13px; opacity: 0.8;">{item.subject || '—'}</div>
                        <div style="text-align: left; font-size: 13px; opacity: 0.8;">{item.semester || '—'}</div>
                        <div style="text-align: left; font-size: 13px; opacity: 0.8;">{item.size ? formatBytes(item.size) : '—'}</div>
                        <div style="text-align: center;">
                            <button class="btn" style="background: #dc3545; color: white; padding: 4px 10px; border-radius: 15px; border: none; cursor: pointer; font-size: 12px;"
                                on:click|stopPropagation={() => removeDownload(item.id)}>
                                <HugeIcon name="delete-02" />
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>
