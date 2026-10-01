// capture/visible-capture.js: Instant capture of the visible browser viewport
// Universal compatibility with Service Worker environment and Chromium quota compliance

import { saveCapture } from '../utils/storage.js';
import { createThumbnail } from '../utils/image-utils.js';
import { sendTabMessage, MESSAGE_TYPES, isRestrictedUrl } from '../utils/messaging.js';
import { captureVisibleTabSafe } from './screenshot-manager.js';

export async function captureVisibleViewport(tab) {
  if (!tab || !tab.id) {
    throw new Error('No active browser tab found for visible capture');
  }

  const url = tab.url || tab.pendingUrl || '';
  const isRestricted = isRestrictedUrl(url);

  // Get metrics from page if available
  let metrics = {
    title: tab.title || (isRestricted ? 'Browser Viewport' : 'Visible Viewport'),
    url: url || '',
    viewportWidth: tab.width || 1280,
    viewportHeight: tab.height || 800,
    devicePixelRatio: 1
  };

  if (!isRestricted) {
    try {
      const pageMetrics = await sendTabMessage(tab.id, { type: MESSAGE_TYPES.GET_PAGE_METRICS });
      if (pageMetrics) {
        metrics = pageMetrics;
      }
    } catch (err) {
      // If content script cannot be queried, proceed with tab info
    }

    // Ensure any floating loader is hidden before screenshot capture
    await sendTabMessage(tab.id, { type: 'HIDE_CAPTURE_LOADER' }).catch(() => {});
  }

  // Capture visible viewport via rate-limited Chrome API
  let dataUrl;
  try {
    dataUrl = await captureVisibleTabSafe(tab.windowId, { format: 'png' });
  } catch (err) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes('Cannot access') || errMsg.includes('restricted') || errMsg.includes('security') || errMsg.includes('permission')) {
      throw new Error(`Chrome security policies do not allow capturing this page (${url || 'internal page'}).`);
    }
    throw err;
  }

  // Generate thumbnail and dimensions via ImageBitmap
  let thumbnail = '';
  let dimensions = { width: metrics.viewportWidth, height: metrics.viewportHeight, dpr: metrics.devicePixelRatio };

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    dimensions.width = bitmap.width;
    dimensions.height = bitmap.height;
    dimensions.dpr = metrics.devicePixelRatio || (bitmap.width / metrics.viewportWidth);

    thumbnail = await createThumbnail(bitmap, 320);
    bitmap.close();
  } catch (e) {
    thumbnail = dataUrl;
  }

  // Save to IndexedDB
  const captureRecord = await saveCapture({
    title: metrics.title,
    url: metrics.url,
    mode: 'visible',
    dimensions,
    thumbnail,
    dataUrl,
    fileSize: Math.round(dataUrl.length * 0.75)
  });

  return captureRecord;
}
