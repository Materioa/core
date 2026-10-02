// Guards against the bug that made the notebooks manage page not open:
// a helper used from the Svelte template but never imported.
//
// `svelte-check` does not flag it, and an SSR smoke test does not either —
// with no notes the branch is never taken, and a harness that stubs imports
// will happily supply the missing symbol. In the browser it is a
// ReferenceError thrown mid-render, which kills the whole panel while the URL
// has already changed, so it reads as "navigation does nothing".
//
// This walks the template's {expression} blocks and asserts every identifier
// is either imported, locally declared, or a known runtime global.
import { readFileSync } from 'node:fs';

const COMPONENTS = [
  'src/lib/components/NotebooksTab.svelte',
  'src/lib/components/NotebookEditor.svelte',
  'src/lib/components/ExamCard.svelte',
  'src/lib/components/MaterioModal.svelte',
  'src/lib/components/SoundEngine.svelte'
];

// Names that exist without being imported.
const GLOBALS = new Set([
  // browser / JS
  'window', 'document', 'console', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'fetch', 'URL', 'URLSearchParams', 'Blob', 'FormData', 'Date', 'Math',
  'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Set', 'Map',
  'Error', 'RegExp', 'Infinity', 'NaN', 'undefined', 'null', 'true', 'false', 'parseInt',
  'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'performance',
  'Intl', 'structuredClone', 'Symbol', 'globalThis', 'requestIdleCallback', 'matchMedia',
  'getComputedStyle', 'CustomEvent', 'Event', 'AbortController', 'Text', 'Node', 'Element',
  // svelte
  'get', 'writable', 'readable', 'derived', 'onMount', 'onDestroy', 'beforeUpdate',
  'afterUpdate', 'tick', 'createEventDispatcher', 'setContext', 'getContext', 'hasContext',
  'mount', 'unmount', 'hydrate', 'flushSync', 'untrack'
]);

const KEYWORDS = new Set([
  'if', 'else', 'each', 'await', 'then', 'catch', 'const', 'let', 'var', 'return',
  'true', 'false', 'null', 'undefined', 'this', 'new', 'typeof', 'instanceof', 'in',
  'of', 'function', 'as', 'void', 'delete'
]);

/** Named + default bindings introduced by the <script> block's imports. */
function importedBindings(script) {
  const names = new Set();
  const re = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
  let m;
  while ((m = re.exec(script))) {
    const clause = m[1];
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces) {
      braces[1].split(',').forEach((part) => {
        const t = part.trim();
        if (!t) return;
        // `a as b` -> b is the local name
        const alias = t.split(/\s+as\s+/);
        names.add((alias[1] || alias[0]).trim());
      });
    }
    const def = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim();
    if (def && !def.startsWith('*')) names.add(def);
  }
  return names;
}

/** Everything the script declares locally. */
function declaredBindings(script) {
  const names = new Set();
  const patterns = [
    /\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:let|const|var|function)\s+([A-Za-z_$][\w$]*)/g,
    // Reactive declarations: `$: filteredNotebooks = ...`
    /^\s*\$:\s*(?:async\s+)?([A-Za-z_$][\w$]*)/gm
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(script))) names.add(m[1]);
  }
  // Destructuring / multi-declarator forms.
  const destruct = /\b(?:let|const|var)\s*\{([^}]*)\}/g;
  let m;
  while ((m = destruct.exec(script))) {
    m[1].split(',').forEach((part) => {
      const t = part.trim().split(/[:=]/)[0].trim();
      if (t) names.add(t);
    });
  }
  return names;
}

/** Identifiers local to one expression: each-item vars, arrow params, catch. */
function expressionLocals(expr) {
  const locals = new Set();
  const each = expr.match(/^#each\s+([\s\S]+?)\s+as\s+([\w$]+)/);
  if (each) {
    locals.add(each[2]);
    const extra = expr.match(/\bas\s+[\w$]+\s*,\s*([\w$]+)/);
    if (extra) locals.add(extra[1]);
    return locals;
  }
  const push = (group) => group.split(',').forEach((p) => {
    const t = p.trim().split(/[:=]/)[0].replace(/^\.\.\./, '').trim();
    if (t) locals.add(t);
  });
  let m;
  const param = /\(([^()]*)\)\s*=>/g;
  while ((m = param.exec(expr))) push(m[1]);
  const bare = /([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = bare.exec(expr))) locals.add(m[1]);
  const caught = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g;
  while ((m = caught.exec(expr))) locals.add(m[1]);
  return locals;
}

/** Balanced-brace extraction of {expression} blocks from the template. */
function templateExpressions(template) {
  const out = [];
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '{') continue;
    if (template.startsWith('{:else', i)) continue;
    let depth = 0;
    let j = i;
    for (; j < template.length; j++) {
      if (template[j] === '{') depth++;
      else if (template[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= template.length) break;
    const expr = template.slice(i + 1, j);
    // Skip block openers/closers, which are syntax rather than expressions.
    if (/^\s*[#/:]/.test(expr)) {
      // `{#each list as item}` still references `list` and `item`.
      const each = expr.match(/^#each\s+([\s\S]+?)\s+as\s+([\w$]+)/);
      if (each) out.push(each[1]);
      continue;
    }
    out.push(expr);
  }
  return out;
}

function identifiersIn(code) {
  // Strip strings and JS comments so prose in either is not read as code.
  const stripped = code
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  // A trailing `:` means it was an object-literal key (month, day, ...), not a
  // reference. A leading `.` is a property access, already excluded above.
  // Only CALLS are collected: that is exactly how the missing-import bug
  // presents (coverStyle(...), getRibbon(...) -> ReferenceError mid-render),
  // and it avoids the noise object keys and prose produce.
  const re = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
  const found = new Set();
  let m;
  while ((m = re.exec(stripped))) found.add(m[1]);
  return found;
}

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n       ${detail}`}`);
}

for (const file of COMPONENTS) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const scriptMatch = source.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  const template = scriptMatch ? source.slice(scriptMatch.index + scriptMatch[0].length) : source;

  const known = new Set([
    ...importedBindings(scriptMatch ? scriptMatch[1] : ''),
    ...declaredBindings(scriptMatch ? scriptMatch[1] : '')
  ]);

  const missing = new Set();
  for (const expr of templateExpressions(template)) {
    const locals = expressionLocals(expr);
    for (const id of identifiersIn(expr)) {
      if (known.has(id) || locals.has(id) || GLOBALS.has(id) || KEYWORDS.has(id)) continue;
      // Store auto-subscriptions ($activeTab) resolve to the store name.
      if (id.startsWith('$')) continue;
      missing.add(id);
    }
  }

  check(
    `${file}: every template identifier is imported or declared`,
    missing.size === 0,
    [...missing].join(', ')
  );
}

// The specific regression, named so a future edit cannot quietly undo it.
const tab = readFileSync(new URL('../src/lib/components/NotebooksTab.svelte', import.meta.url), 'utf8');
const tabImports = tab.match(/import\s+\{([^}]*)\}\s+from\s+['"][^'"]*notebookCover\.js['"]/);
const imported = tabImports ? tabImports[1] : '';
for (const helper of ['coverStyle', 'coverLabel', 'getRibbon', 'NOTEBOOK_COVERS', 'DEFAULT_COVER']) {
  check(`NotebooksTab imports ${helper} from notebookCover.js`, imported.includes(helper));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall notebook import checks passed');
process.exit(failures ? 1 : 0);