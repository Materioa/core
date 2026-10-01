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
  // Set on pointerdown so a click that immediately produces a selection is not
  // mistaken for a dismissal of the card it is about to open.
  var selectionStartedAt = 0;

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

  /**
   * Looks a word up directly against both keyless free providers, racing them.
   *
   * This is the primary path, not a fallback. The same-origin API is tried
   * first because it adds a week-long edge cache, but it is an optimisation:
   * the deployed worker can lag behind a desktop release (a build publishes the
   * app before anyone runs `wrangler deploy`), and when that happens a client
   * that only spoke to the API shows nothing at all. Both providers send
   * `Access-Control-Allow-Origin: *`, so talking to them directly works from
   * the browser, Tauri and the Android WebView with no proxy in between.
   */
  function lookupDirectly(word) {
    var sources = [
      {
        provider: 'dictionaryapi.dev',
        url: 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word),
        parse: parseDictionaryApi
      },
      {
        provider: 'wiktionary',
        url: 'https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(word),
        parse: parseWiktionary
      }
    ];

    return new Promise(function (resolve, reject) {
      var controllers = [];
      var settled = false;
      var sawNetworkFailure = false;

      function settle(payload, error) {
        if (settled) return;
        settled = true;
        if (payload) resolve(payload);
        else reject(error);
      }

      var attempts = sources.map(function (source) {
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        if (controller) controllers.push(controller);

        return fetch(source.url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: controller ? controller.signal : undefined,
          credentials: 'omit'
        })
          .then(function (response) {
            if (!response.ok) throw makeError('provider said ' + response.status, response.status === 404);
            return response.json();
          })
          .then(function (payload) {
            var parsed = source.parse(payload, word);
            if (parsed) {
              // First usable answer wins; release the loser's socket.
              controllers.forEach(function (c) { try { c.abort(); } catch (e) {} });
              settle(parsed);
            }
          })
          .catch(function (error) {
            // A clean 404 is a real answer; anything else is a broken request.
            if (!error || !error.notFound) sawNetworkFailure = true;
          });
      });

      Promise.all(attempts).then(function () {
        if (settled) return;
        settle(null, makeError('no definition', !sawNetworkFailure));
      });
    });
  }

  function makeError(message, notFound) {
    var error = new Error(message);
    error.notFound = !!notFound;
    return error;
  }

  var HTML_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  };

  /**
   * Flattens provider HTML into plain text. Wiktionary returns small
   * MediaWiki fragments, which must never reach the card as markup.
   */
  function htmlToText(html) {
    if (typeof html !== 'string') return '';
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&#(\d+);/g, function (_, code) {
        var num = Number(code);
        return num > 0 ? String.fromCodePoint(num) : '';
      })
      .replace(/&([a-z]+);/gi, function (match, name) {
        var key = String(name).toLowerCase();
        return HTML_ENTITIES[key] !== undefined ? HTML_ENTITIES[key] : match;
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  function clampString(value, max) {
    if (typeof value !== 'string') return '';
    return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
  }

  function uniqueStrings(values, limit) {
    var seen = {};
    var out = [];
    for (var i = 0; i < (values || []).length; i++) {
      var text = htmlToText(values[i]);
      if (!text || seen[text]) continue;
      seen[text] = true;
      out.push(text);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** dictionaryapi.dev payload → the shape renderDefinition() consumes. */
  function parseDictionaryApi(payload, word) {
    if (!Array.isArray(payload) || !payload.length) return null;

    var phonetic = '';
    var phonetics = [];
    var sourceUrl = '';

    for (var e = 0; e < payload.length && phonetics.length < 4; e++) {
      var entry = payload[e];
      if (!entry || typeof entry !== 'object') continue;
      if (!phonetic && typeof entry.phonetic === 'string') phonetic = entry.phonetic;
      if (!sourceUrl && Array.isArray(entry.sourceUrls) && entry.sourceUrls.length) {
        sourceUrl = entry.sourceUrls[0];
      }
      var items = Array.isArray(entry.phonetics) ? entry.phonetics : [];
      for (var p = 0; p < items.length && phonetics.length < 4; p++) {
        var item = items[p];
        if (!item) continue;
        var text = typeof item.text === 'string' ? item.text : '';
        var audio = safeHttpUrl(item.audio);
        if ((!text && !audio) || phonetics.some(function (x) {
          return x.text === text && x.audio === audio;
        })) continue;
        phonetics.push({ text: text, audio: audio });
      }
    }

    // Prefer an IPA that actually has audio so the play button is never dead.
    if (!phonetic) phonetic = (phonetics.find(function (x) { return x.text; }) || {}).text || '';

    var meanings = [];
    for (var m = 0; m < payload.length && meanings.length < 5; m++) {
      var list = Array.isArray(payload[m].meanings) ? payload[m].meanings : [];
      for (var g = 0; g < list.length && meanings.length < 5; g++) {
        var meaning = list[g];
        if (!meaning || !meaning.partOfSpeech) continue;
        var definitions = [];
        var defs = Array.isArray(meaning.definitions) ? meaning.definitions : [];
        for (var d = 0; d < defs.length && definitions.length < 6; d++) {
          var defText = clampString(htmlToText(defs[d].definition), 400);
          if (!defText) continue;
          definitions.push({
            definition: defText,
            example: clampString(htmlToText(defs[d].example), 200),
            synonyms: uniqueStrings(defs[d].synonyms, 8),
            antonyms: uniqueStrings(defs[d].antonyms, 8)
          });
        }
        if (!definitions.length) continue;
        meanings.push({
          partOfSpeech: meaning.partOfSpeech,
          definitions: definitions,
          synonyms: uniqueStrings(meaning.synonyms, 8),
          antonyms: uniqueStrings(meaning.antonyms, 8)
        });
      }
    }

    if (!meanings.length) return null;

    return {
      word: typeof payload[0].word === 'string' ? payload[0].word : word,
      phonetic: phonetic,
      phonetics: phonetics,
      sourceUrl: safeHttpUrl(sourceUrl),
      meanings: meanings,
      provider: 'dictionaryapi.dev'
    };
  }

  /** en.wiktionary.org REST payload → the shape renderDefinition() consumes. */
  function parseWiktionary(payload, word) {
    var entries = payload && Array.isArray(payload.en) ? payload.en : [];
    if (!entries.length) return null;

    var meanings = [];
    for (var i = 0; i < entries.length && meanings.length < 5; i++) {
      var entry = entries[i];
      if (!entry || !entry.partOfSpeech) continue;
      var definitions = [];
      var defs = Array.isArray(entry.definitions) ? entry.definitions : [];
      for (var d = 0; d < defs.length && definitions.length < 6; d++) {
        var text = clampString(htmlToText(defs[d].definition), 400);
        if (!text) continue;
        definitions.push({ definition: text, example: '', synonyms: [], antonyms: [] });
      }
      if (!definitions.length) continue;
      meanings.push({
        partOfSpeech: entry.partOfSpeech,
        definitions: definitions,
        synonyms: [],
        antonyms: []
      });
    }

    if (!meanings.length) return null;

    return {
      word: word,
      phonetic: '',
      phonetics: [],
      sourceUrl: 'https://en.wiktionary.org/wiki/' + encodeURIComponent(word),
      meanings: meanings,
      provider: 'wiktionary'
    };
  }

  /** Only ever hand the DOM an http(s) URL it could actually follow. */
  function safeHttpUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      var url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
    } catch (e) {
      return '';
    }
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
        if (!response.ok) throw makeError('dictionary request failed: ' + response.status, response.status === 404);
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
      // The API is a cache optimisation, not a dependency. If it is missing
      // (deployed worker predating this build) or unreachable, go straight to
      // the providers so the tooltip still works.
      .catch(function (error) {
        return lookupDirectly(word).then(function (payload) {
          if (cache.size >= MAX_CACHE_ENTRIES) {
            var oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          cache.set(key, payload);
          return payload;
        });
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
      // A click that starts a fresh selection must not be treated as a
      // dismissal that outlives the selection it caused: PDF.js fires
      // selectionchange right after this, which re-opens the card.
      selectionStartedAt = Date.now();
      hideCard();
    });

    // On scroll the anchor rect moves, so RE-ANCHOR rather than dismiss. Hiding
    // here made the card vanish the moment the viewer scrolled by a few pixels
    // (PDF.js scrolls the container for many reasons mid-gesture), which read
    // as "the tooltip never appeared".
    document.addEventListener('scroll', function () {
      if (!card || card.hidden) return;
      var rect = anchorRect();
      if (!rect) {
        // The selection itself is gone (page turn, text layer swapped out).
        hideCard();
        return;
      }
      positionCard(rect);
    }, true);

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
    },
    /**
     * Explains, from the app's own console, why a selection did or did not open
     * a card. Each step the trigger path can bail on is reported explicitly, so
     * "the tooltip is not showing" resolves to one specific check instead of a
     * guess.
     */
    diagnose: function () {
      var selection = window.getSelection?.();
      var range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      var container = range ? range.commonAncestorContainer : null;
      var layer = null;
      try {
        layer = container
          ? (container.nodeType === Node.ELEMENT_NODE
            ? container.closest('.textLayer')
            : container.parentElement && container.parentElement.closest('.textLayer'))
          : null;
      } catch (e) { /* reported below */ }

      return {
        pluginLoaded: true,
        hasSelection: !!(selection && selection.rangeCount && !selection.isCollapsed),
        selectionText: selection ? String(selection.toString()) : '',
        inTextLayer: !!layer,
        wouldLookUp: !!selectedWord(),
        extractedWord: selectedWord() || null,
        hasAnchorRect: !!anchorRect(),
        cardExists: !!card,
        cardVisible: !!(card && !card.hidden),
        activeWord: activeWord || null,
        apiUrl: dictionaryUrl('probe')
      };
    }
  };
})();