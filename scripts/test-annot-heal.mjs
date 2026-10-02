// Reproduce PDF.js's #cleanup() destroying a restored editor mid-session, then
// confirm healEditors() brings it back. This is the failure that makes an
// annotation "restore, then vanish": cleanup() removes any empty editor and
// de-registers it from the uiManager, so no later render() can recover it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8997, CDP_PORT = 9937;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PROFILE = path.join(os.tmpdir(), 'cr-heal-' + Date.now());
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bcmap': 'application/octet-stream', '.properties': 'text/plain', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  const st = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const r = req.headers.range;
  if (r) { const m = /bytes=(\d*)-(\d*)/.exec(r); const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 });
    fs.createReadStream(file, { start: s, end: e }).pipe(res);
  } else { res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size }); fs.createReadStream(file).pipe(res); }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome, failures = [];
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); if (!ok) failures.push(n); };

try {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1400,1000', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break; } catch {} await sleep(300); }
  const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const w = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } };
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return '__ERR ' + String(r.result.exceptionDetails.exception?.description || '').split('\n')[0];
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');

  const payload = {
    annotationType: 9, color: [255, 235, 59], opacity: 1, thickness: 12,
    quadPoints: [120, 640, 340, 640, 120, 668, 340, 668],
    pageIndex: 0, rect: [120, 640, 340, 668], rotation: 0,
    structTreeParentId: null, id: null,
  };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__P = ' + JSON.stringify({ pdfjs_internal_editor_0: payload }) + ';' });
  await send('Page.navigate', { url: `${ORIGIN}/scripts/annot-restore-harness.html` });
  for (let i = 0; i < 40; i++) {
    if (await ev(`(() => { try { const w = document.getElementById('fr').contentWindow;
      return !!(w && w.PDFViewerApplication && w.PDFViewerApplication.pdfDocument); } catch (e) { return false; } })()`) === true) break;
    await sleep(500);
  }
  await sleep(12000);

  const probe = () => ev(`(() => {
    const wf = document.getElementById('fr').contentWindow;
    const all = wf.PDFViewerApplication.pdfDocument.annotationStorage.getAll() || {};
    const k = Object.keys(all)[0]; const e = all[k];
    if (!e) return 'NO EDITOR';
    const r = e.div && e.div.getBoundingClientRect();
    return JSON.stringify({ attached: !!e.isAttachedToDOM, inDom: !!(e.div && e.div.isConnected),
      rect: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null });
  })()`);

  console.log('A) restored:');
  const a = JSON.parse(await probe());
  console.log('  ' + JSON.stringify(a));
  check('editor is in the DOM after restore', a.inDom === true && a.attached === true, JSON.stringify(a));

  // Now do exactly what PDF.js does on any page draw: run #cleanup() on the
  // layer. The editor is not empty, so a well-behaved editor survives - which
  // is the point: cleanup() must not take it.
  console.log('\nB) after forcing the page to redraw (PDF.js #cleanup path):');
  await ev(`(async () => {
    const wf = document.getElementById('fr').contentWindow;
    const A = wf.PDFViewerApplication;
    const pv0 = A.pdfViewer.getPageView(0);
    const layer = pv0.annotationEditorLayer && pv0.annotationEditorLayer.annotationEditorLayer;
    if (layer && typeof layer.update === 'function') layer.update({ viewport: pv0.viewport });
    return 1; })()`);
  await sleep(2500);
  const b = JSON.parse(await probe());
  console.log('  ' + JSON.stringify(b));
  check('editor survives a layer update', b.inDom === true, JSON.stringify(b));

  console.log('\nC) simulate cleanup() actually destroying the editor, then let the poll heal it:');
  await ev(`(() => {
    const wf = document.getElementById('fr').contentWindow;
    const all = wf.PDFViewerApplication.pdfDocument.annotationStorage.getAll() || {};
    const e = all[Object.keys(all)[0]];
    const layer = wf.PDFViewerApplication.pdfViewer.getPageView(0)
      .annotationEditorLayer.annotationEditorLayer;
    // This is precisely AnnotationEditorLayer.remove().
    if (e.div) e.div.remove();
    e.isAttachedToDOM = false;
    layer.div.hidden = true;
    return 1; })()`);
  const c0 = JSON.parse(await probe());
  console.log('  immediately after removal: ' + JSON.stringify(c0));
  check('removal really detached the editor', c0.inDom === false, JSON.stringify(c0));

  await sleep(4000); // the poll runs every second
  const c1 = JSON.parse(await probe());
  console.log('  after the heal poll:        ' + JSON.stringify(c1));
  check('healEditors() re-attached the editor', c1.inDom === true, JSON.stringify(c1));
  check('healed editor has geometry', !!c1.rect && c1.rect !== '0x0', `rect=${c1.rect}`);

  ws.close();
} catch (e) { console.error('ERROR', e); failures.push('crash: ' + e.message); }
finally { try { chrome?.kill(); } catch {} try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} try { server.close(); } catch {} }
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
