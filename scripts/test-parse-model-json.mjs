/**
 * Regression test for the REAL parseModelJson in src/lib/server/interviewer-llm.js.
 *
 * test-interviewer-llm.mjs "mirrors" this function in its own copy, so it can
 * never catch a change to the shipped one — which is how the lastIndexOf('}')
 * bug survived. This extracts the actual function body and drives it.
 *
 * The bug: slicing from the first '{' to the LAST '}' concatenated any
 * trailing content that contained a brace (a second object, a stray '}' in
 * prose) onto the first object, so JSON.parse threw "Unexpected non-whitespace
 * character after JSON". The provider ladder read that as "openrouter failed"
 * and dropped to the regex extractor on turns the model had actually
 * answered — costing ~17s per message.
 *
 *   node scripts/test-parse-model-json.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const SRC = 'src/lib/server/interviewer-llm.js';
const src = readFileSync(SRC, 'utf8');

/**
 * Extract a top-level function by line range rather than by counting braces.
 *
 * Brace counting lies: it counts the braces inside string literals too, and
 * this function deliberately contains ' and } literals — so the extraction
 * silently truncated. Every top-level function in this file closes with a
 * lone `}` at column 0, while nested closes are indented, so a column-0 scan
 * is exact and needs no lexer.
 */
function extractFn(name) {
  const lines = src.split(/\r?\n/);
  const open = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const start = lines.findIndex((l) => open.test(l));
  if (start === -1) throw new Error(`function ${name} not found in ${SRC}`);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`no column-0 closing brace for ${name}`);
}

const modPath = new URL('./.parse-model-json.mjs', import.meta.url);
// extractFn keeps the `export` keyword, so no second export is added here.
writeFileSync(modPath, `${extractFn('parseModelJson')}\n`);

let parseModelJson;
try {
  ({ parseModelJson } = await import(modPath.href));
} finally {
  rmSync(modPath, { force: true });
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

console.log('existing behaviour (must not regress)');

check('plain JSON parses', () =>
  assert.deepEqual(parseModelJson('{"reply":"hi"}'), { reply: 'hi' }));

check('fenced JSON parses', () =>
  assert.deepEqual(parseModelJson('```json\n{"reply":"hi"}\n```'), { reply: 'hi' }));

check('JSON embedded in prose parses', () =>
  assert.deepEqual(parseModelJson('Sure! {"reply":"hi"} hope that helps'), { reply: 'hi' }));

check('no JSON throws', () =>
  assert.throws(() => parseModelJson('no json here'), /no JSON/));

check('unterminated object throws', () =>
  assert.throws(() => parseModelJson('{"reply":'), /no JSON/));

console.log('trailing-brace bug (the reason every turn fell back to regex)');

check('stray closing brace after the object', () =>
  assert.deepEqual(
    parseModelJson('{"extracted":{"q":"a"},"reply":"ok"}\n}'),
    { extracted: { q: 'a' }, reply: 'ok' }
  ));

check('prose containing a brace after the JSON', () =>
  assert.deepEqual(
    parseModelJson('{"extracted":{"q":"x"},"reply":"y"}\n\nHope that helps! }'),
    { extracted: { q: 'x' }, reply: 'y' }
  ));

check('a second object is not concatenated onto the first', () =>
  assert.deepEqual(
    parseModelJson('{"reply":"first"}\n{"reply":"second"}'),
    { reply: 'first' }
  ));

check('closing brace inside a string literal is not the end', () =>
  assert.deepEqual(parseModelJson('{"reply":"a } b { c"}'), { reply: 'a } b { c' }));

check('escaped quote inside a string literal', () =>
  assert.deepEqual(parseModelJson('{"reply":"say \\"hi\\" }"}'), { reply: 'say "hi" }' }));

check('nested objects balance', () =>
  assert.deepEqual(
    parseModelJson('{"extracted":{"a":{"b":1}},"reply":"ok"}'),
    { extracted: { a: { b: 1 } }, reply: 'ok' }
  ));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
