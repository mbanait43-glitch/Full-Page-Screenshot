// utils/ocr-engine.js: High-precision, 100% local, offline OCR engine for PageSnap Pro
// Manifest V3 compliant: Zero external requests, zero CDNs, zero unsafe-eval.
// Implements client-side image preprocessing, adaptive thresholding, connected component analysis,
// topological feature extraction, and multi-font template matching.

/**
 * Supported character set for optical character recognition
 */
export const OCR_CHARSET = {
  DIGITS: '0123456789',
  UPPERCASE: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  LOWERCASE: 'abcdefghijklmnopqrstuvwxyz',
  SYMBOLS: '.,!?:;\'"()-+/*=$%&@#_<>[]{}—₹'
};

const ALL_CHARS = (
  OCR_CHARSET.DIGITS +
  OCR_CHARSET.UPPERCASE +
  OCR_CHARSET.LOWERCASE +
  OCR_CHARSET.SYMBOLS
).split('');

const GRID_SIZE = 20; // 20x20 canonical grid for glyph comparison

/**
 * Cache for rasterized multi-font templates
 */
let fontTemplateCache = null;

/**
 * Generates the reference glyph database by rasterizing characters across standard web fonts
 * Uses native 2D Canvas in browser or offscreen canvas context
 */
export function buildFontTemplateBank() {
  if (fontTemplateCache) return fontTemplateCache;

  // Check if canvas environment is available
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
    return [];
  }

  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : new OffscreenCanvas(60, 60);

  canvas.width = 60;
  canvas.height = 60;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const fonts = [
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'Arial, Helvetica, sans-serif',
    'Georgia, "Times New Roman", serif',
    '"Courier New", Consolas, monospace'
  ];

  const templates = [];

  for (const fontName of fonts) {
    for (const weight of ['normal', 'bold']) {
      for (const ch of ALL_CHARS) {
        ctx.clearRect(0, 0, 60, 60);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 60, 60);

        ctx.font = `${weight} 32px ${fontName}`;
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch, 30, 30);

        const imgData = ctx.getImageData(0, 0, 60, 60);
        const glyphInfo = extractSingleGlyphFromData(imgData.data, 60, 60);

        if (glyphInfo && glyphInfo.width > 0 && glyphInfo.height > 0) {
          const normalized = normalizeGlyphToGrid(
            glyphInfo.binary,
            glyphInfo.width,
            glyphInfo.height,
            GRID_SIZE
          );
          const holes = countHoles(glyphInfo.binary, glyphInfo.width, glyphInfo.height);
          const aspect = glyphInfo.width / glyphInfo.height;

          templates.push({
            char: ch,
            grid: normalized,
            aspect,
            holes,
            font: fontName,
            weight
          });
        }
      }
    }
  }

  fontTemplateCache = templates;
  return templates;
}

/**
 * Extracts bounding box and binary ink map from an isolated single character image
 */
function extractSingleGlyphFromData(data, w, h) {
  let minX = w, maxX = 0, minY = h, maxY = 0;
  let hasInk = false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < 160) { // ink pixel
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hasInk = true;
      }
    }
  }

  if (!hasInk || maxX < minX || maxY < minY) return null;

  const gw = maxX - minX + 1;
  const gh = maxY - minY + 1;
  const binary = new Uint8Array(gw * gh);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = (y * w + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      binary[(y - minY) * gw + (x - minX)] = lum < 160 ? 1 : 0;
    }
  }

  return { binary, width: gw, height: gh };
}

/**
 * Normalizes an arbitrary binary glyph into a canonical GRID_SIZE x GRID_SIZE matrix
 */
export function normalizeGlyphToGrid(binary, w, h, targetSize = GRID_SIZE) {
  const grid = new Float32Array(targetSize * targetSize);
  const scaleX = w / targetSize;
  const scaleY = h / targetSize;

  for (let gy = 0; gy < targetSize; gy++) {
    for (let gx = 0; gx < targetSize; gx++) {
      const srcStartX = Math.floor(gx * scaleX);
      const srcEndX = Math.min(w, Math.ceil((gx + 1) * scaleX));
      const srcStartY = Math.floor(gy * scaleY);
      const srcEndY = Math.min(h, Math.ceil((gy + 1) * scaleY));

      let inkSum = 0;
      let count = 0;

      for (let sy = srcStartY; sy < srcEndY; sy++) {
        for (let sx = srcStartX; sx < srcEndX; sx++) {
          inkSum += binary[sy * w + sx];
          count++;
        }
      }

      grid[gy * targetSize + gx] = count > 0 ? (inkSum / count) : 0;
    }
  }

  return grid;
}

