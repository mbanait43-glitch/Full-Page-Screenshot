// result/result.js: Interactive logic for Result Page matching reference visual structure & workflow
// Features: Top toolbar, light workspace, centered screenshot, click-to-toggle 100%, right-click context menu

import { getCapture, getAllCaptures, deleteCapture, getSettings } from '../utils/storage.js';
import { generateFilename } from '../utils/filename-utils.js';
import { PDFBuilder } from '../utils/pdf-generator.js';
import { dataURLToBlob } from '../utils/image-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const previewImage = document.getElementById('previewImage');
  const imageStage = document.getElementById('imageStage');
  const viewportContainer = document.getElementById('viewportContainer');
  const emptyState = document.getElementById('emptyState');
  const toast = document.getElementById('toast');

  // Header action buttons
  const btnEdit = document.getElementById('btnEdit');
  const btnDelete = document.getElementById('btnDelete');
  const btnDownloadPDF = document.getElementById('btnDownloadPDF');
  const btnDownloadPNG = document.getElementById('btnDownloadPNG');
  const btnDownloadDropdown = document.getElementById('btnDownloadDropdown');
  const downloadMenu = document.getElementById('downloadMenu');
  const menuDownloadPNG = document.getElementById('menuDownloadPNG');
  const menuDownloadJPG = document.getElementById('menuDownloadJPG');
  const menuDownloadPDFA4 = document.getElementById('menuDownloadPDFA4');
  const menuDownloadPDFContinuous = document.getElementById('menuDownloadPDFContinuous');
  const btnCopy = document.getElementById('btnCopy');

  // Custom Context Menu elements
  const screenshotContextMenu = document.getElementById('screenshotContextMenu');
  const ctxSaveImage = document.getElementById('ctxSaveImage');
  const ctxSavePDF = document.getElementById('ctxSavePDF');
  const ctxCopyImage = document.getElementById('ctxCopyImage');
  const ctxEditImage = document.getElementById('ctxEditImage');
  const ctxCopyUrl = document.getElementById('ctxCopyUrl');
  const ctxOpenUrl = document.getElementById('ctxOpenUrl');

  // Floating Zoom Controls
  const zoomControls = document.getElementById('zoomControls');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomFitBtn = document.getElementById('zoomFitBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');

  let currentCapture = null;
  let viewMode = 'fit'; // 'fit' (State 1: complete preview) or 'zoom' (State 2: detailed inspection)
  let fitScale = 1.0;
  let zoomScale = 1.0;

  // 1. Load capture from IndexedDB
  const params = new URLSearchParams(window.location.search);
  const captureId = params.get('id');

  if (captureId) {
    currentCapture = await getCapture(captureId);
  }

  // Fallback to most recent capture
  if (!currentCapture) {
    const list = await getAllCaptures(1);
    if (list.length > 0) {
      currentCapture = await getCapture(list[0].id);
    }
  }

  if (!currentCapture) {
    document.title = 'Full Page Screenshot — 100% Free & Edit - No Screenshot Found';
    if (imageStage) imageStage.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    showToast('No screenshot found.');
    return;
  }

  document.title = `Full Page Screenshot — 100% Free & Edit - ${currentCapture.title || 'Screen Capture'}`;

  // 2. Set image source & initialize in FIT-TO-VIEW mode (Complete Preview)
  previewImage.src = currentCapture.dataUrl;

  previewImage.onload = () => {
    applyFitMode();
  };

  // ==========================================================================
  // Display Scaling & Zoom (STATE 1: Complete Preview, STATE 2: Inspection)
  // ==========================================================================
  function calculateFitScale() {
    if (!previewImage.naturalWidth || !previewImage.naturalHeight) return 1.0;
    // Available viewer space with 40px margin/padding (20px each side)
    const availW = Math.max(100, viewportContainer.clientWidth - 40);
    const availH = Math.max(100, viewportContainer.clientHeight - 40);
    return Math.min(availW / previewImage.naturalWidth, availH / previewImage.naturalHeight);
  }

  // STATE 1: FIT-TO-VIEW / Complete Initial Preview (Reference Image 1)
  function applyFitMode() {
    if (!previewImage.naturalWidth || !previewImage.naturalHeight) return;

    viewMode = 'fit';
    fitScale = calculateFitScale();

    const targetW = Math.max(10, Math.round(previewImage.naturalWidth * fitScale));
    const targetH = Math.max(10, Math.round(previewImage.naturalHeight * fitScale));

    imageStage.style.width = `${targetW}px`;
    imageStage.style.height = `${targetH}px`;
    imageStage.style.marginTop = 'auto';
    imageStage.style.marginBottom = 'auto';

    viewportContainer.classList.add('fit-mode');
    viewportContainer.classList.remove('zoom-mode');
    viewportContainer.classList.remove('panning');

    previewImage.style.cursor = 'zoom-in';

    if (zoomFitBtn) {
      zoomFitBtn.textContent = 'Fit';
    }

    viewportContainer.scrollTop = 0;
    viewportContainer.scrollLeft = 0;
  }

  const SECOND_PREVIEW_SCALE = 0.80; // State 2: Second Preview at approximately 80% visual scale

  // STATE 2: SECOND PREVIEW / Natural Webpage Inspection (~80% Visual Scale)
  function applyZoomMode(scale = SECOND_PREVIEW_SCALE, focusClientX = null, focusClientY = null) {
    if (!previewImage.naturalWidth || !previewImage.naturalHeight) return;

    fitScale = calculateFitScale();

    // If scale requested is at or below fitScale, return cleanly to FIT mode
    if (scale <= fitScale * 1.05) {
      applyFitMode();
      return;
    }

    const wasFitMode = (viewMode === 'fit');
    viewMode = 'zoom';
    zoomScale = Math.min(4.0, Math.max(fitScale, Math.round(scale * 100) / 100));

    const targetW = Math.round(previewImage.naturalWidth * zoomScale);
    const targetH = Math.round(previewImage.naturalHeight * zoomScale);

    // Compute relative focus point inside stage before size change if zooming within zoom mode
    let relX = 0.5;
    let relY = 0.5;
    if (!wasFitMode && focusClientX !== null && focusClientY !== null) {
      const stageRect = imageStage.getBoundingClientRect();
      if (stageRect.width > 0 && stageRect.height > 0) {
        relX = Math.max(0, Math.min(1, (focusClientX - stageRect.left) / stageRect.width));
        relY = Math.max(0, Math.min(1, (focusClientY - stageRect.top) / stageRect.height));
      }
    }

    imageStage.style.width = `${targetW}px`;
    imageStage.style.height = `${targetH}px`;

    viewportContainer.classList.remove('fit-mode');
    viewportContainer.classList.add('zoom-mode');

    // Only allow horizontal scrolling if image exceeds viewport container width
    viewportContainer.style.overflowX = (targetW > viewportContainer.clientWidth) ? 'auto' : 'hidden';
    viewportContainer.style.overflowY = 'auto';

    // Vertical margin
    const availH = viewportContainer.clientHeight;
    if (targetH < (availH - 40)) {
      const topMargin = Math.max(20, Math.floor((availH - targetH) / 2));
      imageStage.style.marginTop = `${topMargin}px`;
      imageStage.style.marginBottom = `${topMargin}px`;
    } else {
      imageStage.style.marginTop = '20px';
      imageStage.style.marginBottom = '40px';
    }

    previewImage.style.cursor = 'grab';

    if (zoomFitBtn) {
      zoomFitBtn.textContent = `${Math.round(zoomScale * 100)}%`;
    }

    if (!wasFitMode && focusClientX !== null && focusClientY !== null) {
      const rect = viewportContainer.getBoundingClientRect();
      viewportContainer.scrollLeft = Math.max(0, relX * targetW - (focusClientX - rect.left));
      viewportContainer.scrollTop = Math.max(0, relY * targetH - (focusClientY - rect.top));
    } else {
      // Natural webpage viewing experience: start clean at the top of the webpage
      viewportContainer.scrollLeft = 0;
      viewportContainer.scrollTop = 0;
    }
  }

  // Smooth mouse-drag panning when in ZOOM mode
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;
  let hasDragged = false;

  viewportContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (viewMode === 'fit') return;

    isPanning = true;
    hasDragged = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    scrollStartX = viewportContainer.scrollLeft;
    scrollStartY = viewportContainer.scrollTop;
    viewportContainer.classList.add('panning');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      hasDragged = true;
    }
    viewportContainer.scrollLeft = scrollStartX - dx;
    viewportContainer.scrollTop = scrollStartY - dy;
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      viewportContainer.classList.remove('panning');
    }
  });

  // Click screenshot directly: toggle between FIRST PREVIEW (Fit) and SECOND PREVIEW (~80% scale)
  previewImage.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (hasDragged) {
      hasDragged = false;
      return;
    }
    hideContextMenu();
    if (viewMode === 'fit') {
      applyZoomMode(SECOND_PREVIEW_SCALE);
    } else {
      applyFitMode();
    }
  });

  // Floating Zoom Controls Buttons
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (viewMode === 'fit') {
        applyZoomMode(SECOND_PREVIEW_SCALE);
      } else {
        const nextScale = Math.min(4.0, Math.round((zoomScale + 0.1) * 10) / 10);
        applyZoomMode(nextScale);
      }
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (viewMode === 'fit') return;
      const nextScale = Math.round((zoomScale - 0.1) * 10) / 10;
      if (nextScale <= fitScale * 1.05) {
        applyFitMode();
      } else {
        applyZoomMode(nextScale);
      }
    });
  }

  if (zoomFitBtn) {
    zoomFitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (viewMode === 'fit') {
        applyZoomMode(SECOND_PREVIEW_SCALE);
      } else {
        applyFitMode();
      }
    });
  }

  // Keyboard shortcuts for zooming
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      if (viewMode === 'fit') {
        applyZoomMode(SECOND_PREVIEW_SCALE);
      } else {
        applyZoomMode(Math.min(4.0, Math.round((zoomScale + 0.1) * 10) / 10));
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      if (viewMode !== 'fit') {
        const nextScale = Math.round((zoomScale - 0.1) * 10) / 10;
        if (nextScale <= fitScale * 1.05) applyFitMode();
        else applyZoomMode(nextScale);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      applyFitMode();
    }
  });

  // Responsive re-fitting on window resize
  window.addEventListener('resize', () => {
    hideContextMenu();
    if (viewMode === 'fit') {
      applyFitMode();
    } else {
      const availH = viewportContainer.clientHeight;
      const targetH = Math.round(previewImage.naturalHeight * zoomScale);
      if (targetH < (availH - 40)) {
        const topMargin = Math.max(20, Math.floor((availH - targetH) / 2));
        imageStage.style.marginTop = `${topMargin}px`;
        imageStage.style.marginBottom = `${topMargin}px`;
      }
    }
  });

  // ==========================================================================
  // Custom Right-Click Context Menu
  // ==========================================================================
  function showContextMenu(x, y) {
    if (!screenshotContextMenu) return;
    screenshotContextMenu.style.display = 'block';

    const rect = screenshotContextMenu.getBoundingClientRect();
    const menuWidth = rect.width || 215;
    const menuHeight = rect.height || 220;

    // Viewport boundary clamping
    const maxX = window.innerWidth - menuWidth - 10;
    const maxY = window.innerHeight - menuHeight - 10;

    const posX = Math.max(10, Math.min(x, maxX));
    const posY = Math.max(10, Math.min(y, maxY));

    screenshotContextMenu.style.left = `${posX}px`;
    screenshotContextMenu.style.top = `${posY}px`;
  }

  function hideContextMenu() {
    if (screenshotContextMenu) {
      screenshotContextMenu.style.display = 'none';
    }
  }

  // Right-click trigger on preview image & stage
  previewImage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY);
  });

  imageStage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY);
  });

  // Dismiss context menu
  document.addEventListener('click', (e) => {
    if (screenshotContextMenu && !screenshotContextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  viewportContainer.addEventListener('scroll', hideContextMenu);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
      if (downloadMenu) downloadMenu.classList.remove('show');
    }
  });

  // Context Menu Item Actions
  ctxSaveImage.addEventListener('click', (e) => {
    e.stopPropagation();
    hideContextMenu();
    downloadAsPNG();
  });

  ctxSavePDF.addEventListener('click', (e) => {
    e.stopPropagation();
    hideContextMenu();
    downloadAsPDF();
  });

  ctxCopyImage.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideContextMenu();
    await copyImageToClipboard();
  });

  ctxEditImage.addEventListener('click', (e) => {
    e.stopPropagation();
    hideContextMenu();
    openEditor();
  });

  ctxCopyUrl.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (currentCapture && currentCapture.url) {
      try {
        await navigator.clipboard.writeText(currentCapture.url);
        showToast('✔ Original URL copied to clipboard');
      } catch (err) {
        showToast('Failed to copy URL: ' + err.message);
      }
    } else {
      showToast('No original URL available.');
    }
  });

  ctxOpenUrl.addEventListener('click', (e) => {
    e.stopPropagation();
    hideContextMenu();
    if (currentCapture && currentCapture.url) {
      if (chrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: currentCapture.url });
      } else {
        window.open(currentCapture.url, '_blank');
      }
    } else {
      showToast('No original URL available.');
    }
  });

  // ==========================================================================
  // Header Action Operations
  // ==========================================================================

  // Format dropdown toggle
  btnDownloadDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadMenu.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (downloadMenu && !downloadMenu.contains(e.target) && e.target !== btnDownloadDropdown) {
      downloadMenu.classList.remove('show');
    }
  });

  // Downloads helper
  async function triggerDownload(blobOrUrl, filename) {
    let url = blobOrUrl;
    let revoke = false;

    if (blobOrUrl instanceof Blob) {
      url = URL.createObjectURL(blobOrUrl);
      revoke = true;
    }

    if (chrome && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url,
        filename,
        saveAs: false
      }, () => {
        if (revoke) URL.revokeObjectURL(url);
        showToast('Download started: ' + filename);
      });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (revoke) URL.revokeObjectURL(url);
      showToast('Downloaded: ' + filename);
    }
  }

  // 1. Download PNG
  async function downloadAsPNG() {
    const filename = generateFilename({
      title: currentCapture.title,
      url: currentCapture.url,
      format: 'png'
    });
    const blob = dataURLToBlob(currentCapture.dataUrl);
    await triggerDownload(blob, filename);
  }

  btnDownloadPNG.addEventListener('click', downloadAsPNG);
  menuDownloadPNG.addEventListener('click', () => {
    downloadMenu.classList.remove('show');
    downloadAsPNG();
  });

  // 2. Download JPG
  menuDownloadJPG.addEventListener('click', async () => {
    downloadMenu.classList.remove('show');
    showToast('Generating JPG...');
    const settings = await getSettings().catch(() => ({}));
    const quality = settings.jpegQuality || 0.92;

    const img = new Image();
    img.src = currentCapture.dataUrl;
    await new Promise(r => { if (img.complete) r(); else img.onload = r; });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // White background for JPG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    const filename = generateFilename({
      title: currentCapture.title,
      url: currentCapture.url,
      format: 'jpg'
    });
    await triggerDownload(blob, filename);
  });

  // 3. Download PDF (Complete Top-to-Bottom Content)
  async function downloadAsPDF(options = {}) {
    try {
      showToast('Generating PDF...');
      const settings = await getSettings().catch(() => ({}));

      // Ensure full image data is loaded
      const img = new Image();
      img.src = currentCapture.dataUrl;
      await new Promise(r => { if (img.complete) r(); else img.onload = r; });

      const pdfBlob = await PDFBuilder.createPDFFromImage(img, {
        type: options.type || settings.pdfType || 'paginated',
        pageSize: options.pageSize || settings.pdfPageSize || 'a4',
        orientation: 'portrait',
        margin: 20,
        quality: 0.95
      });

      const filename = generateFilename({
        title: currentCapture.title,
        url: currentCapture.url,
        format: 'pdf',
        prefix: options.prefix || 'Full Page Screenshot - 100% Free & Edit'
      });
      await triggerDownload(pdfBlob, filename);
    } catch (err) {
      console.error('PDF export error:', err);
      showToast('Failed to generate PDF: ' + err.message);
    }
  }

  btnDownloadPDF.addEventListener('click', () => downloadAsPDF());

  menuDownloadPDFA4.addEventListener('click', () => {
    downloadMenu.classList.remove('show');
    downloadAsPDF({ type: 'paginated', pageSize: 'a4', prefix: 'Full Page Screenshot - 100% Free & Edit (A4)' });
  });

  menuDownloadPDFContinuous.addEventListener('click', () => {
    downloadMenu.classList.remove('show');
    downloadAsPDF({ type: 'continuous', prefix: 'Full Page Screenshot - 100% Free & Edit (Continuous)' });
  });

  // 4. Copy to Clipboard
  async function copyImageToClipboard() {
    try {
      const blob = dataURLToBlob(currentCapture.dataUrl);
      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        showToast('✔ Image copied to clipboard!');
      } else {
        throw new Error('Clipboard API not available.');
      }
    } catch (err) {
      console.error('Clipboard copy error:', err);
      showToast('Failed to copy: ' + err.message);
    }
  }

  btnCopy.addEventListener('click', copyImageToClipboard);

  // 5. Open in Editor
  function openEditor() {
    const editorUrl = chrome.runtime ? chrome.runtime.getURL(`editor/editor.html?id=${encodeURIComponent(currentCapture.id)}`) : `../editor/editor.html?id=${encodeURIComponent(currentCapture.id)}`;
    if (chrome && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: editorUrl });
    } else {
      window.open(editorUrl, '_blank');
    }
  }

  btnEdit.addEventListener('click', openEditor);

  // 6. Delete Screenshot
  btnDelete.addEventListener('click', async () => {
    if (confirm('Delete this screenshot permanently?')) {
      await deleteCapture(currentCapture.id);
      showToast('Screenshot deleted.');
      if (imageStage) imageStage.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
      setTimeout(() => {
        window.location.href = '../history/history.html';
      }, 400);
    }
  });

  // 7. Keyboard Shortcuts (Ctrl+S, Ctrl+C, Ctrl+E)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        downloadAsPNG();
      } else if (e.key === 'c' || e.key === 'C') {
        const selection = window.getSelection ? window.getSelection().toString() : '';
        if (!selection) {
          e.preventDefault();
          copyImageToClipboard();
        }
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        openEditor();
      }
    }
  });

  // 8. Refresh capture if edited in Editor studio and user switches back
  window.addEventListener('focus', async () => {
    if (currentCapture && currentCapture.id) {
      try {
        const fresh = await getCapture(currentCapture.id);
        if (fresh && fresh.dataUrl && fresh.dataUrl !== currentCapture.dataUrl) {
          currentCapture = fresh;
          previewImage.src = fresh.dataUrl;
          showToast('Updated preview with latest edits.');
        }
      } catch (err) {}
    }
  });

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
  }
});
