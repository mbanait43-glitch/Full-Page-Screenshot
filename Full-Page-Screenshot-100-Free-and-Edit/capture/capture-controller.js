// capture/capture-controller.js: Central state machine and capture coordinator

import { AutoCaptureEngine } from './auto-capture.js';
import { ManualCaptureSession } from './manual-capture.js';
import { captureVisibleViewport } from './visible-capture.js';
import { processSelectedArea } from './area-capture.js';
import { sendTabMessage, MESSAGE_TYPES, isRestrictedUrl } from '../utils/messaging.js';

export const CAPTURE_STATE = {
  IDLE: 'IDLE',
  READY: 'READY',
  INITIALIZING: 'INITIALIZING',
  MEASURING: 'MEASURING',
  PREPARING: 'PREPARING',
  CAPTURING: 'CAPTURING',
  STITCHING: 'STITCHING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR'
};

export class CaptureController {
  constructor() {
    this.state = CAPTURE_STATE.IDLE;
    this.activeTask = null; // AutoCaptureEngine | ManualCaptureSession
    this.activeTabId = null;
    this.sessionId = null;
    this.sessionStartTime = null;
    this.lastStateTime = Date.now();
    this.statusMessage = '';
    this.listeners = new Set();
    this.watchdogTimer = null;
    this.WATCHDOG_TIMEOUT_MS = 10000;
  }

  onStateChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  startWatchdog(timeoutMs = 10000, reason = 'Operation timed out') {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      console.warn(`[CaptureController] Watchdog fired: ${reason} in state ${this.state}`);
      if (this.state !== CAPTURE_STATE.IDLE) {
        this.resetToIdle(`Timeout: ${reason}`);
      }
    }, timeoutMs);
  }

  clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  setState(newState, data = {}) {
    this.state = newState;
    this.lastStateTime = Date.now();
    if (data.message) {
      this.statusMessage = data.message;
    }

    // Manage watchdog timer based on lifecycle state
    if (newState === CAPTURE_STATE.INITIALIZING || newState === CAPTURE_STATE.PREPARING) {
      this.startWatchdog(8000, 'Initialization exceeded timeout');
    } else if (newState === CAPTURE_STATE.CAPTURING || newState === CAPTURE_STATE.STITCHING || newState === CAPTURE_STATE.PROCESSING) {
      this.startWatchdog(30000, 'Capture processing exceeded timeout');
    } else {
      this.clearWatchdog();
    }

    const eventType = newState === CAPTURE_STATE.COMPLETED ? MESSAGE_TYPES.CAPTURE_COMPLETED :
                      newState === CAPTURE_STATE.ERROR ? MESSAGE_TYPES.CAPTURE_ERROR :
                      MESSAGE_TYPES.CAPTURE_PROGRESS;

    const event = {
      type: eventType,
      state: newState,
      sessionId: this.sessionId,
      activeTabId: this.activeTabId,
      percent: data.percent,
      message: data.message || this.statusMessage,
      current: data.current,
      total: data.total,
      data,
      timestamp: Date.now()
    };

    // Broadcast to runtime extension views (e.g. popup.html GoFullPage-style status panel)
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      try {
        chrome.runtime.sendMessage(event).catch(() => {});
      } catch (e) {
        // Ignore if no receiving extension page is currently open
      }
    }

    for (const cb of this.listeners) {
      try { cb(event); } catch (e) { console.error('[CaptureController] Listener error:', e); }
    }
  }

  startSession(tabId) {
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.sessionStartTime = Date.now();
    this.activeTabId = tabId;
  }

  isStale(tabId = null) {
    if (this.state === CAPTURE_STATE.IDLE) return false;
    // Transient states should never linger over 8 seconds
    if ((this.state === CAPTURE_STATE.INITIALIZING || this.state === CAPTURE_STATE.PREPARING) && Date.now() - this.lastStateTime > 8000) {
      return true;
    }
    // Any capture state inactive for 60 seconds is stale
    if (Date.now() - this.lastStateTime > 60000) {
      return true;
    }
    return false;
  }

  resetToIdle(reason = '') {
    this.clearWatchdog();
    if (this.activeTask && typeof this.activeTask.cancel === 'function') {
      try { this.activeTask.cancel(); } catch (e) {}
    }
    this.activeTask = null;
    this.activeTabId = null;
    this.sessionId = null;
    this.statusMessage = '';
    this.setState(CAPTURE_STATE.IDLE, { reason });
  }

  assertTabAccessible(tab, allowRestricted = false) {
    if (!tab || !tab.id) {
      throw new Error('No valid active tab selected');
    }
    const url = tab.url || tab.pendingUrl || '';
    if (!allowRestricted && isRestrictedUrl(url)) {
      throw new Error('Chrome security policies do not allow extensions to capture internal browser pages or the Chrome Web Store.');
    }
  }

  getState(queryTabId = null) {
    if (this.isStale(queryTabId)) {
      this.resetToIdle('Stale capture session recovered');
    }

    // If queryTabId is specified and doesn't match activeTabId, report IDLE to that tab
    if (queryTabId && this.activeTabId && this.activeTabId !== queryTabId) {
      return {
        state: CAPTURE_STATE.IDLE,
        activeTabId: null,
        isOtherTabActive: true,
        sessionId: null
      };
    }

    return {
      state: this.state,
      activeTabId: this.activeTabId,
      sessionId: this.sessionId,
      message: this.statusMessage
    };
  }

  // 1. Trigger Auto Full Page Capture
  async startAutoCapture(tab) {
    const url = tab?.url || tab?.pendingUrl || '';
    if (isRestrictedUrl(url)) {
      // On restricted browser pages, automatic scrolling script injection is blocked by Chrome policy.
      // Fallback gracefully to supported visible area capture.
      return await this.startVisibleCapture(tab);
    }

    this.assertTabAccessible(tab);

    if (this.state !== CAPTURE_STATE.IDLE) {
      if (this.isStale(tab.id)) {
        this.resetToIdle('Previous stale session cleared');
      } else {
        throw new Error(`Capture already in progress (${this.state})`);
      }
    }

    this.startSession(tab.id);
    this.setState(CAPTURE_STATE.INITIALIZING, { message: 'Initializing auto capture...' });

    const engine = new AutoCaptureEngine(tab, (progress) => {
      this.setState(progress.status || CAPTURE_STATE.CAPTURING, progress);
    });
    this.activeTask = engine;

    try {
      const record = await engine.run();
      this.setState(CAPTURE_STATE.COMPLETED, { captureId: record.id });
      this.openResultPage(record.id);
      return record;
    } catch (err) {
      if (engine.isCancelled) {
        this.setState(CAPTURE_STATE.CANCELLED, { message: 'Capture cancelled' });
      } else {
        this.setState(CAPTURE_STATE.ERROR, { error: err.message });
      }
      throw err;
    } finally {
      this.resetToIdle();
    }
  }

  // 2. Trigger Visible Area Capture
  async startVisibleCapture(tab) {
    this.assertTabAccessible(tab, true);

    if (this.state !== CAPTURE_STATE.IDLE) {
      if (this.isStale(tab.id)) {
        this.resetToIdle('Previous stale session cleared');
      } else {
        throw new Error(`Capture already in progress (${this.state})`);
      }
    }

    this.startSession(tab.id);
    this.setState(CAPTURE_STATE.INITIALIZING, { message: 'Initializing visible capture...' });

    try {
      this.setState(CAPTURE_STATE.CAPTURING, { message: 'Capturing visible screen...' });
      const record = await captureVisibleViewport(tab);
      this.setState(CAPTURE_STATE.COMPLETED, { captureId: record.id });
      this.openResultPage(record.id);
      return record;
    } catch (err) {
      this.setState(CAPTURE_STATE.ERROR, { error: err.message });
      throw err;
    } finally {
      this.resetToIdle();
    }
  }

  // 3. Trigger Selected Area Capture (activates interactive overlay in tab)
  async startSelectedCapture(tab) {
    this.assertTabAccessible(tab);

    if (this.state !== CAPTURE_STATE.IDLE) {
      if (this.isStale(tab.id)) {
        this.resetToIdle('Previous stale session cleared');
      } else {
        throw new Error(`Capture already in progress (${this.state})`);
      }
    }

    this.startSession(tab.id);
    this.setState(CAPTURE_STATE.INITIALIZING, { message: 'Activating area selector...' });

    try {
      await sendTabMessage(tab.id, { type: MESSAGE_TYPES.ACTIVATE_AREA_SELECTOR });
      this.setState(CAPTURE_STATE.READY, { message: 'Select an area to capture' });
    } catch (err) {
      this.resetToIdle('Failed to activate area selector');
      throw err;
    }
  }

  // 3b. Trigger Text Extractor (activates interactive OCR overlay in tab)
  async startTextExtractor(tab) {
    this.assertTabAccessible(tab);

    if (this.state !== CAPTURE_STATE.IDLE) {
      if (this.isStale(tab.id)) {
        this.resetToIdle('Previous stale session cleared');
      } else {
        throw new Error(`Capture already in progress (${this.state})`);
      }
    }

    this.startSession(tab.id);
    this.setState(CAPTURE_STATE.INITIALIZING, { message: 'Activating text extractor...' });

    try {
      await sendTabMessage(tab.id, { type: MESSAGE_TYPES.ACTIVATE_TEXT_EXTRACTOR });
      this.setState(CAPTURE_STATE.READY, { message: 'Select an area to extract text' });
    } catch (err) {
      this.resetToIdle('Failed to activate text extractor');
      throw err;
    } finally {
      // Text extractor is an in-page tool; background controller resets to IDLE immediately
      this.resetToIdle();
    }
  }

  // Complete Selected Area Capture when coordinates received
  async finishSelectedAreaCapture(tab, rect) {
    this.setState(CAPTURE_STATE.PROCESSING, { message: 'Processing selected area...' });

    try {
      const record = await processSelectedArea(tab, rect);
      this.setState(CAPTURE_STATE.COMPLETED, { captureId: record.id });
      this.openResultPage(record.id);
      return record;
    } catch (err) {
      this.setState(CAPTURE_STATE.ERROR, { error: err.message });
      throw err;
    } finally {
      this.resetToIdle();
    }
  }

  // 4. Trigger Manual Full Page Capture
  async startManualCapture(tab) {
    this.assertTabAccessible(tab);

    if (this.state !== CAPTURE_STATE.IDLE) {
      if (this.isStale(tab.id)) {
        this.resetToIdle('Previous stale session cleared');
      } else {
        throw new Error(`Capture already in progress (${this.state})`);
      }
    }

    this.startSession(tab.id);
    this.setState(CAPTURE_STATE.INITIALIZING, { message: 'Starting manual capture session...' });

    try {
      const session = new ManualCaptureSession(tab, (update) => {
        this.setState(CAPTURE_STATE.CAPTURING, { message: `Captured ${update.count} sections`, count: update.count });
      });

      this.activeTask = session;
      await session.start();
      this.setState(CAPTURE_STATE.CAPTURING, { message: 'Manual capture active: scroll page to capture', count: 1 });
      return session;
    } catch (err) {
      this.resetToIdle('Failed to start manual capture');
      throw err;
    }
  }

  // Capture slice from manual scroll trigger
  async handleManualSlice(coords) {
    if (this.activeTask instanceof ManualCaptureSession) {
      return await this.activeTask.captureSlice(coords);
    }
  }

  // Stop manual session and stitch
  async stopAndStitchManual() {
    if (this.activeTask instanceof ManualCaptureSession) {
      this.setState(CAPTURE_STATE.STITCHING, { message: 'Stitching manual captures...' });
      try {
        const record = await this.activeTask.stopAndStitch();
        if (record) {
          this.setState(CAPTURE_STATE.COMPLETED, { captureId: record.id });
          this.openResultPage(record.id);
        }
        return record;
      } catch (err) {
        this.setState(CAPTURE_STATE.ERROR, { error: err.message });
        throw err;
      } finally {
        this.resetToIdle();
      }
    }
  }

  // Cancel any active capture
  async cancelCapture() {
    try {
      if (this.activeTask && typeof this.activeTask.cancel === 'function') {
        await this.activeTask.cancel();
      }
      if (this.activeTabId) {
        await sendTabMessage(this.activeTabId, { type: MESSAGE_TYPES.RESTORE_PAGE }).catch(() => {});
      }
    } finally {
      this.resetToIdle('Cancelled by user');
    }
  }

  // Open Result Page in new tab
  openResultPage(captureId) {
    const url = chrome.runtime.getURL(`result/result.html?id=${encodeURIComponent(captureId)}`);
    chrome.tabs.create({ url });
  }
}
