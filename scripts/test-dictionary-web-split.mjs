// Guards the desktop-only split: the dictionary, its settings gear and the
// annotation sidecar exist ONLY in the desktop (Tauri) shell. Everywhere else
// - the web build AND the Android shell - the card must never bind, the API
// (which reaches the Google provider, spending the server's borrowed,
// referrer-restricted key) must never be consulted, and the toolbar entries
// must be hidden.
//
// The other dictionary suites all model the desktop shell, so nothing else
// covers the non-desktop branch - it could regress to calling the API, or bind
// its selection listeners, unnoticed.
import { readFileSync } from 'node:fs';

const DICT = 'D:/v4/v5/project-exodus/static/oread/web/dictionary.js';
const SETTINGS = 'D:/v4/v5/project-exodus/static/oread/web/dictionary-settings.js';
const SIDECAR = 'D:/v4/v5/project-exodus/static/oread/web/sidecar.js';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : `\n       ${detail}`}`);
}

const dictSrc = readFileSync(DICT, 'utf8');
const settingsSrc = readFileSync(SETTINGS, 'utf8');
const sidecarSrc = readFileSync(SIDECAR, 'utf8');

console.log('--- the non-desktop shell must not reach our API ---');
check('web branch skips /api/v2/dictionary',
  /if \(!isDesktopShell\(\) && cfg\.provider !== 'wiktionary'\)[\s\S]{0,200}lookupDirectly\(word\)/.test(dictSrc));
check('the branch sits before the fetch of dictionaryUrl',
  dictSrc.indexOf('lookupDirectly(word)') < dictSrc.indexOf('fetch(dictionaryUrl(word)'));
check('an explicitly configured Custom source is still honoured on web',
  dictSrc.indexOf("cfg.provider === 'custom'") < dictSrc.indexOf('if (!isDesktopShell()'));
check('Wiktionary pin still goes through the API (no Google either way)',
  /!isDesktopShell\(\) && cfg\.provider !== 'wiktionary/.test(dictSrc));

console.log('\n--- the shell check is desktop (Tauri) only ---');
// isDesktopShell() replaced the old isNativeShell(), which counted Capacitor
// as native - that is why the card also opened inside the Android app. The
// probe must recognise Tauri and nothing else.
const helperMatch = dictSrc.match(/function isDesktopShell\(\)[\s\S]{0,700}?\n  }/);
check('isDesktopShell exists in dictionary.js', !!helperMatch);
if (helperMatch) {
  const h = helperMatch[0];
  for (const probe of ['__TAURI_INTERNALS__', "__TAURI__", "'tauri:'", 'tauri.localhost']) {
    check(`  detects ${probe}`, h.includes(probe));
  }
  for (const probe of ['Capacitor', "'capacitor:'", 'capacitor.localhost', '5173']) {
    check(`  does not treat ${probe} as desktop`, !h.includes(probe));
  }
}
check('no stale isNativeShell references left',
  !dictSrc.includes('isNativeShell') && !settingsSrc.includes('isNativeShell'));

console.log('\n--- the card never binds outside the desktop ---');
check('bindDictionary() bails out when not desktop',
  /function bindDictionary\(\) \{\s*\n[^\n]*\n\s*\n?\s*\/\/[^\n]*\n\s*if \(!isDesktopShell\(\)\) return;/.test(dictSrc) ||
  (/function bindDictionary\(\)/.test(dictSrc) && /if \(!isDesktopShell\(\)\) return;/.test(dictSrc)));
check('the settings panel never binds when not desktop',
  /function bind\(\) \{[\s\S]{0,300}?if \(!isDesktopShell\(\)\) return;/.test(settingsSrc));

console.log('\n--- Google UI is desktop-only in the panel ---');
check('provider list is chosen per shell', /var providerOptions = desktopShell/.test(settingsSrc));
check('Google offered only on the desktop shell',
  /var desktopShell = isDesktopShell\(\)[\s\S]{0,400}label: 'Google Dictionary'/.test(settingsSrc));
check('translation control hidden off-desktop', /if \(!desktopShell\) translateBox\.hidden = true/.test(settingsSrc));

console.log('\n--- the annotation sidecar is desktop-only ---');
check('sidecar returns before installing listeners when not desktop',
  /if \(!isDesktopShell\) return;/.test(sidecarSrc));
check('the sidecar probe is Tauri-only (no Capacitor)',
  /var isDesktopShell = \(function \(\)/.test(sidecarSrc) &&
  /var isDesktopShell[\s\S]{0,600}?__TAURI_INTERNALS__/.test(sidecarSrc) &&
  !sidecarSrc.includes('Capacitor') && !sidecarSrc.includes('capacitor'));

console.log('\n--- the toolbar entries are hidden off-desktop ---');
const viewerHtml = readFileSync('D:/v4/v5/project-exodus/static/oread/web/viewer.html', 'utf8');
const viewerCss = readFileSync('D:/v4/v5/project-exodus/static/oread/web/viewer.css', 'utf8');
check('viewer.html stamps data-materio-shell inline', /data-materio-shell/.test(viewerHtml));
check('viewer.css hides the annotation tools + dictionary gear off-desktop',
  /html:not\(\[data-materio-shell='desktop'\]\) #editorModeButtons,\s*\nhtml:not\(\[data-materio-shell='desktop'\]\) #dictSettingsButton \{\s*\n\s*display: none !important;/.test(viewerCss));

console.log('\n--- the settings panel is not shipped with credentials ---');
check('no Google API key in dictionary.js', !/AIza[0-9A-Za-z_-]{20,}/.test(dictSrc));
check('no Google API key in dictionary-settings.js', !/AIza[0-9A-Za-z_-]{20,}/.test(settingsSrc));
check('no extension id in dictionary.js', !/mgijmajocgfcbeboacabfgobmjgjcoja/.test(dictSrc));
check('no extension id in dictionary-settings.js', !/mgijmajocgfcbeboacabfgobmjgjcoja/.test(settingsSrc));

console.log('\n--- viewer.html wiring ---');
const viewer = viewerHtml;
check('external-links.js loaded', /external-links\.js/.test(viewer));
check('no orphaned annotation-delete.js reference', !/annotation-delete\.js/.test(viewer));

console.log(failures ? `\n${failures} web-split check(s) failed` : '\nweb-split checks passed');
process.exit(failures ? 1 : 0);