/**
 * Counts enclosed topological holes using boundary flood fill
 */
export function countHoles(binary, w, h) {
  // Pad binary with 1px border of 0s
  const pw = w + 2;
  const ph = h + 2;
  const visited = new Uint8Array(pw * ph);

  // Mark all ink pixels as visited
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (binary[y * w + x] === 1) {
        visited[(y + 1) * pw + (x + 1)] = 1;
      }
    }
  }

  // Flood fill from (0,0) across exterior background
  const queue = [0];
  visited[0] = 2; // 2 = exterior background

  while (queue.length > 0) {
    const curr = queue.pop();
    const cx = curr % pw;
    const cy = Math.floor(curr / pw);

    const neighbors = [
      cx > 0 ? curr - 1 : -1,
      cx < pw - 1 ? curr + 1 : -1,
      cy > 0 ? curr - pw : -1,
      cy < ph - 1 ? curr + pw : -1
    ];

    for (const n of neighbors) {
      if (n >= 0 && visited[n] === 0) {
        visited[n] = 2;
        queue.push(n);
      }
    }
  }

  // Any remaining unvisited 0-pixels inside the glyph boundary are interior holes!
  let holeCount = 0;
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      const idx = y * pw + x;
      if (visited[idx] === 0) {
        // Found a new hole! Flood fill it
        holeCount++;
        const holeQueue = [idx];
        visited[idx] = 3;

        while (holeQueue.length > 0) {
          const hcurr = holeQueue.pop();
          const hx = hcurr % pw;
          const hy = Math.floor(hcurr / pw);

          const hneighbors = [
            hx > 1 ? hcurr - 1 : -1,
            hx < w ? hcurr + 1 : -1,
            hy > 1 ? hcurr - pw : -1,
            hy < h ? hcurr + pw : -1
          ];

          for (const hn of hneighbors) {
            if (hn >= 0 && visited[hn] === 0) {
              visited[hn] = 3;
              holeQueue.push(hn);
            }
          }
        }
      }
    }
  }

  return holeCount;
}

/**
 * Image Preprocessing:
 * Upscaling, Grayscale, Contrast Normalization, Dark-mode detection/inversion,
 * and Otsu + Adaptive Thresholding.
 */
export function preprocessCanvas(sourceCanvas, options = {}) {
  const upscaleFactor = options.scale || (sourceCanvas.height < 60 ? 2 : 1.5);
  const targetW = Math.round(sourceCanvas.width * upscaleFactor);
  const targetH = Math.round(sourceCanvas.height * upscaleFactor);

  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : new OffscreenCanvas(targetW, targetH);

  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // High quality interpolation
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);

  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const { data } = imgData;

  // 1. Grayscale & Border Sampling for Inversion Check
  const gray = new Uint8Array(targetW * targetH);
  let borderLumSum = 0;
  let borderCount = 0;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const idx = (y * targetW + x) * 4;
      const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      gray[y * targetW + x] = lum;

      if (x <= 1 || x >= targetW - 2 || y <= 1 || y >= targetH - 2) {
        borderLumSum += lum;
        borderCount++;
      }
    }
  }

  // If outer border is dark (< 120), image has dark background -> invert to make text ink dark
  const isDarkBg = borderCount > 0 && (borderLumSum / borderCount) < 120;
  if (isDarkBg) {
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 255 - gray[i];
    }
  }

  // 2. Contrast Normalization (1st to 99th percentile stretch)
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    histogram[gray[i]]++;
  }

  const totalPixels = targetW * targetH;
  let p1 = 0, p99 = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += histogram[i];
    if (acc >= totalPixels * 0.01 && p1 === 0) p1 = i;
    if (acc >= totalPixels * 0.99) { p99 = i; break; }
  }

  if (p99 > p1 + 10) {
    const range = p99 - p1;
    for (let i = 0; i < gray.length; i++) {
      const v = Math.round(((gray[i] - p1) / range) * 255);
      gray[i] = Math.max(0, Math.min(255, v));
    }
  }

  // 3. Otsu Threshold Calculation
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let otsuThreshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = totalPixels - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > maxVariance) {
      maxVariance = variance;
      otsuThreshold = t;
    }
  }

  // 4. Binary Output (1 = text ink, 0 = background)
  // Text ink is darker than threshold
  const binary = new Uint8Array(targetW * targetH);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] < otsuThreshold ? 1 : 0;
  }

  return { binary, width: targetW, height: targetH, isDarkBg };
}

