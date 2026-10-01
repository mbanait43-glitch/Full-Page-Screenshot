// background/service-worker.js: Background service worker for PageSnap Pro
// Manifest V3 compliant, handles commands, context menus, and capture coordination

import { CaptureController } from '../capture/capture-controller.js';
import { getCroppedSelectedRegion } from '../capture/area-capture.js';
import { MESSAGE_TYPES } from '../utils/messaging.js';

const controller = new CaptureController();
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    if (await chrome.offscreen.hasDocument()) return;
  }
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'ocr/offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Run local OCR text recognition on captured screenshot pixels'
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

// 1. Initialize Context Menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'pagesnap_root',
    title: 'Full Page Screenshot — 100% Free & Edit',
    contexts: ['page', 'selection', 'image']
  });

  chrome.contextMenus.create({
    id: 'pagesnap_full_page',
    parentId: 'pagesnap_root',
    title: 'Capture Full Page (Auto)',
    contexts: ['page', 'selection', 'image']
  });

  chrome.contextMenus.create({
    id: 'pagesnap_visible',
    parentId: 'pagesnap_root',
    title: 'Capture Visible Area',
    contexts: ['page', 'selection', 'image']
  });

  chrome.contextMenus.create({
    id: 'pagesnap_selected',
    parentId: 'pagesnap_root',
    title: 'Capture Selected Area',
    contexts: ['page', 'selection', 'image']
  });

  chrome.contextMenus.create({
    id: 'pagesnap_manual',
    parentId: 'pagesnap_root',
    title: 'Manual Full Page Capture',
    contexts: ['page', 'selection', 'image']
  });
});

// Tab lifecycle listeners to prevent stale captures when tabs close or navigate
chrome.tabs.onRemoved.addListener((tabId) => {
  if (controller.activeTabId === tabId) {
    console.log(`[ServiceWorker] Active tab ${tabId} closed; resetting capture controller.`);
    controller.resetToIdle('Active tab closed');
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (controller.activeTabId === tabId && changeInfo.status === 'loading') {
    console.log(`[ServiceWorker] Active tab ${tabId} reloaded or navigated; resetting capture controller.`);
    controller.resetToIdle('Active tab navigated');
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[ServiceWorker] Extension startup; ensuring clean capture state.');
  controller.resetToIdle('Browser startup');
});

// Helper to get active tab
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Safe helper to resolve target tab
async function resolveTargetTab(messageTabId, senderTab) {
  if (messageTabId) {
    try {
      const tab = await chrome.tabs.get(messageTabId);
      if (tab) return tab;
    } catch (e) {
      console.warn(`Could not get tab ${messageTabId}:`, e);
    }
  }
  return senderTab || await getActiveTab();
}

// 2. Handle Context Menu Clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  try {
    switch (info.menuItemId) {
      case 'pagesnap_full_page':
        await controller.startAutoCapture(tab);
        break;
      case 'pagesnap_visible':
        await controller.startVisibleCapture(tab);
        break;
      case 'pagesnap_selected':
        await controller.startSelectedCapture(tab);
        break;
      case 'pagesnap_manual':
        await controller.startManualCapture(tab);
        break;
    }
  } catch (err) {
    console.error('Context menu capture error:', err);
  }
});

// 3. Handle Keyboard Shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;

  try {
    switch (command) {
      case 'capture_full_page':
        await controller.startAutoCapture(tab);
        break;
      case 'capture_visible':
        await controller.startVisibleCapture(tab);
        break;
      case 'capture_selected':
        await controller.startSelectedCapture(tab);
        break;
      case 'capture_manual':
        await controller.startManualCapture(tab);
        break;
      case 'cancel_capture':
        await controller.cancelCapture();
        break;
    }
  } catch (err) {
    console.error('Command capture error:', err);
  }
});

