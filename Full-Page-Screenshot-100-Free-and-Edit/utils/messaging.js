// utils/messaging.js: Structured message protocol for PageSnap Pro

export const MESSAGE_TYPES = {
  // Capture triggers
  START_AUTO_CAPTURE: 'START_AUTO_CAPTURE',
  START_VISIBLE_CAPTURE: 'START_VISIBLE_CAPTURE',
  START_SELECTED_CAPTURE: 'START_SELECTED_CAPTURE',
  START_MANUAL_CAPTURE: 'START_MANUAL_CAPTURE',
  START_TEXT_EXTRACTOR: 'START_TEXT_EXTRACTOR',
  STOP_MANUAL_CAPTURE: 'STOP_MANUAL_CAPTURE',
  CANCEL_CAPTURE: 'CANCEL_CAPTURE',

  // Progress and lifecycle
  CAPTURE_PROGRESS: 'CAPTURE_PROGRESS',
  CAPTURE_COMPLETED: 'CAPTURE_COMPLETED',
  CAPTURE_ERROR: 'CAPTURE_ERROR',

  // Content script page operations
  PING: 'PING',
  GET_PAGE_METRICS: 'GET_PAGE_METRICS',
  SCROLL_PAGE: 'SCROLL_PAGE',
  PREPARE_PAGE: 'PREPARE_PAGE',
  RESTORE_PAGE: 'RESTORE_PAGE',
  HIDE_FIXED_ELEMENTS: 'HIDE_FIXED_ELEMENTS',
  SHOW_FIXED_ELEMENTS: 'SHOW_FIXED_ELEMENTS',

  // Selected area overlay & Text Extractor
  ACTIVATE_AREA_SELECTOR: 'ACTIVATE_AREA_SELECTOR',
  ACTIVATE_TEXT_EXTRACTOR: 'ACTIVATE_TEXT_EXTRACTOR',
  CAPTURE_OCR_CROP: 'CAPTURE_OCR_CROP',
  AREA_SELECTED: 'AREA_SELECTED',
  AREA_CANCELLED: 'AREA_CANCELLED',

  // Manual capture session
  ACTIVATE_MANUAL_HUD: 'ACTIVATE_MANUAL_HUD',
  UPDATE_MANUAL_COUNT: 'UPDATE_MANUAL_COUNT',
  DEACTIVATE_MANUAL_HUD: 'DEACTIVATE_MANUAL_HUD'
};

// Check if a URL or pending URL is restricted by browser security policies
export function isRestrictedUrl(url = '', pendingUrl = '') {
  const target = String(url || pendingUrl || '').trim();
  if (!target) return true; // Empty URL cannot be scripted
  const lower = target.toLowerCase();
  return (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-search://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('about:') ||
    lower.startsWith('data:') ||
    lower.startsWith('view-source:') ||
    lower.startsWith('devtools://') ||
    lower.includes('chrome.google.com/webstore') ||
    lower.includes('chromewebstore.google.com')
  );
}

// Timeout wrapper for async operations to prevent hung promises
export function withTimeout(promise, timeoutMs = 8000, timeoutMsg = 'Operation timed out') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// Send message to active tab content script with auto-injection fallback and timeout
export async function sendTabMessage(tabId, message, timeoutMs = 8000) {
  return withTimeout(
    (async () => {
      try {
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (err) {
        // If content script is not yet injected on this tab, inject it now
        if (err.message && (err.message.includes('Could not establish connection') || err.message.includes('Receiving end does not exist'))) {
          // Verify tab URL is not restricted before attempting script injection
          try {
            if (chrome.tabs && chrome.tabs.get) {
              const tab = await chrome.tabs.get(tabId);
              if (isRestrictedUrl(tab?.url, tab?.pendingUrl)) {
                throw new Error('Cannot inject scripts into restricted browser page');
              }
            }
          } catch (tabErr) {
            if (tabErr.message && tabErr.message.includes('restricted browser page')) {
              throw tabErr;
            }
          }

          if (chrome.scripting) {
            await chrome.scripting.insertCSS({
              target: { tabId },
              files: ['content/content.css']
            }).catch(() => {});

            await chrome.scripting.executeScript({
              target: { tabId },
              files: [
                'content/lottie_light.min.js',
                'content/timing-data.js',
                'content/content.js'
              ]
            });
          }

          // Brief pause then retry
          await new Promise(r => setTimeout(r, 80));
          return await chrome.tabs.sendMessage(tabId, message);
        }
        throw err;
      }
    })(),
    timeoutMs,
    `Messaging tab ${tabId} timed out after ${timeoutMs}ms`
  );
}

// Send message to runtime (background service worker) with timeout
export function sendRuntimeMessage(message, timeoutMs = 8000) {
  const p = new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
      } else {
        resolve(response);
      }
    });
  });
  return withTimeout(p, timeoutMs, `Runtime message (${message?.type || 'unknown'}) timed out after ${timeoutMs}ms`);
}

