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
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    } catch {
        return null;
    }
}

/** Fallback identity when bytes aren't available (e.g. blob: URLs). */
export async function hashPdfUrl(url) {
    if (!url) return null;
    try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('url:' + url));
        return 'url-' + Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
            .slice(0, 32);
    } catch {
        return null;
    }
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
