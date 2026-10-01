// capture/dynamic-content-handler.js: Adaptive waiting for lazy-loaded images and dynamic height expansion

export class DynamicContentHandler {
  constructor(options = {}) {
    this.baseDelay = options.scrollDelay || 180;
    this.maxLazyWait = options.lazyLoadWait || 350;
  }

  // Wait for visible images in current viewport to finish loading
  async waitForVisibleContent() {
    // Basic render tick
    await new Promise(r => setTimeout(r, this.baseDelay));

    const winH = window.innerHeight;
    const images = Array.from(document.querySelectorAll('img, picture, svg, video'));
    const pendingImages = [];

    for (const img of images) {
      const rect = img.getBoundingClientRect();
      // Check if image intersects current viewport
      if (rect.bottom >= 0 && rect.top <= winH && rect.width > 0 && rect.height > 0) {
        if (img.tagName === 'IMG' && !img.complete) {
          pendingImages.push(img);
        }
      }
    }

    if (pendingImages.length > 0) {
      // Race image loading with timeout
      await Promise.race([
        Promise.all(pendingImages.map(img => {
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        })),
        new Promise(r => setTimeout(r, this.maxLazyWait))
      ]);
    }
  }

  // Check if page height grew dynamically
  checkHeightGrowth(previousHeight) {
    const doc = document;
    const currentHeight = Math.max(
      doc.documentElement ? doc.documentElement.scrollHeight : 0,
      doc.body ? doc.body.scrollHeight : 0,
      window.innerHeight
    );

    return {
      grew: currentHeight > previousHeight,
      previousHeight,
      currentHeight,
      diff: currentHeight - previousHeight
    };
  }
}
