const DB_NAME = 'MaterioOfflineDB';
const DB_VERSION = 2;
export const MAX_STORAGE_BYTES = 128 * 1024 * 1024; // 128MB cap

function openDB() {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
            return reject(new Error('IndexedDB not supported'));
        }
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            // Support parent store 'downloadedPDFs' or 'downloaded_pdfs'
            if (!db.objectStoreNames.contains('downloadedPDFs') && !db.objectStoreNames.contains('downloaded_pdfs')) {
                db.createObjectStore('downloadedPDFs', { keyPath: 'url' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function getStoreName(db) {
    if (db.objectStoreNames.contains('downloadedPDFs')) return 'downloadedPDFs';
    if (db.objectStoreNames.contains('downloaded_pdfs')) return 'downloaded_pdfs';
    return db.objectStoreNames[0] || 'downloadedPDFs';
}

export async function savePdfOffline(item, blob) {
    const existing = await getAllOfflinePdfs();
    let currentUsed = 0;
    for (const d of existing) {
        if (d.blob && d.blob.size) currentUsed += d.blob.size;
        else if (d.size) currentUsed += d.size;
        else if (d.fileSize) currentUsed += d.fileSize;
    }
    const blobSize = blob ? blob.size : 0;
    if (currentUsed + blobSize > MAX_STORAGE_BYTES) {
        throw new Error('Download limit reached (128MB max usable storage). Please delete some downloaded PDFs to free up space.');
    }

    const pdfUrl = item.pdfUrl || item.id || item.url;
    let arrayBuffer = null;
    if (blob) {
        try {
            arrayBuffer = await blob.arrayBuffer();
        } catch {}
    }

    const db = await openDB();
    const storeName = getStoreName(db);

    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const record = {
            url: pdfUrl,
            id: pdfUrl,
            title: item.title || item.topic,
            subject: item.subject,
            category: item.category,
            semester: item.semester,
            size: blobSize,
            fileSize: blobSize,
            mimeType: blob?.type || 'application/pdf',
            blob: blob,
            data: arrayBuffer,
            downloadedAt: Date.now(),
            savedAt: new Date().toISOString()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllOfflinePdfs() {
    try {
        const db = await openDB();
        const storeName = getStoreName(db);
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => {
                const results = (req.result || []).map(item => {
                    let blob = item.blob;
                    if (!blob && item.data) {
                        try {
                            blob = new Blob([item.data], { type: item.mimeType || 'application/pdf' });
                        } catch {}
                    }
                    return {
                        ...item,
                        id: item.id || item.url,
                        url: item.url || item.id,
                        pdfUrl: item.url || item.id,
                        size: item.size || item.fileSize || (blob ? blob.size : 0),
                        blob
                    };
                });
                resolve(results);
            };
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        return [];
    }
}

export async function deleteOfflinePdf(id) {
    const db = await openDB();
    const storeName = getStoreName(db);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

export async function isPdfOffline(pdfUrl) {
    if (!pdfUrl) return false;
    const item = await getOfflinePdf(pdfUrl);
    return !!item;
}

export async function getOfflinePdf(pdfUrl) {
    if (!pdfUrl) return null;
    try {
        const db = await openDB();
        const storeName = getStoreName(db);

        // 1. Try direct exact key lookup
        const directResult = await new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(pdfUrl);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });

        const normalizeRecord = (item) => {
            if (!item) return null;
            let blob = item.blob;
            if (!blob && item.data) {
                try {
                    blob = new Blob([item.data], { type: item.mimeType || 'application/pdf' });
                } catch {}
            }
            return {
                ...item,
                id: item.id || item.url,
                url: item.url || item.id,
                pdfUrl: item.url || item.id,
                size: item.size || item.fileSize || (blob ? blob.size : 0),
                blob
            };
        };

        if (directResult) {
            return normalizeRecord(directResult);
        }

        // 2. If direct lookup missed, check all records for URL variants or matching filename
        const allItems = await getAllOfflinePdfs();
        const cleanUrl = (u) => {
            if (!u) return '';
            try {
                return u.split('?')[0].split('#')[0].replace(/^https?:\/\//i, '').toLowerCase();
            } catch {
                return u;
            }
        };

        const targetClean = cleanUrl(pdfUrl);
        const targetFilename = pdfUrl.split('/').pop()?.split('?')[0]?.toLowerCase();

        for (const item of allItems) {
            const itemUrlClean = cleanUrl(item.url || item.id);
            if (itemUrlClean === targetClean) {
                return item;
            }
            const itemFilename = (item.url || item.id || '').split('/').pop()?.split('?')[0]?.toLowerCase();
            if (targetFilename && itemFilename && targetFilename === itemFilename && targetFilename.endsWith('.pdf')) {
                return item;
            }
        }

        return null;
    } catch {
        return null;
    }
}

