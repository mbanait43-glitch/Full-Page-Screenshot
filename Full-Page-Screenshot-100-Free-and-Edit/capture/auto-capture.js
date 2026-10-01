// capture/auto-capture.js: Orchestrates automated full page scroll-and-stitch capture
// Resilient to Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota and MV3 service worker scope

import { sendTabMessage, MESSAGE_TYPES, isRestrictedUrl } from '../utils/messaging.js';
import { ScreenshotStitcher } from './stitcher.js';
import { SegmentManager } from './segment-manager.js';
import { saveCapture, getSettings } from '../utils/storage.js';
import { captureVisibleTabSafe, prepareCaptureSlot } from './screenshot-manager.js';
import { canvasToBlob, blobToDataURL, createThumbnail } from '../utils/image-utils.js';

export class AutoCaptureEngine {
  constructor(tab, onProgress = () => {}) {
    this.tab = tab;
    this.onProgress = onProgress;
    this.isCancelled = false;
    this.segmentManager = new SegmentManager();
    this.stitcher = new ScreenshotStitcher();
  }

  cancel() {
    this.isCancelled = true;
  }

  async run() {
    const tabId = this.tab.id;
    const windowId = this.tab.windowId;

    // Check for restricted URLs
    const url = this.tab.url || this.tab.pendingUrl || '';
    if (isRestrictedUrl(url)) {
      throw new Error('This page is restricted by browser security policies and cannot be captured.');
    }

    try {
      this.onProgress({ status: 'PREPARING', message: 'Analyzing page dimensions...', percent: 5 });

      // Step 1: Prepare page & get initial metrics
      const metrics = await sendTabMessage(tabId, { type: MESSAGE_TYPES.PREPARE_PAGE });
      if (!metrics) {
        throw new Error('Could not retrieve webpage layout metrics.');
      }

      const viewportWidth = metrics.viewportWidth;
      const viewportHeight = metrics.viewportHeight;
      const dpr = metrics.devicePixelRatio || 1;
      let scrollHeight = metrics.scrollHeight;
      let maxScrollY = Math.max(0, scrollHeight - viewportHeight);

      // Estimate total slices
      let estimatedSlices = Math.max(1, Math.ceil(scrollHeight / viewportHeight));

      let currentY = 0;
      let sliceIndex = 0;
      const settings = await getSettings();
      // Ensure base delay gives browser time to render and complies with rate limits
      const baseDelay = Math.max(250, settings.scrollDelay || 250);

      // Show floating transparent Lottie capture indicator in tab
      await sendTabMessage(tabId, { type: 'SHOW_CAPTURE_LOADER' }).catch(() => {});

      while (!this.isCancelled) {
        sliceIndex++;
        const percent = Math.min(90, Math.round((sliceIndex / estimatedSlices) * 85) + 5);
        this.onProgress({
          status: 'CAPTURING',
          message: `Capturing section ${sliceIndex} of ${estimatedSlices}...`,
          current: sliceIndex,
          total: estimatedSlices,
          percent
        });

        // 1. Scroll page to currentY
        await sendTabMessage(tabId, {
          type: MESSAGE_TYPES.SCROLL_PAGE,
          y: currentY
        });

        // 2. Hide fixed/sticky elements for slices after the first
        if (currentY > 0) {
          await sendTabMessage(tabId, { type: MESSAGE_TYPES.HIDE_FIXED_ELEMENTS });
        }

        // 3. Wait for render & dynamic content AND ensure capture quota slot is ready
        // All waiting happens while the Lottie animation is 100% VISIBLE & ANIMATING smoothly!
        await Promise.all([
          new Promise(r => setTimeout(r, baseDelay)),
          prepareCaptureSlot()
        ]);

        // 4. Instantaneous Sub-Frame Isolation: Hide loader for ~15ms snapshot only (preserves animation timeline)
        await sendTabMessage(tabId, { type: 'HIDE_CAPTURE_LOADER' }).catch(() => {});

        // 5. Capture visible tab (executes immediately with 0 delay since slot was pre-waited)
        const dataUrl = await captureVisibleTabSafe(windowId, { format: 'png' });

        // 6. Seamless continuation: Restore loader immediately so Lottie keeps looping
        sendTabMessage(tabId, { type: 'SHOW_CAPTURE_LOADER' }).catch(() => {});

        this.segmentManager.addSegment({
          scrollX: 0,
          scrollY: currentY,
          viewportWidth,
          viewportHeight,
          devicePixelRatio: dpr,
          dataUrl
        });

        // Check if we reached or exceeded the bottom
        if (currentY >= maxScrollY) {
          break;
        }

        // 5. Check if page dynamically grew in height (lazy content expansion)
        const updatedMetrics = await sendTabMessage(tabId, { type: MESSAGE_TYPES.GET_PAGE_METRICS });
        if (updatedMetrics && updatedMetrics.scrollHeight > scrollHeight) {
          scrollHeight = updatedMetrics.scrollHeight;
          maxScrollY = Math.max(0, scrollHeight - viewportHeight);
          estimatedSlices = Math.max(sliceIndex + 1, Math.ceil(scrollHeight / viewportHeight));
        }

        // Next scroll step
        currentY = Math.min(maxScrollY, currentY + viewportHeight);
      }

      if (this.isCancelled) {
        throw new Error('Capture cancelled by user.');
      }

      // Step 2: Stitch all segments
      this.onProgress({ status: 'STITCHING', message: 'Stitching screenshot slices...', percent: 92 });
      const masterCanvas = await this.stitcher.stitchAutoSegments(
        this.segmentManager.getSegments(),
        { scrollWidth: metrics.scrollWidth, scrollHeight }
      );

      // Step 3: Convert canvas to Blob & DataURL
      this.onProgress({ status: 'PROCESSING', message: 'Finalizing high-resolution image...', percent: 97 });
      
      const mimeType = settings.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = settings.format === 'jpeg' ? (settings.jpegQuality || 0.92) : undefined;

      const finalBlob = await canvasToBlob(masterCanvas, mimeType, quality);
      const finalDataUrl = await blobToDataURL(finalBlob);

      // Step 4: Create thumbnail
      const thumbnail = await createThumbnail(masterCanvas, 320);

      // Step 5: Save capture record
      const captureRecord = await saveCapture({
        title: metrics.title || this.tab.title || 'Full Page Screenshot',
        url: metrics.url || this.tab.url || '',
        mode: 'auto',
        dimensions: {
          width: masterCanvas.width,
          height: masterCanvas.height,
          dpr
        },
        thumbnail,
        dataUrl: finalDataUrl,
        fileSize: finalBlob.size
      });

      this.onProgress({ status: 'COMPLETED', message: 'Capture complete!', percent: 100 });
      return captureRecord;

    } finally {
      // Guaranteed cleanup of capture loader and page state
      await sendTabMessage(tabId, { type: 'REMOVE_CAPTURE_LOADER' }).catch(() => {});
      await sendTabMessage(tabId, { type: MESSAGE_TYPES.RESTORE_PAGE }).catch(() => {});
    }
  }
}
