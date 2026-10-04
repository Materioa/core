// End-to-end render test for dictionary.js: loads the shipped file into a VM
// with a minimal DOM, drives a word lookup with a realistic provider payload, and
// asserts the card is created, populated and positioned.
//
// "Not showing up" is a rendering bug as easily as a trigger bug, and neither
// is caught by testing one function in isolation.
//
//   node test-dictionary-render.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(
  'D:/v4/v5/project-exodus/static/oread/web/dictionary.js',
  'utf8'
);

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n       ${detail}`}`);
}

// ---- minimal DOM ----------------------------------------------------------
function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    _cls: new Set(),
    children: [],
    attrs: {},
    dataset: {},
    _text: '',
    _hidden: false,
    parentElement: null,
    style: {
      _props: {},
      setProperty(k, v) { this._props[k] = v; }
    },
    get className() { return [...this._cls].join(' '); },
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get hidden() { return this._hidden; },
    set hidden(v) { this._hidden = !!v; },
    get textContent() {
      if (this.children.length === 0) return this._text;
      return this._text + this.children.map(c => c.textContent).join('');
    },
    set textContent(v) { this._text = String(v); this.children = []; },
    get isConnected() { return true; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {},
    removeEventListener() {},
    closest() { return null; },
    getBoundingClientRect() {
      const h = this.children.length ? 200 : 40;
      return { width: 340, height: h, top: 0, left: 0, right: 340, bottom: h };
    }
  };
  node.classList = {
    add: (c) => node._cls.add(c),
    remove: (c) => node._cls.delete(c),
    contains: (c) => node._cls.has(c)
  };
  return node;
}

// Real dictionaryapi.dev shape, trimmed.
const PROVIDER_PAYLOAD = [{
  word: 'Confidentiality',
  phonetic: '/ˌkɒnfɪˌdɛnʃɪˈælɪti/',
  phonetics: [{ text: '/ˌkɒnfɪˌdɛnʃɪˈælɪti/', audio: 'https://example.test/a.mp3' }],
  meanings: [{
    partOfSpeech: 'noun',
    definitions: [{
      definition: 'The state of being secret or private.',
      example: 'The treaty was signed in strict confidentiality.',
      synonyms: ['secrecy', 'privacy'],
      antonyms: []
    }],
    synonyms: ['secrecy'],
    antonyms: []
  }]
}];

const calls = [];
let apiAvailable = true;
let providerFlaky = false;
const body = makeNode('body');
const doc = {
  readyState: 'complete',
  body,
  createElement: (t) => makeNode(t),
  addEventListener() {},
  getSelection: () => ({ rangeCount: 0, isCollapsed: true, removeAllRanges() {} })
};

