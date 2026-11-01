import { browser } from '$app/environment';
import { getUserData } from './profile-image.js';

const DB_NAME = 'materio_wallpaper_db';
const DB_VERSION = 1;
const STORE_NAME = 'custom_wallpapers';
const ACTIVE_ID_KEY = 'materio_active_custom_id';
const LEGACY_KEY = 'materio_custom_wallpaper';
const LEGACY_STORE_KEY = 'materio_custom_wallpaper_store';

let dbPromise = null;

function getDb() {
  if (!browser || typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

/**
 * Returns max wallpapers allowed:
 * 50 for plus, pro, and admin users
 * 10 for normal / free users
 */
export function getMaxWallpapers() {
  if (!browser) return 10;
  try {
    const user = getUserData();
    if (user && (user.hasAdminPrivileges || user.isAdmin || user.isProUser || user.isPlusUser || user.isLiteUser)) {
      return 50;
    }
  } catch {}
  return 10;
}

/**
 * Create a compressed thumbnail from dataUrl for fast rendering in the store grid
 */
function createThumbnail(dataUrl, maxDimension = 320) {
  return new Promise((resolve) => {
    if (!browser || typeof Image === 'undefined') return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > maxDimension) {
          h = Math.round((h * maxDimension) / w);
          w = maxDimension;
        }
      } else {
        if (h > maxDimension) {
          w = Math.round((w * maxDimension) / h);
          h = maxDimension;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        try {
          return resolve(canvas.toDataURL('image/webp', 0.82));
        } catch {
          return resolve(canvas.toDataURL('image/jpeg', 0.82));
        }
      }
      resolve(dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Get all stored custom wallpapers
 */
export async function getAllCustomWallpapers() {
  const db = await getDb();
  if (!db) return [];

  // Check if we need to migrate legacy localStorage wallpapers
  await migrateLegacyWallpapers(db);

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    } catch (err) {
      resolve([]);
    }
  });
}

/**
 * Save new custom wallpaper
 */
export async function addCustomWallpaper(dataUrl, name = 'Custom Wallpaper') {
  const max = getMaxWallpapers();
  const existing = await getAllCustomWallpapers();
  if (existing.length >= max) {
    return {
      success: false,
      reason: 'limit_reached',
      count: existing.length,
      max
    };
  }

  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const id = `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const thumbnailUrl = await createThumbnail(dataUrl, 320);

  const record = {
    id,
    name: name || `Custom ${existing.length + 1}`,
    dataUrl,
    thumbnailUrl: thumbnailUrl || dataUrl,
    createdAt: Date.now()
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });

  setActiveCustomWallpaperId(id);
  return { success: true, wallpaper: record, count: existing.length + 1, max };
}

/**
 * Delete a custom wallpaper by id
 */
export async function deleteCustomWallpaper(id) {
  const db = await getDb();
  if (!db) return false;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });

  const activeId = getActiveCustomWallpaperId();
  if (activeId === id) {
    const all = await getAllCustomWallpapers();
    if (all.length > 0) {
      setActiveCustomWallpaperId(all[0].id);
    } else {
      if (browser) {
        localStorage.removeItem(ACTIVE_ID_KEY);
      }
    }
  }

  return true;
}

/**
 * Set active custom wallpaper id
 */
export function setActiveCustomWallpaperId(id) {
  if (!browser) return;
  try {
    localStorage.setItem(ACTIVE_ID_KEY, id);
    window.dispatchEvent(new CustomEvent('materioCustomWallpaperActiveChange', { detail: { id } }));
  } catch {}
}

/**
 * Get active custom wallpaper id
 */
export function getActiveCustomWallpaperId() {
  if (!browser) return null;
  try {
    return localStorage.getItem(ACTIVE_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * Get the currently active custom wallpaper record
 */
export async function getActiveCustomWallpaper() {
  const activeId = getActiveCustomWallpaperId();
  const all = await getAllCustomWallpapers();
  if (!all || all.length === 0) return null;
  if (activeId) {
    const found = all.find((w) => w.id === activeId);
    if (found) return found;
  }
  return all[0];
}

/**
 * Migrate legacy localStorage wallpapers to IndexedDB
 */
async function migrateLegacyWallpapers(db) {
  if (!browser) return;
  try {
    const legacySingle = localStorage.getItem(LEGACY_KEY);
    const legacyStoreStr = localStorage.getItem(LEGACY_STORE_KEY);

    let legacyItems = [];
    if (legacyStoreStr) {
      try {
        legacyItems = JSON.parse(legacyStoreStr);
      } catch {}
    }

    if (legacySingle && (!legacyItems || legacyItems.length === 0)) {
      legacyItems.push({
        id: `cw_migrated_single`,
        name: 'My Wallpaper',
        dataUrl: legacySingle,
        createdAt: Date.now()
      });
    }

    if (Array.isArray(legacyItems) && legacyItems.length > 0) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const item of legacyItems) {
        if (item && (item.dataUrl || item.imageUrl)) {
          const id = item.id || `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          const dataUrl = item.dataUrl || item.imageUrl;
          store.put({
            id,
            name: item.name || 'Custom Wallpaper',
            dataUrl,
            thumbnailUrl: item.thumbnailUrl || dataUrl,
            createdAt: item.createdAt || Date.now()
          });
        }
      }

      // Cleanup large localStorage strings to avoid QuotaExceededError in mobile/desktop WebViews
      localStorage.removeItem(LEGACY_STORE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch (err) {
    console.warn('Legacy wallpaper migration warning:', err);
  }
}
