<script>
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { searchModalStore, pdfModalStore, openPdfModal } from '$lib/stores.js';
  import HugeIcon from './HugeIcon.svelte';

  let container = null;
  let slot = null;
  let originalParent = null;
  let nextSibling = null;

  function rememberHome() {
    // (Re)capture the search box home — QuickSearch may mount after this
    // modal (or re-mount on tab switches), so never rely on a single capture.
    const c = document.getElementById('quickSearchContainer');
    if (c) {
      container = c;
      if (c.parentElement && c.parentElement.id !== 'modalSearchSlot') {
        originalParent = c.parentElement;
        nextSibling = c.nextSibling;
      }
    }
  }

  onMount(() => {
    // Find original parent at mount (QuickSearch is already rendered)
    rememberHome();
    const unsub = searchModalStore.subscribe(async state => {
      // Wait for modal DOM to be rendered
      await tick();
      rememberHome();
      slot = document.getElementById('modalSearchSlot');
      if (state.isOpen) {
        try {
          document.body.classList.add('modal-open');
        } catch {}
        if (container && slot && container.parentElement !== slot) {
          try {
            slot.appendChild(container);
            setTimeout(() => document.getElementById('quickSearchInput')?.focus(), 50);
          } catch (e) {
            console.error('Search modal transplant failed:', e);
          }
        }
      } else {
        try {
          if (!get(pdfModalStore).isOpen) document.body.classList.remove('modal-open');
        } catch {}
        if (container && container.parentElement !== originalParent) {
          try {
            if (originalParent && nextSibling && nextSibling.parentElement === originalParent) {
              originalParent.insertBefore(container, nextSibling);
            } else if (originalParent) {
              originalParent.appendChild(container);
            } else {
              // Home unknown (QuickSearch not mounted anywhere): park the box
              // back on the home tab so it isn't stranded inside the modal.
              const home = document.getElementById('home');
              if (home && container.parentElement !== home) home.prepend(container);
            }
          } catch (e) {
            console.error('Search restore failed:', e);
          }
        }
      }
    });
    const esc = (e) => { if (e.key === 'Escape' && get(searchModalStore).isOpen) closeModal(); };
    window.addEventListener('keydown', esc);
    return () => { unsub(); window.removeEventListener('keydown', esc); };
  });

  function closeModal() {
    searchModalStore.update(s => ({ ...s, isOpen: false }));
  }

  function selectResult(item) {
    searchModalStore.update(s => ({ ...s, isOpen: false }));
    if (typeof window !== 'undefined' && typeof window.selectSearchResult === 'function') {
      window.selectSearchResult(String(item.semester), item.subject, item.category, item.topic);
    } else {
      openPdfDirect(item);
    }
  }

  function triggerSuggestion(sug) {
    const input = document.getElementById('quickSearchInput');
    if (input) {
      input.value = sug;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }
  }

  function openPdf(event, item) {
    event.stopPropagation();
    searchModalStore.update(s => ({ ...s, isOpen: false }));
    openPdfDirect(item);
  }

  function openPdfDirect(item) {
    const pdfUrl = String(item.semester) === "9999"
      ? `https://cdn.getmaterio.app/pdfs/${item.semester}/${encodeURIComponent(item.subject)}/vault/${encodeURIComponent(item.topic)}.pdf`
      : `https://cdn.getmaterio.app/pdfs/${item.semester}/${encodeURIComponent(item.subject)}/${encodeURIComponent(item.topic)}.pdf`;

    openPdfModal(pdfUrl, {
      title: item.topic,
      semester: `Semester ${item.semester}`,
      subject: item.subject,
      category: item.category,
      topic: item.topic,
      readingMode: 'default'
    });
  }
</script>

