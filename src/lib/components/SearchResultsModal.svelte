<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { searchModalStore, pdfModalStore, openPdfModal } from '$lib/stores.js';
  import HugeIcon from './HugeIcon.svelte';

  // Thinking verbs, cycled while AI search runs. Lowercase, plain.

  let container = null;
  let slot = null;
  let originalParent = null;
  let nextSibling = null;

  const THINK_VERBS = [
    'thinking', 'pondering', 'searching', 'sifting', 'matching',
    'reranking', 'honing', 'weighing', 'narrowing', 'gathering',
    'checking', 'refining'
  ];
  let thinkIndex = 0;
  let thinkTimer = null;

  $: {
    if ($searchModalStore.isAiLoading) {
      if (!thinkTimer) {
        thinkTimer = setInterval(() => {
          thinkIndex = (thinkIndex + 1) % THINK_VERBS.length;
        }, 1200);
      }
    } else if (thinkTimer) {
      clearInterval(thinkTimer);
      thinkTimer = null;
      thinkIndex = 0;
    }
  }

  onDestroy(() => {
    if (thinkTimer) clearInterval(thinkTimer);
  });

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

  /* AI thinking line: plain lowercase text with a light sweep.
     No cards, pills, icons, caps or italics. */
  .ai-thinking {
    padding: 2px 2px 12px;
    font-size: 12px;
  }
  .ai-thinking-text {
    background: linear-gradient(
      90deg,
      currentColor 0%,
      currentColor 38%,
      rgba(160, 160, 160, 0.35) 50%,
      currentColor 62%,
      currentColor 100%
    );
    background-size: 220% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: ai-think-sweep 2.2s linear infinite;
  }
  @keyframes ai-think-sweep {
    0% { background-position: 200% 0; }
    100% { background-position: -20% 0; }
  }

  /* Narrow viewports: keep the transplanted search box clear of the
     absolute close button at the top-right. */
  @media (max-width: 600px) {
    #modalSearchSlot {
      padding-right: 54px;
      box-sizing: border-box;
    }
  }
</style>

<div class="promo-modal-overlay search-results-overlay" id="searchResultsModal" style="display: {$searchModalStore.isOpen ? 'flex' : 'none'};" class:show={$searchModalStore.isOpen} on:click|self={closeModal} role="dialog" aria-modal="true" aria-hidden={!$searchModalStore.isOpen}>
  <div class="promo-modal no-image search-results-modal" style="display: {$searchModalStore.isOpen ? 'flex' : 'none'};">
    <button type="button" class="promo-close-btn" on:click={closeModal} aria-label="Close Search"><HugeIcon name="cancel-01" /></button>
    <div class="promo-content">
      <div id="modalSearchSlot"></div>

      {#if $searchModalStore.isAiLoading}
        <div class="ai-thinking"><span class="ai-thinking-text">{THINK_VERBS[thinkIndex]}…</span></div>
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
                  <div class="search-result-ai-explanation" style="margin-top: 6px; font-size: 11px; color: var(--text-secondary, #777); line-height: 1.4;">
                    <span>{result.aiExplanation}</span>
                  </div>
                {/if}
              </div>
              <div style="flex-shrink: 0; display: flex; align-items: center; gap: 8px;">
                <button type="button" on:click={(e)=> openPdf(e, item)} class="search-open-btn" style="padding: 8px 16px; background: var(--color-primary, #ff8400); color: white; border: none; border-radius: 12px; corner-shape: squircle; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s ease; font-family: 'OpenRunde', 'Open Runde', sans-serif;">
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
