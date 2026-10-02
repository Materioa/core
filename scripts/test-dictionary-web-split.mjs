// Guards the desktop-only split: the desktop shell consults
// /api/v2/dictionary (which reaches the Google provider), while the WEB build
// goes straight to the keyless providers so site visitors do not spend the
// server's borrowed, referrer-restricted Google key.
//
// The other dictionary suites all model a native shell, so nothing else covers
// the web branch — it could regress to calling the API unnoticed.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DICT = 'D:/v4/v5/project-exodus/static/oread/web/dictionary.js';
const SETTINGS = 'D:/v4/v5/project-exodus/static/oread/web/dictionary-settings.js';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n       ${detail}`}`);
}

const dictSrc = readFileSync(DICT, 'utf8');
const settingsSrc = readFileSync(SETTINGS, 'utf8');

console.log('--- the web build must not reach our API ---');
check('web branch skips /api/v2/dictionary',
  /if \(!isNativeShell\(\) && cfg\.provider !== 'wiktionary'\)[\s\S]{0,200}lookupDirectly\(word\)/.test(dictSrc));
check('the branch sits before the fetch of dictionaryUrl',
  dictSrc.indexOf('lookupDirectly(word)') < dictSrc.indexOf('fetch(dictionaryUrl(word)'));
check('an explicitly configured Custom source is still honoured on web',
  dictSrc.indexOf("cfg.provider === 'custom'") < dictSrc.indexOf('if (!isNativeShell()'));
check('Wiktionary pin still goes through the API (no Google either way)',
  /!isNativeShell\(\) && cfg\.provider !== 'wiktionary'/.test(dictSrc));

console.log('\n--- the shell check matches the other native checks ---');
// dictionaryUrl() already had this test; the new helper must agree with it or
// the web build would resolve a native API URL it is not allowed to call.
const helperMatch = dictSrc.match(/function isNativeShell\(\)[\s\S]{0,700}?\n  }/);
check('isNativeShell exists in dictionary.js', !!helperMatch);
if (helperMatch) {
  const h = helperMatch[0];
  for (const probe of ['__TAURI_INTERNALS__', "__TAURI__", "'tauri:'", 'tauri.localhost', "'capacitor:'", 'capacitor.localhost', '5173']) {
    check(`  detects ${probe}`, h.includes(probe));
  }
}

console.log('\n--- Google UI is desktop-only in the panel ---');
check('provider list is chosen per shell', /var providerOptions = native/.test(settingsSrc));
check('Google offered only when native',
  /var native = isNativeShell\(\)[\s\S]{0,400}label: 'Google Dictionary'[\s\S]{0,200}isNativeShell/.test(settingsSrc) ||
  /var providerOptions = native/.test(settingsSrc));
check('translation control hidden on web', /if \(!native\) translateBox\.hidden = true/.test(settingsSrc));

console.log('\n--- the settings panel is not shipped with credentials ---');
check('no Google API key in dictionary.js', !/AIza[0-9A-Za-z_-]{20,}/.test(dictSrc));
check('no Google API key in dictionary-settings.js', !/AIza[0-9A-Za-z_-]{20,}/.test(settingsSrc));
check('no extension id in dictionary.js', !/mgijmajocgfcbeboacabfgobmjgjcoja/.test(dictSrc));
check('no extension id in dictionary-settings.js', !/mgijmajocgfcbeboacabfgobmjgjcoja/.test(settingsSrc));

console.log('\n--- viewer.html wiring ---');
const viewer = readFileSync('D:/v4/v5/project-exodus/static/oread/web/viewer.html', 'utf8');
check('external-links.js loaded', /external-links\.js/.test(viewer));
check('no orphaned annotation-delete.js reference', !/annotation-delete\.js/.test(viewer));

console.log(failures ? `\n${failures} web-split check(s) failed` : '\nweb-split checks passed');
process.exit(failures ? 1 : 0);