<style>
  :global(#modalSearchSlot #quickSearchContainer) {
    width: 100%;
    margin-bottom: 12px;
  }
  :global(#modalSearchSlot .quick-search-wrapper) {
    width: 100%;
  }
  @keyframes spinSlow {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>

<div class="promo-modal-overlay search-results-overlay" id="searchResultsModal" style="display: {$searchModalStore.isOpen ? 'flex' : 'none'};" class:show={$searchModalStore.isOpen} on:click|self={closeModal} role="dialog" aria-modal="true" aria-hidden={!$searchModalStore.isOpen}>
  <div class="promo-modal no-image search-results-modal" style="display: {$searchModalStore.isOpen ? 'flex' : 'none'};">
    <button type="button" class="promo-close-btn" on:click={closeModal} aria-label="Close Search"><HugeIcon name="cancel-01" /></button>
    <div class="promo-content">
      <div id="modalSearchSlot"></div>

      {#if $searchModalStore.aiUsed}
        <div class="ai-search-indicator" style="padding: 10px 16px; background: linear-gradient(135deg, rgba(255, 130, 0, 0.12), rgba(255, 45, 149, 0.12)); border: 1px solid rgba(255, 45, 149, 0.2); border-radius: 14px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <HugeIcon name="sparkles" style="color: #ff2d95; font-size: 15px;" />
            <span style="font-size: 12px; font-weight: 700; color: #ff2d95; text-transform: uppercase; letter-spacing: 0.5px;">AI-Powered Search</span>
          </div>
          {#if $searchModalStore.ai?.intent}
            <div style="margin-top: 4px; font-size: 11px; color: var(--text-secondary, #666); font-style: italic;">
              {$searchModalStore.ai.intent}
            </div>
          {/if}
        </div>
      {/if}

      {#if $searchModalStore.isAiLoading}
        <div class="ai-loading-indicator" style="display: flex; align-items: center; gap: 8px; padding: 8px 14px; margin-bottom: 10px; border-radius: 10px; background: rgba(255, 45, 149, 0.08); color: #ff2d95; font-size: 12px;">
          <HugeIcon name="sparkles" style="animation: spinSlow 2s linear infinite; font-size: 14px;" />
          <span>Analyzing and reranking materials with AI...</span>
        </div>
      {/if}

      <h2><span class="promo-title" id="searchResultsModalTitle">{$searchModalStore.query ? `Search results for "${$searchModalStore.query}"` : 'Results'}</span></h2>
      <div class="search-results-list" id="searchResultsModalList" style="width: 100%;">
        {#if $searchModalStore.results.length > 0}
          {#each $searchModalStore.results as result}
            {@const item = result.item || result}
            {@const score = result.score || 0}
            {@const scoreColor = score >= 75 ? "#28a745" : score >= 60 ? "#ff8200" : "#6c757d"}
            <div class="search-result-item" style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px;" data-semester={item.semester} data-subject={item.subject} data-category={item.category} data-topic={item.topic}>
              <div style="flex: 1; min-width: 0; cursor: pointer;" on:click={() => selectResult(item)} on:keydown={(e)=> e.key==='Enter' && selectResult(item)} role="button" tabindex="0">
                <div class="search-result-semester">{item.semester} • {item.subject}</div>
                <div class="search-result-title">{item.topic} <span style="color: {scoreColor}; font-size: 11px; font-weight: 700; font-family: var(--font-primary), sans-serif; margin-left: 6px;">{score}%</span></div>
                <div class="search-result-category">{item.category}</div>
                {#if result.aiExplanation}
                  <div class="search-result-ai-explanation" style="margin-top: 6px; font-size: 11px; color: #ff2d95; font-style: italic; line-height: 1.4; display: flex; align-items: center; gap: 4px;">
                    <HugeIcon name="sparkles" style="color: #ff2d95; font-size: 12px; flex-shrink: 0;" />
                    <span>{result.aiExplanation}</span>
                  </div>
                {/if}
              </div>
              <div style="flex-shrink: 0; display: flex; align-items: center; gap: 8px;">
                <button type="button" on:click={(e)=> openPdf(e, item)} class="search-open-btn" style="padding: 8px 16px; background: var(--color-primary, #ff8400); color: white; border: none; border-radius: 12px; corner-shape: squircle; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s ease; font-family: 'Manrope', sans-serif;">
                  <i class="far fa-external-link" style="margin-right: 4px;"></i>Open
                </button>
              </div>
            </div>
          {/each}
        {:else if $searchModalStore.query.trim()}
          <div class="search-no-results" style="text-align:center; padding:24px;">
            <HugeIcon name="search-01" style="font-size:24px;color:#ccc;margin-bottom:8px;" />
            <p style="margin: 8px 0 0 0; font-size: 14px; color:#666;">No results found for "{$searchModalStore.query}"</p>

            {#if $searchModalStore.ai?.suggestions?.length > 0}
              <div class="ai-suggestions-box" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255, 130, 0, 0.15); text-align: left;">
                <p style="font-size: 12px; font-weight: 600; color: #ff2d95; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                  <HugeIcon name="sparkles" style="font-size: 13px;" /> AI Suggestions:
                </p>
                {#each $searchModalStore.ai.suggestions as suggestion}
                  <button type="button" on:click={() => triggerSuggestion(suggestion)}
                    style="display: block; width: 100%; text-align: left; padding: 8px 12px; margin: 6px 0; background: rgba(255, 130, 0, 0.06); border: 1px solid rgba(255, 130, 0, 0.12); border-radius: 8px; font-size: 12px; color: var(--text-secondary, #555); cursor: pointer; transition: all 0.2s;"
                    on:mouseenter={(e) => { e.currentTarget.style.background = 'rgba(255, 130, 0, 0.12)'; e.currentTarget.style.borderColor = 'rgba(255, 130, 0, 0.3)'; }}
                    on:mouseleave={(e) => { e.currentTarget.style.background = 'rgba(255, 130, 0, 0.06)'; e.currentTarget.style.borderColor = 'rgba(255, 130, 0, 0.12)'; }}>
                    <HugeIcon name="search-01" style="font-size: 11px; margin-right: 6px; opacity: 0.6;" />
                    {suggestion}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <p style="padding: 16px; color: #888; font-size: 14px;">Type to search subjects, categories, and topics...</p>
        {/if}
      </div>
    </div>
  </div>
</div>
