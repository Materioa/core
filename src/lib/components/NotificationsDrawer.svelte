<script>
    import { onMount } from 'svelte';
    import HugeIcon from "./HugeIcon.svelte";
    import { HugeiconsIcon } from "@hugeicons/svelte";
    import { LoaderIcon } from "@hugeicons/core-free-icons";
    import { activeModalStore, activeTab, notificationsStore } from '$lib/stores.js';

    export let embedded = false;

    let notifications = [];
    let loading = true;
    let pushEnabled = false;

    onMount(() => {
        fetchNotifications();
    });

    activeModalStore.subscribe(val => {
        try {
            if (val === 'notifications') {
                fetchNotifications();
            }
        } catch (err) {
            console.error('Notifications sync failed:', err);
        }
    });

    activeTab.subscribe(val => {
        try {
            if (val === 'notifications') {
                fetchNotifications();
            }
        } catch (err) {
            console.error('Notifications tab sync failed:', err);
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
                    console.warn(`NotificationsDrawer source ${source} failed:`, err.message);
                }
            }

            // Only show notifications from the last 20 days matching parent notify.js line 265-272
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 20);

            notifications = items
                .filter(n => {
                    if (!n || typeof n !== 'object') return false;
                    if (!n.date) return true;
                    const d = new Date(n.date);
                    if (isNaN(d.getTime())) return true;
                    return d >= cutoff;
                })
                .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
                .map(item => ({
                    ...item,
                    title: item.title || 'Notification',
                    body: item.body || item.message || '',
                    time: item.time || formatDateTime(item.date) || 'Recent'
                }));

            notificationsStore.update(s => ({ ...s, items: notifications, unreadCount: 0 }));
        } catch (e) {
            console.error('Failed to load notifications in drawer:', e);
            notifications = [];
        } finally {
            loading = false;
        }
    }

    function closeModal() {
        activeModalStore.set(null);
    }

    async function togglePush() {
        if ('Notification' in window) {
            const perm = await Notification.requestPermission();
            pushEnabled = perm === 'granted';
        }
    }
</script>

<svelte:head>
    {#if embedded || $activeModalStore === 'notifications'}
        <link rel="stylesheet" href="/assets/style/notification.css" />
    {/if}
</svelte:head>

{#if embedded}
    <div class="notifications-embedded-content">
        <div class="push-banner" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(255,130,0,0.1); border-radius: 12px; margin-bottom: 1.5rem;">
            <span style="font-size: 0.9rem; font-weight: 500;">Web Push Notifications</span>
            <button type="button" class="site-button" on:click={togglePush} style="padding: 6px 14px; font-size: 0.85rem;">
                {pushEnabled ? 'Enabled' : 'Enable'}
            </button>
        </div>

        <div class="notifications-list">
            {#if loading}
                <div class="notice-loading" style="text-align: center; padding: 2rem;">
                    <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" /> Loading...
                </div>
            {:else if notifications.length === 0}
                <div class="notice-empty" style="text-align: center; padding: 3rem; color: var(--muted-text, #888);">
                    
                    <p style="font-size: 1.1rem; font-weight: 500;">You are all caught up!</p>
                </div>
            {:else}
                {#each notifications as item}
                    <div class="notification-item" style="padding: 14px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                        <div class="item-title" style="font-weight: 600; margin-bottom: 4px;">{item.title}</div>
                        <div class="item-body" style="font-size: 0.9rem; opacity: 0.8;">{item.body}</div>
                        <span class="item-time" style="font-size: 0.75rem; opacity: 0.5; margin-top: 6px; display: block;">{item.time || 'Just now'}</span>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
{:else if $activeModalStore === 'notifications'}
    <div class="keyboard-shortcuts-modal show" role="dialog" style="display: flex;">
        <div class="keyboard-shortcuts-backdrop" on:click={closeModal}></div>
        <div class="keyboard-shortcuts-dialog" style="max-width: 450px;">
            <button type="button" class="shortcuts-close-btn" on:click={closeModal}>
                <HugeIcon name="cancel-01" />
            </button>

            <div class="keyboard-shortcuts-content">
                <div class="shortcuts-header">
                    <h2> Notifications</h2>
                </div>

                <div class="push-banner" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255,130,0,0.1); border-radius: 8px; margin-bottom: 1rem;">
                    <span style="font-size: 0.85rem;">Web Push Notifications</span>
                    <button type="button" class="site-button" on:click={togglePush} style="padding: 4px 12px; font-size: 0.8rem;">
                        {pushEnabled ? 'Enabled' : 'Enable'}
                    </button>
                </div>

                <div class="notifications-list">
                    {#if loading}
                        <div class="notice-loading" style="text-align: center; padding: 2rem;">
                            <HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" /> Loading...
                        </div>
                    {:else if notifications.length === 0}
                        <div class="notice-empty" style="text-align: center; padding: 2rem; color: var(--muted-text, #888);">
                            
                            <p>You are all caught up!</p>
                        </div>
                    {:else}
                        {#each notifications as item}
                            <div class="notification-item">
                                <div class="item-title">{item.title}</div>
                                <div class="item-body">{item.body}</div>
                                <span class="item-time">{item.time || 'Just now'}</span>
                            </div>
                        {/each}
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}
