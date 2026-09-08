# Export & Print

VMark provides multiple ways to export and share your documents.

## What an Export Produces

**File → Export → HTML** writes one folder, named after your document, that always contains **both** of these files — there is no mode to choose:

```text
MyDocument/
├── index.html          ← links to the files under assets/
├── standalone.html     ← everything embedded as data URIs (CSS, JS, images, fonts)
└── assets/
    ├── vmark-reader.css
    ├── vmark-reader.js
    ├── images/
    │   ├── image1.png
    │   └── ...
    └── fonts/          ← only when the document has math or you use a web font
```

Use whichever file suits the moment:

| File | Best for | Trade-off |
|------|----------|-----------|
| `index.html` | Hosting on a static site (clean `/MyDocument/` URLs), editing in another tool, keeping the size down | Needs the `assets/` folder beside it |
| `standalone.html` | Emailing or messaging a single file that cannot lose its images | Larger — every asset is inlined |

Both files are rendered by the same WYSIWYG renderer and stylesheet the editor uses, and both include the [VMark Reader](#vmark-reader).

## How to Export

### Export HTML

1. Use **File → Export → HTML**
2. Choose where to save and enter a name — it becomes the folder name (a trailing `.html` is stripped)
3. Open `index.html` or `standalone.html` from the new folder

#### Re-exporting into a folder you have used before

An HTML export is all-or-nothing. Everything is written to a temporary
`.vmark-export-…` folder inside your chosen destination first, and only moved
into place once every file exists — so an export that fails part way leaves
the previous export exactly as it was, rather than half-overwriting it.

Two things you may see:

- **"Another export is already writing to this folder."** Only one export can
  write to a folder at a time, across windows. Wait for the other one, or — if
  nothing else is running — delete the `.vmark-export.lock` file the message
  names and try again.
- **A `.vmark-export-…` folder left behind.** VMark removes it when it is
  finished. It only remains if putting your previous files back also failed,
  in which case it holds those files and the error message says exactly where
  they are. Nothing is deleted while that is the only copy.

### Print / Export PDF

Available on macOS, Windows and Linux.

**Export PDF** (**File → Export → PDF**) writes a PDF directly, using the page
size, orientation, margins and typography you choose in the export dialog.

**Print** (`Cmd/Ctrl + P`, or **File → Print**) opens the system print dialog
instead, so you can send the document to a printer or use your operating
system's own "save as PDF". On macOS and Linux, VMark confirms a finished print
job with a short notice and stays quiet if you cancel the dialog; Windows's
print UI does not report back, so no notice is shown there.

The export dialog shows the same progress stages — loading, generating,
finishing, done — on all three platforms.

::: info Page size on macOS
Until this release, the Page Size and Orientation controls had no effect on
macOS — every export came out at whatever paper size your system was set to.
If your Mac defaults to Letter and you had chosen A4, you were getting Letter.

That is fixed, so your exports may now differ from what the same document
produced before. They will match what the dialog says.
:::

**Sidebar outline.** Exported PDFs carry a heading outline — the clickable
table of contents your PDF viewer shows in its sidebar — on all three
platforms. It used to be macOS-only; Windows and Linux got the same document
with an empty sidebar.

#### Page numbers

The dialog's **Page numbers** section adds a number to each page. It is on by
default, centred at the bottom.

| Setting | Options |
|---------|---------|
| Position | Bottom centre, bottom right, or off |
| Format | `7`, `7 / 12`, or `Page 7 of 12` |
| Skip first page | Leaves page 1 unnumbered, the usual treatment for a title page |

The number sits inside the bottom margin you chose, and scales with your body
font size. Numbering always reflects the real page, so skipping the first page
gives you 2, 3, 4… on the pages that follow rather than renumbering them.

::: info Page numbers use a Latin alphabet
The number is drawn with a standard PDF font that no viewer has to download,
which is what keeps exports fast and self-contained — but that font cannot
render Chinese, Japanese, Korean or Cyrillic. The two numeric formats work in
every language. If your interface language writes `Page 7 of 12` in a script
that font cannot draw, VMark leaves those pages unnumbered rather than printing
blanks or wrong characters; choose `7` or `7 / 12` instead.
:::

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

Every HTML export includes the **VMark Reader** — an interactive reading experience with its own settings, navigation and lightbox.

### Settings Panel

Click the gear icon (bottom-right) to open the settings panel; `Esc` closes it again. Your choices are remembered by the browser (`localStorage`), so they apply the next time you open the file.

| Setting | Options |
|---------|---------|
| Font Size | 12px – 28px |
| Line Height | 1.2 – 2.4 |
| Content Width | 30em – 80em |
| Latin Font | System, Athelas, Palatino, Georgia, Charter, Literata |
| CJK Font | System, PingFang, Songti, Kaiti, Noto Serif, Source Han |
| Theme | White, Paper (default), Mint, Sepia, Night |
| CJK Letter Spacing | 0.02em – 0.12em |
| CJK-Latin Spacing | Toggle automatic spacing between CJK and Latin characters |
| Table of Contents | Toggle the TOC sidebar (same as pressing `T`) |
| Expand All Sections | Open every collapsible `<details>` block |
| Reset to Defaults | Put every setting back |

### Table of Contents

The TOC sidebar helps navigate long documents:

- **Toggle**: Click the tab at the edge of the page or press `T`
- **Navigate**: Click any heading to jump to it
- **Highlight**: The current section is highlighted as you scroll

### Reading Progress

A subtle progress bar at the top of the page shows how far you've read through the document.

### Back to Top

A floating button appears when you scroll down. Click it to return to the top.

### Image Lightbox

Click any image to view it in a full-screen lightbox:

- **Close**: Click outside, press `Esc`, or click the X button
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
| `Esc` | Close the settings panel or the lightbox |
| `T` | Toggle Table of Contents |
| `+` / `=` | Increase font size |
| `-` | Decrease font size |

## Export Shortcuts

| Action | Shortcut |
|--------|----------|
| Export HTML | _(menu only)_ |
| Export PDF | _(menu only)_ |
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

Both files open offline, with one difference for documents that contain math:

- **`standalone.html`** is fully self-contained — the KaTeX stylesheet and fonts are inlined at export time, so math renders with no connection.
- **`index.html`** loads the KaTeX stylesheet from a CDN (jsDelivr), so its math needs an internet connection when the page is opened; the reader, images and fonts under `assets/` are local.

Fonts are downloaded while you export (KaTeX fonts, and any web font you chose in Settings), so export on a machine with internet access if you want them embedded — an offline export falls back to system fonts.

### Best Practices

1. **Host `index.html`** for documents you'll publish — keep the `assets/` folder beside it
2. **Send `standalone.html`** for quick sharing via email or chat
3. **Include descriptive image alt text** for accessibility
4. **Test the exported HTML** in different browsers
