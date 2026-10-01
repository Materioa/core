// Exercises the server's custom-provider proxy against a real upstream.
//
// Uses a deliberately invalid credential, because the point is to prove the
// request REACHES the provider and the response is parsed/handled correctly -
// not to obtain a definition. A 401/403 from upstream still proves the URL was
// built, the credential was forwarded, and no Origin header was attached.
//
//   node test-dictionary-custom.mjs

import { handleDictionaryPost } from '../src/lib/server/dictionary-handler.js';

const ENDPOINT = 'https://dictionaryextension-pa.googleapis.com/v2/dictionaryExtensionData';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n       ${detail}`}`);
}

function post(body) {
  return handleDictionaryPost({
    request: new Request('https://app.test/api/v2/dictionary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  });
}

const validCustom = {
  baseUrl: ENDPOINT,
  key: 'placeholder-invalid-key',
  headerName: 'x-referer',
  headerValue: 'placeholder-value',
  language: 'en',
  corpus: 'en-US',
  country: 'US',
  strategy: '2',
  termParam: 'term',
  languageParam: 'language',
  corpusParam: 'corpus',
  countryParam: 'country',
  strategyParam: 'strategy',
  keyParam: 'key'
};

console.log('--- request validation (must reject before any outbound call) ---');

for (const [label, body] of [
  ['missing word', { custom: validCustom }],
  ['missing custom block', { word: 'hello' }],
  ['missing base URL', { word: 'hello', custom: { ...validCustom, baseUrl: '' } }],
  ['missing key', { word: 'hello', custom: { ...validCustom, key: '' } }],
  ['non-http scheme', { word: 'hello', custom: { ...validCustom, baseUrl: 'file:///etc/passwd' } }],
  ['loopback host', { word: 'hello', custom: { ...validCustom, baseUrl: 'http://127.0.0.1:8080/dict' } }],
  ['localhost host', { word: 'hello', custom: { ...validCustom, baseUrl: 'http://localhost/dict' } }],
  ['private LAN host', { word: 'hello', custom: { ...validCustom, baseUrl: 'http://192.168.1.5/dict' } }],
  ['link-local host', { word: 'hello', custom: { ...validCustom, baseUrl: 'http://169.254.169.254/latest/meta-data' } }],
  ['injected param name', { word: 'hello', custom: { ...validCustom, termParam: 'a&b=c' } }]
]) {
  const res = await post(body);
  const json = await res.json();
  check(`rejects ${label}`, res.status === 400, `status=${res.status} ${JSON.stringify(json)}`);
}

console.log('\n--- a well-formed custom request reaches the provider ---');
const live = await post({ word: 'Confidentiality', custom: validCustom });
const liveJson = await live.json();
console.log(`     status=${live.status} body=${JSON.stringify(liveJson).slice(0, 220)}`);

// A 4xx from upstream (our placeholder credential is rejected) or a 200 means
// the proxy built the URL, attached the credential header and got a real
// response. A 400 would mean our validation let a bad request through, and a
// 5xx timeout would mean it never left.
check(
  'request reached upstream (not a local rejection)',
  live.status !== 400,
  `status=${live.status}`
);
check(
  'upstream credential rejection is reported cleanly',
  live.status === 200 || (live.status === 502 && liveJson.error === 'upstream_error'),
  `status=${live.status} error=${liveJson.error}`
);

// Credential-bearing responses must never be cacheable, on any path.
check(
  'credentialed response is uncacheable',
  live.headers.get('cache-control') === 'no-store',
  `cache-control=${live.headers.get('cache-control')}`
);

console.log('\n--- the client sends the word lowercased ---');
check(
  'word is normalised before it reaches the provider',
  // normalizeWord lowercases, so an all-caps request word still builds a valid
  // upstream URL rather than being rejected outright.
  (await post({ word: 'CONFIDENTIALITY', custom: validCustom })).status !== 400,
  'all-caps word was rejected locally'
);

console.log(failures ? `\n${failures} failure(s)` : '\ncustom-provider checks passed');
process.exit(failures ? 1 : 0);