// history/history.js: Interactive logic for searching, viewing, and managing screenshot history

import { HistoryManager } from './history-manager.js';
import { formatDimensions } from '../utils/dimensions.js';
import { generateFilename } from '../utils/filename-utils.js';
import { dataURLToBlob } from '../utils/image-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const searchInput = document.getElementById('searchInput');
  const modeFilter = document.getElementById('modeFilter');
  const btnClearHistory = document.getElementById('btnClearHistory');
  const captureGrid = document.getElementById('captureGrid');
  const emptyState = document.getElementById('emptyState');
  const itemCountText = document.getElementById('itemCountText');
  const toast = document.getElementById('toast');

  let allCaptures = [];

  async function loadHistory() {
    allCaptures = await HistoryManager.listCaptures();
    renderFiltered();
  }

  function renderFiltered() {
    const query = searchInput.value;
    const mode = modeFilter.value;
    const filtered = HistoryManager.filterCaptures(allCaptures, { query, mode });

    itemCountText.textContent = `Showing ${filtered.length} capture${filtered.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
      captureGrid.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';
    captureGrid.innerHTML = '';

    const modeLabels = {
      auto: 'Full Page',
      manual: 'Manual Capture',
      visible: 'Visible Area',
      selected: 'Selected Area'
    };

    for (const item of filtered) {
      const card = document.createElement('div');
      card.className = 'capture-card';

      const thumbContainer = document.createElement('div');
      thumbContainer.className = 'card-thumb-container';
      thumbContainer.onclick = () => {
        window.location.href = `../result/result.html?id=${encodeURIComponent(item.id)}`;
      };

      const img = document.createElement('img');
      img.className = 'card-thumb';
      img.src = item.thumbnail || item.dataUrl;
      img.alt = item.title;

      const badge = document.createElement('div');
      badge.className = 'card-mode-badge';
      badge.textContent = modeLabels[item.mode] || 'Capture';

      thumbContainer.appendChild(img);
      thumbContainer.appendChild(badge);

      const body = document.createElement('div');
      body.className = 'card-body';

      const title = document.createElement('h3');
      title.className = 'card-title';
      title.textContent = item.title || 'Untitled Screenshot';

      const urlLink = document.createElement('a');
      urlLink.className = 'card-url';
      urlLink.href = item.url || '#';
      urlLink.target = '_blank';
      urlLink.rel = 'noopener noreferrer';
      urlLink.textContent = item.url || 'No URL';

      const meta = document.createElement('div');
      meta.className = 'card-meta';

      const dateStr = new Date(item.timestamp).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const dateSpan = document.createElement('span');
      dateSpan.textContent = dateStr;

      const dim = item.dimensions || { width: 0, height: 0, dpr: 1 };
      const dimSpan = document.createElement('span');
      dimSpan.textContent = formatDimensions(dim.width, dim.height);

      meta.appendChild(dateSpan);
      meta.appendChild(dimSpan);

      body.appendChild(title);
      body.appendChild(urlLink);
      body.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const viewBtn = document.createElement('a');
      viewBtn.className = 'card-btn';
      viewBtn.href = `../result/result.html?id=${encodeURIComponent(item.id)}`;
      viewBtn.textContent = 'View';

      const editBtn = document.createElement('a');
      editBtn.className = 'card-btn';
      editBtn.href = `../editor/editor.html?id=${encodeURIComponent(item.id)}`;
      editBtn.textContent = 'Edit';

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'card-btn';
      downloadBtn.textContent = 'Download';
      downloadBtn.onclick = async () => {
        const fullItem = await HistoryManager.getCaptureDetails(item.id);
        if (fullItem && fullItem.dataUrl) {
          const blob = dataURLToBlob(fullItem.dataUrl);
          const filename = generateFilename({ title: fullItem.title, url: fullItem.url, format: 'png' });
          const url = URL.createObjectURL(blob);
          if (chrome && chrome.downloads && chrome.downloads.download) {
            chrome.downloads.download({ url, filename, saveAs: false });
          } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
          }
          showToast('Downloaded ' + filename);
        }
      };

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'card-btn card-btn-danger';
      deleteBtn.title = 'Delete';
      deleteBtn.innerHTML = '🗑';
      deleteBtn.onclick = async () => {
        if (confirm(`Delete "${item.title}"?`)) {
          await HistoryManager.removeCapture(item.id);
          showToast('Screenshot deleted.');
          await loadHistory();
        }
      };

      actions.appendChild(viewBtn);
      actions.appendChild(editBtn);
      actions.appendChild(downloadBtn);
      actions.appendChild(deleteBtn);

      card.appendChild(thumbContainer);
      card.appendChild(body);
      card.appendChild(actions);

      captureGrid.appendChild(card);
    }
  }

  searchInput.addEventListener('input', renderFiltered);
  modeFilter.addEventListener('change', renderFiltered);

  btnClearHistory.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete ALL screenshot history? This cannot be undone.')) {
      await HistoryManager.clearHistory();
      showToast('All history cleared.');
      await loadHistory();
    }
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2500);
  }

  await loadHistory();
});
