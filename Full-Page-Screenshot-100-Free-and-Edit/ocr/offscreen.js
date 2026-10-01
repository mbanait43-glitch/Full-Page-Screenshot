// ocr/offscreen.js: Offscreen document for 100% local, offline Tesseract OCR in MV3
let tesseractWorker = null;
let isInitializing = false;
let initPromise = null;

async function getWorker() {
  if (tesseractWorker) return tesseractWorker;
  if (isInitializing) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      const workerPath = chrome.runtime.getURL('ocr/lib/worker.min.js');
      const corePath = chrome.runtime.getURL('ocr/lib/tesseract-core-lstm.wasm.js');
      const langPath = chrome.runtime.getURL('ocr/lib');

      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath,
        corePath,
        langPath,
        cacheMethod: 'none',
        gzip: true
      });
      tesseractWorker = worker;
      return worker;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PROCESS_OCR_IMAGE') {
    (async () => {
      try {
        const worker = await getWorker();
        const ret = await worker.recognize(message.dataUrl);
        const rawText = ret && ret.data && ret.data.text ? ret.data.text : '';
        sendResponse({
          success: true,
          text: rawText.trim(),
          confidence: ret?.data?.confidence || 0,
          lines: ret?.data?.lines ? ret.data.lines.map(l => l.text.trim()).filter(Boolean) : []
        });
      } catch (err) {
        console.error('Offscreen OCR error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open
  }
});
