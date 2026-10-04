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

  // ---- icons -----------------------------------------------------------------
  // Inlined rather than sprite-referenced: the card is attached to document.body
  // and the settings toggle lives in the PDF.js toolbar, so a shared <svg><defs>
  // would have to survive both contexts. currentColor lets each icon inherit the
  // toolbar/card foreground, and every path is stroke-only, so these pick up
  // dark mode for free.
  var ICON_DICTIONARY =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" ' +
    'color="currentColor" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 14L11.2996 6.45808C11.4213 6.17981 11.6963 6 12 6C12.3037 6 12.5787 6.17981 12.7004 6.45808L16 14M9.5 11H14.5"></path>' +
    '<path d="M20 22H6C4.89543 22 4 21.1046 4 20M4 20C4 18.8954 4.89543 18 6 18H20V6C20 4.11438 20 3.17157 19.4142 2.58579C18.8284 2 17.8856 2 16 2H10C7.17157 2 5.75736 2 4.87868 2.87868C4 3.75736 4 5.17157 4 8V20Z"></path>' +
    '<path d="M19.5 18C19.5 18 18.5 18.7628 18.5 20C18.5 21.2372 19.5 22 19.5 22"></path>' +
    '</svg>';

  var ICON_SPEAKER =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" ' +
    'color="currentColor" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 14.8135V9.18646C14 6.04126 14 4.46866 13.0747 4.0773C12.1494 3.68593 11.0603 4.79793 8.88232 7.02192C7.75439 8.17365 7.11085 8.42869 5.50604 8.42869C4.10257 8.42869 3.40084 8.42869 2.89675 8.77262C1.85035 9.48655 2.00852 10.882 2.00852 12C2.00852 13.118 1.85035 14.5134 2.89675 15.2274C3.40084 15.5713 4.10257 15.5713 5.50604 15.5713C7.11085 15.5713 7.75439 15.8264 8.88232 16.9781C11.0603 19.2021 12.1494 20.3141 13.0747 19.9227C14 19.5313 14 17.9587 14 14.8135Z"></path>' +
    '<path d="M17 9C17.6254 9.81968 18 10.8634 18 12C18 13.1366 17.6254 14.1803 17 15"></path>' +
    '<path d="M20 7C21.2508 8.36613 22 10.1057 22 12C22 13.8943 21.2508 15.6339 20 17"></path>' +
    '</svg>';
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

  /**
   * True ONLY inside the desktop (Tauri) app, false everywhere else - the web
   * build and the Android shell.
   *
   * The dictionary is desktop-only by design: the Google provider's credential
   * lives in the app server's environment and every lookup spends it, so any
   * other surface asking for definitions burns a quota it was never provisioned
   * for. This check used to accept every native shell (`window.Capacitor`,
   * capacitor.localhost, …), which is exactly why the card also opened inside
   * the Android app.
   *
   * Mirrors the probe in sidecar.js, which stamps data-materio-shell on
   * <html> and gates the rest of the feature (toolbar entry included).
   */
  function isDesktopShell() {
    try {
      return Boolean(
        window.__TAURI_INTERNALS__ ||
        window.__TAURI__ ||
        window.__TAURI_METADATA__ ||
        window.location.protocol === 'tauri:' ||
        window.location.hostname === 'tauri.localhost'
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * Settings come from dictionary-settings.js when it is present (it owns the
   * panel), and fall back to the same defaults inline so the tooltip still
   * works if that script is ever absent.
   */
  function config() {
    try {
      if (window.materioDictConfig && typeof window.materioDictConfig.get === 'function') {
        return window.materioDictConfig.get();
      }
    } catch (e) { /* fall through to defaults */ }
    return {
      enabled: true,
      trigger: 'select',
      provider: 'auto',
      maxDefinitions: 3,
      showExamples: true,
      showSynonyms: true,
      audio: true,
      storeHistory: false
    };
  }

  function noteHistory(word, data) {
    try {
      var cfg = window.materioDictConfig;
      if (cfg && cfg.history && cfg.history.add && data && (data.meanings || []).length) {
        cfg.history.add(word, data.meanings[0].definitions[0].definition);
      }
    } catch (e) { /* history is optional */ }
  }

  // word -> normalised payload. Repeat lookups inside one reading session are
  // instant and cost no request; the server cache only helps on the next visit.
  var cache = new Map();
  var inflight = new Map();

  // Words whose lookup FAILED. Without this, re-selecting a word that hit a
  // transient provider error did nothing at all - the card sat in its error
  // state and the "same word, just re-anchor" branch returned before any retry,
  // so the tooltip only appeared "sometimes". Failures are remembered briefly
  // (so a re-selection retries instead of re-failing identically) but not
  // cached for long, and never cached as success.
  var failedWords = new Map();
  var FAILURE_RETRY_MS = 4000;

  // Our own /api/v2/dictionary is a cache optimisation, not a dependency. In
  // production that route is frequently not deployed at all, and paying a
  // wasted round trip to a 404 on EVERY lookup added latency to each one. Once
  // it is seen missing, stop probing for a while.
  var apiMissingUntil = 0;
  var API_RETRY_MS = 10 * 60 * 1000;

  function apiIsAvailable() {
    return Date.now() >= apiMissingUntil;
  }

  function noteApiMissing() {
    apiMissingUntil = Date.now() + API_RETRY_MS;
  }

  /**
   * The word as a dictionary lists it: lowercase, unpunctuated.
   *
   * Both providers are lowercase-only, so the lookup key is normalised anyway;
   * displaying that same natural form keeps the card consistent with the
   * headword the definitions belong to, instead of echoing whatever capital
   * letter the sentence happened to start with.
   */
  function headword(word) {
    return String(word || '')
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/[^\p{L}\p{N}]+$/u, '');
  }

  function dictionaryUrl(word) {
    // Language/corpus hints for the Google provider. The endpoint decides
    // definition vs. translation from `language`, and picks the dictionary
    // variant from `corpus`, so both are only sent when they differ from the
    // defaults — keeping the common case byte-identical to what it always was.
    //
    // `corpus` is NOT optional in practice even though it reads like one:
    // omitting it returns the 20-byte miss envelope, so the server defaults it.
    var extra = '';
    try {
      var cfg = config();
      var target = cfg.translateTo && cfg.translateTo !== 'off' ? cfg.translateTo : '';
      if (target) extra += '&glang=' + encodeURIComponent(target);
      else if (cfg.corpus) extra += '&gcorpus=' + encodeURIComponent(cfg.corpus);
    } catch (e) { /* no hints; the server defaults apply */ }

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
      if (isNative) return 'https://getmaterio.app/api/v2/dictionary?word=' + encodeURIComponent(word) + extra;
    } catch (e) { /* fall through to the relative URL */ }
    return '/api/v2/dictionary?word=' + encodeURIComponent(word) + extra;
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
    //
    // commonAncestorContainer is a TEXT NODE whenever the selection sits inside
    // a single span - which is the normal case for selecting one word, since
    // PDF.js emits each text run as its own span. `.closest()` lives on
    // Element.prototype, so a text node has no such method; an earlier guard
    // that required one rejected exactly the single-word case and made the
    // tooltip impossible to trigger. Resolve to the owning ELEMENT first.
    var container = range.commonAncestorContainer;
    if (!container) return '';
    var element = container.nodeType === Node.ELEMENT_NODE
      ? container
      : container.parentElement;
    if (!element || typeof element.closest !== 'function') return '';
    if (!element.closest('.textLayer')) return '';

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
    head.appendChild(el('span', 'materio-dict-word', displayWord(word)));
    var spinner = el('span', 'materio-dict-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    head.appendChild(spinner);
    bodyEl.appendChild(head);
    bodyEl.appendChild(el('div', 'materio-dict-status', 'Looking up…'));
  }

  function renderNotFound(word) {
    bodyEl.textContent = '';
    var head = el('div', 'materio-dict-head');
    head.appendChild(el('span', 'materio-dict-word', displayWord(word)));
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
    head.appendChild(el('span', 'materio-dict-word', displayWord(word)));
    bodyEl.appendChild(head);
    bodyEl.appendChild(el(
      'div',
      'materio-dict-status',
      'Could not reach the dictionary. Check your connection and try again.'
    ));
  }

  function renderDefinition(word, data) {
    bodyEl.textContent = '';
    var cfg = config();

    var head = el('div', 'materio-dict-head');
    head.appendChild(el('span', 'materio-dict-word', displayWord(word)));

    if (data.phonetic) {
      head.appendChild(el('span', 'materio-dict-phonetic', data.phonetic));
    }

    // Only offer playback when a recording exists, and prefer a phonetic that
    // has audio — a dead button is worse than no button.
    var audioUrl = cfg.audio ? (data.phonetics || []).find(function (item) {
      return item && item.audio;
    }) : null;
    if (audioUrl && typeof Audio === 'function') {
      var play = el('button', 'materio-dict-play');
      play.type = 'button';
      play.innerHTML = ICON_SPEAKER;
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

    var cfg = config();
    var maxDefs = Math.max(1, Number(cfg.maxDefinitions) || 3);

    (data.meanings || []).forEach(function (meaning) {
      var group = el('section', 'materio-dict-group');
      group.appendChild(el('div', 'materio-dict-pos', displayWord(meaning.partOfSpeech)));

      (meaning.definitions || []).slice(0, maxDefs).forEach(function (def, index) {
        var block = el('div', 'materio-dict-def');
        if (index > 0) block.classList.add('materio-dict-def-alt');
        block.appendChild(el('div', 'materio-dict-def-text', def.definition));
        if (cfg.showExamples && def.example) {
          block.appendChild(el('div', 'materio-dict-example', '“' + def.example + '”'));
        }

        var synonyms = (def.synonyms || []).concat(meaning.synonyms || [])
          .filter(function (value, i, arr) { return arr.indexOf(value) === i; })
          .slice(0, 6);
        if (cfg.showSynonyms && synonyms.length) {
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

    noteHistory(word, data);
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
    // Both provider endpoints are LOWERCASE-ONLY and case-sensitive. Passing the
    // raw selection capitalised - which is most words in a document - made
    // Wiktionary answer 404 for "Confidentiality" while "confidentiality"
    // returned a full entry, so capitalised lookups silently found nothing.
    // The card still shows the word as the reader selected it; only the lookup
    // key is normalised.
    var key = String(word).toLowerCase();

    var sources = [
      {
        provider: 'dictionaryapi.dev',
        url: 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key),
        parse: parseDictionaryApi
      },
      {
        provider: 'wiktionary',
        url: 'https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(key),
        parse: parseWiktionary
      }
    ];

    return new Promise(function (resolve, reject) {
      var controllers = [];
      var settled = false;
      // A clean 404 is a DEFINITIVE answer ("no such headword"). A 5xx, timeout
      // or network error is not - it only means we did not get to ask. Only
      // when nothing definitive came back should this read as a connection
      // problem, otherwise one flaky provider turns every genuine miss into a
      // scary "check your connection".
      var sawDefinitiveMiss = false;
      var sawHardFailure = false;

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
            if (error && error.notFound) sawDefinitiveMiss = true;
            else sawHardFailure = true;
          });
      });

      Promise.all(attempts).then(function () {
        if (settled) return;
        // Prefer the definitive answer: if any provider said authoritatively
        // that it has no such headword, that is the truthful message.
        settle(null, makeError('no definition', sawDefinitiveMiss || !sawHardFailure));
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

  /**
   * Display form of a word: first letter capitalised, the rest lowercase.
   *
   * Documents set headings in caps, so selecting from a section header gives
   * "SECURITY" or "INTEGRITY". The card should read like prose ("Security"),
   * while the LOOKUP key stays lowercase for the providers (see
   * lookupDirectly) - this is presentation only and never changes what we ask
   * for.
   */
  function displayWord(word) {
    var text = String(word || '').toLowerCase();
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
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

    var cfg = config();
    // A configured custom source replaces the built-ins entirely. It is sent to
    // OUR server rather than fetched here, because the browser always attaches
    // an Origin header and this class of endpoint rejects any request carrying
    // one. Credentials stay out of the browser's hands beyond the request.
    if (cfg.provider === 'custom' && cfg.custom && cfg.custom.baseUrl) {
      return lookupCustom(word, cfg.custom);
    }

    // On the web build, go straight to the keyless providers.
    //
    // Our /api/v2/dictionary would consult the Google provider, and that spends
    // the borrowed, referrer-restricted key on every lookup. Letting anonymous
    // site visitors drive that quota is not worth it for a desktop feature, so
    // the web races dictionaryapi.dev + Wiktionary directly — both send
    // Access-Control-Allow-Origin: *, so this works with no proxy. The card
    // renders identically because the server already normalises the shape.
    //
    // Only applies to the DEFAULT provider path: an explicitly configured Custom
    // source is the reader's own credential and their own choice, so it is left
    // alone above.
    if (!isDesktopShell() && cfg.provider !== 'wiktionary') {
      return lookupDirectly(word).then(function (payload) {
        if (cache.size >= MAX_CACHE_ENTRIES) {
          var oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, payload);
        return payload;
      });
    }

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
   * Looks a word up through our server against a user-configured endpoint.
   *
   * The credential fields are user-supplied and blank by default; this ships no
   * key and no host. The server performs the upstream fetch (no Origin header
   * from a Worker) and normalises the response, so the card renders the same
   * way whichever source answered.
   */
  function lookupCustom(word, custom) {
    if (!custom.key) {
      return Promise.reject(makeError('no custom key configured', true));
    }

    // Credentials travel in a POST body, not in headers: headers get captured
    // by far more log/CDN tooling than bodies.
    return fetch('/api/v2/dictionary', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        word: word,
        custom: {
          baseUrl: custom.baseUrl,
          key: custom.key,
          headerName: custom.headerName,
          headerValue: custom.headerValue,
          language: custom.language,
          corpus: custom.corpus,
          country: custom.country,
          strategy: custom.strategy,
          termParam: custom.termParam,
          languageParam: custom.languageParam,
          corpusParam: custom.corpusParam,
          countryParam: custom.countryParam,
          strategyParam: custom.strategyParam,
          keyParam: custom.keyParam
        }
      })
    }).then(function (response) {
      if (!response.ok) throw makeError('custom lookup failed: ' + response.status, response.status === 404);
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.ok !== true) throw makeError('no definition', true);
      return payload;
    });
  }

  /**
   * Runs the lookup for a word whose card is already open and anchored.
   *
   * `token` guards the whole sequence: a newer selection bumps the token, so a
   * slow response for a word the user has already moved on from is discarded
   * instead of overwriting the card with stale content.
   */
  function resolveWord(word, token) {
    // Return the HANDLED chain, not the raw lookup. Returning the raw promise
    // left a rejected lookup unhandled for every caller - the card still
    // rendered the error state, but each miss logged an unhandled rejection,
    // and window.materioDictionary.lookup() rejected for its caller too.
    return fetchDefinition(word)
      .then(function (payload) {
        if (token !== lookupToken || activeWord !== word || !card || card.hidden) return payload;
        renderDefinition(word, payload);
        var rect = anchorRect();
        if (rect) positionCard(rect);
        return payload;
      })
      .catch(function (error) {
        if (token !== lookupToken || activeWord !== word || !card || card.hidden) throw error;
        // Distinguish "this word has no entry" from "we could not ask", so a
        // typo is not reported as a connection problem.
        if (error && error.notFound) renderNotFound(word);
        else renderError(word);
        throw error;
      });
  }

  function scheduleUpdate(event) {
    var cfg = config();
    if (!cfg.enabled) return;

    // Trigger gating. Selection-mode only fires for a selection that was just
    // made (selectionchange / mouseup / keyup); double-click mode only for an
    // actual dblclick, so a drag-select never opens a card there.
    var isDblClick = !!(event && event.type === 'dblclick');
    if (cfg.trigger === 'dblclick' && !isDblClick) return;
    if (cfg.trigger !== 'dblclick' && event && event.type === 'keydown') return;

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
    //
    // This branch must NOT clear the pending lookup. selectionchange, mouseup
    // and keyup all fire for one word selection, and an unconditional
    // clearTimeout() at the top of this function wiped the armed lookup on the
    // second event before the re-anchor early-return - so the card opened and
    // then sat on "Looking up…" forever. The debounce is the only reason to
    // clear anything, and there is nothing to debounce once armed.
    if (card && !card.hidden && activeWord === word) {
      positionCard(rect);
      return;
    }

    activeWord = word;
    show(word, rect);

    // Arm the lookup once per word, not once per event.
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      resolveWord(word, lookupToken);
    }, 90);
  }

  function bindDictionary() {
    // Desktop-only: on the web build and in the Android shell not one listener
    // is attached, so the card can never open. lookup()/diagnose() below stay
    // exposed but simply have nothing to do.
    if (!isDesktopShell()) return;

    // selectionchange is the only event that reliably fires for drag-select,
    // double-click-select and keyboard select across browsers. mouseup and
    // keyup cover the cases where the selection is set without a change event
    // (e.g. re-selecting the identical word).
    document.addEventListener('selectionchange', scheduleUpdate);
    document.addEventListener('mouseup', scheduleUpdate);
    document.addEventListener('touchend', scheduleUpdate, { passive: true });
    document.addEventListener('keyup', scheduleUpdate);
    document.addEventListener('dblclick', scheduleUpdate);

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