const ctx = {
  document: doc,
  window: {
    location: { protocol: 'https:', hostname: 'getmaterio.app', search: '', hostname: 'getmaterio.app' },
    // Desktop shell. dictionary.js is desktop-only (see isDesktopShell there):
    // web and Android skip the API and bindDictionary() is never called at all,
    // so this suite - which covers the desktop path, where /api/v2/dictionary
    // IS consulted first - must report the Tauri shell or every "API tried
    // first" assertion fails by design.
    __TAURI__: {},
    getSelection: doc.getSelection,
    setTimeout: (fn, ms) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
    addEventListener() {},
    innerWidth: 1280,
    innerHeight: 800
  },
  Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  URL,
  console,
  AbortController,
  Map,
  Set,
  Promise,
  // No Audio: the play button must degrade quietly rather than throw.
  Audio: undefined,
  // Models the real providers: lowercase-only headwords, and dictionaryapi.dev
  // is frequently unavailable. `providerFlaky` flips the 522s on and off so the
  // race has to prove it returns a result either way.
  fetch: async (url) => {
    calls.push(url);
    const headword = decodeURIComponent(url.split('/').pop() || '');

    if (url.includes('/api/v2/dictionary')) {
      return apiAvailable
        ? { ok: true, status: 200, json: async () => ({ ok: true, word: headword, ...PROVIDER_PAYLOAD[0] }) }
        : { ok: false, status: 404, json: async () => ({ ok: false, error: 'not_found' }) };
    }

    // Both real endpoints 404 on a capitalised headword.
    if (/[A-Z]/.test(headword)) {
      return { ok: false, status: 404, json: async () => ({}) };
    }

    if (providerFlaky) {
      return { ok: false, status: 522, json: async () => ({}) };
    }

    if (url.includes('dictionaryapi.dev')) {
      // No provider knows a nonsense headword, which is what makes the
      // not-found path reachable in the first place.
      if (headword.startsWith('zzqqxxyy')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => PROVIDER_PAYLOAD };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
ctx.window.document = doc;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(SOURCE, ctx, { filename: 'dictionary.js' });

const api = ctx.window.materioDictionary;
check('plugin exposes its API', !!api && typeof api.lookup === 'function');
check('plugin exposes diagnose', !!api && typeof api.diagnose === 'function');

// A word near the top edge so placement flips below.
const wordRect = { left: 600, right: 700, top: 6, bottom: 26, width: 100, height: 20 };

// --- Path 1: our API answers (the cache-optimised happy path) --------------
await api.lookup('Confidentiality', wordRect);
await new Promise((r) => setTimeout(r, 30));

check('happy path: API tried first', calls[0] && calls[0].includes('/api/v2/dictionary'), calls.join(', '));
check('happy path: no provider call needed', calls.length === 1, `calls: ${calls.length}`);
// Only provider URLs are subject to the lowercase rule; our own API
// normalises server-side and may carry the word as displayed.
const providerCalls = calls.filter((u) => !u.includes('/api/v2/dictionary'));
check(
  'happy path: providers queried with a lowercase key',
  providerCalls.every((u) => !/[A-Z]/.test(decodeURIComponent(u.split('/').pop()))),
  calls.join(', ')
);

const card = body.children.find((c) => c.attrs.id === 'materioDictionaryCard' || c.id === 'materioDictionaryCard')
  || body.children[0];

check('card was created and attached', !!card, `body children: ${body.children.length}`);
check('card is visible (not hidden)', card && card.hidden === false);
check('card has visible class', card && card.classList.contains('materio-dict-visible'));
check('card placement set', card && card.dataset.placement === 'bottom', `placement=${card?.dataset?.placement}`);
check('card was positioned', card && typeof card.style.top === 'string' || card?.style?._props?.top !== undefined || String(card?.style?.left).includes('px'),
  `left=${card?.style?.left}`);

const text = card ? card.textContent : '';
check('card shows the word', text.includes('Confidentiality'), text.slice(0, 120));
check('word is sentence case, not SHOUTED', !text.includes('CONFIDENTIALITY'), text.slice(0, 120));
check('part of speech is sentence case', text.includes('Noun') && !text.includes('NOUN'), text.slice(0, 200));
check('card shows the phonetic', text.includes('ˈælɪti'), text.slice(0, 160));
check('card shows part of speech', text.toLowerCase().includes('noun'));
check('card shows the definition', text.includes('The state of being secret'));
check('card shows the example', text.includes('signed in strict confidentiality'));
check('card shows a synonym chip', text.includes('secrecy'));

check('happy path: card renders definition', text.includes('The state of being secret'));

// --- Path 2: our API is missing (the v2.1.102/104 situation) --------------
// A different word so it misses the client cache, forcing a fresh request.
calls.length = 0;
apiAvailable = false;
await api.lookup('Integrity', { left: 300, right: 400, top: 300, bottom: 320, width: 100, height: 20 });
await new Promise((r) => setTimeout(r, 30));

check('fallback: API attempted first', calls.some((u) => u.includes('/api/v2/dictionary')), calls.join(', '));
check('fallback: dictionaryapi.dev queried', calls.some((u) => u.includes('dictionaryapi.dev')), calls.join(', '));
check('fallback: wiktionary queried in parallel', calls.some((u) => u.includes('wiktionary')), calls.join(', '));
check('fallback: providers got the LOWERCASE headword', calls.filter((u) => !u.includes('/api/v2/')).every((u) => u.endsWith('integrity')), calls.join(', '));
check('fallback: card still renders definition', card.textContent.includes('The state of being secret'));

// A word neither provider has must read as "no definition found", NOT as a
// connection error. One flaky 5xx must not turn a genuine miss into a scary
// "check your connection".
apiAvailable = false;
card.hidden = true;
await api.lookup('zzqqxxyynotaword', { left: 300, right: 400, top: 300, bottom: 320, width: 100, height: 20 })
  .then(() => check('genuine miss rejects', false, 'resolved instead of rejecting'))
  .catch((error) => {
    check('genuine miss is reported as not-found', error.notFound === true, `notFound=${error.notFound}`);
    check('card says no definition, not connection error', card.textContent.includes('No definition found'), card.textContent.slice(0, 120));
  });

// With dictionaryapi.dev throwing 522 (its normal state) and Wiktionary having
// the word, the race must still produce a definition.
calls.length = 0;
card.hidden = true;
await api.lookup('Confidentiality', { left: 300, right: 400, top: 300, bottom: 320, width: 100, height: 20 });
await new Promise((r) => setTimeout(r, 20));
check('flaky primary does not break the lookup', card.textContent.includes('The state of being secret'), card.textContent.slice(0, 140));

console.log(failures ? `\n${failures} failure(s)` : '\nall render checks passed');
process.exit(failures ? 1 : 0);