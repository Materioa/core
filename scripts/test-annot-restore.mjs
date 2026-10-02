#!/usr/bin/env node
// Reproduces the "PDF annotations save but never come back" bug end-to-end
// against the REAL pdf.mjs/viewer.mjs in headless Chrome, then asserts the fix
// still holds. No PDF.js mocking: everything below runs the shipped viewer.
//
//   node scripts/test-annot-restore.mjs
//
// Requires Google Chrome (or set CHROME_PATH). Serves the repo over HTTP with
// Range support, because PDF.js will not stream a document without it.
//
// What it does:
//   PHASE 1  opens the viewer, enters highlight mode via the real
//            AnnotationEditorUIManager, drags a real mouse selection across a
//            line of text, and captures exactly what sidecar.js persists.
//   PHASE 2  cold-reopens and feeds that payload back through
//            materioAnnotInit; asserts the editor renders AND that the sync
//            reports it.
//   PHASE 3  reopens using the payload phase 2 reported, asserting the cycle
//            is stable.
//
// The regression this guards: PDF.js leaves _initialData null on an editor
// built from raw editor data, but HighlightEditor.serialize() calls
// #hasElementChanged(), which destructures _initialData. serialize() therefore
// THREW on every restored highlight, snapshotPlain() swallowed it and returned
// {}, and the parent read that as "this PDF has no annotations" and persisted
// the empty record. The annotation rendered fine and was then destroyed.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8971 + Math.floor(Math.random() * 60);
const CDP_PORT = 9800 + Math.floor(Math.random() * 150);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const VIEWER = `${ORIGIN}/static/oread/web/viewer.html?file=` +
  encodeURIComponent('/build/assets/data/Seating Arrangement_7th Sem_Btech.pdf');

