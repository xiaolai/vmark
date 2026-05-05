# Export & Print

VMark provides multiple ways to export and share your documents.

## Export Modes

### Folder Mode (Default)

Creates a self-contained folder with clean structure:

```text
MyDocument/
├── index.html
└── assets/
    ├── image1.png
    ├── image2.jpg
    └── ...
```

**Benefits:**
- Clean URLs when served (`/MyDocument/` instead of `/MyDocument.html`)
- Easy to share as a single folder
- Simple asset paths (`assets/image.png`)
- Works great with static site hosts

### Single File Mode

Creates a single self-contained HTML file:

```text
MyDocument.html
```

All images are embedded as data URIs, making it completely portable but larger in file size.

## How to Export

### Export HTML

1. Use **File → Export HTML**
2. Choose export location
3. For folder mode: Enter folder name (e.g., `MyDocument`)
4. For single mode: Enter filename with `.html` extension

### Print / Export PDF

1. Press `Cmd/Ctrl + P` or use **File → Print**
2. Use the system print dialog to print or save as PDF

### Export via Pandoc

VMark integrates with [Pandoc](https://pandoc.org/) — a universal document converter — to export your markdown to additional formats. Choose a format directly from the menu:

**File → Export → Via Pandoc →**

| Menu Item | Extension |
|-----------|-----------|
| Word (.docx) | `.docx` |
| EPUB (.epub) | `.epub` |
| LaTeX (.tex) | `.tex` |
| OpenDocument (.odt) | `.odt` |
| Rich Text (.rtf) | `.rtf` |
| Plain Text (.txt) | `.txt` |

**Setup:**

1. Install Pandoc from [pandoc.org/installing](https://pandoc.org/installing.html) or via your package manager:
   - macOS: `brew install pandoc`
   - Windows: `winget install pandoc`
   - Linux: `apt install pandoc`
2. Restart VMark (or go to **Settings → Files & Images → Document Tools** and click **Detect**)
3. Use **File → Export → Via Pandoc → [format]** to export

If Pandoc is not installed, the **Via Pandoc** submenu shows a single item — **"Install Pandoc to export to Word, EPUB, LaTeX…"** — which opens the Pandoc install guide when clicked.

You can verify Pandoc is detected in **Settings → Files & Images → Document Tools**.

### Copy as HTML

Press `Cmd/Ctrl + Shift + C` to copy the rendered HTML to clipboard for pasting into other applications.

## VMark Reader

When you export to HTML (styled mode), your document includes the **VMark Reader** — an interactive reading experience with powerful features.

### Settings Panel

Click the gear icon (bottom-right) or press `Esc` to open the settings panel:

| Setting | Description |
|---------|-------------|
| Font Size | Adjust text size (12px – 24px) |
| Line Height | Adjust line spacing (1.2 – 2.0) |
| Theme | Cycle through themes (White, Paper, Mint, Sepia, Night) |
| CJK-Latin Spacing | Toggle spacing between CJK and Latin characters |

### Table of Contents

The TOC sidebar helps navigate long documents:

- **Toggle**: Click the panel header or press `T`
- **Navigate**: Click any heading to jump to it
- **Keyboard**: Use `↑`/`↓` arrows to move, `Enter` to jump
- **Highlight**: Current section is highlighted as you scroll

### Reading Progress

A subtle progress bar at the top of the page shows how far you've read through the document.

### Back to Top

A floating button appears when you scroll down. Click it or press `Home` to return to the top.

### Image Lightbox

Click any image to view it in a full-screen lightbox:

- **Close**: Click outside, press `Esc`, or click the X button
- **Navigate**: Use `←`/`→` arrows for multiple images
- **Zoom**: Images display at their natural size

### Code Blocks

Each code block includes interactive controls:

| Button | Function |
|--------|----------|
| Line numbers toggle | Show/hide line numbers for this block |
| Copy button | Copy code to clipboard |

The copy button shows a checkmark when successful.

### Footnote Navigation

Footnotes are fully interactive:

- Click a footnote reference `[1]` to jump to its definition
- Click the `↩` backref to return to where you were reading

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Toggle settings panel |
| `T` | Toggle Table of Contents |
| `↑` / `↓` | Navigate TOC items |
| `Enter` | Jump to selected TOC item |
| `←` / `→` | Navigate images in lightbox |
| `Home` | Scroll to top |

## Export Shortcuts

| Action | Shortcut |
|--------|----------|
| Export HTML | _(menu only)_ |
| Print | `Mod + P` |
| Copy as HTML | `Mod + Shift + C` |

## Tips

### Serving Exported HTML

The folder export structure works well with any static file server:

```bash
# Python
cd MyDocument && python -m http.server 8000

# Node.js (npx)
npx serve MyDocument

# Open directly
open MyDocument/index.html
```

### Offline Viewing

Both export modes work completely offline:

- **Folder mode**: Open `index.html` in any browser
- **Single mode**: Open the `.html` file directly

Math equations (KaTeX) require an internet connection for the stylesheet, but all other content works offline.

### Best Practices

1. **Use folder mode** for documents you'll share or host
2. **Use single mode** for quick sharing via email or chat
3. **Include descriptive image alt text** for accessibility
4. **Test the exported HTML** in different browsers
