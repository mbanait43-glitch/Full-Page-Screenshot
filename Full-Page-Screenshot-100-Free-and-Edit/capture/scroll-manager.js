// capture/scroll-manager.js: Precise scroll control and state restoration

import { detectPrimaryScrollingElement } from './page-detector.js';

export class ScrollManager {
  constructor() {
    this.origScrollX = 0;
    this.origScrollY = 0;
    this.origHtmlScrollBehavior = '';
    this.origBodyScrollBehavior = '';
    this.scrollingElement = null;
    this.isPrepared = false;
  }

  // Save current scroll state and enforce instantaneous scroll behavior
  prepare() {
    if (this.isPrepared) return;

    this.scrollingElement = detectPrimaryScrollingElement();
    
    // Save original scroll coordinates
    this.origScrollX = window.scrollX !== undefined ? window.scrollX : (document.documentElement.scrollLeft || document.body.scrollLeft || 0);
    this.origScrollY = window.scrollY !== undefined ? window.scrollY : (document.documentElement.scrollTop || document.body.scrollTop || 0);

    // Save and override smooth scrolling
    const docEl = document.documentElement;
    const body = document.body;

    if (docEl) {
      this.origHtmlScrollBehavior = docEl.style.scrollBehavior;
      docEl.style.setProperty('scroll-behavior', 'auto', 'important');
    }
    if (body) {
      this.origBodyScrollBehavior = body.style.scrollBehavior;
      body.style.setProperty('scroll-behavior', 'auto', 'important');
    }

    // Suppress native scrollbars so they don't get baked into the screenshot
    if (!this.scrollbarStyle) {
      this.scrollbarStyle = document.createElement('style');
      this.scrollbarStyle.id = '__pagesnap_suppress_scrollbars__';
      this.scrollbarStyle.textContent = `
        ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
        * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      `;
      (document.head || document.documentElement).appendChild(this.scrollbarStyle);
    }

    this.isPrepared = true;
  }

  // Scroll to exact position (x, y)
  async scrollTo(x, y) {
    if (!this.isPrepared) this.prepare();

    const targetY = Math.round(y);
    const targetX = Math.round(x);

    // Try window.scrollTo
    window.scrollTo({ left: targetX, top: targetY, behavior: 'auto' });

    // Also update scrollingElement directly if custom container or fallback
    if (this.scrollingElement && this.scrollingElement !== document.documentElement && this.scrollingElement !== document.body) {
      this.scrollingElement.scrollTop = targetY;
      this.scrollingElement.scrollLeft = targetX;
    }

    // Wait for browser layout & repaint tick
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    const currentY = window.scrollY !== undefined ? window.scrollY : (this.scrollingElement ? this.scrollingElement.scrollTop : 0);
    return { actualX: targetX, actualY: currentY };
  }

  // Restore original scroll position and styles
  async restore() {
    if (!this.isPrepared) return;

    try {
      window.scrollTo({ left: this.origScrollX, top: this.origScrollY, behavior: 'auto' });
      if (this.scrollingElement && this.scrollingElement !== document.documentElement && this.scrollingElement !== document.body) {
        this.scrollingElement.scrollTop = this.origScrollY;
        this.scrollingElement.scrollLeft = this.origScrollX;
      }

      const docEl = document.documentElement;
      const body = document.body;

      if (docEl) {
        if (this.origHtmlScrollBehavior) {
          docEl.style.scrollBehavior = this.origHtmlScrollBehavior;
        } else {
          docEl.style.removeProperty('scroll-behavior');
        }
      }

      if (body) {
        if (this.origBodyScrollBehavior) {
          body.style.scrollBehavior = this.origBodyScrollBehavior;
        } else {
          body.style.removeProperty('scroll-behavior');
        }
      }

      if (this.scrollbarStyle && this.scrollbarStyle.parentNode) {
        this.scrollbarStyle.parentNode.removeChild(this.scrollbarStyle);
        this.scrollbarStyle = null;
      }
    } finally {
      this.isPrepared = false;
    }
  }
}
