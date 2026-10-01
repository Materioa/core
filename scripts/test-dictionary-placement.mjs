// Placement tests for the dictionary tooltip.
//
// positionCard() is the other half of "does it show up correctly": which side
// of the word it lands on, viewport clamping, and where the arrow points. All
// pure arithmetic over rects, so it is tested directly against the shipped
// source.
//
//   node test-dictionary-placement.mjs

import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(
  'D:/v4/v5/project-exodus/static/oread/web/dictionary.js',
  'utf8'
);

function extractFunction(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  let depth = 0;
  let i = SOURCE.indexOf('{', start);
  for (; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return SOURCE.slice(start, i);
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       got ${JSON.stringify(actual)}  expected ${JSON.stringify(expected)}`);
}

// Build positionCard with an injected card + window size.
function position({ cardSize, word, viewport }) {
  const card = {
    _size: cardSize,
    _top: null,
    _left: null,
    dataset: {},
    _props: {},
    style: {
      set top(v) { card._top = v; },
      get top() { return card._top; },
      set left(v) { card._left = v; },
      get left() { return card._left; },
      setProperty(k, v) { card._props[k] = v; }
    },
    getBoundingClientRect: () => ({
      width: cardSize.w, height: cardSize.h, top: 0, left: 0, bottom: cardSize.h, right: cardSize.w
    })
  };

  const win = {
    innerWidth: viewport.w,
    innerHeight: viewport.h
  };

  const fn = new Function(
    'card', 'window', 'clamp', 'ANCHOR_GAP', 'VIEWPORT_MARGIN',
    `return (${extractFunction('positionCard')});`
  )(card, win, extractClamp(), 10, 8);

  fn(word);
  return {
    placement: card.dataset.placement,
    // positionCard assigns CSS lengths, e.g. "190px".
    top: parseFloat(card._top),
    left: parseFloat(card._left),
    arrowLeft: parseFloat(card._props['--materio-dict-arrow-left'])
  };
}

function extractClamp() {
  const src = SOURCE.slice(
    SOURCE.indexOf('function clamp('),
    SOURCE.indexOf('}', SOURCE.indexOf('function clamp(')) + 1
  );
  return new Function(`return (${src});`)();
}

const CARD = { w: 340, h: 200 };
const VIEW = { w: 1280, h: 800 };

// Word in the middle of the page: card goes ABOVE, arrow centred on the word.
const middle = position({
  cardSize: CARD, viewport: VIEW,
  word: { left: 600, right: 700, top: 400, bottom: 420, width: 100, height: 20 }
});
check('centred word: placed above', middle.placement, 'top');
check('centred word: arrow centred', middle.arrowLeft, CARD.w / 2);

// Word near the TOP edge: must flip BELOW, since above has no room.
const nearTop = position({
  cardSize: CARD, viewport: VIEW,
  word: { left: 600, right: 700, top: 5, bottom: 25, width: 100, height: 20 }
});
check('word at top edge: flipped below', nearTop.placement, 'bottom');

// Word near the RIGHT edge: card clamped inside the viewport, arrow follows
// the word rather than staying centred.
const nearRight = position({
  cardSize: CARD, viewport: VIEW,
  word: { left: 1200, right: 1270, top: 400, bottom: 420, width: 70, height: 20 }
});
check('word at right edge: card stays on screen', nearRight.left <= VIEW.w - CARD.w, true);
check('word at right edge: arrow tracks the word', nearRight.arrowLeft > CARD.w / 2, true);

// Word near the LEFT edge.
const nearLeft = position({
  cardSize: CARD, viewport: VIEW,
  word: { left: 2, right: 60, top: 400, bottom: 420, width: 58, height: 20 }
});
check('word at left edge: card stays on screen', nearLeft.left >= 8, true);
check('word at left edge: arrow tracks the word', nearLeft.arrowLeft < CARD.w / 2, true);

// Arrow must never reach the rounded corners (clamped to >= 18).
const tiny = position({
  cardSize: { w: 90, h: 120 }, viewport: VIEW,
  word: { left: 10, right: 20, top: 400, bottom: 420, width: 10, height: 20 }
});
check('narrow card: arrow not in the corner', tiny.arrowLeft >= 18, true);

// Neither side fits (card taller than the viewport): must pin to the top margin
// rather than going negative and rendering off-screen.
const cramped = position({
  cardSize: { w: 340, h: 700 }, viewport: { w: 1280, h: 400 },
  word: { left: 600, right: 700, top: 150, bottom: 170, width: 100, height: 20 }
});
check('cramped viewport: pinned to top margin', cramped.top, 8);
check('cramped viewport: still placed', cramped.placement, 'bottom');

console.log(failures ? `\n${failures} failure(s)` : '\nall placement checks passed');
process.exit(failures ? 1 : 0);