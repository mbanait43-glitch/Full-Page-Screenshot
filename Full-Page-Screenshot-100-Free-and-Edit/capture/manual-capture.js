// capture/manual-capture.js: Orchestrates interactive manual scrolling capture sessions
// Resilient to Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota and MV3 service worker scope

import { sendTabMessage, MESSAGE_TYPES, isRestrictedUrl } from '../utils/messaging.js';
import { ScreenshotStitcher } from './stitcher.js';
import { SegmentManager } from './segment-manager.js';
import { saveCapture, getSettings } from '../utils/storage.js';
import { captureVisibleTabSafe } from './screenshot-manager.js';
import { canvasToBlob, blobToDataURL, createThumbnail } from '../utils/image-utils.js';

export class ManualCaptureSession {
  constructor(tab, onUpdate = () => {}) {
    this.tab = tab;
    this.onUpdate = onUpdate;
    this.isActive = false;
    this.segmentManager = new SegmentManager();
    this.stitcher = new ScreenshotStitcher();
    this.tabId = tab.id;
    this.windowId = tab.windowId;
  }

  // Start the manual capture session
  async start() {
    const url = this.tab.url || this.tab.pendingUrl || '';
    if (isRestrictedUrl(url)) {
      throw new Error('This page is restricted by browser security policies and cannot be captured.');
    }

    this.isActive = true;
    this.segmentManager.clear();

    // 1. Prepare page in content script
    const metrics = await sendTabMessage(this.tabId, { type: MESSAGE_TYPES.PREPARE_PAGE });

    // 2. Activate floating HUD on webpage
    await sendTabMessage(this.tabId, {
      type: MESSAGE_TYPES.ACTIVATE_MANUAL_HUD,
      initialCount: 1
    });

    // 3. Take initial slice at current position
    await this.captureSlice({
      scrollX: metrics.scrollX || 0,
      scrollY: metrics.scrollY || 0,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      devicePixelRatio: metrics.devicePixelRatio || 1
    });

    return { sessionId: this.tabId, initialCount: 1 };
  }

  // Capture a single slice when triggered by manual scroll in content script
  async captureSlice(coords) {
    if (!this.isActive) return;

    // Small settle tick
    await new Promise(r => setTimeout(r, 60));

    // Temporarily hide any loader from slice
    await sendTabMessage(this.tabId, { type: 'HIDE_CAPTURE_LOADER' }).catch(() => {});

    // Rate-limited capture safe against Chrome's quota limit
    const dataUrl = await captureVisibleTabSafe(this.windowId, { format: 'png' });

    const segment = this.segmentManager.addSegment({
      scrollX: coords.scrollX,
      scrollY: coords.scrollY,
      viewportWidth: coords.viewportWidth,
      viewportHeight: coords.viewportHeight,
      devicePixelRatio: coords.devicePixelRatio || 1,
      dataUrl
    });

    const count = this.segmentManager.count();

    // Update HUD on webpage
    await sendTabMessage(this.tabId, {
      type: MESSAGE_TYPES.UPDATE_MANUAL_COUNT,
      count
    }).catch(() => {});

    this.onUpdate({ count, latestSegment: segment });
    return segment;
  }

  // Finish manual capture and stitch all segments
  async stopAndStitch() {
    if (!this.isActive) return null;
    this.isActive = false;

    try {
      // Deactivate HUD
      await sendTabMessage(this.tabId, { type: MESSAGE_TYPES.DEACTIVATE_MANUAL_HUD }).catch(() => {});

      const segments = this.segmentManager.getSegments();
      if (segments.length === 0) {
        throw new Error('No segments were captured during the manual session.');
      }

      // Stitch segments using spatial stitcher (supports Service Worker execution)
      const masterCanvas = await this.stitcher.stitchManualSegments(segments);

      const settings = await getSettings();
      const mimeType = settings.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = settings.format === 'jpeg' ? (settings.jpegQuality || 0.92) : undefined;

      const finalBlob = await canvasToBlob(masterCanvas, mimeType, quality);
      const finalDataUrl = await blobToDataURL(finalBlob);

      // Create thumbnail
      const thumbnail = await createThumbnail(masterCanvas, 320);

      // Save capture record
      const captureRecord = await saveCapture({
        title: (this.tab.title ? `${this.tab.title} (Manual)` : 'Manual Full Page Capture'),
        url: this.tab.url || '',
        mode: 'manual',
        dimensions: {
          width: masterCanvas.width,
          height: masterCanvas.height,
          dpr: segments[0].devicePixelRatio || 1
        },
        thumbnail,
        dataUrl: finalDataUrl,
        fileSize: finalBlob.size
      });

      return captureRecord;

    } finally {
      await sendTabMessage(this.tabId, { type: MESSAGE_TYPES.RESTORE_PAGE }).catch(() => {});
    }
  }

  // Cancel session without saving
  async cancel() {
    this.isActive = false;
    this.segmentManager.clear();
    await sendTabMessage(this.tabId, { type: MESSAGE_TYPES.DEACTIVATE_MANUAL_HUD }).catch(() => {});
    await sendTabMessage(this.tabId, { type: MESSAGE_TYPES.RESTORE_PAGE }).catch(() => {});
  }
}
