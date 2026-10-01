// capture/segment-manager.js: Stores and manages raw segment slices during active capture sessions

export class SegmentManager {
  constructor() {
    this.segments = [];
  }

  addSegment(segment) {
    const record = {
      id: segment.id || ('seg_' + this.segments.length),
      index: this.segments.length,
      scrollX: Math.round(segment.scrollX || 0),
      scrollY: Math.round(segment.scrollY || 0),
      viewportWidth: segment.viewportWidth,
      viewportHeight: segment.viewportHeight,
      devicePixelRatio: segment.devicePixelRatio || 1,
      dataUrl: segment.dataUrl,
      timestamp: segment.timestamp || Date.now()
    };

    this.segments.push(record);
    return record;
  }

  getSegments() {
    return this.segments;
  }

  count() {
    return this.segments.length;
  }

  // Calculate coverage bounding box
  getBoundingBox() {
    if (this.segments.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const seg of this.segments) {
      if (seg.scrollX < minX) minX = seg.scrollX;
      if (seg.scrollX + seg.viewportWidth > maxX) maxX = seg.scrollX + seg.viewportWidth;

      if (seg.scrollY < minY) minY = seg.scrollY;
      if (seg.scrollY + seg.viewportHeight > maxY) maxY = seg.scrollY + seg.viewportHeight;
    }

    return {
      minX: Math.max(0, minX),
      maxX,
      minY: Math.max(0, minY),
      maxY,
      width: maxX - Math.max(0, minX),
      height: maxY - Math.max(0, minY)
    };
  }

  clear() {
    this.segments = [];
  }
}
