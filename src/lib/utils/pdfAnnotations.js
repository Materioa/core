// Per-PDF annotation sidecars ("meta", not the PDF itself).
// Each PDF is identified by the SHA-256 of its bytes, so annotations
// survive renames, URL changes and app updates. Stored in IndexedDB, which
// lives in the app's local WebView profile on desktop (Tauri), Android
// (Capacitor) and web alike — the PDF file itself is never modified.
//
// The stored snapshot is the viewer’s own annotation data
// (pdfDocument.annotationStorage: text, highlight, ink/draw, …), captured
// verbatim so the viewer can restore it exactly.
//
// Sidecar shape:
//   { pdfHash, pdfUrl, title, updatedAt, storage: { "<annotId>": {...} } }

const DB_NAME = 'MaterioPdfMetaDB';
const DB_VERSION = 1;
const STORE = 'annotations';

function openMetaDB() {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
            return reject(new Error('IndexedDB not supported'));
        }
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'pdfHash' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** SHA-256 hex of an ArrayBuffer (the PDF bytes). */
export async function hashPdfBuffer(buffer) {
    if (!buffer) return null;
    try {
        if (window.crypto?.subtle) {
            const digest = await crypto.subtle.digest('SHA-256', buffer);
            return Array.from(new Uint8Array(digest))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        }
    } catch {
        // fall through to non-crypto fallback below (Tauri/offline WebViews
        // may lack SubtleCrypto)
    }
    try {
        const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        return 'fnv-' + fnv1aHex(view) + '-' + view.length.toString(36);
    } catch {
        return null;
    }
}

/** Fallback identity when bytes aren't available (e.g. blob: URLs). */
export async function hashPdfUrl(url) {
    if (!url) return null;
    try {
        if (window.crypto?.subtle) {
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('url:' + url));
            return 'url-' + Array.from(new Uint8Array(digest))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
                .slice(0, 32);
        }
    } catch {
        // fall through to fallback below
    }
    try {
        const bytes = new TextEncoder().encode('url:' + url);
        return 'url-' + fnv1aHex(bytes);
    } catch {
        return null;
    }
}

/** FNV-1a 32-bit hex (x4 lanes for longer inputs). Sync fallback when
 *  SubtleCrypto is unavailable (desktop Tauri / insecure contexts). */
function fnv1aHex(bytes) {
    let h1 = 0x811c9dc5, h2 = 0x811c9dc5 ^ 0x9e3779b9, h3 = h2 ^ 0x85ebca6b, h4 = h3 ^ 0xc2b2ae35;
    const step = Math.max(1, Math.floor(bytes.length / 4096));
    for (let i = 0; i < bytes.length; i += step) {
        const b = bytes[i];
        h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ (b + 1), 0x01000193) >>> 0;
        h3 = Math.imul(h3 ^ (b + 7), 0x01000193) >>> 0;
        h4 = Math.imul(h4 ^ (b + 13), 0x01000193) >>> 0;
    }
    const hex = (n) => n.toString(16).padStart(8, '0');
    return hex(h1) + hex(h2) + hex(h3) + hex(h4);
}

export async function getPdfAnnotations(pdfHash) {
    if (!pdfHash) return null;
    try {
        const db = await openMetaDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(pdfHash);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

export async function savePdfAnnotations(doc) {
    if (!doc || !doc.pdfHash) return false;
    try {
        const db = await openMetaDB();
        const record = {
            pdfHash: doc.pdfHash,
            pdfUrl: doc.pdfUrl || '',
            title: doc.title || '',
            updatedAt: new Date().toISOString(),
            storage: doc.storage || {}
        };
        return await new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite');
            const req = tx.objectStore(STORE).put(record);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch {
        return false;
    }
}

export async function deletePdfAnnotations(pdfHash) {
    if (!pdfHash) return false;
    try {
        const db = await openMetaDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite');
            const req = tx.objectStore(STORE).delete(pdfHash);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch {
        return false;
    }
}

/** True when a sidecar doc actually contains at least one annotation. */
export function sidecarHasStrokes(doc) {
    if (!doc || !doc.storage) return false;
    return Object.keys(doc.storage).length > 0;
}