// 4. Handle Runtime Messages from Popup and Content Scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const tab = sender.tab || await getActiveTab();

      switch (message.type) {
        case MESSAGE_TYPES.START_AUTO_CAPTURE: {
          const targetTab = await resolveTargetTab(message.tabId, tab);
          if (!targetTab) {
            sendResponse({ success: false, error: 'Target tab not found' });
            break;
          }
          controller.startAutoCapture(targetTab).catch((e) => {
            console.error('Auto capture failed:', e);
          });
          sendResponse({ success: true, state: controller.getState(targetTab.id) });
          break;
        }

        case MESSAGE_TYPES.START_VISIBLE_CAPTURE: {
          const targetTab = await resolveTargetTab(message.tabId, tab);
          if (!targetTab) {
            sendResponse({ success: false, error: 'Target tab not found' });
            break;
          }
          controller.startVisibleCapture(targetTab).catch((e) => {
            console.error('Visible capture failed:', e);
          });
          sendResponse({ success: true, state: controller.getState(targetTab.id) });
          break;
        }

        case MESSAGE_TYPES.START_SELECTED_CAPTURE: {
          const targetTab = await resolveTargetTab(message.tabId, tab);
          if (!targetTab) {
            sendResponse({ success: false, error: 'Target tab not found' });
            break;
          }
          controller.startSelectedCapture(targetTab).catch((e) => {
            console.error('Selected capture failed:', e);
          });
          sendResponse({ success: true, state: controller.getState(targetTab.id) });
          break;
        }

        case MESSAGE_TYPES.START_TEXT_EXTRACTOR: {
          const targetTab = await resolveTargetTab(message.tabId, tab);
          if (!targetTab) {
            sendResponse({ success: false, error: 'Target tab not found' });
            break;
          }
          controller.startTextExtractor(targetTab).catch((e) => {
            console.error('Text extractor failed:', e);
          });
          sendResponse({ success: true, state: controller.getState(targetTab.id) });
          break;
        }

        case 'CAPTURE_OCR_CROP': {
          const targetTab = sender.tab || tab;
          const cropResult = await getCroppedSelectedRegion(targetTab, message.rect);
          sendResponse({ success: true, ...cropResult });
          break;
        }

        case 'PERFORM_IMAGE_OCR': {
          try {
            await ensureOffscreenDocument();
            const ocrResp = await chrome.runtime.sendMessage({
              type: 'PROCESS_OCR_IMAGE',
              dataUrl: message.dataUrl
            });
            sendResponse(ocrResp || { success: false, text: '' });
          } catch (err) {
            console.error('Failed to perform image OCR via offscreen:', err);
            sendResponse({ success: false, error: err.message, text: '' });
          }
          break;
        }

        case MESSAGE_TYPES.START_MANUAL_CAPTURE: {
          const targetTab = await resolveTargetTab(message.tabId, tab);
          if (!targetTab) {
            sendResponse({ success: false, error: 'Target tab not found' });
            break;
          }
          controller.startManualCapture(targetTab).catch((e) => {
            console.error('Manual capture start failed:', e);
          });
          sendResponse({ success: true, state: controller.getState(targetTab.id) });
          break;
        }

        case 'MANUAL_CAPTURE_SLICE': {
          const segment = await controller.handleManualSlice(message.coords);
          sendResponse({ success: true, segment });
          break;
        }

        case MESSAGE_TYPES.STOP_MANUAL_CAPTURE: {
          controller.stopAndStitchManual().catch((e) => {
            console.error('Manual stop and stitch failed:', e);
          });
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.CANCEL_CAPTURE: {
          await controller.cancelCapture();
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.AREA_SELECTED: {
          const targetTab = sender.tab || tab;
          if (!targetTab) {
            sendResponse({ success: false, error: 'Tab not found for area selection' });
            break;
          }
          controller.finishSelectedAreaCapture(targetTab, message.rect).catch((e) => {
            console.error('Finish selected area failed:', e);
          });
          sendResponse({ success: true });
          break;
        }

        case 'GET_STATE': {
          const queryTabId = message.tabId || (sender.tab ? sender.tab.id : null);
          sendResponse({ success: true, ...controller.getState(queryTabId) });
          break;
        }

        default:
          sendResponse({ unhandled: true });
      }
    } catch (err) {
      console.error('Runtime message handler error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});
