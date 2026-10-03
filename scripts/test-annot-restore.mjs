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
  await sleep(9000);
  check('AnnotationEditorUIManager reachable', (await ev('!!window.__ui')) === true);
  // ANNOT_MODE=ink reproduces the freehand "draw" tool, which serializes to
  // paths:{lines,points} - a different shape from a highlight's quadPoints.
  const MODE = (process.env.ANNOT_MODE || 'highlight').toLowerCase();
  const EDITOR_MODE = MODE === 'ink' ? 15 : 9;
  console.log(`  mode: ${MODE} (annotationEditorMode=${EDITOR_MODE})`);
  await ev(`(async () => { await window.__ui.updateMode(${EDITOR_MODE}); return 1; })()`);
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
  check('annotation created', !!captured.persisted, captured.ctor || captured.err);
  const payload = captured.persisted;

  // ---------------- PHASE 2: cold reopen, restore it ----------------------
  console.log('\nPHASE 2  cold reopen and restore the persisted payload');
  // Restore must inject its payload BEFORE the harness script runs, otherwise
  // the harness posts its own built-in sample on materioAnnotReady and the test
  // silently measures that instead of what it was given.
  //
  // CDP hands values back as JSON, which turns PDF.js's Float32Array quadPoints
  // into {"0":..,"1":..}. The app delivers these by structured clone
  // (postMessage / IndexedDB), where they stay real typed arrays. Revive them so
  // the payload under test matches what the reader actually gets - otherwise
  // deserialize() dies on `quadPoints[0]` and the test measures a malformed
  // payload rather than the product.
  let injected = null;
  const setPayload = async (storage) => {
    if (injected) { try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected }); } catch { /* gone */ } }
    const r = await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__P = ${JSON.stringify(storage)};
        (function reviveTypedArrays(o) {
          if (!o || typeof o !== 'object') return o;
          for (const k of Object.keys(o)) {
            const v = o[k];
            if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Float32Array)) {
              const keys = Object.keys(v);
              if (keys.length && keys.every((n) => /^\\d+$/.test(n))) {
                o[k] = new Float32Array(keys.map((n) => v[n]));
                continue;
              }
            }
            reviveTypedArrays(v);
          }
          return o;
        })(window.__P);`,
    });
    injected = r.result?.identifier || null;
  };

  const restore = async (storage, startPage) => {
    await setPayload(storage);
    await send('Page.navigate', { url: `${ORIGIN}/scripts/annot-restore-harness.html` + (startPage ? `?page=${startPage}` : '') });
    await sleep(1500);
    // Wait for the viewer's document to actually exist rather than assuming a
    // fixed load time - otherwise a slow start turns into a bogus failure.
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const ok = await ev(`(() => { try {
        const w = document.getElementById('fr').contentWindow;
        return !!(w && w.PDFViewerApplication && w.PDFViewerApplication.pdfDocument); } catch (e) { return false; } })()`);
      if (ok === true) { ready = true; break; }
      await sleep(500);
    }
    if (!ready) throw new Error('viewer document never became ready');
    await sleep(12000);
    const harnessLog = await ev('document.getElementById("log") ? document.getElementById("log").textContent : "NO LOG"');
    if (process.env.ANNOT_VERBOSE) {
      console.log('  harness log:');
      console.log(String(harnessLog).split('\n').filter((l) => !l.includes('snap fallback'))
        .map((l) => '    ' + l).join('\n'));
    }
    // Visibility, not DOM presence. A restored editor sitting inside the
    // layer's `hidden` container is present in the DOM and in
    // annotationStorage, serialises fine, and is completely invisible - which
    // is exactly what made an earlier version of this check pass while the
    // reader saw a blank page.
    //
    // The DrawLayer path is written asynchronously after deserialize, so a
    // single sample can catch the page mid-paint and report "nothing drawn"
    // for an annotation that appears a moment later. Poll for the paint rather
    // than fixing a longer sleep: the assertion is about the end state.
    const reportExpr = `(() => {
      const w = document.getElementById('fr').contentWindow;
      const wd = document.getElementById('fr').contentDocument;
      const all = w.PDFViewerApplication.pdfDocument.annotationStorage.getAll() || {};
      const k = Object.keys(all)[0]; const e = all[k];
      let serErr = null;
      if (e) { try { e.serialize(false); } catch (err) { serErr = String(err.message) + ' ||| ' + String(err.stack || '').split('\\n').slice(0,6).join(' << '); } }
      const pv = w.PDFViewerApplication.pdfViewer;
      const pvPage = pv.getPageView(e ? e.pageIndex : 0);
      const bld = pvPage && pvPage.annotationEditorLayer;
      const layer = bld && bld.annotationEditorLayer;
      const div = layer && layer.div;
      const edDiv = e && e.div;
      const r = edDiv && edDiv.getBoundingClientRect();
      const cs = edDiv && w.getComputedStyle(edDiv);
      let hiddenAncestor = null;
      for (let n = edDiv; n && n !== wd.body; n = n.parentElement) {
        if (n.hidden) { hiddenAncestor = n.className || n.tagName; break; }
      }
      let onTop = null, onTopNote = '';
      if (r && r.width > 1 && r.height > 1) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > wd.documentElement.clientWidth || cy > wd.documentElement.clientHeight) {
          // Scrolled out of the iframe's visible area. "Is it on top at its own
          // centre" is not a meaningful question for something nobody can see;
          // geometry and hidden-ancestor checks already cover real visibility.
          onTop = 'offscreen';
          onTopNote = ' centre=(' + Math.round(cx) + ',' + Math.round(cy) + ') vp=' +
            wd.documentElement.clientWidth + 'x' + wd.documentElement.clientHeight;
        } else {
          const t = wd.elementFromPoint(cx, cy);
          if (t) {
            const cls = typeof t.className === 'string' ? t.className : (t.className.baseVal || '');
            onTop = t.tagName + (cls ? '.' + String(cls).split(' ')[0] : '');
          } else onTop = 'nothing-here';
        }
      }
      let inLayer = 'n/a';
      try { inLayer = w.__ui ? w.__ui.getEditors(e.pageIndex).size : 'no ui'; } catch (x) { inLayer = 'err'; }
      let empty = 'n/a', rect = null;
      try { empty = e.isEmpty(); } catch (x) { empty = 'threw'; }
      try { const g = e.getRect(0, 0); rect = Array.from(g).map((n) => Math.round(n * 100) / 100); } catch (x) { /* n/a */ }
      // What the reader actually SEES. Highlights (box AND freehand) paint
      // through the page's DrawLayer - an <svg><defs><path/></defs><use/></svg>
      // that lives in the page's canvas wrapper, NOT inside editor.div. An SVG
      // path whose "d" attribute contains NaN does not render at all, and a fill
      // of "#undefinedundefinedundefined" is not a colour - both leave the
      // editor present, non-empty and serialising, yet invisible, so they have
      // to be measured directly instead of inferred from isEmpty().
      let paint = null;
      try {
        // The DrawLayer <svg> is classed "highlight" (+ "free" for freehand)
        // and lives in the page's canvas wrapper. Select it BY CLASS across the
        // whole document: scoping through editor.div.closest('.page') proved
        // flaky, because at sample time it can resolve to the placeholder
        // "page loadingIcon" element, which holds no DrawLayer at all - and the
        // check then reports "nothing is painted" for an annotation sitting on
        // the neighbouring page element.
        //
        // Deliberately NO fallback to "any svg path on the page": an unrelated
        // path with fill="none" would make a missing highlight look painted.
        const hlSvgs = [...wd.querySelectorAll('svg.highlight')];
        const paths = hlSvgs.flatMap((s) => [...s.querySelectorAll('path')]);
        const ds = paths.map((p) => p.getAttribute('d') || '').join(' ');
        const fills = [];
        for (const p of paths) {
          const f = w.getComputedStyle(p).fill;
          if (f) fills.push(f);
        }
        paint = {
          drawSvgs: hlSvgs.length,
          pages: wd.querySelectorAll('.page').length,
          svgPaths: paths.length,
          pathLen: ds.length,
          pathHasNaN: /NaN/.test(ds),
          pathHasUndefined: /undefined/.test(ds),
          fills,
          // A painted path must resolve to a real colour, never to
          // transparent / none / an unparsable string.
          hexOk: fills.length > 0 && fills.every((f) =>
            !/undefined|NaN|null|^none$|^transparent$/.test(f)),
        };
      } catch (x) { paint = { err: String(x && x.message) }; }
      return JSON.stringify({
        rendered: wd.querySelectorAll('.annotationEditorLayer div').length,
        storage: Object.keys(all).length,
        serializeThrew: serErr,
        synced: Object.keys(window.__lastSync || {}).length,
        layerDivHidden: div ? div.hidden : null,
        hiddenAncestor,
        editorRect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
        editorDisplay: cs ? cs.display : null,
        editorVisibility: cs ? cs.visibility : null,
        editorOpacity: cs ? cs.opacity : null,
        elementAtEditorCentre: onTop,
        onTopNote,
        ctor: e ? e.constructor.name : null,
        isEmpty: empty,
        attachedToDom: e ? !!e.isAttachedToDOM : null,
        parentIsLayer: e && layer ? e.parent === layer : null,
        layerHasViewport: layer ? !!layer.viewport : null,
        uiEditorsOnPage: inLayer,
        editorGetRect: rect,
        paint,
      });
    })()`;
    let rep = null;
    for (let i = 0; i < 8; i++) {
      const raw = await ev(reportExpr);
      rep = (typeof raw === 'string' && raw.startsWith('{')) ? JSON.parse(raw) : null;
      if (rep && rep.storage > 0 && rep.paint && rep.paint.svgPaths > 0) break;
      await sleep(1000);
    }
    return JSON.stringify(rep || { err: 'report never became valid' });
  };

  if (payload) {
    const r2 = JSON.parse(await restore({ pdf0178: payload }));
    check('editor restored into storage', r2.storage > 0, `storage=${r2.storage}`);
    check('editor is serializable again', r2.serializeThrew === null, r2.serializeThrew || 'ok');
    check('sync reports the annotation (not an empty snapshot)', r2.synced === 1,
      `synced=${r2.synced}`);
    // The regression that actually matched the bug report: an editor that is
    // present and serialisable but sitting in a hidden container, so the reader
    // sees nothing.
    check('editor layer is NOT hidden', r2.layerDivHidden === false,
      `layerDivHidden=${r2.layerDivHidden}`);
    check('no hidden ancestor on the editor element', r2.hiddenAncestor === null,
      `hiddenAncestor=${r2.hiddenAncestor}`);
    check('editor has real geometry', !!r2.editorRect && r2.editorRect.w > 1 && r2.editorRect.h > 1,
      JSON.stringify(r2.editorRect));
    check('editor is painted (display/visibility/opacity)',
      r2.editorDisplay !== 'none' && r2.editorVisibility !== 'hidden' &&
      r2.editorOpacity !== '0',
      `display=${r2.editorDisplay} visibility=${r2.editorVisibility} opacity=${r2.editorOpacity}`);
    check('editor is the top element at its own centre', !!r2.elementAtEditorCentre,
      `topEl=${r2.elementAtEditorCentre}`);

    // PHASE 2b: cold reopen landing on a DIFFERENT page than the annotation.
    // PDF.js restores the last-viewed page, so the page carrying an annotation
    // is often never drawn - and its AnnotationEditorLayerBuilder is only built
    // during drawing, which leaves deserialize with no target. Retrying alone
    // cannot fix that; the restore path has to force the page to render.
    console.log('\nPHASE 2b  cold reopen, viewer starts on the LAST page');
    const offEntry = Object.assign({}, payload, { pageIndex: 0 });
    const r2b = JSON.parse(await restore({ offPage: offEntry }, 3));
    check('annotation on an unrendered page still restores', r2b.storage > 0,
      `storage=${r2b.storage}`);
    check('unrendered-page annotation is not left hidden', r2b.layerDivHidden === false,
      `layerDivHidden=${r2b.layerDivHidden}`);
    check('unrendered-page annotation is reported in the sync', r2b.synced === 1,
      `synced=${r2b.synced}`);

    // PHASE 3 must run before the extra phases below, so move the ink phase
    // after it. (declared here for clarity; executed further down)
    console.log('\nPHASE 2c  freehand INK annotation');
    console.log('\nPHASE 2c  freehand INK annotation');
    // points-only: InkDrawOutliner.deserializeDraw() rebuilds its lines from
    // points when `lines` is absent, and each row must hold 2 or 4 numbers -
    // 6/12-wide rows are what PDF.js itself emits, padded with NaN, which JSON
    // cannot carry. points-only avoids NaN and exercises the same builder.
    const ink = {
      annotationType: 15,
      color: [0, 0, 0],
      opacity: 1,
      thickness: 2,
      paths: { points: [[100, 300], [220, 340], [400, 300]] },
      pageIndex: 0,
      rect: [100, 300, 400, 340],
      rotation: 0,
      structTreeParentId: null,
      id: null,
    };
    const ri = JSON.parse(await restore({ pdfjs_internal_editor_0: ink }));
    console.log('  ' + JSON.stringify(ri));
    check('ink annotation restores into storage', ri.storage > 0, `storage=${ri.storage}`);
    check('ink editor is not empty', ri.isEmpty === false, `isEmpty=${ri.isEmpty} ctor=${ri.ctor}`);
    check('ink editor is attached to the DOM', ri.attachedToDom === true, `attached=${ri.attachedToDom}`);
    check('ink editor belongs to the layer', ri.parentIsLayer === true, `parentIsLayer=${ri.parentIsLayer}`);
    check('ink layer has a viewport', ri.layerHasViewport === true, `viewport=${ri.layerHasViewport}`);
    check('ink layer is not hidden', ri.layerDivHidden === false, `layerDivHidden=${ri.layerDivHidden}`);
    check('ink editor has real geometry', !!ri.editorRect && ri.editorRect.w > 1 && ri.editorRect.h > 1,
      JSON.stringify(ri.editorRect));
    check('ink editor is the top element at its own centre',
      !!ri.elementAtEditorCentre && ri.elementAtEditorCentre !== 'nothing-here',
      `topEl=${ri.elementAtEditorCentre}${ri.onTopNote || ''}`);
    check('ink editor is serializable', ri.serializeThrew === null, ri.serializeThrew || 'ok');
    check('ink annotation is reported in the sync', ri.synced === 1, `synced=${ri.synced}`);
    // The synthetic ink payload must actually produce an InkEditor. If it does
    // not, this phase is measuring a leftover editor from an earlier phase and
    // every check above is meaningless.
    check('ink payload produced an InkEditor (not a leftover)', ri.ctor === 'InkEditor',
      `ctor=${ri.ctor}`);

    // ---------------- PHASE 3: the cycle must be stable -------------------
    // Read phase 2's result now, before later phases overwrite __lastSync.
    console.log('\nPHASE 3  reopen using the payload phase 2 reported');
    const round2 = JSON.parse(await ev('JSON.stringify(window.__lastSync || null)'));
    check('phase 2 handed the parent a non-empty record', !!round2 && Object.keys(round2).length > 0,
      round2 ? `keys=${Object.keys(round2).join(',')}` : 'null');
    if (round2 && Object.keys(round2).length) {
      const r3 = JSON.parse(await restore(round2));
      check('second reopen restores into storage', r3.storage > 0, `storage=${r3.storage}`);
      check('second reopen layer not hidden', r3.layerDivHidden === false,
        `layerDivHidden=${r3.layerDivHidden}`);
      check('second reopen editor has real geometry',
        !!r3.editorRect && r3.editorRect.w > 1 && r3.editorRect.h > 1, JSON.stringify(r3.editorRect));
      check('second reopen syncs 1 entry', r3.synced === 1, `synced=${r3.synced}`);
    }

    // PHASE 2d: a FREE (freehand) HIGHLIGHT - the exact shape found in the
    // reader's own annot-diag.log / IndexedDB dump:
    //     ctor=HIGHLIGHT fields=... quadPoints=null outlines=object ...
    //     outlines: { outline: [456 numbers incl. NaN sentinels],
    //                 points: [[x,y,x,y,... page coords]] }
    //
    // HighlightEditor.deserialize reads ONLY quadPoints and inkLists, so this
    // used to restore as a bare editor with no geometry: truthy deserialize,
    // successful addOrRebuild, unhidden layer, and nothing drawn. The old
    // workaround flattened `outlines.outline` - a cubic-bezier PATH whose NaNs
    // are sentinels - into stride-8 quads, which produced NaN geometry that no
    // SVG path can draw. The real stroke is `outlines.points[0]`, which is what
    // the inkLists branch consumes.
    console.log('\nPHASE 2d  freehand HIGHLIGHT (quadPoints=null, outlines={outline,points})');
    // outline: [NaN,NaN,NaN,NaN, x0,y0, c1x,c1y,c2x,c2y,x,y, ...] - exactly the
    // shape FreeDrawOutline.serialize writes. Deliberately full of NaNs so a
    // repair that copies them into geometry fails the assertions below.
    const bez = [NaN, NaN, NaN, NaN, 120, 640];
    for (let i = 0; i < 20; i++) {
      const x = 120 + i * 4;
      bez.push(x + 1, 641, x + 2, 642, x + 4, 640 + ((i % 3) * 4));
    }
    // points: the authoritative stroke polyline, page coordinates, flat.
    const strokePts = [];
    for (let i = 0; i < 24; i++) strokePts.push(120 + i * 4, 640 + ((i % 3) * 4));
    const freeHl = {
      annotationType: 9,
      color: [255, 235, 59],
      opacity: 1,
      thickness: 12,
      quadPoints: null,
      outlines: { outline: bez, points: [strokePts] },
      pageIndex: 0,
      rect: [120, 636, 216, 656],
      rotation: 0,
      structTreeParentId: null,
      id: null,
    };
    const rf = JSON.parse(await restore({ pdfjs_internal_editor_0: freeHl }));
    console.log('  ' + JSON.stringify(rf));
    check('free highlight restores into storage', rf.storage > 0, `storage=${rf.storage}`);
    check('free highlight editor is not empty', rf.isEmpty === false, `isEmpty=${rf.isEmpty}`);
    check('free highlight editor is attached to the DOM', rf.attachedToDom === true,
      `attached=${rf.attachedToDom}`);
    check('free highlight layer is not hidden', rf.layerDivHidden === false,
      `layerDivHidden=${rf.layerDivHidden}`);
    check('free highlight has real geometry',
      !!rf.editorRect && rf.editorRect.w > 1 && rf.editorRect.h > 1, JSON.stringify(rf.editorRect));
    check('free highlight is reported in the sync', rf.synced === 1, `synced=${rf.synced}`);
    // The actual visibility assertions: the restored stroke must be drawn as an
    // SVG path with no NaN in it (a NaN `d` renders NOTHING), and its fill must
    // be a real colour, not "#undefinedundefinedundefined".
    check('free highlight paints an SVG path', !!rf.paint && rf.paint.svgPaths > 0,
      JSON.stringify(rf.paint));
    check('painted path has no NaN/undefined',
      !!rf.paint && rf.paint.pathHasNaN === false && rf.paint.pathHasUndefined === false,
      `NaN=${rf.paint && rf.paint.pathHasNaN} undefined=${rf.paint && rf.paint.pathHasUndefined}`);
    check('painted colour is valid', !!rf.paint && rf.paint.hexOk === true,
      JSON.stringify(rf.paint && rf.paint.fills));
    // Re-serializing a restored highlight can still throw inside PDF.js
    // (#serializeOutlines walks outlines that were never rebuilt). That is
    // expected and is exactly what the restoredFallback entry exists for - what
    // must NOT happen is the record being blanked. synced === 1 above is that
    // guarantee, so assert the editor is non-empty and present rather than
    // demanding a clean serialize.
    check('free highlight survives a snapshot round-trip', rf.storage > 0 && rf.isEmpty === false,
      `serializeThrew=${rf.serializeThrew || 'none'}`);

    // PHASE 2e: a LEGACY capture - the two shapes older builds wrote, plus a
    // colour that no longer is three integers. All of it used to either throw
    // in deserialize (retried forever) or come back with
    // fill="#undefinedundefinedundefined" (present, serialising, invisible).
    console.log('\nPHASE 2e  legacy outline-rows capture + broken colour');
    const legacy = {
      annotationType: 9,
      color: '#ffeb3b',            // string, not [255,235,59]
      opacity: 'not-a-number',
      thickness: undefined,
      quadPoints: null,
      outlines: [                  // bare ARRAY of polygon rows
        [120, 700, 200, 700, 120, 720, 200, 720],
        [120, 730, 200, 730, 120, 750, 200, 750],
      ],
      pageIndex: 0,
      rect: [120, 700, 200, 750],
      rotation: 0,
      structTreeParentId: null,
      id: null,
    };
    const rl = JSON.parse(await restore({ pdfjs_internal_editor_0: legacy }));
    console.log('  ' + JSON.stringify(rl));
    check('legacy capture restores into storage', rl.storage > 0, `storage=${rl.storage}`);
    check('legacy editor is not empty', rl.isEmpty === false, `isEmpty=${rl.isEmpty}`);
    check('legacy layer is not hidden', rl.layerDivHidden === false,
      `layerDivHidden=${rl.layerDivHidden}`);
    check('legacy editor has real geometry',
      !!rl.editorRect && rl.editorRect.w > 1 && rl.editorRect.h > 1, JSON.stringify(rl.editorRect));
    check('legacy capture is reported in the sync', rl.synced === 1, `synced=${rl.synced}`);
    check('legacy capture paints', !!rl.paint && rl.paint.svgPaths > 0,
      JSON.stringify(rl.paint));
    // The repaired colour must be the one that was asked for (#ffed3b), not the
    // highlight default and not an unparsable string.
    check('legacy colour repaired to the saved colour',
      !!rl.paint && rl.paint.fills.some((f) => f.replace(/\s/g, '') === 'rgb(255,235,59)'),
      JSON.stringify(rl.paint && rl.paint.fills));
    check('legacy capture has no NaN in its path',
      !!rl.paint && rl.paint.pathHasNaN === false && rl.paint.pathHasUndefined === false,
      `NaN=${rl.paint && rl.paint.pathHasNaN}`);
    check('legacy capture serialises', rl.serializeThrew === null, rl.serializeThrew || 'ok');
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

