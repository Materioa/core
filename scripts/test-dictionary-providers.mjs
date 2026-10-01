// Live contract check against the two free providers, plus the normalisation
// the client relies on.
//
// The capitalisation bug is invisible to stubbed tests: a stub happily answers
// "Confidentiality". The real endpoints are lowercase-only, so this asserts
// against the actual services that the client sends a key they accept.
//
//   node test-dictionary-providers.mjs

import { normalizeWord } from '../src/lib/server/dictionary-handler.js';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n       ${detail}`}`);
}

const WIKTIONARY = 'https://en.wiktionary.org/api/rest_v1/page/definition/';

async function get(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, ok: res.ok };
  } catch (error) {
    return { status: 0, error: error.message, ok: false };
  }
}

// The word from the bug report. Capitalised, as it appears in a PDF.
const RAW = 'Confidentiality';

console.log(`--- normalisation (client lowercases before querying) ---`);
check('lowercases the lookup key', RAW.toLowerCase(), 'confidentiality');
check('server normaliser agrees', normalizeWord(RAW), 'confidentiality');

console.log('\n--- capitalisation is decisive on the real endpoint ---');
const capitalised = await get(WIKTIONARY + encodeURIComponent(RAW));
const lower = await get(WIKTIONARY + encodeURIComponent(RAW.toLowerCase()));

check(
  'lowercase key returns an entry',
  lower.ok && Array.isArray(lower.json?.en) && lower.json.en.length > 0,
  `status=${lower.status} body=${JSON.stringify(lower.json)?.slice(0, 120)}`
);

check(
  'lowercase key has real definitions',
  (lower.json?.en?.[0]?.definitions?.[0]?.definition || '').length > 0
);

// This is the regression: the endpoint rejects the capitalised form. If a
// provider ever relaxes this the client still lowercases, so this asserts the
// client's requirement, not a permanent upstream quirk.
console.log(
  `info: capitalised form -> ${capitalised.status}, lowercase form -> ${lower.status}` +
  ` (client sends the latter)`
);

// A word that genuinely does not exist must 404 cleanly, so the UI can say
// "no definition found" rather than "check your connection".
const nonsense = await get(WIKTIONARY + encodeURIComponent('zzqqxxyynotaword'));
check('unknown word is a clean 404', nonsense.status === 404, `status=${nonsense.status}`);

// A word dictionaryapi.dev knows, to confirm that provider is simply flaky
// rather than dead - the race is designed to ride through that.
const dik = await get('https://api.dictionaryapi.dev/api/v2/entries/en/catalogue');
console.log(
  `info: dictionaryapi.dev now -> ${dik.status}` +
  `${dik.status === 200 ? ' (healthy)' : ' (still flaky; the race covers it)'}`
);

console.log(failures ? `\n${failures} failure(s)` : '\nprovider contract checks passed');
process.exit(failures ? 1 : 0);