// Tests for the dictionary settings store (custom credential slot, history) and
// the server's custom-provider proxy.
//
// The credential slot must ship EMPTY: no key, no host, no extension ID. That
// is the whole point of the BYO design, so it is asserted directly.
//
//   node test-dictionary-settings.mjs

import { readFileSync } from 'node:fs';

const SETTINGS_SRC = readFileSync(
  'D:/v4/v5/project-exodus/static/oread/web/dictionary-settings.js',
  'utf8'
);
const DICT_SRC = readFileSync(
  'D:/v4/v5/project-exodus/static/oread/web/dictionary.js',
  'utf8'
);

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n       ${detail}`}`);
}

console.log('--- the shipped build must contain no credentials ---');
// Anything that looks like a Google API key or the official extension ID.
const KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/;
const EXT_ID_PATTERN = /mgijmajocgfcbeboacabfgobmjgjcoja/;

check('no Google API key in settings module', !KEY_PATTERN.test(SETTINGS_SRC));
check('no Google extension ID in settings module', !EXT_ID_PATTERN.test(SETTINGS_SRC));
check('no Google API key in dictionary.js', !KEY_PATTERN.test(DICT_SRC));
check('no Google extension ID in dictionary.js', !EXT_ID_PATTERN.test(DICT_SRC));

console.log('\n--- credential fields exist but default to empty ---');
check('key field exists', /key:\s*''/.test(SETTINGS_SRC));
check('baseUrl defaults to empty', /baseUrl:\s*''/.test(SETTINGS_SRC));
check('headerName defaults to empty', /headerName:\s*''/.test(SETTINGS_SRC));
check('headerValue defaults to empty', /headerValue:\s*''/.test(SETTINGS_SRC));

console.log('\n--- settings surface requested ---');
for (const [label, key] of [
  ['enable toggle', 'enabled'],
  ['trigger mode', 'trigger'],
  ['provider choice', 'provider'],
  ['definitions per meaning', 'maxDefinitions'],
  ['examples toggle', 'showExamples'],
  ['synonyms toggle', 'showSynonyms'],
  ['audio toggle', 'audio'],
  ['history toggle', 'storeHistory']
]) {
  check(`${label} present`, new RegExp(`\\b${key}\\b`).test(SETTINGS_SRC));
}

console.log('\n--- history behaviour ---');
check('history export is TSV', /word\\tmeaning/.test(SETTINGS_SRC));
check('history is capped', /HISTORY_LIMIT/.test(SETTINGS_SRC));
check('history can be cleared', /clearHistory/.test(SETTINGS_SRC));
check('history only records when enabled', /if \(!get\(\)\.storeHistory\) return;/.test(SETTINGS_SRC));

console.log('\n--- dictionary.js honours settings ---');
check('respects enabled flag', /if \(!cfg\.enabled\) return;/.test(DICT_SRC));
check('respects trigger mode', /cfg\.trigger === 'dblclick'/.test(DICT_SRC));
check('respects maxDefinitions', /maxDefs/.test(DICT_SRC));
check('respects showExamples', /cfg\.showExamples/.test(DICT_SRC));
check('respects showSynonyms', /cfg\.showSynonyms/.test(DICT_SRC));
check('respects audio setting', /cfg\.audio/.test(DICT_SRC));
check('routes custom provider to our server', /source: 'custom'|method: 'POST'/.test(DICT_SRC));
check('custom source refused without a key', /no custom key configured/.test(DICT_SRC));
check('custom credentials go in the body, not headers', !/X-Dict-Key/.test(DICT_SRC));

console.log('\n--- viewer wiring ---');
const html = readFileSync('D:/v4/v5/project-exodus/static/oread/web/viewer.html', 'utf8');
check('settings script loaded', /dictionary-settings\.js/.test(html));
check('toolbar button present', /id="dictSettingsButton"/.test(html));
check('panel container declared', /dictSettingsPanel/.test(html));

console.log(failures ? `\n${failures} failure(s)` : '\nsettings checks passed');
process.exit(failures ? 1 : 0);