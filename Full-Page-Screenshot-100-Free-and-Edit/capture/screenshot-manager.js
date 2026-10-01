// capture/screenshot-manager.js: Rate-limited, resilient screenshot capture
// Enforces Chromium MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota compliance with automatic backoff retry

class ScreenshotManager {
  constructor() {
    this.lastCaptureTime = 0;
    this.minIntervalMs = 700; // Chromium quota allows max 2 calls/sec; 700ms provides safe headroom
    this.captureLock = Promise.resolve();
  }

  async captureVisibleTabSafe(windowId, options = { format: 'png' }) {
    // Chain onto captureLock so concurrent calls are strictly serialized
    return new Promise((resolve, reject) => {
      this.captureLock = this.captureLock.then(async () => {
        try {
          const result = await this._executeWithRetry(windowId, options);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async _executeWithRetry(windowId, options, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const now = Date.now();
      const elapsed = now - this.lastCaptureTime;

      // Enforce rate-limiting interval
      if (elapsed < this.minIntervalMs) {
        const waitTime = this.minIntervalMs - elapsed;
        await new Promise(r => setTimeout(r, waitTime));
      }

      try {
        this.lastCaptureTime = Date.now();
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, options);
        return dataUrl;
      } catch (err) {
        const errMsg = err ? (err.message || String(err)) : '';
        const isQuotaError = errMsg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') || errMsg.includes('quota');

        if (isQuotaError && attempt < maxRetries) {
          console.warn(`[ScreenshotManager] Hit capture quota, backing off (attempt ${attempt}/${maxRetries})...`);
          // Exponential backoff
          await new Promise(r => setTimeout(r, 800 * attempt));
          continue;
        }

        throw err;
      }
    }
  }

  async prepareSlot() {
    const elapsed = Date.now() - this.lastCaptureTime;
    if (elapsed < this.minIntervalMs) {
      const waitTime = this.minIntervalMs - elapsed;
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
}

export const screenshotManager = new ScreenshotManager();
export const captureVisibleTabSafe = (windowId, options) => screenshotManager.captureVisibleTabSafe(windowId, options);
export const prepareCaptureSlot = () => screenshotManager.prepareSlot();