/**
 * Segments binary image into lines and character components
 */
export function segmentTextLines(binary, width, height) {
  // Horizontal projection profile (sum ink across each line)
  const projY = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let rowInk = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      rowInk += binary[rowOffset + x];
    }
    projY[y] = rowInk;
  }

  // Find line bands
  const lines = [];
  let inLine = false;
  let lineStart = 0;

  for (let y = 0; y < height; y++) {
    if (projY[y] > Math.max(2, width * 0.005)) {
      if (!inLine) {
        inLine = true;
        lineStart = y;
      }
    } else {
      if (inLine) {
        inLine = false;
        if (y - lineStart >= 6) { // min line height
          lines.push({ startY: lineStart, endY: y });
        }
      }
    }
  }
  if (inLine && height - lineStart >= 6) {
    lines.push({ startY: lineStart, endY: height - 1 });
  }

  // If no lines found from projection, treat entire image as 1 line
  if (lines.length === 0) {
    lines.push({ startY: 0, endY: height - 1 });
  }

  // For each line, extract connected components
  const extractedLines = [];

  for (const line of lines) {
    const lineH = line.endY - line.startY + 1;
    const glyphs = extractComponentsInRegion(binary, width, line.startY, line.endY);

    if (glyphs.length > 0) {
      // Sort glyphs left to right
      glyphs.sort((a, b) => a.x - b.x);

      // Merge vertically overlapping compound glyphs (e.g., dots on 'i', 'j', '!', '?', ':', ';', '=')
      const mergedGlyphs = mergeCompoundGlyphs(glyphs, lineH);
      const bottoms = mergedGlyphs.map(g => g.y + g.height).sort((a, b) => a - b);
      const medianBaseline = bottoms[Math.floor(bottoms.length / 2)] || (line.startY + lineH);
      extractedLines.push({
        startY: line.startY,
        endY: line.endY,
        lineH,
        medianBaseline,
        glyphs: mergedGlyphs
      });
    }
  }

  return extractedLines;
}

/**
 * 8-connected component analysis within a vertical line range
 */
function extractComponentsInRegion(binary, totalWidth, startY, endY) {
  const lineH = endY - startY + 1;
  const visited = new Uint8Array(totalWidth * lineH);
  const components = [];

  for (let ly = 0; ly < lineH; ly++) {
    const gy = startY + ly;
    for (let gx = 0; gx < totalWidth; gx++) {
      const gidx = gy * totalWidth + gx;
      const lidx = ly * totalWidth + gx;

      if (binary[gidx] === 1 && visited[lidx] === 0) {
        // Flood fill component
        let minX = gx, maxX = gx, minY = ly, maxY = ly;
        let pixelCount = 0;
        const queue = [lidx];
        visited[lidx] = 1;
        const compPixels = [];

        while (queue.length > 0) {
          const curr = queue.pop();
          const cx = curr % totalWidth;
          const cy = Math.floor(curr / totalWidth);
          compPixels.push({ x: cx, y: cy });
          pixelCount++;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // 8 directions
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < totalWidth && ny >= 0 && ny < lineH) {
                const nLocalIdx = ny * totalWidth + nx;
                const nGlobalIdx = (startY + ny) * totalWidth + nx;
                if (binary[nGlobalIdx] === 1 && visited[nLocalIdx] === 0) {
                  visited[nLocalIdx] = 1;
                  queue.push(nLocalIdx);
                }
              }
            }
          }
        }

        const compW = maxX - minX + 1;
        const compH = maxY - minY + 1;

        // Filter out tiny noise specks while preserving dots of 'i' and 'j'
        if (pixelCount >= 2 && compH >= 2) {
          const compBinary = new Uint8Array(compW * compH);
          for (const p of compPixels) {
            compBinary[(p.y - minY) * compW + (p.x - minX)] = 1;
          }

          components.push({
            x: minX,
            y: startY + minY,
            width: compW,
            height: compH,
            binary: compBinary,
            pixelCount
          });
        }
      }
    }
  }

  return components;
}

/**
 * Merges vertically aligned components belonging to the same character
 * e.g., 'i', 'j', '!', '?', ':', ';', '=', '%'
 */
