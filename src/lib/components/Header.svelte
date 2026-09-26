<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { searchTerm, activeModalStore, actualThemeStore } from '$lib/stores.js';
  import HugeIcon from '$lib/components/HugeIcon.svelte';
  
  $: isLightTheme = $actualThemeStore === 'light' || $actualThemeStore === 'coffee';
  let showBugTooltip = true;
  let statusClass = 'ok';
  let statusText = 'Operational';
  let statusTitle = 'All systems operational';

  onMount(() => {
    checkHealth();
  });

  async function checkHealth() {
    try {
      const response = await fetch(`/api/v2/health?t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      const incident = data.incident;
      const status = data.status;

      if (incident) {
        const impact = incident.impact || 'partial_outage';
        if (impact === 'major_outage') {
          statusClass = 'error';
          statusText = 'Outage';
        } else if (impact === 'partial_outage') {
          statusClass = 'partial-outage';
          statusText = 'Partial Outage';
        } else if (impact === 'degraded_performance' || impact === 'maintenance') {
          statusClass = 'degraded';
          statusText = 'Degraded';
        } else {
          statusClass = 'partial-outage';
          statusText = 'Issues';
        }
        statusTitle = incident.name || 'Active incident';
      } else if (status === 'offline') {
        statusClass = 'degraded';
        statusText = 'Offline';
        statusTitle = data.message || 'Please check your internet connection';
      } else if (status === 'degraded') {
        statusClass = 'degraded';
        statusText = 'Degraded';
        statusTitle = data.message || 'Systems are experiencing issues';
      } else {
        statusClass = 'ok';
        statusText = 'Operational';
        statusTitle = 'All systems operational';
      }
    } catch (error) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        statusClass = 'degraded';
        statusText = 'Offline';
        statusTitle = 'You are currently offline';
      } else {
        statusClass = 'ok';
        statusText = 'Operational';
        statusTitle = 'All systems operational';
      }
    }
  }
</script>

{#if ['/', '/home', '/notifications', '/leaderboard', '/notebooks', '/downloads', '/settings'].includes($page.url.pathname)}
<header class="actual-content" style="background-image: none !important;">
  <a href="/" class="header-logo" role="button" aria-label="Go to homepage">
    <img
      src={isLightTheme ? '/assets/img/materio_new_bk.svg' : '/assets/img/materio_new_wh.svg'}
      alt="Materio"
      class="header-logo-svg"
      style="width: 120px; height: 32px; object-fit: contain; display: block;"
    />
  </a>
  <div class="header-actions">
      <button class="bug-report-btn" id="bugReportBtn" aria-label="Report a Bug" title="Report a Bug"
          on:click={() => { try { activeModalStore.set('bug-report'); } catch (e) { console.error('Open bug report failed:', e); } }}>
          <HugeIcon name="alert-02" />
      </button>
      {#if showBugTooltip}
      <div id="bugReportTooltip" class="bug-report-tooltip" style="display: block;">
          <span>Found a bug? Report it here.</span>
          <button type="button" style="background: none; border: none; padding: 0; cursor: pointer;" on:click={() => showBugTooltip = false} aria-label="Close tooltip">
            <HugeIcon name="cancel-01" class="close-tooltip" />
          </button>
      </div>
      {/if}
      <a href="https://status.getmaterio.app" target="_blank" class="health-status-container"
          aria-label={`System Status: ${statusText}`} title={statusTitle}>
          <div class={`health-status-indicator ${statusClass}`} id="healthIndicator" title={statusTitle}></div>
          <span class="health-status-text" id="healthStatusText">{statusText}</span>
      </a>
  </div>
</header>
{:else}
<header class="site-header">
  <a href="/" class="header-logo" role="button" aria-label="Go to homepage">
    <img
      src={isLightTheme ? '/assets/img/materio_new_bk.svg' : '/assets/img/materio_new_wh.svg'}
      alt="Materio"
      class="header-logo-svg"
      style="width: 120px; height: 32px; object-fit: contain; display: block;"
    />
  </a>
  
  {#if $page.url.pathname.includes('/post/')}
  <button class="toc-toggle" aria-label="Toggle table of contents" title="Toggle table of contents">
    <HugeIcon name="menu-01" />
  </button>
  {/if}

  <!-- Exit icon for post pages -->
  {#if $page.url.pathname.includes('/post/')}
  <button type="button"
    style="position: absolute; right: 20px; top: 50%; transform: translateY(-50%); color: var(--text); background: none; border: none; font-size: 1.2rem; cursor: pointer;"
    on:click|preventDefault={() => { if (document.referrer) history.back(); else window.location.href='/room'; }}
    on:mousedown={(e) => e.currentTarget.style.color='#ff8200'} 
    on:mouseup={(e) => e.currentTarget.style.color='var(--text)'}
    on:mouseleave={(e) => e.currentTarget.style.color='var(--text)'} aria-label="Back">
    <HugeIcon name="logout-03" />
  </button>
  {/if}
</header>
{/if}
