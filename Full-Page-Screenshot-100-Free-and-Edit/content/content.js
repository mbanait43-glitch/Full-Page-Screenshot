// content/content.js: Injected script for DOM interaction, scroll control, area selection, and manual HUD

(function () {
  // Prevent duplicate initialization
  if (window.__pagesnap_initialized) return;
  window.__pagesnap_initialized = true;

  // --- 1. Page Detection & Metrics ---
  function detectPrimaryScrollingElement() {
    const doc = document;
    const win = window;

    if (doc.scrollingElement && doc.scrollingElement.scrollHeight > win.innerHeight) {
      return doc.scrollingElement;
    }
    if (doc.documentElement && doc.documentElement.scrollHeight > win.innerHeight) {
      return doc.documentElement;
    }
    if (doc.body && doc.body.scrollHeight > win.innerHeight) {
      return doc.body;
    }

    const candidateElements = doc.querySelectorAll('main, [role="main"], #root, #app, .app, .container, body > div');
    let bestContainer = null;
    let maxScrollHeight = win.innerHeight;

    for (const el of candidateElements) {
      try {
        const style = win.getComputedStyle(el);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > maxScrollHeight) {
          maxScrollHeight = el.scrollHeight;
          bestContainer = el;
        }
      } catch (e) {}
    }

    return bestContainer || doc.scrollingElement || doc.documentElement || doc.body;
  }

  function getPageMetrics() {
    const win = window;
    const doc = document;
    const scrollEl = detectPrimaryScrollingElement();

    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight;
    const dpr = win.devicePixelRatio || 1;

    const scrollWidth = Math.max(
      scrollEl ? scrollEl.scrollWidth : 0,
      doc.documentElement ? doc.documentElement.scrollWidth : 0,
      doc.body ? doc.body.scrollWidth : 0,
      viewportWidth
    );

    const scrollHeight = Math.max(
      scrollEl ? scrollEl.scrollHeight : 0,
      doc.documentElement ? doc.documentElement.scrollHeight : 0,
      doc.body ? doc.body.scrollHeight : 0,
      viewportHeight
    );

    const scrollX = win.scrollX !== undefined ? win.scrollX : (doc.documentElement.scrollLeft || doc.body.scrollLeft || 0);
    const scrollY = win.scrollY !== undefined ? win.scrollY : (doc.documentElement.scrollTop || doc.body.scrollTop || 0);
    const maxScrollY = Math.max(0, scrollHeight - viewportHeight);

    return {
      viewportWidth,
      viewportHeight,
      scrollWidth,
      scrollHeight,
      scrollX,
      scrollY,
      maxScrollY,
      devicePixelRatio: dpr,
      title: doc.title || 'Untitled',
      url: win.location.href,
      isCustomContainer: scrollEl !== doc.scrollingElement && scrollEl !== doc.documentElement && scrollEl !== doc.body
    };
  }

  // --- 2. Scroll Manager ---
  class ScrollManager {
    constructor() {
      this.origScrollX = 0;
      this.origScrollY = 0;
      this.origHtmlScrollBehavior = '';
      this.origBodyScrollBehavior = '';
      this.scrollingElement = null;
      this.isPrepared = false;
    }

    prepare() {
      if (this.isPrepared) return;

      this.scrollingElement = detectPrimaryScrollingElement();
      this.origScrollX = window.scrollX !== undefined ? window.scrollX : (document.documentElement.scrollLeft || document.body.scrollLeft || 0);
      this.origScrollY = window.scrollY !== undefined ? window.scrollY : (document.documentElement.scrollTop || document.body.scrollTop || 0);

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

    async scrollTo(x, y) {
      if (!this.isPrepared) this.prepare();

      const targetY = Math.round(y);
      const targetX = Math.round(x);

      window.scrollTo({ left: targetX, top: targetY, behavior: 'auto' });

      if (this.scrollingElement && this.scrollingElement !== document.documentElement && this.scrollingElement !== document.body) {
        this.scrollingElement.scrollTop = targetY;
        this.scrollingElement.scrollLeft = targetX;
      }

      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });

      const currentY = window.scrollY !== undefined ? window.scrollY : (this.scrollingElement ? this.scrollingElement.scrollTop : 0);
      return { actualX: targetX, actualY: currentY };
    }

    restore() {
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

  // --- 3. Fixed and Sticky Elements Handler ---
  class FixedElementHandler {
    constructor() {
      this.modifiedElements = new Map();
      this.isActive = false;
    }

    findFixedAndStickyElements() {
      const elements = document.querySelectorAll('*');
      const fixedSticky = [];

      for (const el of elements) {
        if (el.id && el.id.startsWith('pagesnap')) continue;
        if (el.className && typeof el.className === 'string' && el.className.includes('pagesnap')) continue;
        if (el.closest && el.closest('[id^="pagesnap"], [class*="pagesnap"]')) continue;

        try {
          const style = window.getComputedStyle(el);
          const pos = style.position;

          if (pos === 'fixed' || pos === 'sticky') {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
              fixedSticky.push({
                element: el,
                rect,
                position: pos,
                isTopPinned: rect.top <= 120,
                isBottomPinned: rect.bottom >= (window.innerHeight - 120)
              });
            }
          }
        } catch (e) {}
      }

      return fixedSticky;
    }

    hideForSubsequentSlices() {
      if (this.isActive) return;

      const targets = this.findFixedAndStickyElements();
      for (const item of targets) {
        const el = item.element;
        if (!this.modifiedElements.has(el)) {
          this.modifiedElements.set(el, {
            visibility: el.style.visibility,
            transition: el.style.transition
          });

          el.style.setProperty('transition', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }

      this.isActive = true;
    }

    restore() {
      for (const [el, original] of this.modifiedElements.entries()) {
        try {
          if (original.visibility) {
            el.style.visibility = original.visibility;
          } else {
            el.style.removeProperty('visibility');
          }

          if (original.transition) {
            el.style.transition = original.transition;
          } else {
            el.style.removeProperty('transition');
          }
        } catch (err) {}
      }

      this.modifiedElements.clear();
      this.isActive = false;
    }
  }

  // --- 4. Interactive Selected Area Overlay ---
  class AreaSelector {
    constructor(onConfirm, onCancel) {
      this.onConfirm = onConfirm;
      this.onCancel = onCancel;
      this.overlay = null;
      this.box = null;
      this.toolbar = null;
      this.dimChip = null;

      this.startX = 0;
      this.startY = 0;
      this.currentX = 0;
      this.currentY = 0;
      this.isDragging = false;
      this.isMoving = false;
      this.activeHandle = null;

      this.rect = { x: 0, y: 0, width: 0, height: 0 };
    }

    activate() {
      this.deactivate(); // clean existing

      const overlay = document.createElement('div');
      overlay.id = 'pagesnap-pro-area-overlay';

      const box = document.createElement('div');
      box.id = 'pagesnap-pro-selection-box';
      box.style.display = 'none';

      // 8 Resize handles
      const handleTypes = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      for (const t of handleTypes) {
        const h = document.createElement('div');
        h.className = `pagesnap-handle pagesnap-handle-${t}`;
        h.dataset.handle = t;
        box.appendChild(h);
      }

      // Toolbar
      const toolbar = document.createElement('div');
      toolbar.id = 'pagesnap-pro-area-toolbar';

      const dimChip = document.createElement('span');
      dimChip.className = 'pagesnap-dim-chip';
      dimChip.textContent = '0 × 0 px';

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'pagesnap-btn pagesnap-btn-primary';
      confirmBtn.innerHTML = '✔ Capture Region';
      confirmBtn.onclick = (e) => {
        e.stopPropagation();
        this.confirmSelection();
      };

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'pagesnap-btn pagesnap-btn-secondary';
      cancelBtn.innerHTML = '✖ Cancel';
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        this.cancelSelection();
      };

      toolbar.appendChild(dimChip);
      toolbar.appendChild(confirmBtn);
      toolbar.appendChild(cancelBtn);
      box.appendChild(toolbar);

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      this.overlay = overlay;
      this.box = box;
      this.toolbar = toolbar;
      this.dimChip = dimChip;

      this.bindEvents();
    }

    bindEvents() {
      this._onMouseDown = this.handleMouseDown.bind(this);
      this._onMouseMove = this.handleMouseMove.bind(this);
      this._onMouseUp = this.handleMouseUp.bind(this);
      this._onKeyDown = this.handleKeyDown.bind(this);

      this.overlay.addEventListener('mousedown', this._onMouseDown);
      window.addEventListener('mousemove', this._onMouseMove);
      window.addEventListener('mouseup', this._onMouseUp);
      window.addEventListener('keydown', this._onKeyDown);
    }

    handleMouseDown(e) {
      if (e.target.closest('#pagesnap-pro-area-toolbar')) return;

      const handle = e.target.closest('.pagesnap-handle');
      if (handle) {
        this.activeHandle = handle.dataset.handle;
        this.startX = e.clientX;
        this.startY = e.clientY;
        return;
      }

      if (e.target.closest('#pagesnap-pro-selection-box')) {
        this.isMoving = true;
        this.dragOffsetX = e.clientX - this.rect.x;
        this.dragOffsetY = e.clientY - this.rect.y;
        return;
      }

      // Start new selection drag
      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.rect = { x: this.startX, y: this.startY, width: 0, height: 0 };
      this.box.style.display = 'block';
      this.updateBoxDOM();
    }

    handleMouseMove(e) {
      if (this.isDragging) {
        const curX = e.clientX;
        const curY = e.clientY;
        this.rect.x = Math.min(this.startX, curX);
        this.rect.y = Math.min(this.startY, curY);
        this.rect.width = Math.abs(curX - this.startX);
        this.rect.height = Math.abs(curY - this.startY);
        this.updateBoxDOM();
      } else if (this.isMoving) {
        this.rect.x = Math.max(0, Math.min(window.innerWidth - this.rect.width, e.clientX - this.dragOffsetX));
        this.rect.y = Math.max(0, Math.min(window.innerHeight - this.rect.height, e.clientY - this.dragOffsetY));
        this.updateBoxDOM();
      } else if (this.activeHandle) {
        this.resizeByHandle(e.clientX, e.clientY);
      }
    }

    resizeByHandle(curX, curY) {
      const h = this.activeHandle;
      let { x, y, width, height } = this.rect;

      if (h.includes('e')) width = Math.max(20, curX - x);
      if (h.includes('s')) height = Math.max(20, curY - y);
      if (h.includes('w')) {
        const newW = width + (x - curX);
        if (newW >= 20) {
          x = curX;
          width = newW;
        }
      }
      if (h.includes('n')) {
        const newH = height + (y - curY);
        if (newH >= 20) {
          y = curY;
          height = newH;
        }
      }

      this.rect = { x, y, width, height };
      this.updateBoxDOM();
    }

    handleMouseUp() {
      this.isDragging = false;
      this.isMoving = false;
      this.activeHandle = null;
    }

    handleKeyDown(e) {
      if (e.key === 'Escape') {
        this.cancelSelection();
      } else if (e.key === 'Enter') {
        this.confirmSelection();
      }
    }

    updateBoxDOM() {
      if (!this.box) return;
      this.box.style.left = `${this.rect.x}px`;
      this.box.style.top = `${this.rect.y}px`;
      this.box.style.width = `${this.rect.width}px`;
      this.box.style.height = `${this.rect.height}px`;

      const dpr = window.devicePixelRatio || 1;
      const physW = Math.round(this.rect.width * dpr);
      const physH = Math.round(this.rect.height * dpr);
      this.dimChip.textContent = `${Math.round(this.rect.width)} × ${Math.round(this.rect.height)} px (${physW} × ${physH} phys)`;
    }

    confirmSelection() {
      if (this.rect.width < 10 || this.rect.height < 10) {
        this.cancelSelection();
        return;
      }

      const selectionData = {
        x: this.rect.x,
        y: this.rect.y,
        width: this.rect.width,
        height: this.rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      };

      this.deactivate();
      if (this.onConfirm) this.onConfirm(selectionData);
    }

    cancelSelection() {
      this.deactivate();
      if (this.onCancel) this.onCancel();
    }

    deactivate() {
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      window.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('mouseup', this._onMouseUp);
      window.removeEventListener('keydown', this._onKeyDown);
      this.overlay = null;
      this.box = null;
    }
  }

  // --- 5. Manual Capture HUD and Scroll Observer ---
  class ManualCaptureHUD {
    constructor() {
      this.hud = null;
      this.counterEl = null;
      this.isTracking = false;
      this.lastCapturedY = -9999;
      this.lastTriggerTime = 0;
      this.scrollTimer = null;
      this._onScroll = this.handleScroll.bind(this);
    }

    activate(initialCount = 1) {
      this.deactivate();

      const hud = document.createElement('div');
      hud.id = 'pagesnap-pro-manual-hud';

      const dot = document.createElement('div');
      dot.className = 'pagesnap-pulse-dot';

      const info = document.createElement('div');
      info.className = 'pagesnap-hud-info';

      const title = document.createElement('div');
      title.className = 'pagesnap-hud-title';
      title.textContent = 'Manual Capture Active';

      const counter = document.createElement('div');
      counter.className = 'pagesnap-hud-counter';
      counter.textContent = `${initialCount} section${initialCount === 1 ? '' : 's'} captured`;
      this.counterEl = counter;

      info.appendChild(title);
      info.appendChild(counter);

      const finishBtn = document.createElement('button');
      finishBtn.className = 'pagesnap-btn pagesnap-btn-primary';
      finishBtn.innerHTML = '✔ Stop & Stitch';
      finishBtn.onclick = () => {
        chrome.runtime.sendMessage({ type: 'STOP_MANUAL_CAPTURE' });
      };

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'pagesnap-btn pagesnap-btn-secondary';
      cancelBtn.innerHTML = '✖ Cancel';
      cancelBtn.onclick = () => {
        chrome.runtime.sendMessage({ type: 'CANCEL_CAPTURE' });
      };

      hud.appendChild(dot);
      hud.appendChild(info);
      hud.appendChild(finishBtn);
      hud.appendChild(cancelBtn);

      document.body.appendChild(hud);
      this.hud = hud;
      this.isTracking = true;
      this.lastCapturedY = window.scrollY || 0;
      this.lastTriggerTime = Date.now();

      // Listen to scroll events
      window.addEventListener('scroll', this._onScroll, { passive: true });
    }

    updateCount(count) {
      if (this.counterEl) {
        this.counterEl.textContent = `${count} section${count === 1 ? '' : 's'} captured`;
      }
    }

    handleScroll() {
      if (!this.isTracking) return;

      const currentY = window.scrollY || 0;
      const winH = window.innerHeight;
      const delta = Math.abs(currentY - this.lastCapturedY);

      // Trigger capture if scrolled more than 40% of viewport
      if (delta >= winH * 0.40) {
        this.triggerSlice(currentY);
        return;
      }

      // Or debounce when scrolling pauses for 220ms
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => {
        const settledY = window.scrollY || 0;
        if (Math.abs(settledY - this.lastCapturedY) >= 40) {
          this.triggerSlice(settledY);
        }
      }, 220);
    }

    triggerSlice(currentY) {
      const now = Date.now();
      if (now - this.lastTriggerTime < 700) {
        clearTimeout(this.scrollTimer);
        this.scrollTimer = setTimeout(() => {
          if (this.isTracking) {
            this.triggerSlice(window.scrollY || 0);
          }
        }, 700 - (now - this.lastTriggerTime));
        return;
      }
      this.lastTriggerTime = now;
      this.lastCapturedY = currentY;
      chrome.runtime.sendMessage({
        type: 'MANUAL_CAPTURE_SLICE',
        coords: {
          scrollX: window.scrollX || 0,
          scrollY: currentY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        }
      });
    }

    deactivate() {
      if (this.hud && this.hud.parentNode) {
        this.hud.parentNode.removeChild(this.hud);
      }
      this.hud = null;
      this.counterEl = null;
      this.isTracking = false;
      clearTimeout(this.scrollTimer);
      window.removeEventListener('scroll', this._onScroll);
    }
  }

  // --- 6. Floating Capture Indicator (100% Transparent Upper-Right Lottie) ---
  class FloatingCaptureLoader {
    constructor() {
      if (FloatingCaptureLoader._instance) {
        return FloatingCaptureLoader._instance;
      }
      this.el = null;
      this.box = null;
      this.anim = null;
      this.isShown = false;
      FloatingCaptureLoader._instance = this;
    }

    create() {
      // Strict singleton guard: if container and anim exist, do not re-create or reload
      if (this.el && document.documentElement && document.documentElement.contains(this.el)) {
        if (this.anim) {
          return;
        }
      }

      // Cleanup any legacy or duplicate loader
      const existing = document.getElementById('pagesnap-floating-loader');
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }

      // 1. Transparent floating container in upper-right below toolbar with safe margins (~1 inch left of original)
      const container = document.createElement('div');
      container.id = 'pagesnap-floating-loader';
      container.style.cssText = [
        'position: fixed !important',
        'top: 75px !important',
        'right: 176px !important',
        'width: 56px !important',
        'height: 56px !important',
        'z-index: 2147483647 !important',
        'pointer-events: none !important',
        'background: transparent !important',
        'background-color: transparent !important',
        'border: none !important',
        'outline: none !important',
        'box-shadow: none !important',
        'padding: 0 !important',
        'margin: 0 !important',
        'display: block !important',
        'opacity: 1 !important',
        'visibility: visible !important',
        'overflow: visible !important'
      ].join('; ');

      const box = document.createElement('div');
      box.id = 'pagesnap-lottie-box';
      box.style.cssText = [
        'width: 56px !important',
        'height: 56px !important',
        'background: transparent !important',
        'background-color: transparent !important',
        'border: none !important',
        'outline: none !important',
        'box-shadow: none !important',
        'margin: 0 !important',
        'padding: 0 !important',
        'overflow: visible !important',
        'display: flex !important',
        'align-items: center !important',
        'justify-content: center !important'
      ].join('; ');

      container.appendChild(box);
      (document.documentElement || document.body).appendChild(container);

      this.el = container;
      this.box = box;

      // 2. Initialize single persistent continuous Lottie instance
      const lottieLib = window.lottie || (typeof globalThis !== 'undefined' ? globalThis.lottie : null);
      const animData = window.__PAGESNAP_TIMING_ANIMATION__;

      if (lottieLib && animData) {
        try {
          this.anim = lottieLib.loadAnimation({
            container: box,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            animationData: animData,
            rendererSettings: {
              preserveAspectRatio: 'xMidYMid meet'
            }
          });

          const fitSvg = () => {
            const svg = box.querySelector('svg');
            if (svg) {
              // Exact artwork bounds: [24, 20] to [231, 224] fills ~52px of 56px box (93% fill)
              svg.setAttribute('viewBox', '18 16 218 214');
              svg.style.setProperty('background', 'transparent', 'important');
              svg.style.setProperty('background-color', 'transparent', 'important');
              svg.style.setProperty('width', '56px', 'important');
              svg.style.setProperty('height', '56px', 'important');
              svg.style.setProperty('filter', 'none', 'important');
              svg.style.setProperty('overflow', 'visible', 'important');
            }
          };

          this.anim.addEventListener('DOMLoaded', fitSvg);
          fitSvg();
        } catch (e) {
          console.warn('[PageSnap] Lottie initialization error:', e);
        }
      }
    }

    show() {
      if (!this.el || !document.documentElement || !document.documentElement.contains(this.el)) {
        this.create();
      }
      if (this.el) {
        this.el.style.setProperty('opacity', '1', 'important');
        this.el.style.setProperty('visibility', 'visible', 'important');
        this.el.style.setProperty('display', 'block', 'important');
      }
      // Ensure playing without resetting keyframe to 0
      if (this.anim && this.anim.isPaused) {
        this.anim.play();
      }
      this.isShown = true;
    }

    hide() {
      // Temporarily hide for sub-frame screenshot isolation via opacity:0
      // In Chromium, opacity:0 keeps the animation loop running smoothly without keyframe pauses or reset
      if (this.el) {
        this.el.style.setProperty('opacity', '0', 'important');
      }
      this.isShown = false;
    }

    remove() {
      if (this.anim) {
        try {
          this.anim.stop();
          this.anim.destroy();
        } catch (e) {}
        this.anim = null;
      }
      if (this.el && this.el.parentNode) {
        this.el.parentNode.removeChild(this.el);
      }
      const existing = document.getElementById('pagesnap-floating-loader');
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      this.el = null;
      this.box = null;
      this.isShown = false;
      FloatingCaptureLoader._instance = null;
    }
  }

  // --- 7. Local Optical Character Recognition (OCR) Engine ---
  const OCR_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,!?:;\'"()-+/*=$%&@#_<>[]{}—₹';
  const ALL_CHARS = OCR_CHARSET.split('');
  const GRID_SIZE = 20;
  let fontTemplateCache = null;

  function buildFontTemplateBank() {
    if (fontTemplateCache) return fontTemplateCache;
    const canvas = document.createElement('canvas');
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
            const normalized = normalizeGlyphToGrid(glyphInfo.binary, glyphInfo.width, glyphInfo.height, GRID_SIZE);
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

  function extractSingleGlyphFromData(data, w, h) {
    let minX = w, maxX = 0, minY = h, maxY = 0;
    let hasInk = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        if (lum < 160) {
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

  function normalizeGlyphToGrid(binary, w, h, targetSize = GRID_SIZE) {
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

  function countHoles(binary, w, h) {
    const pw = w + 2;
    const ph = h + 2;
    const visited = new Uint8Array(pw * ph);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (binary[y * w + x] === 1) {
          visited[(y + 1) * pw + (x + 1)] = 1;
        }
      }
    }

    const queue = [0];
    visited[0] = 2;

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

    let holeCount = 0;
    for (let y = 1; y <= h; y++) {
      for (let x = 1; x <= w; x++) {
        const idx = y * pw + x;
        if (visited[idx] === 0) {
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

  function preprocessCanvas(sourceCanvas) {
    const upscaleFactor = sourceCanvas.height < 60 ? 2 : 1.5;
    const targetW = Math.round(sourceCanvas.width * upscaleFactor);
    const targetH = Math.round(sourceCanvas.height * upscaleFactor);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);

    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    const { data } = imgData;

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

    const isDarkBg = borderCount > 0 && (borderLumSum / borderCount) < 120;
    if (isDarkBg) {
      for (let i = 0; i < gray.length; i++) {
        gray[i] = 255 - gray[i];
      }
    }

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

    const binary = new Uint8Array(targetW * targetH);
    for (let i = 0; i < gray.length; i++) {
      binary[i] = gray[i] < otsuThreshold ? 1 : 0;
    }

    return { binary, width: targetW, height: targetH };
  }

  function segmentTextLines(binary, width, height) {
    const projY = new Int32Array(height);
    for (let y = 0; y < height; y++) {
      let rowInk = 0;
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        rowInk += binary[rowOffset + x];
      }
      projY[y] = rowInk;
    }

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
          if (y - lineStart >= 6) {
            lines.push({ startY: lineStart, endY: y });
          }
        }
      }
    }
    if (inLine && height - lineStart >= 6) {
      lines.push({ startY: lineStart, endY: height - 1 });
    }

    if (lines.length === 0) {
      lines.push({ startY: 0, endY: height - 1 });
    }

    const extractedLines = [];
    for (const line of lines) {
      const lineH = line.endY - line.startY + 1;
      const glyphs = extractComponentsInRegion(binary, width, line.startY, line.endY);

      if (glyphs.length > 0) {
        glyphs.sort((a, b) => a.x - b.x);
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

        const overlapStart = Math.max(base.x, other.x);
        const overlapEnd = Math.min(base.x + base.width, other.x + other.width);
        const overlapW = overlapEnd - overlapStart;
        const minW = Math.min(base.width, other.width);

        if (overlapW > 0 && overlapW >= minW * 0.3) {
          const totalSpan = Math.max(base.y + base.height, other.y + other.height) - Math.min(base.y, other.y);
          if (totalSpan <= lineH * 1.25) {
            const newMinX = Math.min(base.x, other.x);
            const newMaxX = Math.max(base.x + base.width, other.x + other.width);
            const newMinY = Math.min(base.y, other.y);
            const newMaxY = Math.max(base.y + base.height, other.y + other.height);
            const newW = newMaxX - newMinX;
            const newH = newMaxY - newMinY;

            const mergedBinary = new Uint8Array(newW * newH);

            for (let y = 0; y < base.height; y++) {
              for (let x = 0; x < base.width; x++) {
                if (base.binary[y * base.width + x] === 1) {
                  const mx = (base.x - newMinX) + x;
                  const my = (base.y - newMinY) + y;
                  mergedBinary[my * newW + mx] = 1;
                }
              }
            }

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

  function classifyGlyph(glyph, templates, line = null) {
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
      let intersection = 0;
      let union = 0;

      for (let k = 0; k < GRID_SIZE * GRID_SIZE; k++) {
        const gVal = normGrid[k];
        const tVal = t.grid[k];
        intersection += Math.min(gVal, tVal);
        union += Math.max(gVal, tVal);
      }

      const jaccard = union > 0 ? (intersection / union) : 0;
      const aspectDiff = Math.abs(glyphAspect - t.aspect) / Math.max(0.2, t.aspect);
      const aspectPenalty = Math.min(0.35, aspectDiff * 0.25);

      let holeScore = 0;
      if (glyphHoles === t.holes) {
        holeScore = 0.15;
      } else if (Math.abs(glyphHoles - t.holes) > 1) {
        holeScore = -0.3;
      }

      let heightPenalty = 0;
      const isXHeight = 'acegmnopqrsuvwxyz'.includes(t.char);
      const isCapOrAscender = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789bdfhkl$₹'.includes(t.char);
      if (isXHeight && candRelH > 0.75 && !hasDescender) {
        heightPenalty += 0.22;
      } else if (isCapOrAscender && candRelH < 0.6) {
        heightPenalty += 0.25;
      }

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

      if (t.char === ',' && candRelY < 0.40) {
        heightPenalty += 0.85;
      } else if (t.char === '\'' && candRelY > 0.40) {
        heightPenalty += 0.85;
      } else if (t.char === '.' && (candRelY < 0.50 || candRelBottom > 0.85)) {
        heightPenalty += 0.70;
      } else if (t.char === ',' && candRelBottom > 0.80 && glyphAspect < 0.75) {
        heightPenalty -= 0.25;
      }

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

  function postProcessExtractedText(rawText) {
    if (!rawText) return '';
    return rawText;
  }

  async function extractTextFromImage(imageSource) {
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
      } catch (e) {}
    }

    let canvas;
    if (imageSource instanceof HTMLCanvasElement) {
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
    } else {
      throw new Error('Unsupported image source format');
    }

    const preprocessed = preprocessCanvas(canvas);
    const { binary, width, height } = preprocessed;
    const segmentedLines = segmentTextLines(binary, width, height);

    if (segmentedLines.length === 0) {
      return { text: '', lines: [], confidence: 0, glyphCount: 0 };
    }

    const templates = buildFontTemplateBank();
    if (!templates || templates.length === 0) {
      return { text: '', lines: [], confidence: 0, glyphCount: 0 };
    }

    const textLines = [];
    let totalScore = 0;
    let totalGlyphs = 0;

    for (const line of segmentedLines) {
      let lineStr = '';
      const glyphs = line.glyphs;
      const widths = glyphs.map(g => g.width).sort((a, b) => a - b);
      const medianW = widths[Math.floor(widths.length / 2)] || 12;
      const spaceThreshold = Math.max(8, Math.min(medianW * 0.60, line.lineH * 0.35));

      for (let i = 0; i < glyphs.length; i++) {
        const g = glyphs[i];

        const match = classifyGlyph(g, templates, line);
        let ch = match.char;

        if (i > 0) {
          const prevG = glyphs[i - 1];
          const gap = g.x - (prevG.x + prevG.width);
          const noSpaceBefore = ',.:;!?)]}%';
          if (gap >= spaceThreshold && !noSpaceBefore.includes(ch)) {
            lineStr += ' ';
          }
        }

        // Disambiguate vertical stroke: 'I' after lowercase letter is 'l'
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

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      return true;
    } catch (err) {
      return false;
    } finally {
      if (ta.parentNode) ta.parentNode.removeChild(ta);
    }
  }

  // --- 8. DOM and Graphic Elements Query Pipelines ---
  function findGraphicElementsInRect(rect) {
    const selLeft = rect.x;
    const selTop = rect.y;
    const selRight = rect.x + rect.width;
    const selBottom = rect.y + rect.height;

    const allGraphics = document.querySelectorAll('img, canvas, svg, video');
    const candidates = [];

    for (const el of allGraphics) {
      if (el.closest('[id^="pagesnap"]')) continue;
      const r = el.getBoundingClientRect();
      const overlapLeft = Math.max(selLeft, r.left);
      const overlapTop = Math.max(selTop, r.top);
      const overlapRight = Math.min(selRight, r.right);
      const overlapBottom = Math.min(selBottom, r.bottom);
      const overlapW = overlapRight - overlapLeft;
      const overlapH = overlapBottom - overlapTop;

      if (overlapW >= 15 && overlapH >= 15) {
        candidates.push({
          element: el,
          rect: {
            left: overlapLeft,
            top: overlapTop,
            right: overlapRight,
            bottom: overlapBottom,
            width: overlapW,
            height: overlapH
          }
        });
      }
    }

    return candidates;
  }

  function extractDomTextInRect(rect) {
    const selLeft = rect.x;
    const selTop = rect.y;
    const selRight = rect.x + rect.width;
    const selBottom = rect.y + rect.height;

    const fragments = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || parent.closest('[id^="pagesnap"]')) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let textNode;
    const range = document.createRange();

    while ((textNode = walker.nextNode())) {
      const parent = textNode.parentElement;
      const blockParent = parent.closest('p, h1, h2, h3, h4, h5, h6, li, td, th, div, article, section, header, footer, aside, blockquote, pre, code') || parent;
      const fullText = textNode.nodeValue;
      const tokenRegex = /\S+/g;
      let match;

      while ((match = tokenRegex.exec(fullText)) !== null) {
        const startIdx = match.index;
        const endIdx = startIdx + match[0].length;
        const tokenStr = match[0];

        try {
          range.setStart(textNode, startIdx);
          range.setEnd(textNode, endIdx);
          const r = range.getBoundingClientRect();

          const overlapW = Math.max(0, Math.min(selRight, r.right) - Math.max(selLeft, r.left));
          const overlapH = Math.max(0, Math.min(selBottom, r.bottom) - Math.max(selTop, r.top));

          if (overlapW > 0 && overlapH > 0 && (overlapW >= Math.min(r.width * 0.35, 4))) {
            fragments.push({
              text: tokenStr,
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
              centerY: (r.top + r.bottom) / 2,
              blockElement: blockParent
            });
          }
        } catch (e) {}
      }
    }

    if (fragments.length === 0) {
      return { hasUsableDomText: false, rawExtractedText: '' };
    }

    fragments.sort((a, b) => {
      const dy = a.top - b.top;
      if (Math.abs(dy) > 4) return dy;
      return a.left - b.left;
    });

    const lines = [];
    for (const frag of fragments) {
      let added = false;
      for (const line of lines) {
        const vOverlap = Math.max(0, Math.min(frag.bottom, line.bottom) - Math.max(frag.top, line.top));
        if (Math.abs(frag.centerY - line.centerY) <= Math.min(frag.height, line.height) * 0.45 || vOverlap >= Math.min(frag.height, line.height) * 0.5) {
          line.fragments.push(frag);
          line.left = Math.min(line.left, frag.left);
          line.right = Math.max(line.right, frag.right);
          line.top = Math.min(line.top, frag.top);
          line.bottom = Math.max(line.bottom, frag.bottom);
          line.height = line.bottom - line.top;
          line.centerY = (line.top + line.bottom) / 2;
          added = true;
          break;
        }
      }

      if (!added) {
        lines.push({
          top: frag.top,
          bottom: frag.bottom,
          left: frag.left,
          right: frag.right,
          height: frag.height,
          centerY: frag.centerY,
          blockElement: frag.blockElement,
          fragments: [frag]
        });
      }
    }

    lines.sort((a, b) => a.top - b.top);

    const reconstructedLines = [];
    for (const line of lines) {
      line.fragments.sort((a, b) => a.left - b.left);
      const lineText = line.fragments.map(f => f.text).join(' ');
      reconstructedLines.push({
        text: lineText,
        blockElement: line.blockElement,
        top: line.top,
        bottom: line.bottom,
        left: line.left,
        right: line.right,
        height: line.height
      });
    }

    let assembledText = '';
    for (let i = 0; i < reconstructedLines.length; i++) {
      const curr = reconstructedLines[i];
      if (i === 0) {
        assembledText += curr.text;
      } else {
        const prev = reconstructedLines[i - 1];
        const isDifferentBlock = prev.blockElement !== curr.blockElement;
        const verticalGap = curr.top - prev.bottom;
        const isLargeGap = verticalGap > Math.min(prev.height, curr.height) * 0.75;

        if (isDifferentBlock || isLargeGap) {
          const isListItem = (prev.blockElement && prev.blockElement.tagName === 'LI') || (curr.blockElement && curr.blockElement.tagName === 'LI');
          assembledText += (isListItem ? '\n' : '\n\n') + curr.text;
        } else {
          assembledText += ' ' + curr.text;
        }
      }
    }

    return {
      hasUsableDomText: assembledText.trim().length > 0,
      rawExtractedText: assembledText.trim(),
      lines: reconstructedLines
    };
  }

  // --- 9. Text Extractor Manager & Interactive Modal UI ---
  class TextExtractorManager {
    constructor() {
      this.overlay = null;
      this.box = null;
      this.dimEl = null;
      this.loadingEl = null;
      this.modalBackdrop = null;
      this.isDragging = false;
      this.startX = 0;
      this.startY = 0;
      this.rect = { x: 0, y: 0, width: 0, height: 0 };
    }

    activate() {
      this.deactivate();

      const overlay = document.createElement('div');
      overlay.id = 'pagesnap-pro-ocr-overlay';

      const tip = document.createElement('div');
      tip.className = 'pagesnap-ocr-tip';
      tip.innerHTML = '<span style="font-size:15px;">🔍</span> <span>Drag to select text area • ESC to cancel</span>';

      const box = document.createElement('div');
      box.id = 'pagesnap-pro-ocr-box';
      box.style.display = 'none';

      const dim = document.createElement('div');
      dim.className = 'pagesnap-ocr-dim';
      dim.textContent = '0 × 0 px';
      box.appendChild(dim);

      overlay.appendChild(tip);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      this.overlay = overlay;
      this.box = box;
      this.dimEl = dim;

      this.bindSelectionEvents();
    }

    bindSelectionEvents() {
      this._onMouseDown = this.handleMouseDown.bind(this);
      this._onMouseMove = this.handleMouseMove.bind(this);
      this._onMouseUp = this.handleMouseUp.bind(this);
      this._onKeyDown = this.handleKeyDown.bind(this);

      this.overlay.addEventListener('mousedown', this._onMouseDown);
      window.addEventListener('mousemove', this._onMouseMove);
      window.addEventListener('mouseup', this._onMouseUp);
      window.addEventListener('keydown', this._onKeyDown);
    }

    handleMouseDown(e) {
      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.rect = { x: this.startX, y: this.startY, width: 0, height: 0 };
      this.box.style.display = 'block';
      this.updateBoxDOM();
    }

    handleMouseMove(e) {
      if (!this.isDragging) return;
      const curX = e.clientX;
      const curY = e.clientY;
      this.rect.x = Math.min(this.startX, curX);
      this.rect.y = Math.min(this.startY, curY);
      this.rect.width = Math.abs(curX - this.startX);
      this.rect.height = Math.abs(curY - this.startY);
      this.updateBoxDOM();
    }

    updateBoxDOM() {
      if (!this.box) return;
      this.box.style.left = `${this.rect.x}px`;
      this.box.style.top = `${this.rect.y}px`;
      this.box.style.width = `${this.rect.width}px`;
      this.box.style.height = `${this.rect.height}px`;
      this.dimEl.textContent = `${Math.round(this.rect.width)} × ${Math.round(this.rect.height)} px`;
    }

    async handleMouseUp() {
      if (!this.isDragging) return;
      this.isDragging = false;

      const { width, height } = this.rect;
      if (width < 10 || height < 10) {
        this.deactivate();
        return;
      }

      const captureRect = {
        x: this.rect.x,
        y: this.rect.y,
        width: this.rect.width,
        height: this.rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      };

      this.removeSelectionOverlay();
      this.showLoading();

      try {
        const domResult = extractDomTextInRect(captureRect);
        const graphicCandidates = findGraphicElementsInRect(captureRect);
        let finalResult = null;

        const hasDomText = domResult && domResult.hasUsableDomText && domResult.rawExtractedText.trim().length > 0;
        const hasGraphics = graphicCandidates.length > 0;

        // Case 1: Pure selectable DOM text with no graphics in the selected area
        if (hasDomText && !hasGraphics) {
          finalResult = {
            text: domResult.rawExtractedText,
            lines: domResult.rawExtractedText.split('\n'),
            source: 'dom',
            confidence: 100,
            glyphCount: domResult.rawExtractedText.length
          };
        } else {
          // We need screenshot pixels for OCR (either pure graphic or hybrid)
          const cropResp = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: 'CAPTURE_OCR_CROP',
              rect: captureRect
            }, (res) => resolve(res));
          });

          if (!cropResp || !cropResp.croppedDataUrl) {
            // Fallback gracefully to DOM text if available
            if (hasDomText) {
              finalResult = {
                text: domResult.rawExtractedText,
                lines: domResult.rawExtractedText.split('\n'),
                source: 'dom',
                confidence: 100,
                glyphCount: domResult.rawExtractedText.length
              };
            } else {
              throw new Error('Failed to capture selected region for OCR');
            }
          } else {
            const cropImg = new Image();
            cropImg.src = cropResp.croppedDataUrl;
            await new Promise((res, rej) => { cropImg.onload = res; cropImg.onerror = rej; });

            const croppedCanvas = document.createElement('canvas');
            croppedCanvas.width = cropImg.naturalWidth || cropImg.width;
            croppedCanvas.height = cropImg.naturalHeight || cropImg.height;
            const cCtx = croppedCanvas.getContext('2d');
            cCtx.drawImage(cropImg, 0, 0);

            // Case 2: Pure graphic selection (no selectable DOM text found)
            if (!hasDomText) {
              const ocrResult = await extractTextFromImage(croppedCanvas);
              finalResult = {
                ...ocrResult,
                source: 'ocr'
              };
            } else {
              // Case 3: HYBRID EXTRACTION (both DOM text and graphics exist)
              const hybridItems = [];

              // Add DOM text lines
              if (domResult.lines && domResult.lines.length > 0) {
                for (const dLine of domResult.lines) {
                  if (dLine.text && dLine.text.trim()) {
                    hybridItems.push({
                      type: 'dom',
                      text: dLine.text.trim(),
                      top: dLine.top,
                      bottom: dLine.bottom,
                      height: dLine.height,
                      left: dLine.left,
                      blockElement: dLine.blockElement
                    });
                  }
                }
              }

              // Run OCR on each graphic element
              const dpr = captureRect.dpr || 1;
              for (const cand of graphicCandidates) {
                const subX = Math.max(0, Math.round((cand.rect.left - captureRect.x) * dpr));
                const subY = Math.max(0, Math.round((cand.rect.top - captureRect.y) * dpr));
                const subW = Math.min(croppedCanvas.width - subX, Math.round(cand.rect.width * dpr));
                const subH = Math.min(croppedCanvas.height - subY, Math.round(cand.rect.height * dpr));

                if (subW >= 15 && subH >= 15) {
                  const subCanvas = document.createElement('canvas');
                  subCanvas.width = subW;
                  subCanvas.height = subH;
                  const sCtx = subCanvas.getContext('2d');
                  sCtx.drawImage(croppedCanvas, subX, subY, subW, subH, 0, 0, subW, subH);

                  const ocrRes = await extractTextFromImage(subCanvas);
                  if (ocrRes && ocrRes.text && ocrRes.text.trim().length > 0) {
                    const ocrLines = ocrRes.text.split('\n').map(l => l.trim()).filter(Boolean);
                    const lineSpan = cand.rect.height / Math.max(1, ocrLines.length);

                    for (let li = 0; li < ocrLines.length; li++) {
                      const lText = ocrLines[li];
                      // Check for duplicate with existing DOM items
                      const isDuplicate = hybridItems.some(item => {
                        const itemNorm = item.text.replace(/[\s\-_]/g, '').toLowerCase();
                        const ocrNorm = lText.replace(/[\s\-_]/g, '').toLowerCase();
                        return itemNorm === ocrNorm || itemNorm.includes(ocrNorm) || ocrNorm.includes(itemNorm);
                      });

                      if (!isDuplicate) {
                        hybridItems.push({
                          type: 'ocr',
                          text: lText,
                          top: cand.rect.top + (li * lineSpan),
                          bottom: cand.rect.top + ((li + 1) * lineSpan),
                          height: lineSpan,
                          left: cand.rect.left
                        });
                      }
                    }
                  }
                }
              }

              // Sort all hybrid items vertically in natural visual reading order
              hybridItems.sort((a, b) => {
                const dy = a.top - b.top;
                if (Math.abs(dy) > 6) return dy;
                return (a.left || 0) - (b.left || 0);
              });

              // Assemble text
              let assembledHybrid = '';
              for (let i = 0; i < hybridItems.length; i++) {
                const item = hybridItems[i];
                if (i === 0) {
                  assembledHybrid += item.text;
                } else {
                  const prev = hybridItems[i - 1];
                  if (prev.type === 'dom' && item.type === 'dom' && prev.blockElement === item.blockElement) {
                    assembledHybrid += ' ' + item.text;
                  } else {
                    assembledHybrid += '\n\n' + item.text;
                  }
                }
              }

              finalResult = {
                text: assembledHybrid.trim(),
                lines: assembledHybrid.trim().split('\n'),
                source: 'hybrid',
                confidence: 95,
                glyphCount: assembledHybrid.length
              };
            }
          }
        }

        this.hideLoading();
        this.showResultModal(finalResult);
      } catch (err) {
        console.error('Text Extractor error:', err);
        this.hideLoading();
        this.showResultModal({ text: '', lines: [], error: err.message });
      }
    }

    handleKeyDown(e) {
      if (e.key === 'Escape') {
        this.deactivate();
      }
    }

    showLoading() {
      this.hideLoading();
      const loading = document.createElement('div');
      loading.id = 'pagesnap-pro-ocr-loading';

      const spinner = document.createElement('div');
      spinner.className = 'pagesnap-ocr-spinner';

      const text = document.createElement('span');
      text.className = 'pagesnap-ocr-loading-text';
      text.textContent = 'Extracting text...';

      loading.appendChild(spinner);
      loading.appendChild(text);
      document.body.appendChild(loading);
      this.loadingEl = loading;
    }

    hideLoading() {
      if (this.loadingEl && this.loadingEl.parentNode) {
        this.loadingEl.parentNode.removeChild(this.loadingEl);
      }
      this.loadingEl = null;
    }

    showResultModal(ocrResult) {
      this.closeModal();

      const backdrop = document.createElement('div');
      backdrop.id = 'pagesnap-pro-ocr-modal-backdrop';

      const modal = document.createElement('div');
      modal.id = 'pagesnap-pro-ocr-modal';

      // Header
      const header = document.createElement('div');
      header.className = 'pagesnap-ocr-header';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'pagesnap-ocr-title-group';

      const iconSvg = document.createElement('span');
      iconSvg.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
        <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
        <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
        <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
        <line x1="8" y1="9" x2="16" y2="9"></line>
        <line x1="12" y1="9" x2="12" y2="16"></line>
        <line x1="10" y1="16" x2="14" y2="16"></line>
      </svg>`;

      const title = document.createElement('span');
      title.className = 'pagesnap-ocr-title';
      title.textContent = 'Extracted Text';

      const badge = document.createElement('span');
      badge.className = 'pagesnap-ocr-badge';
      badge.textContent = 'OCR';

      titleGroup.appendChild(iconSvg);
      titleGroup.appendChild(title);
      titleGroup.appendChild(badge);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'pagesnap-ocr-close-btn';
      closeBtn.innerHTML = '✕';
      closeBtn.title = 'Close (ESC)';
      closeBtn.onclick = () => this.closeModal();

      header.appendChild(titleGroup);
      header.appendChild(closeBtn);

      // Body
      const body = document.createElement('div');
      body.className = 'pagesnap-ocr-body';

      const textVal = (ocrResult && ocrResult.text) ? ocrResult.text.trim() : '';
      let textarea = null;

      if (textVal.length > 0) {
        textarea = document.createElement('textarea');
        textarea.className = 'pagesnap-ocr-textarea';
        textarea.value = textVal;
        textarea.spellcheck = false;
        body.appendChild(textarea);
      } else {
        const emptyState = document.createElement('div');
        emptyState.className = 'pagesnap-ocr-empty-state';
        emptyState.innerHTML = `
          <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
          <div style="font-weight: 600; color: #f8fafc; margin-bottom: 4px;">No readable text was detected in this area.</div>
          <div style="font-size: 12px; color: #94a3b8;">Try selecting a higher contrast or clearer image region.</div>
        `;
        body.appendChild(emptyState);
      }

      // Footer
      const footer = document.createElement('div');
      footer.className = 'pagesnap-ocr-footer';

      const info = document.createElement('div');
      info.className = 'pagesnap-ocr-info';
      const count = textVal.length;
      info.textContent = count > 0 ? `${count} characters • 100% offline & local` : '0 characters detected';

      const actions = document.createElement('div');
      actions.className = 'pagesnap-ocr-actions';

      const closeSecBtn = document.createElement('button');
      closeSecBtn.className = 'pagesnap-ocr-btn pagesnap-ocr-btn-sec';
      closeSecBtn.textContent = 'Close';
      closeSecBtn.onclick = () => this.closeModal();
      actions.appendChild(closeSecBtn);

      if (count > 0) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'pagesnap-ocr-btn pagesnap-ocr-btn-primary';
        copyBtn.innerHTML = '📋 Copy All';
        copyBtn.onclick = async () => {
          const valToCopy = textarea ? textarea.value : textVal;
          await copyToClipboard(valToCopy);
          copyBtn.innerHTML = '✔ Copied!';
          copyBtn.classList.add('pagesnap-ocr-btn-copied');
          setTimeout(() => {
            if (copyBtn) {
              copyBtn.innerHTML = '📋 Copy All';
              copyBtn.classList.remove('pagesnap-ocr-btn-copied');
            }
          }, 2000);
        };
        actions.appendChild(copyBtn);
      }

      footer.appendChild(info);
      footer.appendChild(actions);

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      backdrop.appendChild(modal);

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          this.closeModal();
        }
      });

      this._modalKeyDown = (e) => {
        if (e.key === 'Escape') {
          this.closeModal();
        }
      };
      window.addEventListener('keydown', this._modalKeyDown);

      document.body.appendChild(backdrop);
      this.modalBackdrop = backdrop;

      if (textarea) {
        setTimeout(() => textarea.focus(), 50);
      }
    }

    closeModal() {
      if (this.modalBackdrop && this.modalBackdrop.parentNode) {
        this.modalBackdrop.parentNode.removeChild(this.modalBackdrop);
      }
      this.modalBackdrop = null;
      if (this._modalKeyDown) {
        window.removeEventListener('keydown', this._modalKeyDown);
        this._modalKeyDown = null;
      }
    }

    removeSelectionOverlay() {
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      this.overlay = null;
      this.box = null;
      this.dimEl = null;
      window.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('mouseup', this._onMouseUp);
      window.removeEventListener('keydown', this._onKeyDown);
    }

    deactivate() {
      this.removeSelectionOverlay();
      this.hideLoading();
      this.closeModal();
    }
  }

  // --- Singleton Instances ---
  const scrollManager = new ScrollManager();
  const fixedHandler = new FixedElementHandler();
  const manualHUD = new ManualCaptureHUD();
  const floatingLoader = new FloatingCaptureLoader();
  const textExtractor = new TextExtractorManager();
  let areaSelector = null;

  // Expose helper on window for inspection and testing
  window.__pagesnap = {
    getPageMetrics,
    scrollManager,
    fixedHandler,
    manualHUD,
    progressHUD: floatingLoader,
    floatingLoader,
    textExtractor,
    extractDomTextInRect,
    findGraphicElementsInRect,
    extractTextFromImage,
    preprocessCanvas,
    segmentTextLines,
    classifyGlyph,
    buildFontTemplateBank
  };

  // --- 7. Runtime Message Dispatcher ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'PING':
            sendResponse({ alive: true });
            break;

          case 'GET_PAGE_METRICS':
            sendResponse(getPageMetrics());
            break;

          case 'PREPARE_PAGE':
            scrollManager.prepare();
            sendResponse(getPageMetrics());
            break;

          case 'SCROLL_PAGE': {
            const result = await scrollManager.scrollTo(0, message.y);
            sendResponse(result);
            break;
          }

          case 'HIDE_FIXED_ELEMENTS':
            fixedHandler.hideForSubsequentSlices();
            sendResponse({ success: true });
            break;

          case 'SHOW_FIXED_ELEMENTS':
            fixedHandler.restore();
            sendResponse({ success: true });
            break;

          case 'SHOW_CAPTURE_LOADER':
            floatingLoader.show();
            sendResponse({ success: true });
            break;

          case 'HIDE_CAPTURE_LOADER':
            floatingLoader.hide();
            // Double requestAnimationFrame guarantees browser paint engine has cleared loader before screenshot
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                sendResponse({ success: true });
              });
            });
            return true;

          case 'REMOVE_CAPTURE_LOADER':
            floatingLoader.remove();
            sendResponse({ success: true });
            break;

          case 'RESTORE_PAGE':
            scrollManager.restore();
            fixedHandler.restore();
            manualHUD.deactivate();
            floatingLoader.remove();
            if (areaSelector) areaSelector.deactivate();
            if (textExtractor) textExtractor.deactivate();
            sendResponse({ success: true });
            break;

          case 'ACTIVATE_AREA_SELECTOR': {
            areaSelector = new AreaSelector(
              (rect) => {
                chrome.runtime.sendMessage({ type: 'AREA_SELECTED', rect });
              },
              () => {
                chrome.runtime.sendMessage({ type: 'CANCEL_CAPTURE' });
              }
            );
            areaSelector.activate();
            sendResponse({ success: true });
            break;
          }

          case 'ACTIVATE_TEXT_EXTRACTOR': {
            textExtractor.activate();
            sendResponse({ success: true });
            break;
          }

          case 'ACTIVATE_MANUAL_HUD':
            manualHUD.activate(message.initialCount || 1);
            sendResponse({ success: true });
            break;

          case 'UPDATE_MANUAL_COUNT':
            manualHUD.updateCount(message.count);
            sendResponse({ success: true });
            break;

          case 'DEACTIVATE_MANUAL_HUD':
            manualHUD.deactivate();
            sendResponse({ success: true });
            break;

          case 'CAPTURE_PROGRESS':
            if (message.status === 'COMPLETED' || message.status === 'CANCELLED' || message.status === 'ERROR') {
              floatingLoader.remove();
            }
            sendResponse({ success: true });
            break;

          default:
            sendResponse({ unhandled: true });
        }
      } catch (err) {
        console.error('Content script message error:', err);
        sendResponse({ error: err.message });
      }
    })();

    return true; // Keep channel open for async response
  });
})();
