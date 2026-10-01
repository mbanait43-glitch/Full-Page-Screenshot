// utils/filename-utils.js: Generates safe, readable filenames for exported screenshots

export function sanitizeFilename(str) {
  if (!str) return 'screenshot';
  // Remove invalid filesystem characters: \ / : * ? " < > | and control chars
  let cleaned = str
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();

  // Limit length
  if (cleaned.length > 60) {
    cleaned = cleaned.substring(0, 60);
  }
  return cleaned || 'screenshot';
}

export function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins = pad(date.getMinutes());
  const secs = pad(date.getSeconds());
  return `${year}-${month}-${day}_${hours}-${mins}-${secs}`;
}

export function generateFilename({ title = '', url = '', format = 'png', prefix = 'Full Page Screenshot - 100% Free & Edit' }) {
  let base = '';
  if (title && title.trim()) {
    base = sanitizeFilename(title);
  } else if (url) {
    try {
      const u = new URL(url);
      base = sanitizeFilename(u.hostname + u.pathname);
    } catch {
      base = 'webpage';
    }
  } else {
    base = 'capture';
  }

  const timestamp = formatTimestamp();
  const ext = format.toLowerCase() === 'jpeg' || format.toLowerCase() === 'jpg' ? 'jpg' :
              format.toLowerCase() === 'pdf' ? 'pdf' : 'png';

  return `${prefix} - ${base}_${timestamp}.${ext}`;
}
