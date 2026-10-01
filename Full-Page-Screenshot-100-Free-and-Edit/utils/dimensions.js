// utils/dimensions.js: Coordinate transforms, DPR scaling, and canvas limits

// Browser standard canvas safety limits
export const CANVAS_MAX_DIMENSION = 32767;
export const CANVAS_MAX_AREA = 268435456; // 16384 * 16384 safe limit in Chromium

export function cssToPhysical(cssVal, dpr) {
  return Math.round(cssVal * (dpr || 1));
}

export function physicalToCss(physVal, dpr) {
  return (physVal / (dpr || 1));
}

export function checkCanvasLimits(width, height) {
  const isWidthValid = width <= CANVAS_MAX_DIMENSION;
  const isHeightValid = height <= CANVAS_MAX_DIMENSION;
  const isAreaValid = (width * height) <= CANVAS_MAX_AREA;

  return {
    valid: isWidthValid && isHeightValid && isAreaValid,
    width,
    height,
    area: width * height,
    isWidthValid,
    isHeightValid,
    isAreaValid,
    suggestedScale: isAreaValid && isHeightValid ? 1 : Math.min(
      CANVAS_MAX_DIMENSION / height,
      Math.sqrt(CANVAS_MAX_AREA / (width * height))
    )
  };
}

export function formatDimensions(width, height, dpr = 1) {
  if (dpr !== 1) {
    const cssW = Math.round(width / dpr);
    const cssH = Math.round(height / dpr);
    return `${width} × ${height} px (${cssW} × ${cssH} CSS @ ${dpr}x)`;
  }
  return `${width} × ${height} px`;
}

export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
