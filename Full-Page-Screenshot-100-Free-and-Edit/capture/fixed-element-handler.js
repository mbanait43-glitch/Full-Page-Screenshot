// capture/fixed-element-handler.js: Non-destructive sticky/fixed element handling during multi-slice capture

export class FixedElementHandler {
  constructor() {
    this.modifiedElements = new Map(); // el -> { originalVisibility, originalTransition }
    this.isActive = false;
  }

  // Scan and identify all fixed or sticky elements
  findFixedAndStickyElements() {
    const elements = document.querySelectorAll('*');
    const fixedSticky = [];

    // Filter to visible elements with fixed/sticky position
    for (const el of elements) {
      // Skip extension HUD or overlay elements
      if (el.id && el.id.startsWith('pagesnap-pro')) continue;
      if (el.closest && el.closest('[id^="pagesnap-pro"]')) continue;

      const style = window.getComputedStyle(el);
      const pos = style.position;

      if (pos === 'fixed' || pos === 'sticky') {
        const rect = el.getBoundingClientRect();
        // Only care about elements that occupy visible space
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
    }

    return fixedSticky;
  }

  // Hide fixed and sticky elements for subsequent slices (slices after slice 0)
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

        // Suppress transitions so hiding is instant
        el.style.setProperty('transition', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }

    this.isActive = true;
  }

  // Show bottom-pinned elements for the final slice
  prepareForFinalSlice() {
    for (const [el, original] of this.modifiedElements.entries()) {
      const rect = el.getBoundingClientRect();
      // If element is a bottom bar or cookie banner, show it on the final slice
      if (rect.bottom >= (window.innerHeight - 120) && rect.top > window.innerHeight / 2) {
        el.style.setProperty('visibility', original.visibility || 'visible');
      }
    }
  }

  // Fully restore all elements to their original styles
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
      } catch (err) {
        // Element may have been detached by the page
      }
    }

    this.modifiedElements.clear();
    this.isActive = false;
  }
}
