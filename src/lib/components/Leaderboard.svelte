<script>
    import { onMount, onDestroy } from 'svelte';
    import { activeTab } from '$lib/stores.js';
    import HugeIcon from './HugeIcon.svelte';
    import { HugeiconsIcon } from '@hugeicons/svelte';
    import { LoaderIcon } from '@hugeicons/core-free-icons';
    import { getSignupUrl } from '$lib/utils/app-urls.js';

    let range = 'weekly'; // 'weekly' | 'today'
    let entries = [];
    let loading = false;
    let hasLoaded = false;
    const leaderboardCache = new Map();

    // Only load leaderboard data when the tab is active
    $: if ($activeTab === 'leaderboard') {
        fetchLeaderboard();
    }

    onMount(() => {
        const handleTabOpened = (e) => {
            if (e.detail?.tab === 'leaderboard') {
                fetchLeaderboard();
            }
        };
        document.addEventListener('tabOpened', handleTabOpened);

        if ($activeTab === 'leaderboard') {
            fetchLeaderboard();
        }

        return () => {
            document.removeEventListener('tabOpened', handleTabOpened);
        };
    });

    function generateFingerprint() {
        if (typeof window === 'undefined') return '';
        const nav = window.navigator;
        const screen = window.screen;
        const data = [
            nav.userAgent,
            nav.language,
            screen.colorDepth,
            `${screen.width}x${screen.height}`,
            new Date().getTimezoneOffset(),
            nav.platform,
            nav.hardwareConcurrency
        ].join('###');

        let hash = 0;
        for (let i = 0; i < data.length; i += 1) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
    }

    function formatTime(seconds) {
        const safeSeconds = Math.max(0, Number(seconds) || 0);
        if (safeSeconds < 3600) {
            const minutes = Math.floor(safeSeconds / 60);
            return `${minutes}m`;
        }
        const hours = safeSeconds / 3600;
        const rounded = Math.round(hours * 10) / 10;
        const formattedHours = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
        return `${formattedHours}h`;
    }

    function formatLeaderboardValue(entry) {
        const readTime = formatTime(entry.totalReadSec || 0);
        const uniques = Number(entry.uniquePdfs || 0).toLocaleString();
        return `${readTime} • ${uniques} unique`;
    }

    async function fetchLeaderboard() {
        const dateKey = range === 'today' ? new Date().toISOString().slice(0, 10) : '';
        const cacheKey = `${range}:${dateKey}`;
        const now = Date.now();
        const cached = leaderboardCache.get(cacheKey);
        if (cached && now - cached.at < 2 * 60 * 1000) {
            entries = cached.data;
            loading = false;
            hasLoaded = true;
            return;
        }

        loading = true;
        try {
            let anonId = '';
            let userId = '';
            let fingerprint = '';
            if (typeof localStorage !== 'undefined') {
                anonId = localStorage.getItem('materio_anon_id') || '';
                try {
                    const user = JSON.parse(localStorage.getItem('materio_user') || 'null');
                    userId = user?.id || '';
                } catch {}
                fingerprint = generateFingerprint();
            }

            const query = new URLSearchParams({
                action: 'leaderboard',
                limit: '50',
                timeframe: range
            });
            if (anonId) query.set('anonId', anonId);
            if (userId) query.set('userId', userId);
            if (fingerprint) query.set('fp', fingerprint);
            if (range === 'today') {
                const today = new Date();
                const y = today.getFullYear();
                const m = String(today.getMonth() + 1).padStart(2, '0');
                const d = String(today.getDate()).padStart(2, '0');
                query.set('date', `${y}-${m}-${d}`);
            }

            const res = await fetch(`/api/v2/features?${query.toString()}`);
            if (res.ok) {
                const data = await res.json();
                entries = Array.isArray(data?.entries) ? data.entries : (Array.isArray(data) ? data : []);
                leaderboardCache.set(cacheKey, { at: Date.now(), data: entries });
            } else {
                entries = [];
            }
        } catch (e) {
            console.error('Failed to load leaderboard:', e);
            entries = [];
        } finally {
            loading = false;
            hasLoaded = true;
        }
    }

    function setRange(r) {
        if (range === r) return;
        range = r;
        fetchLeaderboard();
    }

    // Top 3 in visual podium order: 2nd (Silver), 1st (Gold), 3rd (Bronze)
    $: topThreePodium = entries.length >= 3
        ? [
            { entry: entries[1], stageClass: 'stage-second' },
            { entry: entries[0], stageClass: 'stage-first' },
            { entry: entries[2], stageClass: 'stage-third' }
          ].filter(item => item.entry)
        : entries.slice(0, 3).map((entry, idx) => ({
            entry,
            stageClass: idx === 0 ? 'stage-first' : (idx === 1 ? 'stage-second' : 'stage-third')
          }));

    $: others = entries.slice(3);
