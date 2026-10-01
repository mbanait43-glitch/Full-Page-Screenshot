// utils/storage.js: Unified storage layer for PageSnap Pro
// Handles settings via chrome.storage.local/sync and screenshots/history via IndexedDB (for large blobs)

export const DEFAULT_SETTINGS = {
  format: 'png',            // 'png' | 'jpeg'
  jpegQuality: 0.92,        // 0.60 (low) | 0.80 (med) | 0.92 (high) | 1.0 (max)
  scrollDelay: 200,         // ms wait after scroll for render
  lazyLoadWait: 300,        // ms max extra wait for dynamic/lazy content
  pdfPageSize: 'a4',        // 'a4' | 'letter' | 'continuous'
  pdfOrientation: 'portrait', // 'portrait' | 'landscape'
  pdfMargin: 10,            // mm
  autoDownload: false,      // direct download vs open result page
  includeMetadataHeader: false, // add URL and date bar to top of exported image
  metadataFormat: 'datetime', // 'date' | 'datetime' | 'iso'
  maxHistoryItems: 50
};

const DB_NAME = 'PageSnapProDB';
const DB_VERSION = 1;
const CAPTURES_STORE = 'captures';

let dbInstance = null;

export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(CAPTURES_STORE)) {
        const store = db.createObjectStore(CAPTURES_STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('url', 'url', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });
}

// Save a captured screenshot to IndexedDB
export async function saveCapture(capture) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURES_STORE, 'readwrite');
    const store = tx.objectStore(CAPTURES_STORE);
    
    // Ensure capture has required properties
    const record = {
      id: capture.id || ('snap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
      title: capture.title || 'Untitled Screenshot',
      url: capture.url || '',
      mode: capture.mode || 'auto', // 'auto', 'visible', 'selected', 'manual'
      timestamp: capture.timestamp || new Date().toISOString(),
      dimensions: capture.dimensions || { width: 0, height: 0, dpr: 1 },
      thumbnail: capture.thumbnail || '', // Base64 data URL preview
      dataUrl: capture.dataUrl || '',     // Full image dataUrl or blob
      blob: capture.blob || null,
      fileSize: capture.fileSize || 0
    };

    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

// Get capture by ID
export async function getCapture(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURES_STORE, 'readonly');
    const store = tx.objectStore(CAPTURES_STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Get all captures ordered by timestamp desc
export async function getAllCaptures(limit = 100) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURES_STORE, 'readonly');
    const store = tx.objectStore(CAPTURES_STORE);
    const index = store.index('timestamp');
    const req = index.openCursor(null, 'prev');
    const list = [];

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && list.length < limit) {
        // Return without heavy full dataUrl for fast listing
        const val = cursor.value;
        list.push({
          id: val.id,
          title: val.title,
          url: val.url,
          mode: val.mode,
          timestamp: val.timestamp,
          dimensions: val.dimensions,
          thumbnail: val.thumbnail,
          fileSize: val.fileSize
        });
        cursor.continue();
      } else {
        resolve(list);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// Delete capture by ID
export async function deleteCapture(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURES_STORE, 'readwrite');
    const store = tx.objectStore(CAPTURES_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Clear all captures
export async function clearAllCaptures() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CAPTURES_STORE, 'readwrite');
    const store = tx.objectStore(CAPTURES_STORE);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Settings management
export async function getSettings() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ pagesnap_settings: DEFAULT_SETTINGS }, (result) => {
        resolve({ ...DEFAULT_SETTINGS, ...result.pagesnap_settings });
      });
    } else {
      resolve(DEFAULT_SETTINGS);
    }
  });
}

export async function saveSettings(newSettings) {
  const current = await getSettings();
  const merged = { ...current, ...newSettings };
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ pagesnap_settings: merged }, () => resolve(merged));
    } else {
      resolve(merged);
    }
  });
}
