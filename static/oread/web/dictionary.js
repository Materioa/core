// Word lookup on text selection for the oread (PDF.js) viewer.
//
// Selecting a single word in the document shows a floating definition card
// anchored to that word, with an arrow pointing back at it. Multi-word
// selections are left alone so they can keep going to the "Ask AI" menu that
// thinklet.js already owns.
//
// Definitions come from this app's own /api/v2/dictionary, never from a
// provider directly — that endpoint picks between two keyless free providers,
// caches for a week at the edge, and gives both of them CORS headers. Keeping
// the client on one same-origin URL is what lets the same code work in the
// browser, in Tauri and in the Android shell without a branch per platform
// beyond resolving the base (see dictionaryUrl).

(function () {
  'use strict';

  var CARD_ID = 'materioDictionaryCard';
  // Must EXCEED the server's own provider budget (12s per provider, racing —
  // so a definitive 200 or 404 within ~12s). A client timeout shorter than that
  // would abort live lookups the server was about to answer, turning a working
  // request into a false "could not reach the dictionary". This is a backstop
  // for an unreachable host only.
  var LOOKUP_TIMEOUT_MS = 16000;
  var ANCHOR_GAP = 10;   // card edge -> word edge
  var VIEWPORT_MARGIN = 8;
  var MAX_CACHE_ENTRIES = 200;

  // One card, reused for every lookup. Recreating it per selection would drop
  // the open animation and leave stale timers holding dead nodes.
  var card = null;
  var arrow = null;
  var bodyEl = null;
  var timer = 0;
  var lookupToken = 0;
  var activeWord = '';

  // word -> normalised payload. Repeat lookups inside one reading session are
  // instant and cost no request; the server cache only helps on the next visit.
  var cache = new Map();
  var inflight = new Map();

  function dictionaryUrl(word) {
    // In native shells there is no same-origin backend (tauri://,
    // capacitor://), so a relative path 404s against the static asset server.
    // Resolve the absolute production API exactly like thinklet.js does for
    // its profile check rather than hard-coding the host twice.
    try {
      var h = window.location.hostname || '';
      var p = window.location.protocol || '';
      var isNative = h === 'tauri.localhost' || h === 'capacitor.localhost' ||
        p === 'tauri:' || p === 'capacitor:' ||
        (h === 'localhost' && window.location.port !== '5173');
      if (isNative) return 'https://getmaterio.app/api/v2/dictionary?word=' + encodeURIComponent(word);
    } catch (e) { /* fall through to the relative URL */ }
    return '/api/v2/dictionary?word=' + encodeURIComponent(word);
  }

  /**
   * Pulls the looked-up word out of the current selection, or '' when there is
   * nothing to look up.
   *
   * Only single words qualify. PDF.js splits a line into many spans, so a
   * one-word selection can span several of them — the range text is the
   * authority, not the span count. Wrapping punctuation ("well," -> "well") is
   * stripped, but a bare quote or bracket that is genuinely part of the word
   * (don't, co-operate) is kept.
   */
  function selectedWord() {
    var selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';

    var range = selection.getRangeAt(0);

    // Only the document text layer. Without this a selection inside the find
    // bar, a sidebar input or our own card would trigger a lookup.
    var container = range.commonAncestorContainer;
    if (!container || typeof container.closest !== 'function') return '';
    var layer = container.nodeType === Node.ELEMENT_NODE
      ? container.closest('.textLayer')
      : container.parentElement?.closest('.textLayer');
    if (!layer) return '';

    var text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 64) return '';

    // Multi-word selection -> the Ask AI menu owns this, not us.
    if (/\s/.test(text)) return '';

    var word = text
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/[^\p{L}\p{N}]+$/u, '');

    // A bare number, symbol or formula is not a dictionary lookup.
    if (word.length < 2 || word.length > 40) return '';
    if (!/\p{L}/u.test(word)) return '';

    return word;
  }

  /**
   * The word's own on-screen box. Selection rects are viewport-relative,
   * matching the fixed-position card, so no scroll maths is needed here.
   */
  function anchorRect() {
    var selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return null;

    var rects = selection.getRangeAt(0).getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      if (rect.width > 0 && rect.height > 0) return rect;
    }
    return null;
  }

  function ensureCard() {
    if (card && card.isConnected) return;

    card = document.createElement('div');
    card.id = CARD_ID;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Word definition');
    card.hidden = true;

    arrow = document.createElement('div');
    arrow.className = 'materio-dict-arrow';
    arrow.setAttribute('aria-hidden', 'true');

    bodyEl = document.createElement('div');
    bodyEl.className = 'materio-dict-body';

    card.appendChild(arrow);
    card.appendChild(bodyEl);
    document.body.appendChild(card);
  }

  function hideCard() {
    window.clearTimeout(timer);
    timer = 0;
    // Bump the token so an in-flight lookup that resolves after dismissal
    // cannot re-open the card.
    lookupToken++;
    if (card) {
      card.hidden = true;
      card.classList.remove('materio-dict-visible');
      card.removeAttribute('data-placement');
    }
    activeWord = '';
  }

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Places the card against the word and aims the arrow at it.
   *
   * Above the word is the default: that is where the eye already is after a
   * selection, and it leaves the space below the word free for the Ask AI menu
   * that thinklet.js shows for the same selection. Below is the fallback when
   * the word sits near the top edge.
   */
  function positionCard(rect) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var cardRect = card.getBoundingClientRect();

    var placement = 'top';
    var top = rect.top - cardRect.height - ANCHOR_GAP;

    if (top < VIEWPORT_MARGIN) {
      var below = rect.bottom + ANCHOR_GAP;
      if (below + cardRect.height <= vh - VIEWPORT_MARGIN) {
        placement = 'bottom';
        top = below;
      } else {
        // Neither side fits: pin to whichever edge the word is furthest from
        // and let the card scroll internally rather than overflow the window.
        placement = rect.top > vh / 2 ? 'top' : 'bottom';
        top = placement === 'top'
          ? VIEWPORT_MARGIN
          : Math.max(VIEWPORT_MARGIN, vh - cardRect.height - VIEWPORT_MARGIN);
      }
    }

    var wordCenter = rect.left + rect.width / 2;
    var left = clamp(
      wordCenter - cardRect.width / 2,
      VIEWPORT_MARGIN,
      vw - cardRect.width - VIEWPORT_MARGIN
    );

    card.style.top = Math.round(top) + 'px';
    card.style.left = Math.round(left) + 'px';
    card.dataset.placement = placement;

    // The arrow tracks the word's centre, but is kept inside the rounded
    // corners so it never detaches from the card outline on a narrow window.
    var arrowLeft = clamp(wordCenter - left, 18, Math.max(18, cardRect.width - 18));
    card.style.setProperty('--materio-dict-arrow-left', Math.round(arrowLeft) + 'px');
  }

  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent) node.textContent = textContent;
    return node;
  }

  function renderLoading(word) {
    bodyEl.textContent = '';
    var head = el('div', 'materio-dict-head');
    head.appendChild(el('span', 'materio-dict-word', word));
    var spinner = el('span', 'materio-dict-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    head.appendChild(spinner);
    bodyEl.appendChild(head);
    bodyEl.appendChild(el('div', 'materio-dict-status', 'Looking up…'));
  }

  function renderNotFound(word) {
    bodyEl.textContent = '';
    var head = el('div', 'materio-dict-head');
    head.appendChild(el('span', 'materio-dict-word', word));
    bodyEl.appendChild(head);
    bodyEl.appendChild(el(
      'div',
      'materio-dict-status',
      'No definition found. Check the spelling, or try a different word.'
    ));
  }

  function renderError(word) {
    bodyEl.textContent = '';
    var head = el('div', 'materio-dict-head');
    head.appendChild(el('span', 'materio-dict-word', word));
    bodyEl.appendChild(head);
    bodyEl.appendChild(el(
      'div',
      'materio-dict-status',
      'Could not reach the dictionary. Check your connection and try again.'
    ));
  }

  function renderDefinition(word, data) {
    bodyEl.textContent = '';

    var head = el('div', 'materio-dict-head');
    head.appendChild(el('span', 'materio-dict-word', word));

    if (data.phonetic) {
      head.appendChild(el('span', 'materio-dict-phonetic', data.phonetic));
    }

    // Only offer playback when a recording exists, and prefer a phonetic that
    // has audio — a dead button is worse than no button.
    var audioUrl = (data.phonetics || []).find(function (item) {
      return item && item.audio;
    });
    if (audioUrl && typeof Audio === 'function') {
      var play = el('button', 'materio-dict-play', '▶');
      play.type = 'button';
      play.title = 'Pronounce';
      play.setAttribute('aria-label', 'Pronounce ' + word);
      var audio = null;
      play.addEventListener('click', function () {
        try {
          if (!audio) audio = new Audio(audioUrl.audio);
          audio.currentTime = 0;
          void audio.play();
        } catch (e) { /* playback is a nicety, never fail the tooltip */ }
      });
      head.appendChild(play);
    }

    if (data.sourceUrl) {
      var link = el('a', 'materio-dict-source', 'source');
      link.href = data.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = 'Open in ' + (data.provider || 'the dictionary');
      head.appendChild(link);
    }

    bodyEl.appendChild(head);

    (data.meanings || []).forEach(function (meaning) {
      var group = el('section', 'materio-dict-group');
      group.appendChild(el('div', 'materio-dict-pos', meaning.partOfSpeech));

      (meaning.definitions || []).forEach(function (def, index) {
        var block = el('div', 'materio-dict-def');
        if (index > 0) block.classList.add('materio-dict-def-alt');
        block.appendChild(el('div', 'materio-dict-def-text', def.definition));
        if (def.example) {
          block.appendChild(el('div', 'materio-dict-example', '“' + def.example + '”'));
        }

        var synonyms = (def.synonyms || []).concat(meaning.synonyms || [])
          .filter(function (value, i, arr) { return arr.indexOf(value) === i; })
          .slice(0, 6);
        if (synonyms.length) {
          var chips = el('div', 'materio-dict-chips');
          synonyms.forEach(function (value) {
            chips.appendChild(el('span', 'materio-dict-chip', value));
          });
          block.appendChild(chips);
        }

        group.appendChild(block);
      });

      bodyEl.appendChild(group);
    });
  }

  function show(word, rect) {
    ensureCard();

    var cached = cache.get(word.toLowerCase());
    if (cached) renderDefinition(word, cached);
    else renderLoading(word);

    card.hidden = false;
    // Measure before the transition so the first paint is already placed —
    // animating from an unpositioned card shows it snapping across the page.
    card.classList.add('materio-dict-visible');
    positionCard(rect);
  }

  function fetchDefinition(word) {
    var key = word.toLowerCase();
    if (cache.has(key)) return Promise.resolve(cache.get(key));

    // Collapse concurrent lookups of the same word onto one request.
    if (inflight.has(key)) return inflight.get(key);

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timerId = window.setTimeout(function () {
      if (controller) controller.abort();
    }, LOOKUP_TIMEOUT_MS);

    var promise = fetch(dictionaryUrl(word), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
      credentials: 'omit'
    })
      .then(function (response) {
        // 404 is a real answer ("no such headword"), distinct from the request
        // itself failing. Tag it so the card can say the useful thing instead
        // of blaming the network for a spelling mistake.
        if (!response.ok) {
          var failure = new Error('dictionary request failed: ' + response.status);
          failure.notFound = response.status === 404;
          throw failure;
        }
        return response.json();
      })
      .then(function (payload) {
        if (!payload || payload.ok !== true) throw new Error('no definition');
        if (cache.size >= MAX_CACHE_ENTRIES) {
          var oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, payload);
        return payload;
      })
      .finally(function () {
        window.clearTimeout(timerId);
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  }

  /**
   * Runs the lookup for a word whose card is already open and anchored.
   *
   * `token` guards the whole sequence: a newer selection bumps the token, so a
   * slow response for a word the user has already moved on from is discarded
   * instead of overwriting the card with stale content.
   */
  function resolveWord(word, token) {
    var pendingLookup = fetchDefinition(word);
    pendingLookup
      .then(function (payload) {
        if (token !== lookupToken || activeWord !== word || !card || card.hidden) return;
        renderDefinition(word, payload);
        var rect = anchorRect();
        if (rect) positionCard(rect);
      })
      .catch(function (error) {
        if (token !== lookupToken || activeWord !== word || !card || card.hidden) return;
        // Distinguish "this word has no entry" from "we could not ask", so a
        // typo is not reported as a connection problem.
        if (error && error.notFound) renderNotFound(word);
        else renderError(word);
      });
    return pendingLookup;
  }

  function scheduleUpdate() {
    window.clearTimeout(timer);

    var selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    // A selection made inside our own card (to copy a definition) must not
    // replace the card with a lookup of the copied text.
    if (card && selection.anchorNode && card.contains(selection.anchorNode)) return;

    var word = selectedWord();
    if (!word) return;

    var rect = anchorRect();
    if (!rect) return;

    // Same word, card already open: only re-anchor, never refetch.
    if (card && !card.hidden && activeWord === word) {
      positionCard(rect);
      return;
    }

    activeWord = word;
    show(word, rect);

    timer = window.setTimeout(function () {
      resolveWord(word, lookupToken);
    }, 90);
  }

  function bindDictionary() {
    // selectionchange is the only event that reliably fires for drag-select,
    // double-click-select and keyboard select across browsers. mouseup and
    // keyup cover the cases where the selection is set without a change event
    // (e.g. re-selecting the identical word).
    document.addEventListener('selectionchange', scheduleUpdate);
    document.addEventListener('mouseup', scheduleUpdate);
    document.addEventListener('touchend', scheduleUpdate, { passive: true });
    document.addEventListener('keyup', scheduleUpdate);

    document.addEventListener('pointerdown', function (event) {
      if (card && !card.hidden && event.target.closest && event.target.closest('#' + CARD_ID)) return;
      hideCard();
    });

    // A scrolled rect is stale: the anchor would point at the old spot.
    document.addEventListener('scroll', hideCard, true);

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!card || card.hidden) return;
      hideCard();
      window.getSelection()?.removeAllRanges();
    });

    // Releasing a page or closing the modal must not leave the card in a
    // half-rendered state over the next document.
    window.addEventListener('pagehide', hideCard);
    window.addEventListener('resize', hideCard);
    document.addEventListener('webviewerloaded', hideCard);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDictionary);
  } else {
    bindDictionary();
  }

  // Exposed for the viewer shell (and for debugging from the console).
  window.materioDictionary = {
    hide: hideCard,
    // Lets a future "define this selection" toolbar button reuse the same
    // card without re-implementing fetch, cache or placement.
    lookup: function (word, rect) {
      var cleaned = String(word || '').trim();
      if (!cleaned) return null;
      ensureCard();
      activeWord = cleaned;
      show(cleaned, rect || anchorRect() || { top: 40, bottom: 40, left: 40, width: 0, height: 0 });
      return resolveWord(cleaned, lookupToken);
    }
  };
})();