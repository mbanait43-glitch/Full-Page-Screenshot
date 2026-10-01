// utils/pdf-generator.js: Pure JavaScript PDF generator for single-page and paginated screenshot PDFs
// Zero external dependencies, offline, compliant with Manifest V3

const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },       // points (72 dpi)
  letter: { width: 612.0, height: 792.0 },     // points (72 dpi)
  legal: { width: 612.0, height: 1008.0 }
};

export class PDFBuilder {
  constructor() {
    this.objects = [];
    this.pages = [];
  }

  addObject(content) {
    const id = this.objects.length + 1;
    this.objects.push({ id, content });
    return id;
  }

  // Convert canvas to JPEG binary string / Uint8Array
  static async canvasToJpegBytes(canvas, quality = 0.95) {
    if (canvas.convertToBlob) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      const arrayBuffer = await blob.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }
    return new Promise((resolve, reject) => {
      if (!canvas.toBlob) {
        if (canvas.toDataURL) {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const base64 = dataUrl.split(',')[1];
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          resolve(bytes);
          return;
        }
        reject(new Error('Canvas toBlob not supported'));
        return;
      }
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('Failed to create JPEG blob from canvas'));
          return;
        }
        if (blob.arrayBuffer) {
          const buf = await blob.arrayBuffer();
          resolve(new Uint8Array(buf));
        } else {
          const reader = new FileReader();
          reader.onloadend = () => resolve(new Uint8Array(reader.result));
          reader.readAsArrayBuffer(blob);
        }
      }, 'image/jpeg', quality);
    });
  }

  // Generate either single long PDF or paginated PDF from image
  static async createPDFFromImage(imageSource, options = {}) {
    const {
      type = 'paginated', // 'paginated' | 'continuous'
      pageSize = 'a4',     // 'a4' | 'letter'
      orientation = 'portrait',
      margin = 20,         // points
      quality = 0.95
    } = options;

    // Resolve intrinsic image / canvas pixel dimensions
    let imgW = 0;
    let imgH = 0;

    if (imageSource instanceof HTMLImageElement || (imageSource && typeof imageSource.naturalWidth === 'number' && imageSource.naturalWidth > 0)) {
      imgW = imageSource.naturalWidth;
      imgH = imageSource.naturalHeight;
    } else if (imageSource instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && imageSource instanceof OffscreenCanvas)) {
      imgW = imageSource.width;
      imgH = imageSource.height;
    } else if (imageSource && typeof imageSource.width === 'number') {
      imgW = imageSource.width;
      imgH = imageSource.height;
    }

    if (!imgW || !imgH) {
      throw new Error(`Invalid image dimensions for PDF export: ${imgW}x${imgH}`);
    }

    if (type === 'continuous') {
      return await PDFBuilder.createContinuousPDF(imageSource, imgW, imgH, quality);
    } else {
      return await PDFBuilder.createPaginatedPDF(imageSource, imgW, imgH, { pageSize, orientation, margin, quality });
    }
  }

  // Single continuous page PDF with dimensions matching image aspect ratio
  static async createContinuousPDF(imageSource, imgW, imgH, quality = 0.95) {
    const standardWidth = 595.28; // Standard A4 width in pt
    let ptWidth = standardWidth;
    let ptHeight = Math.round((imgH / imgW) * standardWidth * 100) / 100;

    // PDF 1.4-1.7 standard max dimension is 14,400 pt (200 inches)
    if (ptHeight > 14400) {
      const scaleDown = 14400 / ptHeight;
      ptWidth = Math.round(ptWidth * scaleDown * 100) / 100;
      ptHeight = 14400;
    }

    const canvas = document.createElement('canvas');
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // White background for clean JPEG export
    ctx.fillRect(0, 0, imgW, imgH);
    ctx.drawImage(imageSource, 0, 0, imgW, imgH);

    const jpegBytes = await PDFBuilder.canvasToJpegBytes(canvas, quality);

    return PDFBuilder.assemblePDF([
      {
        width: ptWidth,
        height: ptHeight,
        imgWidth: imgW,
        imgHeight: imgH,
        jpegBytes,
        boxW: ptWidth,
        boxH: ptHeight,
        posX: 0,
        posY: 0
      }
    ]);
  }

  // Paginated PDF (e.g. A4 / Letter) with smart slice calculation covering 100% of vertical content
  static async createPaginatedPDF(imageSource, imgW, imgH, config) {
    const standard = PAGE_SIZES[config.pageSize] || PAGE_SIZES.a4;
    let pagePtW = config.orientation === 'landscape' ? standard.height : standard.width;
    let pagePtH = config.orientation === 'landscape' ? standard.width : standard.height;

    const margin = config.margin || 20;
    const contentPtW = pagePtW - (margin * 2);
    const contentPtH = pagePtH - (margin * 2) - 18; // 18pt reserved for footer page numbers

    // Determine how many natural image pixels fit in one PDF page height
    const scale = contentPtW / imgW;
    const slicePixelHeight = Math.floor(contentPtH / scale);

    const totalPages = Math.ceil(imgH / slicePixelHeight);
    const pageDescriptors = [];

    for (let i = 0; i < totalPages; i++) {
      const srcY = i * slicePixelHeight;
      const currentSliceH = Math.min(slicePixelHeight, imgH - srcY);
      if (currentSliceH <= 0) break;

      // Create slice canvas with exact slice pixel dimensions
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = imgW;
      sliceCanvas.height = currentSliceH;
      const sCtx = sliceCanvas.getContext('2d');
      sCtx.fillStyle = '#ffffff'; // Fill white behind image to prevent dark background artifacts
      sCtx.fillRect(0, 0, imgW, currentSliceH);
      sCtx.drawImage(imageSource, 0, srcY, imgW, currentSliceH, 0, 0, imgW, currentSliceH);

      const jpegBytes = await PDFBuilder.canvasToJpegBytes(sliceCanvas, config.quality || 0.95);
      const slicePtH = currentSliceH * scale;

      pageDescriptors.push({
        width: pagePtW,
        height: pagePtH,
        imgWidth: imgW,
        imgHeight: currentSliceH,
        jpegBytes,
        boxW: contentPtW,
        boxH: slicePtH,
        posX: margin,
        posY: pagePtH - margin - slicePtH,
        pageNumber: i + 1,
        totalPages
      });
    }

    return PDFBuilder.assemblePDF(pageDescriptors);
  }

  static assemblePDF(pages) {
    const numPages = pages.length;
    const pageObjIds = [];
    const objects = []; // { id, header, streamBytes }

    let currentObjId = 3;

    for (let i = 0; i < numPages; i++) {
      const p = pages[i];
      const pageId = currentObjId++;
      const imageId = currentObjId++;
      const contentId = currentObjId++;
      pageObjIds.push(pageId);

      // Image Object
      const imgHeader = `<< /Type /XObject /Subtype /Image /Width ${p.imgWidth} /Height ${p.imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.length} >>\nstream\n`;
      const imgFooter = '\nendstream';
      objects.push({
        id: imageId,
        isStream: true,
        header: imgHeader,
        bytes: p.jpegBytes,
        footer: imgFooter
      });

      // Content stream: Draw image at (posX, posY) with dimensions (boxW, boxH)
      let streamText = `q\n${p.boxW.toFixed(2)} 0 0 ${p.boxH.toFixed(2)} ${p.posX.toFixed(2)} ${p.posY.toFixed(2)} cm\n/Im${i + 1} Do\nQ\n`;
      
      // Page number footer if paginated
      if (p.totalPages && p.totalPages > 1) {
        streamText += `BT /F1 9 Tf 0.45 0.45 0.45 rg ${Math.round(p.width / 2 - 20)} 10 Td (Page ${p.pageNumber} of ${p.totalPages}) Tj ET\n`;
      }

      const streamBytes = new TextEncoder().encode(streamText);
      const contentHeader = `<< /Length ${streamBytes.length} >>\nstream\n`;
      const contentFooter = '\nendstream';
      objects.push({
        id: contentId,
        isStream: true,
        header: contentHeader,
        bytes: streamBytes,
        footer: contentFooter
      });

      // Page Object with standard ProcSet for universal reader compatibility
      const pageText = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width.toFixed(2)} ${p.height.toFixed(2)}] /Resources << /ProcSet [/PDF /Text /ImageB /ImageC /ImageI] /XObject << /Im${i + 1} ${imageId} 0 R >> /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentId} 0 R >>`;
      objects.push({
        id: pageId,
        isStream: false,
        text: pageText
      });
    }

    // Catalog & Pages
    const catalogText = `<< /Type /Catalog /Pages 2 0 R >>`;
    const pagesText = `<< /Type /Pages /Kids [${pageObjIds.map(id => id + ' 0 R').join(' ')}] /Count ${numPages} >>`;

    const allObjects = [
      { id: 1, isStream: false, text: catalogText },
      { id: 2, isStream: false, text: pagesText },
      ...objects
    ];

    allObjects.sort((a, b) => a.id - b.id);

    // Build PDF binary
    const chunks = [];
    const pushString = (str) => chunks.push(new TextEncoder().encode(str));
    const pushBytes = (bytes) => chunks.push(bytes);

    pushString('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

    let offset = chunks.reduce((acc, c) => acc + c.length, 0);
    const xrefOffsets = [];

    for (const obj of allObjects) {
      xrefOffsets[obj.id] = offset;
      pushString(`${obj.id} 0 obj\n`);
      if (obj.isStream) {
        pushString(obj.header);
        pushBytes(obj.bytes);
        pushString(obj.footer + '\nendobj\n');
      } else {
        pushString(obj.text + '\nendobj\n');
      }
      offset = chunks.reduce((acc, c) => acc + c.length, 0);
    }

    // XREF Table
    const startXref = offset;
    pushString(`xref\n0 ${allObjects.length + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= allObjects.length; id++) {
      const o = xrefOffsets[id] || 0;
      pushString(String(o).padStart(10, '0') + ' 00000 n \n');
    }

    // Trailer
    pushString(`trailer\n<< /Size ${allObjects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  }
}
