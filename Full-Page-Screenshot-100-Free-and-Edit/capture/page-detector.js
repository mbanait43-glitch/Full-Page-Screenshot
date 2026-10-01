// capture/page-detector.js: Accurately identifies scrolling container, dimensions, and viewport metrics

export function detectPrimaryScrollingElement() {
  const doc = document;
  const win = window;

  // 1. Standard HTML5 scrolling element
  if (doc.scrollingElement && doc.scrollingElement.scrollHeight > win.innerHeight) {
    return doc.scrollingElement;
  }

  // 2. Check documentElement and body
  if (doc.documentElement && doc.documentElement.scrollHeight > win.innerHeight) {
    return doc.documentElement;
  }
  if (doc.body && doc.body.scrollHeight > win.innerHeight) {
    return doc.body;
  }

  // 3. Fallback: Search for inner scrollable containers (e.g. SPAs, dashboards, full-screen overflow divs)
  const candidateElements = doc.querySelectorAll('main, [role="main"], #root, #app, .app, .container, body > div');
  let bestContainer = null;
  let maxScrollHeight = win.innerHeight;

  for (const el of candidateElements) {
    const style = win.getComputedStyle(el);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > maxScrollHeight) {
      maxScrollHeight = el.scrollHeight;
      bestContainer = el;
    }
  }

  return bestContainer || doc.scrollingElement || doc.documentElement || doc.body;
}

export function getPageMetrics() {
  const win = window;
  const doc = document;
  const scrollEl = detectPrimaryScrollingElement();

  const viewportWidth = win.innerWidth || doc.documentElement.clientWidth;
  const viewportHeight = win.innerHeight || doc.documentElement.clientHeight;
  const dpr = win.devicePixelRatio || 1;

  // Calculate true document dimensions
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
