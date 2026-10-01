// capture/area-capture.js: Handles cropping and coordination for selected area capture
// Fully compatible with MV3 Service Worker and Chromium capture rate limits

import { saveCapture } from '../utils/storage.js';
import { captureVisibleTabSafe } from './screenshot-manager.js';
import { createCanvas, canvasToBlob, blobToDataURL, createThumbnail } from '../utils/image-utils.js';
import { isRestrictedUrl } from '../utils/messaging.js';

/**
 * Captures the viewport and crops to the specified rectangle
 * Returns the cropped dataUrl and physical dimensions
 */
export async function getCroppedSelectedRegion(tab, rect) {
  if (!tab || !tab.id) {
    throw new Error('No active browser tab found for selected area capture');
  }

  const url = tab.url || tab.pendingUrl || '';
  if (isRestrictedUrl(url)) {
    throw new Error('This page is restricted by browser security policies and cannot be captured.');
  }

  if (!rect || rect.width < 5 || rect.height < 5) {
    throw new Error('Selected region is too small to capture');
  }

  // 1. Capture the current visible viewport with rate-limit protection
  const fullDataUrl = await captureVisibleTabSafe(tab.windowId, { format: 'png' });

  // 2. Load into ImageBitmap to crop the selected area
  const response = await fetch(fullDataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  // Calculate scaling between CSS coordinates and physical screenshot bitmap
  const scaleX = bitmap.width / (rect.viewportWidth || tab.width || 1280);
  const scaleY = bitmap.height / (rect.viewportHeight || tab.height || 800);

  const cropX = Math.max(0, Math.round(rect.x * scaleX));
  const cropY = Math.max(0, Math.round(rect.y * scaleY));
  const cropW = Math.min(bitmap.width - cropX, Math.round(rect.width * scaleX));
  const cropH = Math.min(bitmap.height - cropY, Math.round(rect.height * scaleY));

  if (cropW <= 0 || cropH <= 0) {
    bitmap.close();
    throw new Error('Invalid crop coordinates');
  }

  const croppedCanvas = createCanvas(cropW, cropH);
  const ctx = croppedCanvas.getContext('2d');
  ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  bitmap.close();

  const croppedBlob = await canvasToBlob(croppedCanvas, 'image/png');
  const croppedDataUrl = await blobToDataURL(croppedBlob);

  return {
    croppedDataUrl,
    croppedCanvas,
    croppedBlob,
    width: cropW,
    height: cropH,
    dpr: scaleX
  };
}

export async function processSelectedArea(tab, rect) {
  const { croppedCanvas, croppedBlob, croppedDataUrl, width, height, dpr } = await getCroppedSelectedRegion(tab, rect);

  // Generate thumbnail
  const thumbnail = await createThumbnail(croppedCanvas, 320);

  const captureRecord = await saveCapture({
    title: (tab.title ? `${tab.title} (Selected)` : 'Selected Region'),
    url: tab.url || '',
    mode: 'selected',
    dimensions: { width, height, dpr },
    thumbnail,
    dataUrl: croppedDataUrl,
    fileSize: croppedBlob.size
  });

  return captureRecord;
}