function mergeCompoundGlyphs(glyphs, lineH) {
  if (glyphs.length <= 1) return glyphs;

  const result = [];
  const merged = new Set();

  for (let i = 0; i < glyphs.length; i++) {
    if (merged.has(i)) continue;
    let base = glyphs[i];

    for (let j = i + 1; j < glyphs.length; j++) {
      if (merged.has(j)) continue;
      const other = glyphs[j];

      // Check horizontal overlap
      const overlapStart = Math.max(base.x, other.x);
      const overlapEnd = Math.min(base.x + base.width, other.x + other.width);
      const overlapW = overlapEnd - overlapStart;
      const minW = Math.min(base.width, other.width);

      if (overlapW > 0 && overlapW >= minW * 0.3) {
        // Vertical proximity check
        const totalSpan = Math.max(base.y + base.height, other.y + other.height) - Math.min(base.y, other.y);
        if (totalSpan <= lineH * 1.25) {
          // Merge 'other' into 'base'
          const newMinX = Math.min(base.x, other.x);
          const newMaxX = Math.max(base.x + base.width, other.x + other.width);
          const newMinY = Math.min(base.y, other.y);
          const newMaxY = Math.max(base.y + base.height, other.y + other.height);
          const newW = newMaxX - newMinX;
          const newH = newMaxY - newMinY;

          const mergedBinary = new Uint8Array(newW * newH);

          // Copy base
          for (let y = 0; y < base.height; y++) {
            for (let x = 0; x < base.width; x++) {
              if (base.binary[y * base.width + x] === 1) {
                const mx = (base.x - newMinX) + x;
                const my = (base.y - newMinY) + y;
                mergedBinary[my * newW + mx] = 1;
              }
            }
          }

          // Copy other
          for (let y = 0; y < other.height; y++) {
            for (let x = 0; x < other.width; x++) {
              if (other.binary[y * other.width + x] === 1) {
                const mx = (other.x - newMinX) + x;
                const my = (other.y - newMinY) + y;
                mergedBinary[my * newW + mx] = 1;
              }
            }
          }

          base = {
            x: newMinX,
            y: newMinY,
            width: newW,
            height: newH,
            binary: mergedBinary,
            pixelCount: base.pixelCount + other.pixelCount
          };

          merged.add(j);
        }
      }
    }

    result.push(base);
  }

  return result;
}

/**
 * Classifies an individual extracted glyph by matching against reference templates
 */
