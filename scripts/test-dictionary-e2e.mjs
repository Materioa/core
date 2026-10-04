// Full-chain test: a real text selection in a PDF.js-shaped DOM must produce a
// visible definition card, driven only by the events the browser fires.
//
// This is the exact scenario from the bug report - drag-select one word in the
// viewer - so it is the one that matters. The trigger test covers selectedWord()
// alone and the render test covers lookup() alone; this proves the two are
// actually wired to selectionchange/mouseup.
//
//   node test-dictionary-e2e.mjs

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

// DOM stub faithful to PDF.js: body > div.textLayer > span > text node.
function makeNode(tag, cls) {
  const node = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    _cls: new Set(cls ? String(cls).split(/\s+/) : []),
    children: [],
    attrs: {},
    dataset: {},
    _text: '',
    _hidden: false,
    parentElement: null,
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; } },
    get className() { return [...this._cls].join(' '); },
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get hidden() { return this._hidden; },
    set hidden(v) { this._hidden = !!v; },
    get textContent() {
      return this.children.length
        ? this._text + this.children.map((c) => c.textContent).join('')
        : this._text;
    },
    set textContent(v) { this._text = String(v); this.children = []; },
    get isConnected() { return true; },
    contains(n) {
      let cur = n;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {},
    removeEventListener() {},
    closest(sel) {
      let n = this;
      while (n) {
        if (sel === '.textLayer' && n._cls.has('textLayer')) return n;
        n = n.parentElement;
      }
      return null;
    },
    getBoundingClientRect() {
      return { width: 340, height: this.children.length ? 200 : 40, top: 0, left: 0, right: 340, bottom: 200 };
    }
  };
  node.classList = {
    add: (c) => node._cls.add(c),
    remove: (c) => node._cls.delete(c),
    contains: (c) => node._cls.has(c)
  };
  // A real DOM reflects these properties onto the corresponding attributes.
  // Without this the stub silently hides bugs that set .id instead of
  // setAttribute('id', ...).
  for (const prop of ['id', 'type', 'title', 'href', 'rel', 'target', 'ariaLabel']) {
    Object.defineProperty(node, prop, {
      get() { return this.attrs[prop] ?? ''; },
      set(v) { this.attrs[prop] = v; },
      enumerable: true
    });
  }
  return node;
}

const PAYLOAD = [{
  word: 'Confidentiality',
  phonetic: '/kən/',
  phonetics: [],
  meanings: [{
    partOfSpeech: 'noun',
    definitions: [{ definition: 'The state of being secret.', example: '', synonyms: [], antonyms: [] }],
    synonyms: [], antonyms: []
  }]
}];

function build() {
  const listeners = new Map();

  const body = makeNode('body');
  const layer = makeNode('div', 'textLayer');
  body.appendChild(layer);

  // The selected word, exactly how PDF.js emits it: one span, one text node.
  const span = makeNode('span');
  const textNode = { nodeType: 3, nodeValue: 'Confidentiality', data: 'Confidentiality', parentElement: span };
  span._text = 'Confidentiality';
  layer.appendChild(span);

  const range = {
    toString: () => 'Confidentiality',
    // A single-word selection is contained by its TEXT NODE. This is the
    // detail that broke the trigger, so it is modelled faithfully.
    commonAncestorContainer: textNode,
    getClientRects: () => [{ left: 600, right: 700, top: 300, bottom: 320, width: 100, height: 20 }]
  };

  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: textNode,
    toString: () => 'Confidentiality',
    getRangeAt: () => range,
    removeAllRanges() {}
  };

  const doc = {
    readyState: 'complete',
    body,
    createElement: (t) => makeNode(t),
    getSelection: () => selection,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    }
  };

  const calls = [];
  const ctx = {
    document: doc,
    window: {
      location: { protocol: 'https:', hostname: 'getmaterio.app', search: '' },
    // Desktop shell: sidecar/dictionary gating is Tauri-only (see
    // isDesktopShell in dictionary.js). Without this the fixture models the
    // web/Android, which now skips bindDictionary() entirely, and the flow
    // assertions fail.
    __TAURI__: {},
      getSelection: doc.getSelection,
      setTimeout: (fn, ms) => setTimeout(fn, 0),
      clearTimeout: (id) => clearTimeout(id),
      addEventListener() {},
      innerWidth: 1280,
      innerHeight: 800
    },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    URL, console, AbortController, Map, Set, Promise,
    Audio: undefined,
    // Mirrors production: our /api/v2/dictionary route is NOT deployed, so the
    // lookup must succeed via the providers alone. Both are lowercase-only.
    fetch: async (url) => {
      calls.push(url);
      if (url.includes('/api/v2/dictionary')) {
        return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not_found' }) };
      }
      const headword = decodeURIComponent(url.split('/').pop() || '');
      if (/[A-Z]/.test(headword)) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => PAYLOAD };
    }
  };
  ctx.window.document = doc;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'dictionary.js' });

  return { ctx, doc, body, layer, span, selection, range, listeners, calls };
}

