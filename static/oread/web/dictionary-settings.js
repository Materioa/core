// Dictionary settings + word history, and the in-viewer settings panel.
//
// This is the "bring your own credentials" slot for a custom dictionary
// provider. The request shape is fixed (base URL + query params + one extra
// header) and the credential fields are deliberately EMPTY: this file ships no
// keys and no default host. Until you fill them in, the Custom option is inert
// and says so rather than failing silently.
//
// Storage layout (localStorage, desktop shell only):
//   materio_dictionary_settings -> the object below
//   materio_dictionary_history  -> { "<word>": "<first meaning>", ... }
//
// The panel and dictionary.js are separate scripts in the same window, so
// changes are broadcast with a CustomEvent instead of a build-time coupling.

(function () {
  'use strict';

  var SETTINGS_KEY = 'materio_dictionary_settings';
  var HISTORY_KEY = 'materio_dictionary_history';
  var HISTORY_LIMIT = 300;
  var CHANGE_EVENT = 'materio:dictionary-settings';

  // The documented request shape for the private endpoint, with credentials
  // blank. `params` are appended verbatim; `headerName`/`headerValue` is the
  // single optional extra header the provider needs.
  var CUSTOM_DEFAULTS = {
    baseUrl: '',
    termParam: 'term',
    languageParam: 'language',
    language: 'en',
    corpusParam: 'corpus',
    corpus: 'en-US',
    countryParam: 'country',
    country: 'US',
    strategyParam: 'strategy',
    strategy: '2',
    keyParam: 'key',
    key: '',
    headerName: '',
    headerValue: ''
  };

  var DEFAULTS = {
    enabled: true,
    // 'select' | 'dblclick'
    trigger: 'select',
    // 'auto' races the built-in providers; 'wiktionary' pins one;
    // 'custom' uses the slot above.
    provider: 'auto',
    // Translation mode for the Google provider. 'off' looks the word up in the
    // corpus's own language; any language code asks for a translation instead
    // (the endpoint answers with translateResponse). Empty corpus value means
    // "derive it from the language" — en -> en-US, en-uk -> en.
    translateTo: 'off',
    corpus: '',
    maxDefinitions: 3,
    showExamples: true,
    showSynonyms: true,
    audio: true,
    storeHistory: false,
    custom: CUSTOM_DEFAULTS
  };

  /**
   * True ONLY inside the desktop (Tauri) app.
   *
   * Desktop-only by decision: the whole feature (card, settings gear, the
   * Google provider and its translation controls) exists solely in the desktop
   * build, so the web build and the Android shell get neither the button nor
   * the panel. Accepting `capacitor:`/`capacitor.localhost` here previously is
   * what let the Android app reach this UI at all.
   *
   * Matches isDesktopShell() in dictionary.js and the probe in sidecar.js.
   */
  function isDesktopShell() {
    try {
      var h = window.location.hostname || '';
      var p = window.location.protocol || '';
      return h === 'tauri.localhost' ||
        p === 'tauri:' ||
        Boolean(window.__TAURI__) || Boolean(window.__TAURI_INTERNALS__);
    } catch (e) {
      return false;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Merges stored settings over the defaults, one level into `custom`.
   * A missing/garbled blob must never leave the tooltip in a broken state, so
   * anything unreadable is discarded rather than trusted.
   */
  function get() {
    var stored = {};
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
      }
    } catch (e) { /* unreadable -> defaults */ }

    var merged = clone(DEFAULTS);
    for (var key in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue;
      if (key === 'custom') continue;
      if (typeof DEFAULTS[key] === 'boolean') {
        if (typeof stored[key] === 'boolean') merged[key] = stored[key];
      } else if (typeof stored[key] === typeof DEFAULTS[key]) {
        merged[key] = stored[key];
      }
    }

    if (stored.custom && typeof stored.custom === 'object') {
      for (var ck in CUSTOM_DEFAULTS) {
        if (!Object.prototype.hasOwnProperty.call(CUSTOM_DEFAULTS, ck)) continue;
        var v = stored.custom[ck];
        if (typeof v === 'string') merged.custom[ck] = v;
      }
    }

    merged.maxDefinitions = Math.min(6, Math.max(1, Number(merged.maxDefinitions) || DEFAULTS.maxDefinitions));
    return merged;
  }

  function set(patch) {
    var next = get();
    for (var key in patch || {}) {
      if (key === 'custom' && patch.custom && typeof patch.custom === 'object') {
        next.custom = Object.assign({}, next.custom, patch.custom);
      } else if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
        next[key] = patch[key];
      }
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (e) { /* private mode: keep in-memory behaviour only */ }
    broadcast();
    return next;
  }

  function reset() {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch (e) {}
    broadcast();
    return get();
  }

  function broadcast() {
    try {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: get() }));
    } catch (e) { /* older WebView: listeners fall back to polling on next use */ }
  }

  function subscribe(fn) {
    window.addEventListener(CHANGE_EVENT, function (event) {
      try { fn(event.detail || get()); } catch (e) {}
    });
  }

  // ---- word history -------------------------------------------------------
  // Mirrors the Google Dictionary extension's model: a word -> meaning map,
  // newest first, capped so it cannot grow without bound.
  function readHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeHistory(map) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function addToHistory(word, meaning) {
    if (!get().storeHistory) return;
    var key = String(word || '').toLowerCase();
    if (!key) return;
    var map = readHistory();
    // Re-insert so a repeat lookup moves the word to the front.
    delete map[key];
    map[key] = String(meaning || '').slice(0, 300);

    var keys = Object.keys(map);
    if (keys.length > HISTORY_LIMIT) {
      var drop = keys.slice(0, keys.length - HISTORY_LIMIT);
      for (var i = 0; i < drop.length; i++) delete map[drop[i]];
    }
    writeHistory(map);
    refreshHistoryView();
  }

  function listHistory() {
    var map = readHistory();
    return Object.keys(map).map(function (key) {
      return { word: key, meaning: map[key] };
    }).reverse();
  }

  function clearHistory() {
    writeHistory({});
    refreshHistoryView();
  }

  /** TSV, matching the extension's export column layout. */
  function historyTsv() {
    return ['word\tmeaning']
      .concat(listHistory().map(function (row) {
        return row.word + '\t' + String(row.meaning).replace(/[\t\r\n]+/g, ' ');
      }))
      .join('\n');
  }

  // ---- panel UI -----------------------------------------------------------
  var panel = null;
  var historyListEl = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function card(title, subtitle) {
    var section = el('section', 'dict-card');
    var head = el('div', 'dict-card-head');
    head.appendChild(el('h3', 'dict-card-title', title));
    if (subtitle) head.appendChild(el('p', 'dict-card-sub', subtitle));
    section.appendChild(head);
    var body = el('div', 'dict-card-body');
    section.appendChild(body);
    return { section: section, body: body };
  }

  function row(labelText, control, hint) {
    var wrap = el('div', 'dict-row');
    var text = el('div', 'dict-row-text');
    text.appendChild(el('span', 'dict-row-label', labelText));
    if (hint) text.appendChild(el('span', 'dict-row-hint', hint));
    wrap.appendChild(text);
    wrap.appendChild(control);
    return wrap;
  }

  function toggle(settings, key, label, hint) {
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'dict-switch';
    input.checked = !!settings[key];
    input.addEventListener('change', function () {
      set({ [key]: input.checked });
    });
    return row(label, input, hint);
  }

  function select(settings, key, label, options, hint) {
    var sel = document.createElement('select');
    sel.className = 'dict-select';
    options.forEach(function (opt) {
      // `{ group: 'Name' }` starts an <optgroup>, so the long language list is
      // navigable instead of one flat 79-item scroll.
      if (opt.group) {
        var og = document.createElement('optgroup');
        og.label = opt.group;
        sel.appendChild(og);
        return;
      }
      var option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (settings[key] === opt.value) option.selected = true;
      sel.appendChild(option);
    });
    sel.addEventListener('change', function () {
      var patch = {};
      patch[key] = sel.value;
      set(patch);
      if (key === 'provider') refreshPanel();
    });
    return row(label, sel, hint);
  }

  /**
   * A free-text field for a TOP-LEVEL setting.
   *
   * textInput() always writes into `custom[...]`, which is right for the BYO
   * slot but wrong for the corpus field, which is a first-class setting shared
   * with the Google provider. Without this the corpus value was unreachable.
   */
  function topInput(settings, key, label, placeholder, hint) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dict-input';
    input.value = settings[key] || '';
    input.placeholder = placeholder || '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('change', function () {
      var patch = {};
      patch[key] = input.value.trim();
      set(patch);
    });
    return row(label, input, hint);
  }

  function textInput(settings, path, label, placeholder, hint) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dict-input';
    input.value = settings.custom[path] || '';
    input.placeholder = placeholder || '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('change', function () {
      var patch = { custom: {} };
      patch.custom[path] = input.value.trim();
      set(patch);
    });
    return row(label, input, hint);
  }

  function buildPanel() {
    var settings = get();

    panel = el('aside', 'dict-panel');
    panel.id = 'dictSettingsPanel';
    panel.setAttribute('aria-label', 'Dictionary settings');
    panel.hidden = true;

    var header = el('div', 'dict-panel-head');
    header.appendChild(el('span', 'dict-panel-title', 'Dictionary'));
    var close = el('button', 'dict-panel-close', '✕');
    close.type = 'button';
    close.title = 'Close';
    close.addEventListener('click', function () { togglePanel(false); });
    header.appendChild(close);
    panel.appendChild(header);

    var scroll = el('div', 'dict-panel-scroll');

    // Card 1 - trigger
    var c1 = card('Pop-up definitions', 'When a definition card appears while reading.');
    c1.body.appendChild(toggle(settings, 'enabled', 'Enable dictionary lookup'));
    c1.body.appendChild(select(settings, 'trigger', 'Show on', [
      { value: 'select', label: 'Selecting a word' },
      { value: 'dblclick', label: 'Double-clicking a word' }
    ], 'Multi-word selections always go to Ask AI.'));
    scroll.appendChild(c1.section);

    // Card 2 - source
    var c2 = card('Source', 'Where definitions come from.');
    // "Google" is listed first and is the default. It is the richest source
    // (Oxford entries: IPA, native-speaker audio, thesaurus, etymology) and the
    // fastest, and its credential lives in the app server's environment — so the
    // reader never sees or supplies a key for it. Wiktionary and Custom stay
    // available; Custom is the BYO slot for a different provider or a personal
    // key.
    // Google is a desktop-only provider (see isDesktopShell in dictionary.js:
    // its credential is a borrowed, referrer-restricted key, and routing web
    // visitors through it would spend that quota for a feature they cannot own).
    // Offering it on the web would be a control that silently does nothing, so
    // the option is omitted there rather than shown-and-ignored. The panel only
    // opens on the desktop shell anyway; this keeps the list honest if it ever
    // is opened elsewhere.
    var desktopShell = isDesktopShell();
    var providerOptions = desktopShell
      ? [
        { value: 'auto', label: 'Google Dictionary' },
        { value: 'wiktionary', label: 'Wiktionary' },
        { value: 'custom', label: 'Custom endpoint' }
      ]
      : [
        { value: 'wiktionary', label: 'Wiktionary' },
        { value: 'custom', label: 'Custom endpoint' }
      ];
    c2.body.appendChild(select(settings, 'provider', 'Provider', providerOptions));

    // Translation controls. These apply to the Google provider, so they live
    // OUTSIDE the Custom box — previously language/corpus existed only in the
    // Custom slot, which is hidden unless provider === 'custom', and dictionary.js
    // never sent them anyway. So there was no way to reach translation at all.
    var translateBox = el('div', 'dict-translate');
    // Translation is served by the Google endpoint, so the control is desktop
    // only for the same reason the Google provider option is.
    if (!desktopShell) translateBox.hidden = true;
    // Every code here was verified against the live endpoint, not copied from a
    // language list. Probing ~86 codes with `language=X&corpus=X` showed 79 that
    // genuinely translate. The list is what actually answers, which is why it
    // includes Gujarati, Tamil, Telugu, Marathi, Kannada, Malayalam, Punjabi,
    // Urdu and Bengali — all absent from the Chrome extension's own 35-code map.
    //
    // Two caveats baked into the list:
    //   - `nl`, `af` and `rm` are dropped. They appear in the extension's map but
    //     return nothing from this endpoint, so offering them would be a control
    //     that silently does nothing.
    //   - `fr`, `id` and `it` translate fine for words outside their dictionaries,
    //     but for an English headword like "water" the corpus HIT and returned a
    //     definition instead. Kept, since that is correct behaviour for a word
    //     that genuinely is not in the target language.
    var TRANSLATE_OPTIONS = [
      { group: 'Off' },
      { value: 'off', label: 'Off — define in the corpus language' },
      { group: 'Indian' },
      { value: 'hi', label: 'Hindi' },
      { value: 'bn', label: 'Bengali' },
      { value: 'gu', label: 'Gujarati' },
      { value: 'mr', label: 'Marathi' },
      { value: 'ta', label: 'Tamil' },
      { value: 'te', label: 'Telugu' },
      { value: 'kn', label: 'Kannada' },
      { value: 'ml', label: 'Malayalam' },
      { value: 'pa', label: 'Punjabi' },
      { value: 'ur', label: 'Urdu' },
      { value: 'or', label: 'Odia' },
      { value: 'as', label: 'Assamese' },
      { value: 'ne', label: 'Nepali' },
      { value: 'si', label: 'Sinhala' },
      { value: 'sat', label: 'Santali' },
      { value: 'kok', label: 'Konkani' },
      { value: 'mai', label: 'Maithili' },
      { group: 'European' },
      { value: 'de', label: 'German' },
      { value: 'fr', label: 'French' },
      { value: 'es', label: 'Spanish' },
      { value: 'pt', label: 'Portuguese' },
      { value: 'it', label: 'Italian' },
      { value: 'ru', label: 'Russian' },
      { value: 'uk', label: 'Ukrainian' },
      { value: 'pl', label: 'Polish' },
      { value: 'sv', label: 'Swedish' },
      { value: 'da', label: 'Danish' },
      { value: 'no', label: 'Norwegian' },
      { value: 'fi', label: 'Finnish' },
      { value: 'is', label: 'Icelandic' },
      { value: 'cs', label: 'Czech' },
      { value: 'sk', label: 'Slovak' },
      { value: 'hu', label: 'Hungarian' },
      { value: 'ro', label: 'Romanian' },
      { value: 'el', label: 'Greek' },
      { value: 'bg', label: 'Bulgarian' },
      { value: 'sr', label: 'Serbian' },
      { value: 'hr', label: 'Croatian' },
      { value: 'sl', label: 'Slovenian' },
      { value: 'lt', label: 'Lithuanian' },
      { value: 'lv', label: 'Latvian' },
      { value: 'et', label: 'Estonian' },
      { value: 'ca', label: 'Catalan' },
      { value: 'eu', label: 'Basque' },
      { value: 'gl', label: 'Galician' },
      { value: 'ga', label: 'Irish' },
      { value: 'cy', label: 'Welsh' },
      { value: 'sq', label: 'Albanian' },
      { value: 'mk', label: 'Macedonian' },
      { value: 'be', label: 'Belarusian' },
      { value: 'mt', label: 'Maltese' },
      { value: 'fo', label: 'Faroese' },
      { group: 'Asian & Pacific' },
      { value: 'zh', label: 'Chinese' },
      { value: 'ja', label: 'Japanese' },
      { value: 'ko', label: 'Korean' },
      { value: 'th', label: 'Thai' },
      { value: 'vi', label: 'Vietnamese' },
      { value: 'id', label: 'Indonesian' },
      { value: 'ms', label: 'Malay' },
      { value: 'tl', label: 'Tagalog' },
      { value: 'km', label: 'Khmer' },
      { value: 'lo', label: 'Lao' },
      { value: 'my', label: 'Burmese' },
      { value: 'tr', label: 'Turkish' },
      { value: 'he', label: 'Hebrew' },
      { value: 'ar', label: 'Arabic' },
      { value: 'fa', label: 'Persian' },
      { value: 'ka', label: 'Georgian' },
      { value: 'hy', label: 'Armenian' },
      { value: 'az', label: 'Azerbaijani' },
      { value: 'kk', label: 'Kazakh' },
      { value: 'uz', label: 'Uzbek' },
      { value: 'mn', label: 'Mongolian' },
      { value: 'ky', label: 'Kyrgyz' },
      { value: 'tt', label: 'Tatar' },
      { group: 'Other' },
      { value: 'sw', label: 'Swahili' },
      { value: 'su', label: 'Sundanese' },
      { value: 'jw', label: 'Javanese' },
      { value: 'yi', label: 'Yiddish' }
    ];
    translateBox.appendChild(select(settings, 'translateTo', 'Translate into', TRANSLATE_OPTIONS,
      'Verified against the Google endpoint — it returns a translation instead of a definition. Other providers are unaffected.'));

    // Corpus only matters when not translating — with a translation target the
    // endpoint picks its own corpus, so showing it would be misleading.
    var corpusBox = el('div');
    corpusBox.appendChild(topInput(settings, 'corpus', 'Corpus (no translation)',
      'en-US, or en for UK spelling'));
    translateBox.appendChild(corpusBox);
    c2.body.appendChild(translateBox);

    var customBox = el('div', 'dict-custom');
    customBox.hidden = settings.provider !== 'custom';

    var credWarn = el('p', 'dict-note',
      'Credentials are blank. Fill in the key and header below to enable this source — nothing is shipped pre-filled.');
    customBox.appendChild(credWarn);
    customBox.appendChild(textInput(settings, 'baseUrl', 'Base URL', 'https://…/v2/dictionaryExtensionData'));
    customBox.appendChild(textInput(settings, 'key', 'API key', 'paste your key'));
    customBox.appendChild(textInput(settings, 'headerName', 'Extra header name', 'e.g. x-referer'));
    customBox.appendChild(textInput(settings, 'headerValue', 'Extra header value', 'paste your value'));
    customBox.appendChild(textInput(settings, 'termParam', 'Term parameter', 'term'));
    customBox.appendChild(textInput(settings, 'language', 'Language', 'en'));
    customBox.appendChild(textInput(settings, 'corpus', 'Corpus', 'en-US'));
    customBox.appendChild(textInput(settings, 'country', 'Country', 'US'));
    customBox.appendChild(textInput(settings, 'strategy', 'Strategy', '2'));

    var probe = el('p', 'dict-note dict-note-quiet',
      'Lookups from this endpoint are sent through this app\'s server because the browser always attaches an Origin header, which this endpoint rejects.');
    customBox.appendChild(probe);
    c2.body.appendChild(customBox);
    scroll.appendChild(c2.section);

    // Card 3 - content
    var c3 = card('Content', 'How much a card shows.');
    c3.body.appendChild(select(settings, 'maxDefinitions', 'Definitions per meaning', [
      { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
      { value: '4', label: '4' }, { value: '5', label: '5' }, { value: '6', label: '6' }
    ]));
    c3.body.appendChild(toggle(settings, 'showExamples', 'Show examples'));
    c3.body.appendChild(toggle(settings, 'showSynonyms', 'Show synonyms'));
    c3.body.appendChild(toggle(settings, 'audio', 'Offer pronunciation'));
    scroll.appendChild(c3.section);

    // Card 4 - history
    var c4 = card('Word history', 'Words you have looked up on this device.');
    c4.body.appendChild(toggle(settings, 'storeHistory', 'Store words I look up'));

    historyListEl = el('div', 'dict-history');
    c4.body.appendChild(historyListEl);

    var actions = el('div', 'dict-actions');
    var exportBtn = el('button', 'dict-btn', 'Export (.tsv)');
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', function () {
      try {
        var blob = new Blob([historyTsv()], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'dictionary-history.tsv';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      } catch (e) {}
    });
    var clearBtn = el('button', 'dict-btn', 'Clear history');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () { clearHistory(); });
    actions.appendChild(exportBtn);
    actions.appendChild(clearBtn);
    c4.body.appendChild(actions);

    var resetBtn = el('button', 'dict-btn dict-btn-reset', 'Reset all settings');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', function () {
      reset();
      refreshPanel();
    });
    c4.body.appendChild(resetBtn);
    scroll.appendChild(c4.section);

    panel.appendChild(scroll);
    document.body.appendChild(panel);
    refreshHistoryView();
  }

  function refreshHistoryView() {
    if (!historyListEl) return;
    historyListEl.textContent = '';
    var rows = listHistory();
    if (!rows.length) {
      historyListEl.appendChild(el('p', 'dict-note dict-note-quiet', 'No words stored yet.'));
      return;
    }
    rows.slice(0, 60).forEach(function (row) {
      var item = el('div', 'dict-history-item');
      item.appendChild(el('strong', 'dict-history-word', row.word));
      if (row.meaning) item.appendChild(el('span', 'dict-history-meaning', row.meaning));
      historyListEl.appendChild(item);
    });
    if (rows.length > 60) {
      historyListEl.appendChild(el('p', 'dict-note dict-note-quiet', '…and ' + (rows.length - 60) + ' more'));
    }
  }

  function refreshPanel() {
    if (!panel) return;
    var settings = get();
    var customBox = panel.querySelector('.dict-custom');
    if (customBox) customBox.hidden = settings.provider !== 'custom';
    // Corpus is only meaningful when NOT translating — with a target language
    // the endpoint picks its own corpus.
    var corpusRow = panel.querySelector('.dict-translate > div:last-child');
    if (corpusRow) corpusRow.hidden = !!(settings.translateTo && settings.translateTo !== 'off');
  }

  function isOpen() {
    return !!(panel && !panel.hidden);
  }

  function togglePanel(force) {
    if (!panel) buildPanel();
    var next = typeof force === 'boolean' ? force : !isOpen();
    panel.hidden = !next;
    var button = document.getElementById('dictSettingsButton');
    if (button) {
      button.setAttribute('aria-expanded', next ? 'true' : 'false');
      button.classList.toggle('toggled', next);
    }
    document.body.classList.toggle('dictPanelOpen', next);
    if (next) refreshHistoryView();
  }

  function bind() {
    // Desktop-only: never unhide the gear or wire the panel up anywhere else,
    // so the web build and the Android shell keep the button in its initial
    // `hidden` state for good.
    if (!isDesktopShell()) return;

    var button = document.getElementById('dictSettingsButton');
    if (button) {
      button.removeAttribute('hidden');
      button.addEventListener('click', function () { togglePanel(); });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen()) {
        event.stopPropagation();
        togglePanel(false);
      }
    });

    document.addEventListener('pointerdown', function (event) {
      if (!isOpen()) return;
      if (event.target.closest && event.target.closest('#dictSettingsPanel')) return;
      if (event.target.closest && event.target.closest('#dictSettingsButton')) return;
      togglePanel(false);
    });
  }

  window.materioDictConfig = {
    DEFAULTS: DEFAULTS,
    CUSTOM_DEFAULTS: CUSTOM_DEFAULTS,
    get: get,
    set: set,
    reset: reset,
    subscribe: subscribe,
    isOpen: isOpen,
    toggle: togglePanel,
    history: {
      add: addToHistory,
      list: listHistory,
      clear: clearHistory,
      tsv: historyTsv
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();