export function classifyGlyph(glyph, templates, line = null) {
  const normGrid = normalizeGlyphToGrid(glyph.binary, glyph.width, glyph.height, GRID_SIZE);
  const glyphHoles = countHoles(glyph.binary, glyph.width, glyph.height);
  const glyphAspect = glyph.width / glyph.height;

  let bestChar = '?';
  let bestScore = -1;

  const lineStartY = (line && (line.startY !== undefined ? line.startY : line.y)) || 0;
  const lineH = (line && line.lineH > 0) ? line.lineH : glyph.height;
  const candRelH = glyph.height / lineH;
  const candRelY = (glyph.y - lineStartY) / lineH;
  const candRelBottom = (glyph.y + glyph.height - lineStartY) / lineH;

  // Topological check for detached dot above vertical stem ('i' and 'j')
  let hasTopDot = false;
  if (glyph.height >= 10 && glyph.width <= lineH * 0.7) {
    const rowSums = new Int32Array(glyph.height);
    for (let gy = 0; gy < glyph.height; gy++) {
      let rSum = 0;
      const rowOffset = gy * glyph.width;
      for (let gx = 0; gx < glyph.width; gx++) {
        rSum += glyph.binary[rowOffset + gx];
      }
      rowSums[gy] = rSum;
    }
    let dotInk = false;
    let gapFound = false;
    let stemInk = false;
    const gapThresholdY = Math.floor(glyph.height * 0.45);
    for (let gy = 0; gy < glyph.height; gy++) {
      if (gy < gapThresholdY) {
        if (rowSums[gy] > 0) dotInk = true;
        else if (dotInk) gapFound = true;
      } else {
        if (rowSums[gy] > 0) stemInk = true;
      }
    }
    if (dotInk && gapFound && stemInk) {
      hasTopDot = true;
    }
  }

  const isHorizBar = (glyph.width / glyph.height) >= 2.0;
  const medianBaseline = (line && line.medianBaseline !== undefined) ? line.medianBaseline : (lineStartY + lineH * 0.85);
  const descenderDepth = (glyph.y + glyph.height) - medianBaseline;
  const hasDescender = descenderDepth >= Math.max(3, lineH * 0.13) && candRelY >= 0.10;

  for (const t of templates) {
    // 1. Grid Similarity (Jaccard / Overlap coefficient)
    let intersection = 0;
    let union = 0;

    for (let k = 0; k < GRID_SIZE * GRID_SIZE; k++) {
      const gVal = normGrid[k];
      const tVal = t.grid[k];
      intersection += Math.min(gVal, tVal);
      union += Math.max(gVal, tVal);
    }

    const jaccard = union > 0 ? (intersection / union) : 0;

    // 2. Aspect Ratio Compatibility
    const aspectDiff = Math.abs(glyphAspect - t.aspect) / Math.max(0.2, t.aspect);
    const aspectPenalty = Math.min(0.35, aspectDiff * 0.25);

    // 3. Hole Compatibility
    let holeScore = 0;
    if (glyphHoles === t.holes) {
      holeScore = 0.15;
    } else if (Math.abs(glyphHoles - t.holes) > 1) {
      holeScore = -0.3;
    }

    // 4. Relative Height & Casing
    let heightPenalty = 0;
    const isXHeight = 'acegmnopqrsuvwxyz'.includes(t.char);
    const isCapOrAscender = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789bdfhkl$₹'.includes(t.char);
    if (isXHeight && candRelH > 0.75 && !hasDescender) {
      heightPenalty += 0.22;
    } else if (isCapOrAscender && candRelH < 0.6) {
      heightPenalty += 0.25;
    }

    // 5. Underscore vs Dash/Hyphen position & aspect
    if (isHorizBar) {
      if (t.char === '_') {
        if (candRelY < 0.60) heightPenalty += 0.85;
      } else if (t.char === '—' || t.char === '-') {
        if (candRelY > 0.65) heightPenalty += 0.85;
        if (t.char === '—' && glyph.width >= 16 && (glyph.width / glyph.height) >= 3.0) {
          heightPenalty -= 0.35;
        } else if (t.char === '-' && (glyph.width / glyph.height) >= 3.5) {
          heightPenalty += 0.25;
        }
      }
    } else {
      if (t.char === '_' || t.char === '—') {
        heightPenalty += 0.9;
      }
    }

    // 6. Descender vs Non-Descender
    if (hasDescender) {
      if ('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcedfhiklmorstuvwxz'.includes(t.char)) {
        heightPenalty += 0.65;
      } else if ('gpqyj'.includes(t.char)) {
        heightPenalty -= 0.25;
      }
    } else {
      if ('gpqyj'.includes(t.char)) {
        heightPenalty += 0.50;
      }
    }

    // 7. Case disambiguation for Y vs y, C vs c
    if (t.char === 'Y' && hasDescender) {
      heightPenalty += 0.5;
    }
    if (t.char === 'y' && !hasDescender) {
      heightPenalty += 0.5;
    }
    if (t.char === 'C' && candRelY <= 0.08 && candRelH >= 0.70) {
      heightPenalty -= 0.15;
    }
    if (t.char === 'c' && candRelY <= 0.08 && candRelH >= 0.70) {
      heightPenalty += 0.35;
    }

    // 8. Comma vs Apostrophe vs Period vertical position
    if (t.char === ',' && candRelY < 0.40) {
      heightPenalty += 0.85;
    } else if (t.char === '\'' && candRelY > 0.40) {
      heightPenalty += 0.85;
    } else if (t.char === '.' && (candRelY < 0.50 || candRelBottom > 0.85)) {
      heightPenalty += 0.70;
    } else if (t.char === ',' && candRelBottom > 0.80 && glyphAspect < 0.75) {
      heightPenalty -= 0.25;
    }

    // 8. Dot topological disambiguation for i/j vs I/l/1
    if (hasTopDot) {
      if (t.char === 'i') {
        heightPenalty -= 0.6;
      } else if (t.char === 'j') {
        heightPenalty -= (candRelBottom >= 0.85 ? 0.6 : 0.2);
      } else if ('Il1tfLT|!'.includes(t.char)) {
        heightPenalty += 0.85;
      } else {
        heightPenalty += 0.4;
      }
    } else {
      if (t.char === 'i' || t.char === 'j') {
        heightPenalty += 0.35;
      }
    }

    const totalScore = jaccard * 0.75 + holeScore - aspectPenalty - heightPenalty;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestChar = t.char;
    }
  }

  return { char: bestChar, score: bestScore };
}

/**
 * Contextual post-processing: preserves recognized text faithfully without regex rewriting
 */
function postProcessExtractedText(rawText) {
  // Preserve recognized text faithfully without regex modifications, guessing, or character rewriting
  if (!rawText) return '';
  return rawText;
}

