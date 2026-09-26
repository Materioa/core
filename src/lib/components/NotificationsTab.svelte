<script>
    import { onMount } from 'svelte';
    import HugeIcon from "./HugeIcon.svelte";
    import { HugeiconsIcon } from "@hugeicons/svelte";
    import { LoaderIcon } from "@hugeicons/core-free-icons";
    import { activeTab, notificationsStore } from '$lib/stores.js';

    let notifications = [];
    let loading = true;

    onMount(() => {
        fetchNotifications();
    });

    activeTab.subscribe(val => {
        if (val === 'notifications') {
            fetchNotifications();
        }
    });

    function formatDateTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    }

    async function fetchNotifications() {
        loading = true;
        try {
            let items = [];
            const sources = [
                '/api/v2/notifications',
                '/api/v2/features?action=notifications-feed&num=20',
                'https://cdn.getmaterio.app/notifications.json',
                'https://cdn-materioa.netlify.app/notifications.json'
            ];

            for (const source of sources) {
                try {
                    const res = await fetch(`${source}${source.includes('?') ? '&' : '?'}t=${Date.now()}`, {
                        cache: 'no-store'
                    });
                    if (!res.ok) continue;
                    const data = await res.json();
                    const list = Array.isArray(data) ? data : (Array.isArray(data?.notifications) ? data.notifications : []);
                    const filtered = list.filter(item => item && typeof item === 'object' && (item.title || item.message || item.body));
                    if (filtered.length > 0) {
                        items = filtered;
                        break;
                    }
                } catch (err) {
                    console.warn(`Notifications source ${source} failed:`, err.message);
                }
            }

            // Only show notifications from the last 20 days matching parent notify.js line 265-272
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 20);

            const validNotifications = items
                .filter(n => {
                    if (!n || typeof n !== 'object') return false;
                    if (!n.date) return true;
                    const d = new Date(n.date);
                    if (isNaN(d.getTime())) return true;
                    return d >= cutoff;
                })
                .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

            notifications = validNotifications;
            notificationsStore.update(s => ({ ...s, items: notifications, unreadCount: 0 }));
        } catch (e) {
            console.error('Failed to load notifications:', e);
            notifications = [];
        } finally {
            loading = false;
        }
    }
</script>

<svelte:head>
    {#if $activeTab === 'notifications'}
        <link rel="stylesheet" href="/assets/style/notification.css" />
    {/if}
</svelte:head>

<!-- Matches _includes/main.html lines 849-854 -->
<h1>Notifications</h1>
<div id="notificationBoard" class="notifications-data-panel active" style="color: inherit;">
    {#if loading}
        <div class="notification-loading" style="text-align: center; padding: 40px; color: var(--muted-text, #888);">
            <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" /> Loading notifications...
        </div>
    {:else if notifications.length === 0}
        <div class="notification-empty" style="display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 50vh; text-align: center; padding: 40px 20px;">
            <img src="/assets/img/193d8b46-eaed-423e-9673-5bed950377ba.webp" alt="All Caught Up!" class="empty-state-img" style="max-width: 420px; width: 100%; opacity: 0.8;" />
            <p style="font-size: 18px; font-weight: 800; margin: 16px 0 4px; color: #666;">All Caught Up !</p>
            <p style="color: #888; font-size: 14px;">No new notifications from the last 20 days.</p>
        </div>
    {:else}
        {#each notifications as item}
            <div class="card-layout" id="notify">
                <h3>{item.title}</h3>
                <p>{item.message || item.body || ''}</p>
                {#if item.date}
                    <span class="notification-date">{formatDateTime(item.date)}</span>
                {/if}
                {#if item.links && item.links.length > 0}
                    <div class="notification-links" style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
                        {#each item.links as link}
                            <a href={link.url} target="_blank" rel="noopener noreferrer" style="color: var(--primary, #ff6600); font-weight: 500; text-decoration: underline;">{link.text || 'View details'}</a>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}
    {/if}
</div>
