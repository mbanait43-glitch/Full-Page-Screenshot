// popup/popup.js: Logic and event bindings for popup user interface
// Manifest V3 compliant: cleanly initiates capture and immediately closes popup

import { MESSAGE_TYPES, isRestrictedUrl } from '../utils/messaging.js';
import { getSettings, saveSettings } from '../utils/storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  const btnAutoFull = document.getElementById('btnAutoFull');
  const btnManualFull = document.getElementById('btnManualFull');
  const btnVisible = document.getElementById('btnVisible');
  const btnSelected = document.getElementById('btnSelected');
  const btnTextExtractor = document.getElementById('btnTextExtractor');
  const historyBtn = document.getElementById('historyBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const formatPng = document.getElementById('formatPng');
  const formatJpg = document.getElementById('formatJpg');
  const statusToast = document.getElementById('statusToast');

  function showError(msg) {
    if (!statusToast) return;
    statusToast.style.display = 'block';
    statusToast.textContent = msg;
  }

  // 1. Navigation buttons
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') });
      window.close();
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
      window.close();
    });
  }

  // 2. Load settings for format toggle
  try {
    const settings = await getSettings();
    if (settings && settings.format === 'jpeg') {
      formatJpg?.classList.add('active');
      formatPng?.classList.remove('active');
    } else {
      formatPng?.classList.add('active');
      formatJpg?.classList.remove('active');
    }
  } catch (e) {
    console.warn('Failed to load settings in popup:', e);
  }

  formatPng?.addEventListener('click', async () => {
    formatPng.classList.add('active');
    formatJpg?.classList.remove('active');
    await saveSettings({ format: 'png' }).catch(() => {});
  });

  formatJpg?.addEventListener('click', async () => {
    formatJpg.classList.add('active');
    formatPng?.classList.remove('active');
    await saveSettings({ format: 'jpeg' }).catch(() => {});
  });

  // 3. Query active tab
  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs.length > 0 ? tabs[0] : null;
  } catch (e) {
    console.warn('Could not query active tab:', e);
  }

  // Official Chrome Permission / Access check triggered strictly by user capture actions
  async function ensureCaptureAccess(targetTab) {
    if (!targetTab) {
      return { granted: false, reason: 'No active browser tab found.' };
    }

    const currentUrl = targetTab.url || targetTab.pendingUrl || '';
    const isRestricted = isRestrictedUrl(currentUrl);

    // Standard web pages: activeTab is already present and granted by opening popup
    if (!isRestricted) {
      return { granted: true, isRestricted: false };
    }

    // Check if official Chrome access / permission is already granted
    let alreadyGranted = false;
    try {
      if (chrome.permissions && chrome.permissions.contains) {
        alreadyGranted = await chrome.permissions.contains({
          origins: ['<all_urls>']
        });
      }
    } catch (e) {
      alreadyGranted = false;
    }

    if (alreadyGranted) {
      return { granted: true, isRestricted: true };
    }

    // User clicked capture on a restricted/sensitive page -> trigger official Chrome permission UI
    try {
      if (chrome.permissions && chrome.permissions.request) {
        const userGranted = await chrome.permissions.request({
          origins: ['<all_urls>']
        });
        if (userGranted) {
          return { granted: true, isRestricted: true };
        } else {
          return {
            granted: false,
            isRestricted: true,
            reason: 'Capture permission was not granted by user.'
          };
        }
      }
    } catch (permErr) {
      console.warn('[PageSnap] Official permission request error:', permErr);
      return {
        granted: false,
        isRestricted: true,
        reason: permErr.message || 'Permission request failed'
      };
    }

    return { granted: true, isRestricted: true };
  }

  // 4. Capture mode handlers
  btnAutoFull?.addEventListener('click', async () => {
    try {
      const access = await ensureCaptureAccess(tab);
      if (!access.granted) {
        showError(access.reason || 'Permission not granted.');
        return;
      }

      // If on restricted page (e.g. chrome://newtab), Chrome blocks DOM script injection for auto-scroll.
      // Use maximum supported capture capability: Visible Area capture fallback.
      const captureType = access.isRestricted ? MESSAGE_TYPES.START_VISIBLE_CAPTURE : MESSAGE_TYPES.START_AUTO_CAPTURE;

      chrome.runtime.sendMessage({
        type: captureType,
        tabId: tab.id
      }, (resp) => {
        if (resp && resp.error) showError(resp.error);
      });
      window.close();
    } catch (err) {
      showError(err.message);
    }
  });

  btnManualFull?.addEventListener('click', async () => {
    try {
      const access = await ensureCaptureAccess(tab);
      if (!access.granted) {
        showError(access.reason || 'Permission not granted.');
        return;
      }

      if (access.isRestricted) {
        showError('Chrome security policies prevent interactive scroll tools on internal browser pages. Please use Visible Area capture.');
        return;
      }

      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.START_MANUAL_CAPTURE,
        tabId: tab.id
      }, (resp) => {
        if (resp && resp.error) showError(resp.error);
      });
      window.close();
    } catch (err) {
      showError(err.message);
    }
  });

  btnVisible?.addEventListener('click', async () => {
    try {
      const access = await ensureCaptureAccess(tab);
      if (!access.granted) {
        showError(access.reason || 'Permission not granted.');
        return;
      }

      if (btnVisible) btnVisible.disabled = true;
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.START_VISIBLE_CAPTURE,
        tabId: tab.id
      }, (resp) => {
        if (resp && resp.error) showError(resp.error);
      });
      setTimeout(() => window.close(), 150);
    } catch (err) {
      showError(err.message);
    }
  });

  btnSelected?.addEventListener('click', async () => {
    try {
      const access = await ensureCaptureAccess(tab);
      if (!access.granted) {
        showError(access.reason || 'Permission not granted.');
        return;
      }

      if (access.isRestricted) {
        showError('Chrome security policies prevent interactive selection on internal browser pages. Please use Visible Area capture.');
        return;
      }

      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.START_SELECTED_CAPTURE,
        tabId: tab.id
      }, (resp) => {
        if (resp && resp.error) showError(resp.error);
      });
      window.close();
    } catch (err) {
      showError(err.message);
    }
  });

  btnTextExtractor?.addEventListener('click', async () => {
    try {
      const access = await ensureCaptureAccess(tab);
      if (!access.granted) {
        showError(access.reason || 'Permission not granted.');
        return;
      }

      if (access.isRestricted) {
        showError('Chrome security policies prevent OCR overlay on internal browser pages.');
        return;
      }

      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.START_TEXT_EXTRACTOR,
        tabId: tab.id
      }, (resp) => {
        if (resp && resp.error) showError(resp.error);
      });
      window.close();
    } catch (err) {
      showError(err.message);
    }
  });
});
