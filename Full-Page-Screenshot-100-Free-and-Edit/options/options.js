// options/options.js: Reads, validates, and saves user extension preferences

import { getSettings, saveSettings } from '../utils/storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  const settingFormat = document.getElementById('settingFormat');
  const settingQuality = document.getElementById('settingQuality');
  const jpegQualityGroup = document.getElementById('jpegQualityGroup');
  const settingMetadataHeader = document.getElementById('settingMetadataHeader');
  const settingScrollDelay = document.getElementById('settingScrollDelay');
  const settingLazyWait = document.getElementById('settingLazyWait');
  const settingPdfPageSize = document.getElementById('settingPdfPageSize');
  const settingPdfOrientation = document.getElementById('settingPdfOrientation');
  const btnSaveOptions = document.getElementById('btnSaveOptions');
  const toast = document.getElementById('toast');

  // Load existing settings
  const settings = await getSettings();

  settingFormat.value = settings.format || 'png';
  settingQuality.value = String(settings.jpegQuality || '0.92');
  settingMetadataHeader.checked = !!settings.includeMetadataHeader;
  settingScrollDelay.value = String(settings.scrollDelay || '200');
  settingLazyWait.value = String(settings.lazyLoadWait || '300');
  settingPdfPageSize.value = settings.pdfPageSize || 'a4';
  settingPdfOrientation.value = settings.pdfOrientation || 'portrait';

  function updateQualityVisibility() {
    jpegQualityGroup.style.display = settingFormat.value === 'jpeg' ? 'block' : 'none';
  }

  settingFormat.addEventListener('change', updateQualityVisibility);
  updateQualityVisibility();

  btnSaveOptions.addEventListener('click', async () => {
    btnSaveOptions.disabled = true;
    btnSaveOptions.textContent = 'Saving...';

    try {
      await saveSettings({
        format: settingFormat.value,
        jpegQuality: parseFloat(settingQuality.value),
        includeMetadataHeader: settingMetadataHeader.checked,
        scrollDelay: parseInt(settingScrollDelay.value, 10),
        lazyLoadWait: parseInt(settingLazyWait.value, 10),
        pdfPageSize: settingPdfPageSize.value,
        pdfOrientation: settingPdfOrientation.value
      });

      showToast('✔ Preferences saved successfully!');
    } catch (err) {
      showToast('Error saving: ' + err.message);
    } finally {
      btnSaveOptions.disabled = false;
      btnSaveOptions.textContent = 'Save Settings';
    }
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2500);
  }
});