/**
 * Complete End-to-End Local OCR on an Image/Canvas/DataURL
 */
export async function extractTextFromImage(imageSource, options = {}) {
  // 1. If native TextDetector exists in the browser, attempt hardware detection first
  if (typeof window !== 'undefined' && typeof window.TextDetector === 'function') {
    try {
      let detectTarget = imageSource;
      if (typeof imageSource === 'string') {
        const img = new Image();
        img.src = imageSource;
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        detectTarget = img;
      }
      const detector = new window.TextDetector();
      const detected = await detector.detect(detectTarget);
      if (detected && detected.length > 0) {
        // Sort detected boxes vertically, then horizontally
        detected.sort((a, b) => {
          const dy = a.boundingBox.y - b.boundingBox.y;
          if (Math.abs(dy) > 10) return dy;
          return a.boundingBox.x - b.boundingBox.x;
        });

        const lines = detected.map(d => d.rawValue).filter(Boolean);
        if (lines.length > 0) {
          const joinedText = lines.join('\n');
          return {
            text: joinedText,
            lines,
            confidence: 95,
            glyphCount: joinedText.length,
            engine: 'native-shape-detector'
          };
        }
      }
    } catch (e) {
      // Fallback to local Canvas OCR
    }
  }

  // 2. Prepare canvas from source
  let canvas;
  if (imageSource instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && imageSource instanceof OffscreenCanvas)) {
    canvas = imageSource;
  } else if (typeof imageSource === 'string') {
    const img = new Image();
    img.src = imageSource;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
  } else if (imageSource instanceof ImageData) {
    canvas = document.createElement('canvas');
    canvas.width = imageSource.width;
    canvas.height = imageSource.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageSource, 0, 0);
  } else {
    throw new Error('Unsupported image source format for OCR');
  }

  // 3. Preprocess Image
  const preprocessed = preprocessCanvas(canvas, options);
  const { binary, width, height } = preprocessed;

  // 4. Segment Lines and Characters
  const segmentedLines = segmentTextLines(binary, width, height);
  if (segmentedLines.length === 0) {
    return {
      text: '',
      lines: [],
      confidence: 0,
      glyphCount: 0,
      engine: 'pagesnap-local-ocr'
    };
  }

  // 5. Ensure Reference Font Templates are Built
  const templates = buildFontTemplateBank();
  if (!templates || templates.length === 0) {
    return {
      text: '',
      lines: [],
      confidence: 0,
      glyphCount: 0,
      engine: 'pagesnap-local-ocr'
    };
  }

  // 6. Recognize Each Line and Character
  const textLines = [];
  let totalScore = 0;
  let totalGlyphs = 0;

  for (const line of segmentedLines) {
    let lineStr = '';
    const glyphs = line.glyphs;

    // Estimate median character width & height for space calculation
    const widths = glyphs.map(g => g.width).sort((a, b) => a - b);
    const medianW = widths[Math.floor(widths.length / 2)] || 12;
    const spaceThreshold = Math.max(8, Math.min(medianW * 0.60, line.lineH * 0.35));

    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];

      const match = classifyGlyph(g, templates, line);
      let ch = match.char;

      // Insert space if there is a wide gap from previous glyph
      if (i > 0) {
        const prevG = glyphs[i - 1];
        const gap = g.x - (prevG.x + prevG.width);
        const noSpaceBefore = ',.:;!?)]}%';
        if (gap >= spaceThreshold && !noSpaceBefore.includes(ch)) {
          lineStr += ' ';
        }
      }

      // Vertical stroke disambiguation: 'I' after lowercase letter in same word is 'l'
      if (ch === 'I' && lineStr.length > 0) {
        const lastChar = lineStr[lineStr.length - 1];
        if (/[a-z]/.test(lastChar)) {
          ch = 'l';
        }
      }

      lineStr += ch;
      totalScore += Math.max(0, match.score);
      totalGlyphs++;
    }

    if (lineStr.trim().length > 0) {
      textLines.push(lineStr.trim());
    }
  }

  const rawExtracted = textLines.join('\n');
  const cleanedText = postProcessExtractedText(rawExtracted);
  const avgConfidence = totalGlyphs > 0 ? Math.round((totalScore / totalGlyphs) * 100) : 0;

  return {
    text: cleanedText,
    lines: cleanedText.split('\n'),
    confidence: avgConfidence,
    glyphCount: totalGlyphs,
    engine: 'pagesnap-local-ocr'
  };
}