const { doc, body, layer, selection, range, listeners, calls } = build();

const findCard = () => body.children.find((c) => c.attrs.id === 'materioDictionaryCard');

// Before any event: no card exists at all.
check('no card exists before a selection', !findCard(), `body children: ${body.children.length}`);

// Fire exactly what the browser fires when you select a word.
const fire = (type) => (listeners.get(type) || []).forEach((fn) => fn({ target: doc.body }));
fire('selectionchange');
fire('mouseup');
fire('keyup');

await new Promise((r) => setTimeout(r, 40));

const card = findCard();
check('a card was created by the selection event', !!card, `children: ${body.children.length}`);
check('card id is set', card && card.attrs.id === 'materioDictionaryCard', card?.attrs?.id);
check('card is not hidden', card && card.hidden === false);
check('card is visible', card && card.classList.contains('materio-dict-visible'));
check('card was positioned', card && String(card.style.left).includes('px'), `left=${card?.style?.left}`);
check('a lookup was made', calls.length >= 1, calls.join(', '));

const text = card ? card.textContent : '';
check('card shows the selected word', text.includes('Confidentiality'), text.slice(0, 100));
check('card shows the definition', text.includes('The state of being secret'), text.slice(0, 160));

// --- Regression: a second event for the SAME word must not cancel the lookup.
check('lookup not cancelled by follow-up events', calls.length >= 3, `calls: ${calls.length}`);
check('api attempted first', calls[0].includes('/api/v2/dictionary'), calls.join(', '));
const e2eProviderCalls = calls.filter((u) => !u.includes('/api/v2/dictionary'));
check(
  'providers queried with the LOWERCASE headword',
  e2eProviderCalls.length === 2 &&
    e2eProviderCalls.every((u) => !/[A-Z]/.test(decodeURIComponent(u.split('/').pop()))),
  calls.join(', ')
);
check('definition resolved without the API', text.includes('The state of being secret'), text.slice(0, 160));

// --- Selecting a DIFFERENT word must retarget the open card.
const secondSpan = makeNode('span');
secondSpan._text = 'Integrity';
layer.appendChild(secondSpan);
const secondText = { nodeType: 3, nodeValue: 'Integrity', data: 'Integrity', parentElement: secondSpan };

selection.anchorNode = secondText;
range.commonAncestorContainer = secondText;
range.toString = () => 'Integrity';
selection.toString = () => 'Integrity';

calls.length = 0;
fire('selectionchange');
await new Promise((r) => setTimeout(r, 40));

check('new word triggers a new lookup', calls.length >= 1, `calls: ${calls.length}`);
check('new word retargets the same card', findCard() === card, 'card was replaced');
check('card now shows the new word', card.textContent.includes('Integrity'), card.textContent.slice(0, 120));

console.log(failures ? `\n${failures} failure(s)` : '\nend-to-end selection -> card: PASS');
process.exit(failures ? 1 : 0);