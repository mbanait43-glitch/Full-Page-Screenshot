// capture/stitcher.js: High-precision screenshot stitching engine
// Handles Auto-capture overlap elimination, Manual-capture spatial reconciliation, DPR scaling, and canvas limits

import { loadImage, createCanvas } from '../utils/image-utils.js';
import { checkCanvasLimits } from '../utils/dimensions.js';

export class ScreenshotStitcher {
  constructor(options = {}) {
    this.options = options;
  }

  // Stitch segments from Auto Full Page capture
  async stitchAutoSegments(segments, totalMetrics) {
    if (!segments || segments.length === 0) {
      throw new Error('No screenshot segments provided for stitching');
    }

    if (segments.length === 1) {
      const singleImg = await loadImage(segments[0].dataUrl);
      const canvas = createCanvas(singleImg.width, singleImg.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(singleImg, 0, 0);
      return canvas;
    }

    // Load first image to determine physical pixel scale
    const firstImg = await loadImage(segments[0].dataUrl);
    const scaleX = firstImg.width / segments[0].viewportWidth;
    const scaleY = firstImg.height / segments[0].viewportHeight;

    const totalCssWidth = totalMetrics.scrollWidth || segments[0].viewportWidth;
    const totalCssHeight = totalMetrics.scrollHeight || (segments[segments.length - 1].scrollY + segments[segments.length - 1].viewportHeight);

    let canvasWidth = Math.round(totalCssWidth * scaleX);
    let canvasHeight = Math.round(totalCssHeight * scaleY);

    // Verify browser canvas limits
    const limitCheck = checkCanvasLimits(canvasWidth, canvasHeight);
    let globalScale = 1;
    if (!limitCheck.valid) {
      globalScale = limitCheck.suggestedScale;
      canvasWidth = Math.round(canvasWidth * globalScale);
      canvasHeight = Math.round(canvasHeight * globalScale);
      console.warn(`Canvas dimensions exceeded browser limit. Scaled down by ${(globalScale * 100).toFixed(1)}% to ${canvasWidth}x${canvasHeight}`);
    }

    const masterCanvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = masterCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw segment 0
    // Slices contribute non-overlapping vertical chunks:
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const img = (i === 0) ? firstImg : await loadImage(seg.dataUrl);

      const isLast = (i === segments.length - 1);
      const currentScrollY = seg.scrollY;
      
      let cssChunkHeight;
      if (!isLast) {
        const nextScrollY = segments[i + 1].scrollY;
        cssChunkHeight = Math.max(0, nextScrollY - currentScrollY);
      } else {
        // Last segment covers up to totalCssHeight
        cssChunkHeight = Math.max(0, totalCssHeight - currentScrollY);
      }

      // Convert chunk to physical image pixels
      const srcW = img.width;
      const srcH = Math.min(img.height, Math.round(cssChunkHeight * scaleY));

      const dstX = 0;
      const dstY = Math.round(currentScrollY * scaleY * globalScale);
      const dstW = Math.round(srcW * globalScale);
      const dstH = Math.round(srcH * globalScale);

      if (srcH > 0 && dstH > 0) {
        ctx.drawImage(
          img,
          0, 0, srcW, srcH,          // Source rectangle (non-overlapping slice)
          dstX, dstY, dstW, dstH     // Destination rectangle on master canvas
        );
      }
    }

    return masterCanvas;
  }

  // Spatial Stitching for Manual Full Page Capture
  // Segments may have been captured during irregular, non-sequential, or overlapping scrolling
  async stitchManualSegments(rawSegments) {
    if (!rawSegments || rawSegments.length === 0) {
      throw new Error('No segments recorded in manual capture session');
    }

    // Step 1: Deduplicate segments taken at virtually identical scroll positions (< 6px difference)
    const sorted = [...rawSegments].sort((a, b) => a.scrollY - b.scrollY);
    const uniqueSegments = [];

    for (const seg of sorted) {
      if (uniqueSegments.length === 0) {
        uniqueSegments.push(seg);
      } else {
        const last = uniqueSegments[uniqueSegments.length - 1];
        if (Math.abs(seg.scrollY - last.scrollY) >= 6) {
          uniqueSegments.push(seg);
        }
      }
    }

    // Load first image to determine physical scale
    const firstImg = await loadImage(uniqueSegments[0].dataUrl);
    const scaleX = firstImg.width / uniqueSegments[0].viewportWidth;
    const scaleY = firstImg.height / uniqueSegments[0].viewportHeight;

    const minY = uniqueSegments[0].scrollY;
    const lastSeg = uniqueSegments[uniqueSegments.length - 1];
    const maxY = lastSeg.scrollY + lastSeg.viewportHeight;
    const totalCssHeight = Math.max(1, maxY - minY);
    const totalCssWidth = uniqueSegments[0].viewportWidth;

    let canvasWidth = Math.round(totalCssWidth * scaleX);
    let canvasHeight = Math.round(totalCssHeight * scaleY);

    const limitCheck = checkCanvasLimits(canvasWidth, canvasHeight);
    let globalScale = 1;
    if (!limitCheck.valid) {
      globalScale = limitCheck.suggestedScale;
      canvasWidth = Math.round(canvasWidth * globalScale);
      canvasHeight = Math.round(canvasHeight * globalScale);
    }

    const masterCanvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = masterCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Step 2: Draw segments spatially from top to bottom, resolving overlaps
    for (let i = 0; i < uniqueSegments.length; i++) {
      const seg = uniqueSegments[i];
      const img = (seg === uniqueSegments[0]) ? firstImg : await loadImage(seg.dataUrl);

      const isLast = (i === uniqueSegments.length - 1);
      const relativeTop = seg.scrollY - minY;

      let cssSliceHeight;
      if (!isLast) {
        const nextRelativeTop = uniqueSegments[i + 1].scrollY - minY;
        if (nextRelativeTop > relativeTop && nextRelativeTop < relativeTop + seg.viewportHeight) {
          // Overlapping next segment: take slice up to nextTop to avoid duplication
          cssSliceHeight = nextRelativeTop - relativeTop;
        } else {
          cssSliceHeight = seg.viewportHeight;
        }
      } else {
        cssSliceHeight = seg.viewportHeight;
      }

      const srcW = img.width;
      const srcH = Math.min(img.height, Math.round(cssSliceHeight * scaleY));

      const dstX = 0;
      const dstY = Math.round(relativeTop * scaleY * globalScale);
      const dstW = Math.round(srcW * globalScale);
      const dstH = Math.round(srcH * globalScale);

      if (srcH > 0 && dstH > 0) {
        ctx.drawImage(
          img,
          0, 0, srcW, srcH,
          dstX, dstY, dstW, dstH
        );
      }
    }

    return masterCanvas;
  }
}
