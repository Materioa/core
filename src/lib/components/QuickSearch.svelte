<script>
  import Fuse from 'fuse.js';
    import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { searchModalStore } from '$lib/stores.js';
  import HugeIcon from './HugeIcon.svelte';

  let searchQuery = '';
  let fuse;
  let aiEnabled = false;
  let pulseActive = false;

  onMount(async () => {
    try {
      const res = await fetch('/assets/data/archive.json');
      if (res.ok) {
        const data = await res.json();
        const items = [];
        if (Array.isArray(data)) {
          data.forEach(sem => {
          sem.subjects?.forEach(sub => {
            sub.categories?.forEach(cat => {
              cat.topics?.forEach(topic => {
                const topicName = typeof topic === 'string' ? topic : (topic.name || topic.title);
                items.push({
                  semester: sem.semester,
                  subject: sub.name,
                  category: cat.name,
                  topic: topicName,
                  label: `Sem ${sem.semester} > ${sub.name} > ${cat.name} > ${topicName}`
                });
              });
            });
          });
        });
      }
      fuse = new Fuse(items, {
          keys: ['subject', 'category', 'topic', 'label'],
          threshold: 0.3
        });
      }
    } catch (e) {
      console.error('Failed to load search data:', e);
    }
  });

  function triggerPulse() {
    pulseActive = false;
    setTimeout(() => pulseActive = true, 10);
    setTimeout(() => pulseActive = false, 900);
  }

  function toggleAiMode() {
    aiEnabled = !aiEnabled;
    triggerPulse();
    const input = document.getElementById('quickSearchInput');
    const wrapper = document.querySelector('.quick-search-wrapper');
    if (aiEnabled) {
      input?.classList.add('ai-mode');
      wrapper?.classList.add('ai-mode');
    } else {
      input?.classList.remove('ai-mode');
      wrapper?.classList.remove('ai-mode');
    }
    if (searchQuery.trim()) handleSearch();
  }

  function openSearchModal() {
    searchModalStore.update(s => ({ ...s, isOpen: true, query: searchQuery }));
  }

  let searchAbortController = null;

  async function handleSearch() {
    if (!searchQuery.trim()) {
      searchModalStore.set({
        isOpen: false,
        query: '',
        results: [],
        ai: null,
        aiUsed: false,
        isAiLoading: false,
        isDiscovery: false
      });
      return;
    }
    openSearchModal();
    searchModalStore.update(s => ({ ...s, isAiLoading: aiEnabled }));

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();

    try {
      const selectedSemester = document.getElementById('semesterSelect')?.value || '';
      const params = new URLSearchParams({
        q: searchQuery,
        useAI: aiEnabled ? 'true' : 'false',
        aiMode: aiEnabled ? 'pure' : 'hybrid'
      });
      if (selectedSemester) params.set('semester', selectedSemester);

      const res = await fetch(`/api/v2/search?${params.toString()}`, {
        signal: searchAbortController.signal
      });

      if (res.ok) {
        const data = await res.json();
        const apiResults = data.results || data.items || [];
        const mapped = apiResults.map(item => ({
          item: {
            semester: item.semester,
            subject: item.subject,
            category: item.category,
            topic: item.topic || item.item || item.title,
            label: item.label || `${item.subject} > ${item.category} > ${item.topic}`
          },
          score: item.score || 0,
          aiExplanation: item.aiExplanation,
          aiRanked: item.aiRanked,
          aiRelevance: item.aiRelevance,
          matchType: item.matchType
        }));

        searchModalStore.set({
          isOpen: true,
          query: searchQuery,
          results: mapped,
          ai: data.ai || null,
          aiUsed: !!data.aiUsed,
          isAiLoading: false,
          isDiscovery: !!data.isDiscovery
        });
        return;
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('API search failed, fallback', e);
    }

    if (!fuse) {
      searchModalStore.update(s => ({ ...s, isOpen: true, query: searchQuery, results: [], isAiLoading: false }));
      return;
    }
    const results = fuse.search(searchQuery).slice(0, 15).map(r => ({ item: r.item, score: r.score }));
    searchModalStore.set({
      isOpen: true,
      query: searchQuery,
      results,
      ai: null,
      aiUsed: false,
      isAiLoading: false,
      isDiscovery: false
    });
  }

  function handleInput(e) {
    searchQuery = e.target.value;
    handleSearch();
  }

  function handleFocus() {
    // Clicking the box opens the search modal immediately, even empty.
    if (!get(searchModalStore).isOpen) openSearchModal();
    if (searchQuery.trim()) handleSearch();
  }

  function clearSearch() {
    searchQuery = '';
    searchModalStore.set({ isOpen: false, query: '', results: [] });
    const input = document.getElementById('quickSearchInput');
    if (input) { input.value = ''; input.focus(); }
  }
</script>

<div id="quickSearchContainer">
  <div class="quick-search-wrapper" class:ai-mode={aiEnabled}>
    <div class="quick-search-border-glow"></div>
    <div class="pulse-wave" class:active-pulse={pulseActive}></div>
    <HugeIcon name="search-01" class="quick-search-icon-left" />
    <input
      type="text"
      id="quickSearchInput"
      placeholder={aiEnabled ? "AI-powered search" : "Finder"}
      autocomplete="off"
      spellcheck="false"
      autocapitalize="off"
      bind:value={searchQuery}
      on:input={handleInput}
      on:focus={handleFocus}
      class:ai-mode={aiEnabled}
    />
    {#if searchQuery}
      <button
        id="clearSearchBtn"
        class="clear-search-btn"
        title="Clear Search"
        aria-label="Clear Search"
        on:click={clearSearch}
        style="display: flex;"
      >
        <HugeIcon name="cancel-01" />
      </button>
    {/if}
    <button type="button" id="aiSearchToggle" class="ai-search-toggle" class:active={aiEnabled} title="Toggle AI Search" aria-label="Toggle AI Mode" on:click={toggleAiMode}>
       AI Mode
    </button>
  </div>
</div>
