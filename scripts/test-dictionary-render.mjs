// End-to-end render test for dictionary.js: loads the shipped file into a VM
// with a minimal DOM, drives a word lookup with a real provider payload, and
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
  // URL-aware so the happy path (our API answers) is exercised separately from
  // the fallback path (our API is missing, providers answer).
  fetch: async (url) => {
    calls.push(url);
    if (url.includes('/api/v2/dictionary')) {
      if (apiAvailable) {
        return {
          ok: true, status: 200,
          json: async () => ({ ok: true, word: 'Confidentiality', ...PROVIDER_PAYLOAD[0], provider: 'api' })
        };
      }
      return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not_found' }) };
    }
    if (url.includes('dictionaryapi.dev')) {
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
check('fallback: card still renders definition', card.textContent.includes('The state of being secret'));

console.log(failures ? `\n${failures} failure(s)` : '\nall render checks passed');
process.exit(failures ? 1 : 0);