</script>

<svelte:head>
    {#if $activeTab === 'leaderboard'}
        <link rel="stylesheet" href="/assets/style/leaderboard.css" />
    {/if}
</svelte:head>

<div class="leaderboard-shell">
    <h1>
        Leaderboard
        <span class="info-icon" aria-hidden="true" style="position: relative; display: inline-flex; vertical-align: middle; margin-left: 6px; font-size: 1rem; cursor: pointer;">
            <HugeIcon name="information-circle" />
            <span class="tooltip" style="font-weight: normal;">
                Create account to know if you made it to top 50.
                <a href={getSignupUrl()}>Create account</a>
            </span>
        </span>
    </h1>
    <p class="leaderboard-subtitle">
        {range === 'today' ? 'Showing only current date data.' : 'Showing summed data for the last 7 days.'}
    </p>

    <div class="leaderboard-controls" role="group" aria-label="Leaderboard range">
        <button type="button" class="leaderboard-filter-btn" class:active={range === 'weekly'} on:click={() => setRange('weekly')}>Weekly</button>
        <button type="button" class="leaderboard-filter-btn" class:active={range === 'today'} on:click={() => setRange('today')}>Today</button>
    </div>

    {#if loading}
        <div class="leaderboard-loading" id="leaderboardLoadingState"><HugeiconsIcon icon={LoaderIcon} size="1em" class="hgi spin" /> Loading leaderboard...</div>
    {:else if entries.length === 0}
        <div class="leaderboard-empty" style="text-align: center; padding: 2.5rem; color: var(--muted-text, #888);">
            <p>{hasLoaded ? 'Leaderboard data is not available yet.' : 'Loading leaderboard...'}</p>
        </div>
    {:else}
        <div id="leaderboardContent" class="leaderboard-content">
            {#if topThreePodium.length > 0}
                <section class="leaderboard-podium-zone" aria-label="Top three readers">
                    <div class="leaderboard-podium">
                        {#each topThreePodium as { entry, stageClass }}
                            <article class="leaderboard-stage {stageClass}">
                                <div class="leaderboard-stage-inner">
                                    <div class="leaderboard-stage-rank">#{entry.rank}</div>
                                    <div class="leaderboard-stage-name" title={entry.displayName}>{entry.displayName}</div>
                                    <div class="leaderboard-stage-value">{formatLeaderboardValue(entry)}</div>
                                </div>
                            </article>
                        {/each}
                    </div>
                </section>
            {/if}

            {#if others.length > 0}
                <section class="leaderboard-table-wrap" aria-label="Leaderboard table">
                    <table class="leaderboard-table" aria-label="Leaderboard rankings">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Name</th>
                                <th style="text-align:right;">Time</th>
                                <th style="text-align:right;">Unique</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each others as entry}
                                <tr>
                                    <td class="leaderboard-table-rank">#{entry.rank}</td>
                                    <td class="leaderboard-table-name" title={entry.displayName}>{entry.displayName}</td>
                                    <td class="leaderboard-table-metric">{formatTime(entry.totalReadSec)}</td>
                                    <td class="leaderboard-table-metric">{Number(entry.uniquePdfs || 0).toLocaleString()}</td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </section>
            {/if}
        </div>
    {/if}
</div>
