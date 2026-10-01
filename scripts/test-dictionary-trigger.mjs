// Regression test for the dictionary trigger.
//
// Extracts selectedWord() from the SHIPPED source and runs it against DOM stubs
// that model PDF.js's real text-layer shape. The bug being guarded against:
// range.commonAncestorContainer is a TEXT node for a single-word selection, and
// text nodes have no .closest() (that is Element.prototype), so a naive guard
// rejects every single-word selection - the only case we handle.
//
//   node test-trigger.mjs

import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(
  'D:/v4/v5/project-exodus/static/oread/web/dictionary.js',
  'utf8'
);

// Pull the real function out of the shipped file so this can never drift.
function extractFunction(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in source`);
  let depth = 0;
  let i = SOURCE.indexOf('{', start);
  const from = i;
  for (; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return SOURCE.slice(start, i);
}

// A DOM stub faithful to PDF.js: div.textLayer > span > textNode.
function makeDom({ ancestors, containerIsTextNode }) {
  function element(cls) {
    const el = {
      nodeType: 1,
      _cls: cls,
      parentElement: null,
      // Only elements get .closest, exactly like the DOM.
      closest(selector) {
        let n = this;
        while (n) {
          if (selector === '.textLayer' && n._cls === 'textLayer') return n;
          n = n.parentElement;
        }
        return null;
      }
    };
    return el;
  }

  const layer = element('textLayer');
  const span = element('span');
  span.parentElement = layer;

  const textNode = { nodeType: 3, nodeValue: 'Confidentiality', data: 'Confidentiality', parentElement: span };

  // For a multi-word selection the ancestor is the shared parent element.
  const container = containerIsTextNode ? textNode : span;

  // Walk up from the container to the layer, mimicking a real ancestry chain.
  let node = containerIsTextNode ? span : span;
  const chain = [];
  node = node.parentElement;
  chain.push(layer, span);

  return { layer, span, textNode, container, chain };
}

function runSelectedWord({ rangeText, containerIsTextNode, outsideTextLayer = false }) {
  const dom = makeDom({ containerIsTextNode });
  if (outsideTextLayer) dom.layer._cls = 'someOtherContainer';

  const range = {
    toString: () => rangeText,
    commonAncestorContainer: dom.container
  };

  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => rangeText,
    getRangeAt: () => range
  };

  const Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

  // Evaluate the extracted function with only what it closes over.
  const fnSrc = extractFunction('selectedWord');
  const factory = new Function('window', 'Node', `return (${fnSrc});`);
  const selectedWord = factory({ getSelection: () => selection }, Node);

  return selectedWord();
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       got "${actual}"  expected "${expected}"`);
}

// THE REGRESSION: a single word inside one span -> ancestor is a TEXT node.
check('single word, ancestor is a text node', runSelectedWord({
  rangeText: 'Confidentiality', containerIsTextNode: true
}), 'Confidentiality');

check('single word, ancestor is an element', runSelectedWord({
  rangeText: 'Integrity', containerIsTextNode: false
}), 'Integrity');

check('word with trailing punctuation', runSelectedWord({
  rangeText: 'security.', containerIsTextNode: true
}), 'security');

check('wrapped in quotes', runSelectedWord({
  rangeText: '"confidentiality"', containerIsTextNode: true
}), 'confidentiality');

check('hyphenated word', runSelectedWord({
  rangeText: 'well-known', containerIsTextNode: true
}), 'well-known');

check('apostrophe kept', runSelectedWord({
  rangeText: "don't", containerIsTextNode: true
}), "don't");

// Behaviour that must be preserved.
check('multi-word selection declined', runSelectedWord({
  rangeText: 'Confidentiality means', containerIsTextNode: true
}), '');

check('pure number declined', runSelectedWord({
  rangeText: '42', containerIsTextNode: true
}), '');

check('single character declined', runSelectedWord({
  rangeText: 'x', containerIsTextNode: true
}), '');

check('selection outside text layer declined', runSelectedWord({
  rangeText: 'Confidentiality', containerIsTextNode: true, outsideTextLayer: true
}), '');

check('empty selection declined', runSelectedWord({
  rangeText: '   ', containerIsTextNode: true
}), '');

console.log(failures ? `\n${failures} failure(s)` : '\nall trigger checks passed');
process.exit(failures ? 1 : 0);