// utils/image-utils.js: Image transformations, blob handling, and thumbnail generation
// Universal compatibility: functions seamlessly in both Service Worker (MV3) and DOM Window contexts

// Universal Canvas creator
export function createCanvas(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error('Canvas is not supported in this runtime environment');
}

// Universal Canvas to Blob
export async function canvasToBlob(canvas, mimeType = 'image/png', quality = 0.92) {
  if (canvas.convertToBlob) {
    const opts = { type: mimeType };
    if (mimeType === 'image/jpeg') opts.quality = quality;
    return await canvas.convertToBlob(opts);
  }

  if (canvas.toBlob) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    });
  }

  throw new Error('Canvas conversion to Blob not supported on this canvas type');
}

// Convert Data URL to Blob (works in both Service Worker and Window)
export function dataURLToBlob(dataURL) {
  const parts = dataURL.split(';base64,');
  const contentType = parts[0].split(':')[1];
  const raw = atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], { type: contentType });
}

// Convert Blob to Data URL (works in both Service Worker and Window)
export async function blobToDataURL(blob) {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } else {
    // Service Worker fallback: arrayBuffer -> base64
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  }
}

// Universal Image loader: loads an ImageBitmap in Service Workers, or ImageBitmap/Image in DOM
export async function loadImage(src) {
  // 1. If createImageBitmap is available (available in ServiceWorker and Modern Browsers)
  if (typeof createImageBitmap !== 'undefined') {
    let blob;
    if (src.startsWith('data:')) {
      blob = dataURLToBlob(src);
    } else {
      const response = await fetch(src);
      blob = await response.blob();
    }
    return await createImageBitmap(blob);
  }

  // 2. DOM Window fallback (HTMLImageElement)
  if (typeof Image !== 'undefined') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('Failed to load image: ' + (e.message || 'unknown error')));
      img.src = src;
    });
  }

  throw new Error('Image decoding is not supported in this runtime environment');
}

// Universal thumbnail generator
export async function createThumbnail(source, maxDim = 320) {
  const srcW = source.width || source.naturalWidth;
  const srcH = source.height || source.naturalHeight;

  let dstW = srcW;
  let dstH = srcH;

  if (dstW > maxDim || dstH > maxDim) {
    const scale = Math.min(maxDim / dstW, maxDim / dstH);
    dstW = Math.round(dstW * scale);
    dstH = Math.round(dstH * scale);
  }

  const canvas = createCanvas(dstW, dstH);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(source, 0, 0, dstW, dstH);

  if (canvas.toDataURL) {
    return canvas.toDataURL('image/jpeg', 0.82);
  } else {
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    return await blobToDataURL(blob);
  }
}

// Add an optional clean info banner at the top of the image
export function addMetadataBanner(canvas, { url = '', title = '', timestamp = '' }) {
  const bannerHeight = 44;
  const originalWidth = canvas.width;
  const originalHeight = canvas.height;

  const newCanvas = createCanvas(originalWidth, originalHeight + bannerHeight);
  const ctx = newCanvas.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, originalWidth, bannerHeight);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';

  const dateStr = timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString();
  const titleText = title || 'Full Page Screenshot — 100% Free & Edit';
  ctx.fillText(titleText, 16, bannerHeight / 2);

  ctx.font = '12px system-ui, -apple-system, monospace';
  ctx.fillStyle = '#94a3b8';
  const metaText = `${url} | Captured: ${dateStr}`;
  const metaWidth = ctx.measureText(metaText).width;
  const startX = Math.max(originalWidth - metaWidth - 16, originalWidth * 0.4);
  ctx.fillText(metaText, startX, bannerHeight / 2);

  ctx.drawImage(canvas, 0, bannerHeight);
  return newCanvas;
}

// Crop a region from a canvas or image
export function cropImage(source, rect) {
  const { x, y, width, height } = rect;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    source,
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height),
    0,
    0,
    Math.round(width),
    Math.round(height)
  );

  return canvas;
}
