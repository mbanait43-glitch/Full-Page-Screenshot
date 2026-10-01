// editor/editor.js: Interactive canvas editor with rich editable object layers,
// endpoint arrow resizing, circle/rectangle transform handles, editable text & redaction,
// and multi-format exports (PNG, JPG, PDF)

import { getCapture, saveCapture, getAllCaptures } from '../utils/storage.js';
import { loadImage, createThumbnail } from '../utils/image-utils.js';
import { generateFilename } from '../utils/filename-utils.js';
import { PDFBuilder } from '../utils/pdf-generator.js';

document.addEventListener('DOMContentLoaded', async () => {
  const baseCanvas = document.getElementById('baseCanvas');
  const baseCtx = baseCanvas.getContext('2d');
  const annotationCanvas = document.getElementById('annotationCanvas');
  const annotCtx = annotationCanvas.getContext('2d');
  const canvasContainer = document.getElementById('canvasContainer');
  const editorWorkspace = document.getElementById('editorWorkspace');
  const editorTitle = document.getElementById('editorTitle');
  const backBtn = document.getElementById('backBtn');
  const toast = document.getElementById('editorToast');
  const inlineTextEditor = document.getElementById('inlineTextEditor');

  // Tool buttons
  const toolSelect = document.getElementById('toolSelect');
  const toolCrop = document.getElementById('toolCrop');
  const toolText = document.getElementById('toolText');
  const toolArrow = document.getElementById('toolArrow');
  const toolRect = document.getElementById('toolRect');
  const toolEllipse = document.getElementById('toolEllipse');
  const toolHighlight = document.getElementById('toolHighlight');
  const toolRedact = document.getElementById('toolRedact');

  // Property controls
  const propColor = document.getElementById('propColor');
  const propStrokeWidth = document.getElementById('propStrokeWidth');
  const propArrowheadSize = document.getElementById('propArrowheadSize');
  const propRedactMode = document.getElementById('propRedactMode');
  const textPropGroup = document.getElementById('textPropGroup');
  const propFontFamily = document.getElementById('propFontFamily');
  const propFontSize = document.getElementById('propFontSize');
  const propBoldBtn = document.getElementById('propBoldBtn');
  const propItalicBtn = document.getElementById('propItalicBtn');
  const propUnderlineBtn = document.getElementById('propUnderlineBtn');

  // Actions
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  const btnDeleteSelected = document.getElementById('btnDeleteSelected');
  const btnSave = document.getElementById('btnSave');
  const btnDownloadEdited = document.getElementById('btnDownloadEdited');
  const btnDownloadDropdown = document.getElementById('btnDownloadDropdown');
  const downloadMenu = document.getElementById('downloadMenu');
  const menuDownloadPNG = document.getElementById('menuDownloadPNG');
  const menuDownloadJPG = document.getElementById('menuDownloadJPG');
  const menuDownloadPDFContinuous = document.getElementById('menuDownloadPDFContinuous');
  const menuDownloadPDFA4 = document.getElementById('menuDownloadPDFA4');
  const menuDownloadPDFLetter = document.getElementById('menuDownloadPDFLetter');

  // Crop elements
  const cropActionBar = document.getElementById('cropActionBar');
  const cropBox = document.getElementById('cropBox');
  const cropDimInfo = document.getElementById('cropDimInfo');
  const btnApplyCrop = document.getElementById('btnApplyCrop');
  const btnCancelCrop = document.getElementById('btnCancelCrop');

  // Floating zoom controls
  const editorZoomOutBtn = document.getElementById('editorZoomOutBtn');
  const editorZoomInBtn = document.getElementById('editorZoomInBtn');
  const editorZoomFitBtn = document.getElementById('editorZoomFitBtn');
  const editorZoomResetBtn = document.getElementById('editorZoomResetBtn');
  const editorZoom100Btn = document.getElementById('editorZoom100Btn');
  const editorZoomLabel = document.getElementById('editorZoomLabel');

  let currentCapture = null;
  let activeTool = 'select'; // 'select' | 'crop' | 'text' | 'arrow' | 'rect' | 'ellipse' | 'highlight' | 'redact'
  let annotations = [];      // Array of independent editable annotation objects
  let selectedAnnotation = null;
  let editorZoom = 40;       // Default initial view zoom

  // Undo / Redo Stacks
  const undoStack = [];
  const redoStack = [];

  // Dragging & Interaction state
  let isMouseDown = false;
  let isDraggingObject = false;
  let activeResizeHandle = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let currentMouseX = 0;
  let currentMouseY = 0;
  let tempShape = null;

  // Text inline editing state
  let isEditingText = false;
  let editingTextObj = null;

  // Pan state
  let isPanningWorkspace = false;
  let panStartX = 0;
  let panStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;
  let isSpacePressed = false;

  // Crop state
  let cropRect = { x: 0, y: 0, width: 0, height: 0 };
  let isCropDragging = false;
  let isCropMoving = false;
  let activeCropHandle = null;

  // 1. Load screenshot data
  const params = new URLSearchParams(window.location.search);
  const captureId = params.get('id');

  if (captureId) {
    currentCapture = await getCapture(captureId);
  }
  if (!currentCapture) {
    const list = await getAllCaptures(1);
    if (list.length > 0) currentCapture = await getCapture(list[0].id);
  }

  if (!currentCapture) {
    editorTitle.textContent = 'No capture found';
    showToast('Could not load capture.');
    return;
  }

  editorTitle.textContent = currentCapture.title || 'Editing Screenshot';
  backBtn.href = `../result/result.html?id=${encodeURIComponent(currentCapture.id)}`;

  // 2. Initialize canvases
  const baseImg = await loadImage(currentCapture.dataUrl);
  baseCanvas.width = baseImg.width;
  baseCanvas.height = baseImg.height;
  baseCtx.drawImage(baseImg, 0, 0);

  annotationCanvas.width = baseImg.width;
  annotationCanvas.height = baseImg.height;

  // Set initial zoom & center canvas
  setEditorZoom(40);
  setTimeout(() => {
    editorWorkspace.scrollTop = 0;
    editorWorkspace.scrollLeft = Math.max(0, (editorWorkspace.scrollWidth - editorWorkspace.clientWidth) / 2);
  }, 60);

  // Push initial snapshot
  pushUndoSnapshot();

  // 3. Zoom System
  function setEditorZoom(percent) {
    if (percent === 'fit') {
      const availW = Math.max(300, editorWorkspace.clientWidth - 80);
      editorZoom = Math.min(100, Math.max(10, Math.round((availW / baseCanvas.width) * 100)));
    } else {
      editorZoom = Math.max(10, Math.min(300, Math.round(percent)));
    }

    editorZoomLabel.textContent = `${editorZoom}%`;

    const scale = editorZoom / 100;
    const targetW = Math.round(baseCanvas.width * scale);
    const targetH = Math.round(baseCanvas.height * scale);

    canvasContainer.style.width = `${targetW}px`;
    canvasContainer.style.height = `${targetH}px`;
    baseCanvas.style.width = '100%';
    baseCanvas.style.height = '100%';
    annotationCanvas.style.width = '100%';
    annotationCanvas.style.height = '100%';

    if (activeTool === 'crop') {
      updateCropBoxDOM();
    }
  }

  if (editorZoomOutBtn) editorZoomOutBtn.addEventListener('click', () => setEditorZoom(editorZoom - 10));
  if (editorZoomInBtn) editorZoomInBtn.addEventListener('click', () => setEditorZoom(editorZoom + 10));
  if (editorZoomFitBtn) editorZoomFitBtn.addEventListener('click', () => setEditorZoom('fit'));
  if (editorZoomResetBtn) editorZoomResetBtn.addEventListener('click', () => setEditorZoom(40));
  if (editorZoom100Btn) editorZoom100Btn.addEventListener('click', () => setEditorZoom(100));

  editorWorkspace.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 10 : -10;
      setEditorZoom(editorZoom + delta);
    }
  }, { passive: false });

  // 4. Tool Switching
  const toolButtons = [toolSelect, toolCrop, toolText, toolArrow, toolRect, toolEllipse, toolHighlight, toolRedact];

  function setActiveTool(tool) {
    if (isEditingText && tool !== 'text') {
      finishInlineTextEditing();
    }

    activeTool = tool;
    toolButtons.forEach(b => b.classList.remove('active'));

    if (tool === 'select') toolSelect.classList.add('active');
    else if (tool === 'crop') toolCrop.classList.add('active');
    else if (tool === 'text') toolText.classList.add('active');
    else if (tool === 'arrow') toolArrow.classList.add('active');
    else if (tool === 'rect') toolRect.classList.add('active');
    else if (tool === 'ellipse') toolEllipse.classList.add('active');
    else if (tool === 'highlight') toolHighlight.classList.add('active');
    else if (tool === 'redact') toolRedact.classList.add('active');

    // Toggle crop UI
    if (tool === 'crop') {
      enterCropMode();
    } else {
      exitCropMode();
    }

    // Toggle redact mode select
    propRedactMode.style.display = (tool === 'redact' || (selectedAnnotation && selectedAnnotation.type === 'redact')) ? 'inline-block' : 'none';

    // Show/hide arrowhead size select
    if (propArrowheadSize) {
      const isArrow = tool === 'arrow' || (selectedAnnotation && selectedAnnotation.type === 'arrow');
      propArrowheadSize.style.display = isArrow ? 'inline-block' : 'none';
    }

    // Show text property bar if in text tool or text annotation selected
    updatePropertyBarVisibility();

    renderAnnotations();
  }

  function updatePropertyBarVisibility() {
    const isTextMode = activeTool === 'text' || (selectedAnnotation && selectedAnnotation.type === 'text');
    textPropGroup.style.display = isTextMode ? 'flex' : 'none';
    if (selectedAnnotation && selectedAnnotation.type === 'text') {
      syncTextPropertiesFromAnnotation(selectedAnnotation);
    }

    // Arrow controls
    const isArrowMode = activeTool === 'arrow' || (selectedAnnotation && selectedAnnotation.type === 'arrow');
    if (propArrowheadSize) {
      propArrowheadSize.style.display = isArrowMode ? 'inline-block' : 'none';
      if (selectedAnnotation && selectedAnnotation.type === 'arrow') {
        propArrowheadSize.value = String(selectedAnnotation.arrowheadSize || 'auto');
      }
    }

    // Sync stroke width and color from selected annotation
    if (selectedAnnotation) {
      if (selectedAnnotation.color) propColor.value = selectedAnnotation.color;
      if (selectedAnnotation.strokeWidth && selectedAnnotation.type !== 'text') {
        propStrokeWidth.value = String(selectedAnnotation.strokeWidth);
      }
    }
  }

  function syncTextPropertiesFromAnnotation(item) {
    if (item.fontFamily) propFontFamily.value = item.fontFamily;
    if (item.fontSize) propFontSize.value = String(item.fontSize);
    propBoldBtn.classList.toggle('active', item.bold !== false);
    propItalicBtn.classList.toggle('active', !!item.italic);
    propUnderlineBtn.classList.toggle('active', !!item.underline);
    if (item.color) propColor.value = item.color;
  }

  toolSelect.addEventListener('click', () => setActiveTool('select'));
  toolCrop.addEventListener('click', () => setActiveTool('crop'));
  toolText.addEventListener('click', () => setActiveTool('text'));
  toolArrow.addEventListener('click', () => setActiveTool('arrow'));
  toolRect.addEventListener('click', () => setActiveTool('rect'));
  toolEllipse.addEventListener('click', () => setActiveTool('ellipse'));
  toolHighlight.addEventListener('click', () => setActiveTool('highlight'));
  toolRedact.addEventListener('click', () => setActiveTool('redact'));

  // Property Controls Listeners
  propColor.addEventListener('input', () => {
    if (selectedAnnotation) {
      selectedAnnotation.color = propColor.value;
      renderAnnotations();
      pushUndoSnapshot();
    }
  });

  propStrokeWidth.addEventListener('change', () => {
    if (selectedAnnotation && selectedAnnotation.type !== 'text') {
      selectedAnnotation.strokeWidth = parseInt(propStrokeWidth.value, 10);
      renderAnnotations();
      pushUndoSnapshot();
    }
  });

  if (propArrowheadSize) {
    propArrowheadSize.addEventListener('change', () => {
      if (selectedAnnotation && selectedAnnotation.type === 'arrow') {
        selectedAnnotation.arrowheadSize = propArrowheadSize.value === 'auto' ? 'auto' : parseInt(propArrowheadSize.value, 10);
        renderAnnotations();
        pushUndoSnapshot();
      }
    });
  }

  propRedactMode.addEventListener('change', () => {
    if (selectedAnnotation && selectedAnnotation.type === 'redact') {
      selectedAnnotation.mode = propRedactMode.value;
      renderAnnotations();
      pushUndoSnapshot();
    }
  });

  propFontFamily.addEventListener('change', () => {
    if (selectedAnnotation && selectedAnnotation.type === 'text') {
      selectedAnnotation.fontFamily = propFontFamily.value;
      renderAnnotations();
      pushUndoSnapshot();
    }
  });

  propFontSize.addEventListener('change', () => {
    if (selectedAnnotation && selectedAnnotation.type === 'text') {
      selectedAnnotation.fontSize = parseInt(propFontSize.value, 10);
      renderAnnotations();
      pushUndoSnapshot();
    }
  });

  propBoldBtn.addEventListener('click', () => {
    propBoldBtn.classList.toggle('active');
    if (selectedAnnotation && selectedAnnotation.type === 'text') {
      selectedAnnotation.bold = propBoldBtn.classList.contains('active');
      renderAnnotations();
      pushUndoSnapshot();
    }
  });

  propItalicBtn.addEventListener('click', () => {
    propItalicBtn.classList.toggle('active');
    if (selectedAnnotation && selectedAnnotation.type === 'text') {
      selectedAnnotation.italic = propItalicBtn.classList.contains('active');
      renderAnnotations();
      pushUndoSnapshot();
    }
  });

  propUnderlineBtn.addEventListener('click', () => {
    propUnderlineBtn.classList.toggle('active');
    if (selectedAnnotation && selectedAnnotation.type === 'text') {
      selectedAnnotation.underline = propUnderlineBtn.classList.contains('active');
      renderAnnotations();
      pushUndoSnapshot();
    }
  });

  // 5. Annotation Rendering
  function renderAnnotations() {
    annotCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

    for (const item of annotations) {
      if (isEditingText && item === editingTextObj) continue;
      drawAnnotation(annotCtx, item, item === selectedAnnotation);
    }

    if (tempShape) {
      drawAnnotation(annotCtx, tempShape, false);
    }

    btnDeleteSelected.disabled = !selectedAnnotation;
  }

  function drawAnnotation(ctx, item, isSelected = false) {
    ctx.save();

    if (item.type === 'rect') {
      ctx.strokeStyle = item.color || '#ef4444';
      ctx.lineWidth = item.strokeWidth || 4;
      ctx.strokeRect(item.x, item.y, item.width, item.height);
    } else if (item.type === 'ellipse') {
      ctx.strokeStyle = item.color || '#ef4444';
      ctx.lineWidth = item.strokeWidth || 4;
      ctx.beginPath();
      const cx = item.x + item.width / 2;
      const cy = item.y + item.height / 2;
      const rx = Math.abs(item.width / 2);
      const ry = Math.abs(item.height / 2);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (item.type === 'arrow') {
      ctx.strokeStyle = item.color || '#ef4444';
      ctx.fillStyle = item.color || '#ef4444';
      ctx.lineWidth = item.strokeWidth || 4;
      drawArrow(ctx, item.x, item.y, item.x2, item.y2, item.strokeWidth || 4, item.arrowheadSize);
    } else if (item.type === 'highlight') {
      ctx.fillStyle = item.color || 'rgba(250, 204, 21, 0.4)';
      ctx.fillRect(item.x, item.y, item.width, item.height);
    } else if (item.type === 'redact') {
      if (item.mode === 'blackout') {
        ctx.fillStyle = '#000000';
        ctx.fillRect(item.x, item.y, item.width, item.height);
      } else {
        // Pixelate blur
        const sw = Math.max(1, Math.round(item.width / 14));
        const sh = Math.max(1, Math.round(item.height / 14));
        const off = document.createElement('canvas');
        off.width = sw;
        off.height = sh;
        const offCtx = off.getContext('2d');
        offCtx.drawImage(baseCanvas, item.x, item.y, item.width, item.height, 0, 0, sw, sh);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, sw, sh, item.x, item.y, item.width, item.height);
        ctx.restore();
      }
    } else if (item.type === 'text') {
      let fontStyle = '';
      if (item.italic) fontStyle += 'italic ';
      if (item.bold !== false) fontStyle += 'bold ';
      const fontSize = item.fontSize || 24;
      const fontFamily = item.fontFamily || 'sans-serif';
      ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
      ctx.fillStyle = item.color || '#ef4444';
      ctx.textBaseline = 'top';

      const lines = (item.text || '').split('\n');
      const lineHeight = fontSize * 1.25;
      for (let l = 0; l < lines.length; l++) {
        const line = lines[l];
        const lineY = item.y + l * lineHeight;
        ctx.fillText(line, item.x, lineY);

        if (item.underline) {
          const m = ctx.measureText(line);
          ctx.strokeStyle = item.color || '#ef4444';
          ctx.lineWidth = Math.max(1, fontSize / 16);
          ctx.beginPath();
          ctx.moveTo(item.x, lineY + fontSize + 2);
          ctx.lineTo(item.x + m.width, lineY + fontSize + 2);
          ctx.stroke();
        }
      }
    }

    // Selection Halo & Bounding Box Handles
    if (isSelected) {
      drawSelectionHalo(ctx, item);
    }

    ctx.restore();
  }

  function drawArrow(ctx, fromX, fromY, toX, toY, width, arrowheadSize = 'auto') {
    let headLength;
    if (arrowheadSize && arrowheadSize !== 'auto') {
      headLength = Number(arrowheadSize);
    } else {
      headLength = Math.max(14, width * 3.5);
    }
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function drawSelectionHalo(ctx, item) {
    ctx.strokeStyle = '#38bdf8';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    if (item.type === 'arrow') {
      // Handles at endpoints
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;

      // Start handle
      ctx.beginPath();
      ctx.arc(item.x, item.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // End handle
      ctx.beginPath();
      ctx.arc(item.x2, item.y2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const bounds = getAnnotationBounds(item);
      ctx.strokeRect(bounds.x - 4, bounds.y - 4, bounds.width + 8, bounds.height + 8);

      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1.5;

      const halfW = bounds.width / 2;
      const halfH = bounds.height / 2;

      // 8 handles (corners + side midpoints)
      const handles = [
        { x: bounds.x - 4, y: bounds.y - 4 },                     // nw
        { x: bounds.x + halfW, y: bounds.y - 4 },                 // n
        { x: bounds.x + bounds.width + 4, y: bounds.y - 4 },     // ne
        { x: bounds.x + bounds.width + 4, y: bounds.y + halfH }, // e
        { x: bounds.x + bounds.width + 4, y: bounds.y + bounds.height + 4 }, // se
        { x: bounds.x + halfW, y: bounds.y + bounds.height + 4 }, // s
        { x: bounds.x - 4, y: bounds.y + bounds.height + 4 },    // sw
        { x: bounds.x - 4, y: bounds.y + halfH }                 // w
      ];

      for (const h of handles) {
        ctx.fillRect(h.x - 3.5, h.y - 3.5, 7, 7);
        ctx.strokeRect(h.x - 3.5, h.y - 3.5, 7, 7);
      }
    }
  }

  function getAnnotationBounds(item) {
    if (item.type === 'arrow') {
      const minX = Math.min(item.x, item.x2);
      const minY = Math.min(item.y, item.y2);
      const maxX = Math.max(item.x, item.x2);
      const maxY = Math.max(item.y, item.y2);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    } else if (item.type === 'text') {
      let fontStyle = '';
      if (item.italic) fontStyle += 'italic ';
      if (item.bold !== false) fontStyle += 'bold ';
      const fontSize = item.fontSize || 24;
      const fontFamily = item.fontFamily || 'sans-serif';
      annotCtx.font = `${fontStyle}${fontSize}px ${fontFamily}`;

      const lines = (item.text || '').split('\n');
      let maxW = 20;
      for (const l of lines) {
        const m = annotCtx.measureText(l);
        if (m.width > maxW) maxW = m.width;
      }
      const totalH = Math.max(fontSize, lines.length * (fontSize * 1.25));
      return { x: item.x, y: item.y, width: maxW, height: totalH };
    } else {
      return { x: item.x, y: item.y, width: item.width, height: item.height };
    }
  }

  // 6. Hit Testing & Object Selection
  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function findAnnotationAt(px, py) {
    for (let i = annotations.length - 1; i >= 0; i--) {
      const item = annotations[i];
      if (item.type === 'arrow') {
        const dist = distToSegment(px, py, item.x, item.y, item.x2, item.y2);
        if (dist <= Math.max(14, (item.strokeWidth || 4) * 1.8)) return item;
      } else {
        const b = getAnnotationBounds(item);
        if (px >= b.x - 8 && px <= b.x + b.width + 8 && py >= b.y - 8 && py <= b.y + b.height + 8) {
          return item;
        }
      }
    }
    return null;
  }

  function findHandleAt(px, py, item) {
    if (!item) return null;
    const threshold = 14;

    if (item.type === 'arrow') {
      if (Math.hypot(px - item.x, py - item.y) <= threshold) return 'arrow_start';
      if (Math.hypot(px - item.x2, py - item.y2) <= threshold) return 'arrow_end';
      return null;
    }

    const b = getAnnotationBounds(item);
    const halfW = b.width / 2;
    const halfH = b.height / 2;

    if (Math.hypot(px - (b.x - 4), py - (b.y - 4)) <= threshold) return 'nw';
    if (Math.hypot(px - (b.x + halfW), py - (b.y - 4)) <= threshold) return 'n';
    if (Math.hypot(px - (b.x + b.width + 4), py - (b.y - 4)) <= threshold) return 'ne';
    if (Math.hypot(px - (b.x + b.width + 4), py - (b.y + halfH)) <= threshold) return 'e';
    if (Math.hypot(px - (b.x + b.width + 4), py - (b.y + b.height + 4)) <= threshold) return 'se';
    if (Math.hypot(px - (b.x + halfW), py - (b.y + b.height + 4)) <= threshold) return 's';
    if (Math.hypot(px - (b.x - 4), py - (b.y + b.height + 4)) <= threshold) return 'sw';
    if (Math.hypot(px - (b.x - 4), py - (b.y + halfH)) <= threshold) return 'w';

    return null;
  }

  // 7. Inline Text Editing
  function startInlineTextEditing(textObj) {
    if (isEditingText && editingTextObj && editingTextObj !== textObj) {
      finishInlineTextEditing();
    }

    isEditingText = true;
    editingTextObj = textObj;
    selectedAnnotation = textObj;
    updatePropertyBarVisibility();

    const scale = editorZoom / 100;
    const screenX = Math.round(textObj.x * scale);
    const screenY = Math.round(textObj.y * scale);

    inlineTextEditor.style.left = `${screenX}px`;
    inlineTextEditor.style.top = `${screenY}px`;
    inlineTextEditor.style.fontFamily = textObj.fontFamily || 'sans-serif';
    inlineTextEditor.style.fontSize = `${Math.round((textObj.fontSize || 24) * scale)}px`;
    inlineTextEditor.style.fontWeight = textObj.bold !== false ? '700' : '400';
    inlineTextEditor.style.fontStyle = textObj.italic ? 'italic' : 'normal';
    inlineTextEditor.style.textDecoration = textObj.underline ? 'underline' : 'none';
    inlineTextEditor.style.color = textObj.color || '#ef4444';
    inlineTextEditor.value = textObj.text || '';
    inlineTextEditor.style.display = 'block';

    renderAnnotations();
    setTimeout(() => {
      inlineTextEditor.focus();
      if (textObj.text) inlineTextEditor.select();
    }, 20);
  }

  function finishInlineTextEditing() {
    if (!isEditingText || !editingTextObj) return;

    const val = inlineTextEditor.value.trim();
    inlineTextEditor.style.display = 'none';
    isEditingText = false;

    if (!val) {
      const idx = annotations.indexOf(editingTextObj);
      if (idx !== -1) annotations.splice(idx, 1);
      selectedAnnotation = null;
    } else {
      editingTextObj.text = val;
      selectedAnnotation = editingTextObj;
      pushUndoSnapshot();
    }

    editingTextObj = null;
    setActiveTool('select');
    updatePropertyBarVisibility();
    renderAnnotations();
  }

  inlineTextEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      finishInlineTextEditing();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      finishInlineTextEditing();
    }
  });

  inlineTextEditor.addEventListener('blur', () => {
    if (isEditingText) {
      finishInlineTextEditing();
    }
  });

  // 8. Canvas Coordinates Transformation
  function getCanvasCoords(e) {
    const rect = annotationCanvas.getBoundingClientRect();
    const scaleX = annotationCanvas.width / rect.width;
    const scaleY = annotationCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  // 9. Canvas Mouse Events & Object Manipulation
  canvasContainer.addEventListener('mousedown', (e) => {
    if (activeTool === 'crop') return;

    if (isSpacePressed) {
      isPanningWorkspace = true;
      editorWorkspace.classList.add('panning');
      panStartX = e.clientX;
      panStartY = e.clientY;
      scrollStartX = editorWorkspace.scrollLeft;
      scrollStartY = editorWorkspace.scrollTop;
      return;
    }

    const pos = getCanvasCoords(e);
    isMouseDown = true;
    dragStartX = pos.x;
    dragStartY = pos.y;

    // Check if clicked a resize handle of selected annotation
    if (selectedAnnotation) {
      const handle = findHandleAt(pos.x, pos.y, selectedAnnotation);
      if (handle) {
        activeResizeHandle = handle;
        return;
      }
    }

    // Direct Object Hit Test
    const hit = findAnnotationAt(pos.x, pos.y);

    if (hit) {
      selectedAnnotation = hit;
      updatePropertyBarVisibility();
      btnDeleteSelected.disabled = false;
      renderAnnotations();

      if (hit.type === 'text' && e.detail >= 2) {
        isMouseDown = false;
        startInlineTextEditing(hit);
        return;
      }

      isDraggingObject = true;
      return;
    }

    // Clicked empty space
    if (activeTool === 'select') {
      selectedAnnotation = null;
      btnDeleteSelected.disabled = true;
      updatePropertyBarVisibility();
      renderAnnotations();
    } else if (activeTool === 'text') {
      selectedAnnotation = null;
      btnDeleteSelected.disabled = true;
      updatePropertyBarVisibility();
      isMouseDown = false;
      const newText = {
        id: 'text_' + Date.now(),
        type: 'text',
        text: '',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        fontFamily: propFontFamily.value || 'sans-serif',
        fontSize: parseInt(propFontSize.value, 10) || 24,
        bold: propBoldBtn.classList.contains('active'),
        italic: propItalicBtn.classList.contains('active'),
        underline: propUnderlineBtn.classList.contains('active'),
        color: propColor.value
      };
      annotations.push(newText);
      selectedAnnotation = newText;
      startInlineTextEditing(newText);
    } else {
      // Creation tools: arrow, rect, ellipse, highlight, redact
      // Deselect previous annotation so we can draw a new one right away!
      selectedAnnotation = null;
      btnDeleteSelected.disabled = true;
      updatePropertyBarVisibility();
      renderAnnotations();
      // isMouseDown is true, dragStartX/dragStartY are set to pos.x/pos.y
    }
  });

  canvasContainer.addEventListener('dblclick', (e) => {
    const pos = getCanvasCoords(e);
    const hit = findAnnotationAt(pos.x, pos.y);
    if (hit && hit.type === 'text') {
      startInlineTextEditing(hit);
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanningWorkspace) {
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      editorWorkspace.scrollLeft = scrollStartX - dx;
      editorWorkspace.scrollTop = scrollStartY - dy;
      return;
    }

    if (!isMouseDown) return;
    const pos = getCanvasCoords(e);
    currentMouseX = pos.x;
    currentMouseY = pos.y;

    const dx = currentMouseX - dragStartX;
    const dy = currentMouseY - dragStartY;

    if (activeResizeHandle && selectedAnnotation) {
      const item = selectedAnnotation;
      if (item.type === 'arrow') {
        if (activeResizeHandle === 'arrow_start') {
          item.x = Math.round(currentMouseX);
          item.y = Math.round(currentMouseY);
        } else if (activeResizeHandle === 'arrow_end') {
          item.x2 = Math.round(currentMouseX);
          item.y2 = Math.round(currentMouseY);
        }
      } else if (item.type === 'text') {
        if (activeResizeHandle.includes('s') || activeResizeHandle.includes('e')) {
          const dyFont = currentMouseY - item.y;
          if (dyFont > 8) {
            item.fontSize = Math.max(12, Math.min(140, Math.round(dyFont)));
            if (propFontSize) propFontSize.value = String(item.fontSize);
          }
        }
      } else {
        // Shapes: rect, ellipse, highlight, redact
        if (activeResizeHandle.includes('e')) {
          item.width = Math.max(8, currentMouseX - item.x);
        }
        if (activeResizeHandle.includes('s')) {
          item.height = Math.max(8, currentMouseY - item.y);
        }
        if (activeResizeHandle.includes('w')) {
          const newW = item.width + (item.x - currentMouseX);
          if (newW >= 8) {
            item.x = currentMouseX;
            item.width = newW;
          }
        }
        if (activeResizeHandle.includes('n')) {
          const newH = item.height + (item.y - currentMouseY);
          if (newH >= 8) {
            item.y = currentMouseY;
            item.height = newH;
          }
        }
      }
      renderAnnotations();
      return;
    }

    if (isDraggingObject && selectedAnnotation) {
      selectedAnnotation.x += dx;
      selectedAnnotation.y += dy;
      if (selectedAnnotation.type === 'arrow') {
        selectedAnnotation.x2 += dx;
        selectedAnnotation.y2 += dy;
      }
      dragStartX = currentMouseX;
      dragStartY = currentMouseY;
      renderAnnotations();
      return;
    }

    // Creating new shapes
    if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'highlight' || activeTool === 'redact') {
      const rx = Math.min(dragStartX, currentMouseX);
      const ry = Math.min(dragStartY, currentMouseY);
      const rw = Math.abs(currentMouseX - dragStartX);
      const rh = Math.abs(currentMouseY - dragStartY);

      tempShape = {
        type: activeTool,
        x: rx,
        y: ry,
        width: rw,
        height: rh,
        color: activeTool === 'highlight' ? 'rgba(250, 204, 21, 0.4)' : propColor.value,
        strokeWidth: parseInt(propStrokeWidth.value, 10),
        mode: propRedactMode.value || 'pixelate'
      };
      renderAnnotations();
    } else if (activeTool === 'arrow') {
      const headSize = propArrowheadSize && propArrowheadSize.value !== 'auto' ? parseInt(propArrowheadSize.value, 10) : 'auto';
      tempShape = {
        type: 'arrow',
        x: dragStartX,
        y: dragStartY,
        x2: currentMouseX,
        y2: currentMouseY,
        color: propColor.value,
        strokeWidth: parseInt(propStrokeWidth.value, 10),
        arrowheadSize: headSize
      };
      renderAnnotations();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isPanningWorkspace) {
      isPanningWorkspace = false;
      editorWorkspace.classList.remove('panning');
    }

    if (activeResizeHandle) {
      activeResizeHandle = null;
      pushUndoSnapshot();
    }

    if (isDraggingObject) {
      isDraggingObject = false;
      pushUndoSnapshot();
    }

    if (!isMouseDown) return;
    isMouseDown = false;

    if (tempShape) {
      const isArrowValid = tempShape.type === 'arrow' && (Math.hypot(tempShape.x2 - tempShape.x, tempShape.y2 - tempShape.y) > 6);
      const isShapeValid = tempShape.type !== 'arrow' && (tempShape.width > 4 || tempShape.height > 4);

      if (isArrowValid || isShapeValid) {
        const newObj = { ...tempShape, id: 'annot_' + Date.now() };
        annotations.push(newObj);
        selectedAnnotation = newObj;
        // Keep activeTool active so user can consecutively draw without switching tools!
        btnDeleteSelected.disabled = false;
        updatePropertyBarVisibility();
        pushUndoSnapshot();
      }
      tempShape = null;
      renderAnnotations();
    }
  });

  // Spacebar to pan
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      isSpacePressed = true;
      editorWorkspace.style.cursor = 'grab';
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isSpacePressed = false;
      editorWorkspace.style.cursor = 'default';
    }
  });

  // 10. Crop Functionality
  function enterCropMode() {
    cropActionBar.style.display = 'flex';
    cropBox.style.display = 'block';

    // Default Crop Box = 100% of Screenshot (Never auto-shrunk)
    const w = baseCanvas.width;
    const h = baseCanvas.height;
    cropRect = { x: 0, y: 0, width: w, height: h };
    updateCropBoxDOM();
  }

  function exitCropMode() {
    cropActionBar.style.display = 'none';
    cropBox.style.display = 'none';
    if (activeTool === 'crop') {
      setActiveTool('select');
    }
  }

  function updateCropBoxDOM() {
    const scale = editorZoom / 100;
    cropBox.style.left = `${cropRect.x * scale}px`;
    cropBox.style.top = `${cropRect.y * scale}px`;
    cropBox.style.width = `${cropRect.width * scale}px`;
    cropBox.style.height = `${cropRect.height * scale}px`;

    cropDimInfo.textContent = `${Math.round(cropRect.width)} × ${Math.round(cropRect.height)} px`;
  }

  cropBox.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.crop-handle');
    if (handle) {
      activeCropHandle = handle.dataset.h;
      isCropDragging = true;
    } else {
      isCropMoving = true;
    }

    const pos = getCanvasCoords(e);
    dragStartX = pos.x;
    dragStartY = pos.y;
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isCropDragging && !isCropMoving) return;

    const pos = getCanvasCoords(e);
    const curX = pos.x;
    const curY = pos.y;

    if (isCropMoving) {
      const dx = curX - dragStartX;
      const dy = curY - dragStartY;
      cropRect.x = Math.max(0, Math.min(baseCanvas.width - cropRect.width, cropRect.x + dx));
      cropRect.y = Math.max(0, Math.min(baseCanvas.height - cropRect.height, cropRect.y + dy));
      dragStartX = curX;
      dragStartY = curY;
    } else if (isCropDragging && activeCropHandle) {
      const h = activeCropHandle;
      if (h.includes('e')) {
        const clampedX = Math.max(cropRect.x + 20, Math.min(baseCanvas.width, curX));
        cropRect.width = clampedX - cropRect.x;
      }
      if (h.includes('s')) {
        const clampedY = Math.max(cropRect.y + 20, Math.min(baseCanvas.height, curY));
        cropRect.height = clampedY - cropRect.y;
      }
      if (h.includes('w')) {
        const clampedX = Math.max(0, Math.min(cropRect.x + cropRect.width - 20, curX));
        const newW = cropRect.width + (cropRect.x - clampedX);
        cropRect.x = clampedX;
        cropRect.width = newW;
      }
      if (h.includes('n')) {
        const clampedY = Math.max(0, Math.min(cropRect.y + cropRect.height - 20, curY));
        const newH = cropRect.height + (cropRect.y - clampedY);
        cropRect.y = clampedY;
        cropRect.height = newH;
      }
    }

    updateCropBoxDOM();
  });

  window.addEventListener('mouseup', () => {
    isCropDragging = false;
    isCropMoving = false;
    activeCropHandle = null;
  });

  btnApplyCrop.addEventListener('click', () => applyCrop());
  btnCancelCrop.addEventListener('click', () => exitCropMode());

  function applyCrop() {
    const rx = Math.max(0, Math.round(cropRect.x));
    const ry = Math.max(0, Math.round(cropRect.y));
    const rw = Math.min(baseCanvas.width - rx, Math.round(cropRect.width));
    const rh = Math.min(baseCanvas.height - ry, Math.round(cropRect.height));

    if (rw <= 10 || rh <= 10) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = rw;
    tempCanvas.height = rh;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(baseCanvas, rx, ry, rw, rh, 0, 0, rw, rh);

    baseCanvas.width = rw;
    baseCanvas.height = rh;
    baseCtx.drawImage(tempCanvas, 0, 0);

    annotationCanvas.width = rw;
    annotationCanvas.height = rh;

    for (const item of annotations) {
      item.x -= rx;
      item.y -= ry;
      if (item.type === 'arrow') {
        item.x2 -= rx;
        item.y2 -= ry;
      }
    }

    exitCropMode();
    setEditorZoom(editorZoom);
    pushUndoSnapshot();
    renderAnnotations();
    showToast(`Cropped to ${rw} × ${rh} px`);
  }

  // 11. Undo / Redo
  function pushUndoSnapshot() {
    const snapshot = {
      baseData: baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height),
      width: baseCanvas.width,
      height: baseCanvas.height,
      annotations: JSON.parse(JSON.stringify(annotations))
    };

    undoStack.push(snapshot);
    redoStack.length = 0;
    updateUndoRedoBtns();
  }

  function updateUndoRedoBtns() {
    btnUndo.disabled = undoStack.length <= 1;
    btnRedo.disabled = redoStack.length === 0;
  }

  btnUndo.addEventListener('click', () => {
    if (undoStack.length <= 1) return;
    const current = undoStack.pop();
    redoStack.push(current);
    const prev = undoStack[undoStack.length - 1];
    restoreSnapshot(prev);
    updateUndoRedoBtns();
    showToast('Undo');
  });

  btnRedo.addEventListener('click', () => {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    undoStack.push(next);
    restoreSnapshot(next);
    updateUndoRedoBtns();
    showToast('Redo');
  });

  function restoreSnapshot(snap) {
    baseCanvas.width = snap.width;
    baseCanvas.height = snap.height;
    baseCtx.putImageData(snap.baseData, 0, 0);

    annotationCanvas.width = snap.width;
    annotationCanvas.height = snap.height;
    annotations = JSON.parse(JSON.stringify(snap.annotations));
    selectedAnnotation = null;
    btnDeleteSelected.disabled = true;

    setEditorZoom(editorZoom);
    renderAnnotations();
  }

  // 12. Delete Selected Annotation
  btnDeleteSelected.addEventListener('click', () => {
    if (!selectedAnnotation) return;
    const idx = annotations.indexOf(selectedAnnotation);
    if (idx !== -1) {
      annotations.splice(idx, 1);
      selectedAnnotation = null;
      btnDeleteSelected.disabled = true;
      updatePropertyBarVisibility();
      pushUndoSnapshot();
      renderAnnotations();
    }
  });

  // 13. Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      if (selectedAnnotation) {
        selectedAnnotation = null;
        updatePropertyBarVisibility();
        renderAnnotations();
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedAnnotation) {
        e.preventDefault();
        btnDeleteSelected.click();
      }
    } else if (e.key.startsWith('Arrow') && selectedAnnotation) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowUp') selectedAnnotation.y -= step;
      if (e.key === 'ArrowDown') selectedAnnotation.y += step;
      if (e.key === 'ArrowLeft') selectedAnnotation.x -= step;
      if (e.key === 'ArrowRight') selectedAnnotation.x += step;
      if (selectedAnnotation.type === 'arrow') {
        if (e.key === 'ArrowUp') selectedAnnotation.y2 -= step;
        if (e.key === 'ArrowDown') selectedAnnotation.y2 += step;
        if (e.key === 'ArrowLeft') selectedAnnotation.x2 -= step;
        if (e.key === 'ArrowRight') selectedAnnotation.x2 += step;
      }
      renderAnnotations();
      pushUndoSnapshot();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) btnRedo.click();
      else btnUndo.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      btnRedo.click();
    } else if (e.key === 'v' || e.key === 'V') {
      setActiveTool('select');
    } else if (e.key === 'c' || e.key === 'C') {
      setActiveTool('crop');
    } else if (e.key === 't' || e.key === 'T') {
      setActiveTool('text');
    } else if (e.key === 'a' || e.key === 'A') {
      setActiveTool('arrow');
    } else if (e.key === 'r' || e.key === 'R') {
      setActiveTool('rect');
    } else if (e.key === 'o' || e.key === 'O') {
      setActiveTool('ellipse');
    } else if (e.key === 'h' || e.key === 'H') {
      setActiveTool('highlight');
    } else if (e.key === 'b' || e.key === 'B') {
      setActiveTool('redact');
    }
  });

  // 14. Flatten & Exports (PNG, JPG, PDF)
  function createFlattenedCanvas() {
    const flat = document.createElement('canvas');
    flat.width = baseCanvas.width;
    flat.height = baseCanvas.height;
    const fCtx = flat.getContext('2d');

    // Draw base image
    fCtx.drawImage(baseCanvas, 0, 0);

    // Draw all annotations
    for (const item of annotations) {
      drawAnnotation(fCtx, item, false);
    }

    return flat;
  }

  // Save & Apply
  btnSave.addEventListener('click', async () => {
    btnSave.textContent = 'Saving...';
    btnSave.disabled = true;

    try {
      const flattened = createFlattenedCanvas();
      const finalDataUrl = flattened.toDataURL('image/png');
      const thumbnail = createThumbnail(flattened, 320);

      currentCapture.dataUrl = finalDataUrl;
      currentCapture.thumbnail = thumbnail;
      currentCapture.dimensions = {
        width: flattened.width,
        height: flattened.height,
        dpr: (currentCapture.dimensions && currentCapture.dimensions.dpr) || 1
      };
      currentCapture.fileSize = Math.round(finalDataUrl.length * 0.75);

      await saveCapture(currentCapture);
      showToast('✔ Saved & Applied!');

      setTimeout(() => {
        window.location.href = `../result/result.html?id=${encodeURIComponent(currentCapture.id)}`;
      }, 350);
    } catch (err) {
      console.error(err);
      showToast('Failed to save edits: ' + err.message);
      btnSave.textContent = 'Save & Apply';
      btnSave.disabled = false;
    }
  });

  // Format Dropdown
  btnDownloadDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadMenu.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    downloadMenu.classList.remove('show');
  });

  async function triggerDownload(blobOrUrl, filename) {
    let url = blobOrUrl;
    let revoke = false;
    if (blobOrUrl instanceof Blob) {
      url = URL.createObjectURL(blobOrUrl);
      revoke = true;
    }

    if (chrome && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url, filename, saveAs: false }, () => {
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

  // Download Edited PNG
  async function downloadEditedPNG() {
    const flattened = createFlattenedCanvas();
    const blob = await new Promise(r => flattened.toBlob(r, 'image/png'));
    const filename = generateFilename({
      title: currentCapture.title,
      url: currentCapture.url,
      format: 'png',
      prefix: 'Full Page Screenshot - 100% Free & Edit (Edited)'
    });
    await triggerDownload(blob, filename);
  }

  btnDownloadEdited.addEventListener('click', downloadEditedPNG);
  menuDownloadPNG.addEventListener('click', downloadEditedPNG);

  // Download Edited JPG
  menuDownloadJPG.addEventListener('click', async () => {
    const flattened = createFlattenedCanvas();
    const jpgCanvas = document.createElement('canvas');
    jpgCanvas.width = flattened.width;
    jpgCanvas.height = flattened.height;
    const jCtx = jpgCanvas.getContext('2d');
    jCtx.fillStyle = '#ffffff';
    jCtx.fillRect(0, 0, jpgCanvas.width, jpgCanvas.height);
    jCtx.drawImage(flattened, 0, 0);

    const blob = await new Promise(r => jpgCanvas.toBlob(r, 'image/jpeg', 0.95));
    const filename = generateFilename({
      title: currentCapture.title,
      url: currentCapture.url,
      format: 'jpg',
      prefix: 'Full Page Screenshot - 100% Free & Edit (Edited)'
    });
    await triggerDownload(blob, filename);
  });

  // Export PDF from Edited Canvas
  menuDownloadPDFContinuous.addEventListener('click', async () => {
    showToast('Exporting continuous PDF...');
    const flattened = createFlattenedCanvas();
    const pdfBlob = await PDFBuilder.createPDFFromImage(flattened, {
      type: 'continuous',
      quality: 0.95
    });
    const filename = generateFilename({
      title: currentCapture.title,
      url: currentCapture.url,
      format: 'pdf',
      prefix: 'Full Page Screenshot - 100% Free & Edit (Edited Continuous)'
    });
    await triggerDownload(pdfBlob, filename);
  });

  menuDownloadPDFA4.addEventListener('click', async () => {
    showToast('Exporting paginated A4 PDF...');
    const flattened = createFlattenedCanvas();
    const pdfBlob = await PDFBuilder.createPDFFromImage(flattened, {
      type: 'paginated',
      pageSize: 'a4',
      orientation: 'portrait',
      margin: 20,
      quality: 0.95
    });
    const filename = generateFilename({
      title: currentCapture.title,
      url: currentCapture.url,
      format: 'pdf',
      prefix: 'Full Page Screenshot - 100% Free & Edit (Edited A4)'
    });
    await triggerDownload(pdfBlob, filename);
  });

  menuDownloadPDFLetter.addEventListener('click', async () => {
    showToast('Exporting paginated Letter PDF...');
    const flattened = createFlattenedCanvas();
    const pdfBlob = await PDFBuilder.createPDFFromImage(flattened, {
      type: 'paginated',
      pageSize: 'letter',
      orientation: 'portrait',
      margin: 20,
      quality: 0.95
    });
    const filename = generateFilename({
      title: currentCapture.title,
      url: currentCapture.url,
      format: 'pdf',
      prefix: 'edited_letter'
    });
    await triggerDownload(pdfBlob, filename);
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
  }
});
