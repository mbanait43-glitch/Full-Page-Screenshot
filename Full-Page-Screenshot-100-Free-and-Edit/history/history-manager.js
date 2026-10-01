// history/history-manager.js: Manages screenshot records in local storage / IndexedDB

import { getAllCaptures, getCapture, deleteCapture, clearAllCaptures } from '../utils/storage.js';

export class HistoryManager {
  static async listCaptures(limit = 100) {
    return await getAllCaptures(limit);
  }

  static async getCaptureDetails(id) {
    return await getCapture(id);
  }

  static async removeCapture(id) {
    return await deleteCapture(id);
  }

  static async clearHistory() {
    return await clearAllCaptures();
  }

  static filterCaptures(captures, { query = '', mode = 'all' } = {}) {
    const q = query.toLowerCase().trim();
    return captures.filter(item => {
      const matchQuery = !q || (item.title && item.title.toLowerCase().includes(q)) || (item.url && item.url.toLowerCase().includes(q));
      const matchMode = mode === 'all' || item.mode === mode;
      return matchQuery && matchMode;
    });
  }
}