if (!fs.existsSync(CHROME)) {
  console.error(`SKIP: no Chrome at ${CHROME} (set CHROME_PATH to run this check)`);
  process.exit(0);
}
const sample = path.join(ROOT, 'build', 'assets', 'data', 'Seating Arrangement_7th Sem_Btech.pdf');
if (!fs.existsSync(sample)) {
  console.error(`SKIP: sample PDF missing at ${sample} (run: npm run build:static)`);
  process.exit(0);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bcmap': 'application/octet-stream', '.properties': 'text/plain',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

// PDF.js streams byte ranges and refuses to load a document from a server that
// does not advertise Accept-Ranges - hence this instead of a one-liner.
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  const st = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    res.writeHead(206, {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome, profile;
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) failures.push(name);
};

try {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  profile = path.join(os.tmpdir(), 'annot-restore-' + Date.now());
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1400,1000', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break; } catch { /* not up */ }
    await sleep(300);
  }
  const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const waiters = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++msgId; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      return '__ERR ' + String(r.result.exceptionDetails.exception?.description || '').split('\n')[0];
    }
    return r.result?.result?.value;
  };
  const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent',
    { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse' });

  await send('Runtime.enable');
  await send('Page.enable');
  // The uiManager is published once, at document load, so the hook has to be
  // installed before any page script runs.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__ui = null;
    (function poll() {
      try {
        const b = window.PDFViewerApplication && window.PDFViewerApplication.eventBus;
        if (b && !b.__h) { b.__h = 1; b.on('annotationeditoruimanager', (e) => { window.__ui = e.uiManager; }); }
      } catch (err) { /* not ready */ }
      if (!window.__ui) setTimeout(poll, 30);
    })();
  ` });

  // ---------------- PHASE 1: create a highlight like a user would ----------
  console.log('\nPHASE 1  create a highlight through the real UI');
  await send('Page.navigate', { url: VIEWER });
  await sleep(10000);
  check('AnnotationEditorUIManager reachable', (await ev('!!window.__ui')) === true);
  await ev('(async () => { await window.__ui.updateMode(9); return 1; })()'); // HIGHLIGHT
  await sleep(2000);
  await ev(`(() => {
    const tls = [...document.querySelectorAll('.textLayer')];
    const tl = tls.sort((a, b) => b.querySelectorAll('span').length - a.querySelectorAll('span').length)[0];
    const sp = [...tl.querySelectorAll('span')].filter((s) => s.textContent.trim().length > 8);
    (sp.find((s) => s.getBoundingClientRect().width > 60) || sp[0]).scrollIntoView({ block: 'center' });
    return 1;
  })()`);
  await sleep(1200);
  const t = JSON.parse(await ev(`(() => {
    const tls = [...document.querySelectorAll('.textLayer')];
    const tl = tls.sort((a, b) => b.querySelectorAll('span').length - a.querySelectorAll('span').length)[0];
    const sp = [...tl.querySelectorAll('span')].filter((s) => {
      const r = s.getBoundingClientRect();
      return s.textContent.trim().length > 8 && r.top > 140 && r.bottom < window.innerHeight - 140 && r.width > 60;
    });
    if (!sp.length) return 'null';
    const r = sp[0].getBoundingClientRect();
    return JSON.stringify({ x1: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2), x2: Math.round(r.right - 4) });
  })()`));
  check('found a text run to highlight', !!t);
  if (t) {
    await mouse('mouseMoved', t.x1, t.y, 0); await sleep(120);
    await mouse('mousePressed', t.x1, t.y, 1);
    for (let i = 1; i <= 15; i++) {
      await mouse('mouseMoved', Math.round(t.x1 + (t.x2 - t.x1) * i / 15), t.y, 1);
      await sleep(60);
    }
    await sleep(150);
    await mouse('mouseReleased', t.x2, t.y, 0);
    await sleep(3000);
  }
  const captured = JSON.parse(await ev(`(() => {
    const all = PDFViewerApplication.pdfDocument.annotationStorage.getAll() || {};
    const k = Object.keys(all)[0]; const e = all[k];
    if (!e) return JSON.stringify({ err: 'no editor created' });
    const rec = { ctor: e.constructor.name };
    try { rec.persisted = JSON.parse(JSON.stringify(e.serialize(false))); }
    catch (err) { rec.serializeThrew = String(err.message); }
    return JSON.stringify(rec);
  })()`));
  check('highlight created', !!captured.persisted, captured.ctor || captured.err);
  const payload = captured.persisted;

  // ---------------- PHASE 2: cold reopen, restore it ----------------------
  console.log('\nPHASE 2  cold reopen and restore the persisted payload');
  const restore = async (storage) => {
    await send('Page.navigate', { url: `${ORIGIN}/scripts/annot-restore-harness.html` });
    await sleep(1500);
    await ev(`window.__P = ${JSON.stringify(storage)};
      const fr = document.getElementById('fr');
      const post = () => fr.contentWindow.postMessage(
        { type: 'materioAnnotInit', annotations: { storage: window.__P } }, '*');
      window.addEventListener('message', (e) => { if (e.data && e.data.type === 'materioAnnotReady') post(); });
      let n = 0; const iv = setInterval(() => { n++; if (n > 40) clearInterval(iv);
        if (fr.contentWindow && fr.contentWindow.PDFViewerApplication && fr.contentWindow.PDFViewerApplication.pdfDocument) post(); }, 300);
      return 1;`);
    await sleep(22000);
    return ev(`(() => {
      const w = document.getElementById('fr').contentWindow;
      const all = w.PDFViewerApplication.pdfDocument.annotationStorage.getAll() || {};
      const k = Object.keys(all)[0]; const e = all[k];
      let serErr = null;
      if (e) { try { e.serialize(false); } catch (err) { serErr = String(err.message); } }
      return JSON.stringify({
        rendered: w.document.querySelectorAll('.annotationEditorLayer div').length,
        storage: Object.keys(all).length,
        serializeThrew: serErr,
        synced: Object.keys(window.__lastSync || {}).length,
      });
    })()`);
  };

  if (payload) {
    const r2 = JSON.parse(await restore({ pdf0178: payload }));
    check('editor restored and rendered', r2.storage > 0 && r2.rendered > 0,
      `storage=${r2.storage} divs=${r2.rendered}`);
    check('editor is serializable again', r2.serializeThrew === null, r2.serializeThrew || 'ok');
    check('sync reports the annotation (not an empty snapshot)', r2.synced === 1,
      `synced=${r2.synced}`);

    // ---------------- PHASE 3: the cycle must be stable -------------------
    console.log('\nPHASE 3  reopen using the payload phase 2 reported');
    const round2 = JSON.parse(await ev('JSON.stringify(window.__lastSync || null)'));
    check('phase 2 handed the parent a non-empty record', !!round2 && Object.keys(round2).length > 0,
      round2 ? `keys=${Object.keys(round2).join(',')}` : 'null');
    if (round2 && Object.keys(round2).length) {
      const r3 = JSON.parse(await restore(round2));
      check('second reopen still restores', r3.storage > 0 && r3.rendered > 0,
        `storage=${r3.storage} divs=${r3.rendered}`);
      check('second reopen still syncs 1 entry', r3.synced === 1, `synced=${r3.synced}`);
    }
  }
  ws.close();
} catch (err) {
  console.error('\nERROR', err);
  failures.push('harness crashed: ' + err.message);
} finally {
  try { chrome?.kill(); } catch { /* already gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
