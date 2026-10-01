# 📸 Full Page Screenshot — 100% Free & Edit

A powerful, privacy-friendly Chrome extension for capturing full webpages, visible areas, and selected sections — with built-in screenshot editing, annotation, OCR, history, and PDF export.

> **100% Free • No Subscription • No Watermark**

## ✨ Features

### 📄 Screenshot Capture

* **Full Page Capture (Auto)** — Automatically scrolls through the webpage and stitches all sections into one complete screenshot.
* **Manual Full Page Capture** — Manually control scrolling while the extension tracks and stitches captured sections.
* **Visible Area Capture** — Instantly capture the currently visible browser viewport.
* **Selected Area Capture** — Capture a specific area of the webpage.
* Smart handling for:

  * Sticky/fixed headers
  * Dynamic webpage content
  * Lazy-loaded content
  * Long webpages
  * Scroll-based page changes

### ✏️ Built-in Screenshot Editor

Edit captured screenshots without leaving the extension.

Available tools include:

* Select / Move
* Crop
* Text
* Arrow
* Rectangle
* Circle / Ellipse
* Highlight
* Blur / Privacy Redaction
* Custom annotation colors
* Adjustable stroke width
* Adjustable arrowhead size
* Undo / Redo
* Zoom controls

### 📤 Export Options

Save your screenshots in multiple formats:

* PNG — Lossless quality
* JPG / JPEG — Compressed file size
* PDF — Paginated A4
* PDF — Continuous page
* PDF — Letter format
* Copy screenshot directly to clipboard

### 🔍 OCR Support

Built-in OCR functionality powered by **Tesseract.js** allows text recognition from screenshots.

The extension includes its OCR engine locally, helping keep processing inside the extension.

### 🕘 Screenshot History

* Save and manage previous screenshots
* Quickly reopen captured screenshots
* Edit previous captures
* Delete unwanted screenshots
* Persistent local storage

### ⚙️ Custom Settings

Customize:

* Default image format
* JPG quality
* Scroll settle delay
* Lazy-loaded content wait time
* PDF page size
* PDF orientation
* Optional webpage URL and timestamp metadata
* Keyboard shortcuts

### ⌨️ Keyboard Shortcuts

| Action                   | Shortcut          |
| ------------------------ | ----------------- |
| Auto Full Page Capture   | `Alt + Shift + F` |
| Visible Area Capture     | `Alt + Shift + V` |
| Selected Area Capture    | `Alt + Shift + S` |
| Manual Full Page Capture | `Alt + Shift + M` |

## 🛠️ Tech Stack

* **JavaScript (ES6+)**
* **HTML5**
* **CSS3**
* **Chrome Extensions Manifest V3**
* **Chrome Extension Service Worker**
* **Tesseract.js** — OCR
* **Lottie** — UI animations
* **Canvas API** — Screenshot processing and editing
* **Chrome Storage API** — Local data persistence
* **Chrome Downloads API** — File downloads
* **Chrome Scripting API** — Page interaction
* **Offscreen Documents** — OCR/background processing

## 📁 Project Structure

```text
Full-Page-Screenshot/
│
├── manifest.json
├── background/
│   └── service-worker.js
│
├── capture/
│   ├── area-capture.js
│   ├── auto-capture.js
│   ├── capture-controller.js
│   ├── dynamic-content-handler.js
│   ├── fixed-element-handler.js
│   ├── manual-capture.js
│   ├── page-detector.js
│   ├── screenshot-manager.js
│   ├── scroll-manager.js
│   ├── segment-manager.js
│   ├── stitcher.js
│   └── visible-capture.js
│
├── content/
│   ├── content.js
│   ├── content.css
│   ├── lottie_light.min.js
│   └── timing-data.js
│
├── editor/
│   ├── editor.html
│   ├── editor.js
│   └── editor.css
│
├── history/
│   ├── history.html
│   ├── history.js
│   └── history.css
│
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
│
├── ocr/
│   ├── offscreen.html
│   ├── offscreen.js
│   └── lib/
│
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
│
├── popup/
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── lottie/
│
├── result/
│   ├── result.html
│   ├── result.js
│   └── result.css
│
└── utils/
    ├── dimensions.js
    ├── filename-utils.js
    ├── image-utils.js
    ├── messaging.js
    ├── ocr-engine.js
    ├── pdf-generator.js
    └── storage.js
```

## 🚀 Installation

This project is a Chrome Extension and can be installed locally using Chrome's Developer Mode.

### Step 1 — Download the Project

Clone the repository:

```bash
git clone https://github.com/mbanait43-glitch/mayurbanait-portfolio.git
```

Or download the repository as a ZIP file and extract it.

### Step 2 — Open Chrome Extensions

Open:

```text
chrome://extensions/
```

### Step 3 — Enable Developer Mode

Turn on **Developer mode** from the top-right corner.

### Step 4 — Load the Extension

Click:

**Load unpacked**

Select the project folder containing:

```text
manifest.json
```

The extension will now appear in Chrome.

## 🔐 Permissions

The extension uses Chrome permissions required for its core functionality.

### Required Permissions

* `activeTab` — Access the currently active tab when capturing screenshots.
* `scripting` — Run capture logic on webpages.
* `storage` — Store screenshot history and user preferences.
* `downloads` — Download screenshots and exported files.
* `contextMenus` — Provide context-menu functionality.
* `offscreen` — Support background/offscreen processing.

### Optional Permissions

* `<all_urls>` — Requested when webpage access is required for capture functionality.
* `tabs` — Used for tab-related capture operations.

The extension does not require an external backend server for its core screenshot functionality.

## 🔒 Privacy

This extension is designed with a local-first approach.

* Screenshots are processed locally by the extension.
* Screenshot history is stored using Chrome's local storage mechanisms.
* OCR processing uses the bundled Tesseract.js engine.
* No account is required for basic usage.
* No subscription is required.
* No watermark is added to screenshots.

Always review and understand browser permissions before installing any browser extension.

## 📌 Use Cases

This extension can be useful for:

* Developers
* Designers
* QA testers
* Students
* Researchers
* Documentation
* Bug reporting
* Website archiving
* UI/UX reviews
* Saving long webpages
* Creating PDF references
* Capturing web-based dashboards

## 🧩 Browser Compatibility

Designed primarily for Chromium-based browsers supporting **Manifest V3** and the required Chrome Extension APIs.

Examples include:

* Google Chrome
* Microsoft Edge
* Other Chromium-based browsers with compatible extension API support

## 🗺️ Roadmap

Potential future improvements:

* More annotation tools
* Improved capture handling for complex websites
* Additional export formats
* Better OCR workflows
* Cloud sync as an optional feature
* More customization options
* Additional Chromium browser support

## 🤝 Contributing

Contributions, suggestions, bug reports, and feature requests are welcome.

1. Fork the repository.
2. Create a new branch.
3. Make your changes.
4. Test the extension locally.
5. Commit your changes.
6. Open a Pull Request.

## 📄 License

License information will be added to this repository as the project licensing model is finalized.

## 👨‍💻 Author

**Mayur Banait**

GitHub:
https://github.com/mbanait43-glitch

---

### ⭐ Project

**Full Page Screenshot — 100% Free & Edit**

A free Chrome extension focused on fast full-page screenshot capture, editing, OCR, and flexible export options — all from one browser extension.
