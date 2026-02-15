# Features

VMark is a feature-rich Markdown editor designed for modern writing workflows. Here's what's included.

## Editor Modes

### Rich Text Mode (WYSIWYG)

The default editing mode provides a true "what you see is what you get" experience:

- Live formatting preview as you type
- Inline syntax reveal on cursor hover
- Intuitive toolbar and context menus
- Seamless markdown syntax input

### Source Mode

Switch to raw Markdown editing with full syntax highlighting:

- CodeMirror 6 powered editor
- Full syntax highlighting
- Familiar text editor experience
- Perfect for advanced users

Toggle between modes with `F6`.

### Source Peek

Edit the raw Markdown of a single block without leaving WYSIWYG mode. Press `F5` to open Source Peek for the block at cursor.

**Layout:**
- Header bar with block type label and action buttons
- CodeMirror editor showing the block's Markdown source
- Original block shown as dimmed preview (when live preview is ON)

**Controls:**
| Action | Shortcut |
|--------|----------|
| Save changes | `Cmd/Ctrl + Enter` |
| Cancel (revert) | `Escape` |
| Toggle live preview | Click eye icon |

**Live Preview:**
- **OFF (default):** Edit freely, changes applied only on save
- **ON:** Changes applied immediately as you type, preview shown below

**Excluded blocks:**
Some blocks have their own editing mechanisms and skip Source Peek:
- Code blocks (including Mermaid, LaTeX) — use double-click to edit
- Block images — use image popup
- Frontmatter, HTML blocks, horizontal rules

Source Peek is useful for precise Markdown editing (fixing table syntax, adjusting list indentation) while staying in the visual editor.

## Text Formatting

### Basic Styles

- **Bold**, *Italic*, ~~Strikethrough~~
- `Inline code`
- Subscript and Superscript
- Links with preview popups
- Clear formatting command

### Text Transformations

Quickly change text case via Format → Transform:

| Transform | Shortcut |
|-----------|----------|
| UPPERCASE | `Ctrl+Shift+U` |
| lowercase | `Ctrl+Shift+L` |
| Title Case | `Ctrl+Shift+T` |
| Toggle Case | — |

### Block Elements

- Headings 1-6 with easy shortcuts
- Blockquotes (nested supported)
- Code blocks with syntax highlighting
- Ordered, unordered, and task lists
- Horizontal rules
- Tables with full editing support

### Hard Line Breaks

Press `Shift+Enter` to insert a hard line break within a paragraph.
VMark uses two-space style by default for maximum compatibility.
Configure in **Settings > Editor > Whitespace**.

### Line Operations

Powerful line manipulation via Edit → Lines:

| Action | Shortcut |
|--------|----------|
| Move Line Up | `Alt+Up` |
| Move Line Down | `Alt+Down` |
| Duplicate Line | `Shift+Alt+Down` |
| Delete Line | `Mod+Shift+K` |
| Join Lines | `Mod+J` |
| Remove Blank Lines | — |
| Sort Lines Ascending | `F5` |
| Sort Lines Descending | `Shift+F5` |

## Tables

Full-featured table editing:

- Insert tables via menu or shortcut
- Add/delete rows and columns
- Cell alignment (left, center, right)
- Resize columns by dragging
- Context toolbar for quick actions
- Keyboard navigation (Tab, arrows, Enter)

## Images

Comprehensive image support:

- Insert via file dialog
- Drag & drop from file system
- Paste from clipboard
- Auto-copy to project assets folder
- Resize via context menu
- Hover tooltip with filename, dimensions, and reveal in Finder
- Click to edit source path and alt text

## Video & Audio

Full media support with HTML5 tags:

- Insert video and audio via toolbar file picker
- Drag & drop media files into the editor
- Auto-copy to project `.assets/` folder
- Click to edit source path, title, and poster (video)
- YouTube embed support with privacy-enhanced iframes
- Image syntax fallback: `![](file.mp4)` auto-promotes to video
- Source mode decoration with type-specific colored borders
- [Learn more →](/guide/media-support)

## Special Content

### Info Boxes

GitHub-flavored markdown alerts:

- NOTE - General information
- TIP - Helpful suggestions
- IMPORTANT - Key information
- WARNING - Potential issues
- CAUTION - Dangerous actions

### Collapsible Sections

Create expandable content blocks using the `<details>` HTML element.

### Mathematical Equations

KaTeX-powered LaTeX rendering:

- Inline math: `$E = mc^2$`
- Display math: `$$...$$` blocks
- Full LaTeX syntax support
- Helpful error messages with syntax hints

### Diagrams

Mermaid diagram support with live preview:

- Flowcharts, sequence diagrams, Gantt charts
- Class diagrams, state diagrams, ER diagrams
- Live preview panel in Source mode (drag, resize, zoom)
- [Learn more →](/guide/mermaid)

### SVG Graphics

Render raw SVG inline via ` ```svg ` code blocks:

- Instant rendering with pan, zoom, and PNG export
- Live preview in both WYSIWYG and Source modes
- Ideal for AI-generated charts and custom illustrations
- [Learn more →](/guide/svg)

## AI Genies

Built-in AI writing assistance powered by your choice of provider:

- 13 genies across four categories — editing, creative, structure, and tools
- Spotlight-style picker with search and freeform prompts (`Mod + Y`)
- Inline suggestion rendering — accept or reject with keyboard shortcuts
- Supports CLI providers (Claude, Codex, Gemini, Ollama) and REST APIs

[Learn more →](/guide/ai-genies) | [Configure providers →](/guide/ai-providers)

## Search & Replace

- Find bar (`Cmd/Ctrl + F`)
- Find next/previous
- Use selection for find
- Regular expression search
- Replace all functionality

## Export Options

VMark offers flexible export options for sharing your documents.

### HTML Export

Export to standalone HTML with two packaging modes:

- **Folder mode** (default): Creates `Document/index.html` with assets in a subfolder
- **Single file mode**: Creates a self-contained `.html` file with embedded images

Exported HTML includes the **VMark Reader** — interactive controls for settings, table of contents, image lightbox, and more.

[Learn more about export →](/guide/export)

### PDF Export

Print to PDF with native system dialog (`Cmd/Ctrl + P`).

### Copy as HTML

Copy formatted content for pasting into other apps (`Cmd/Ctrl + Shift + C`).

### Copy Format

By default, copying from WYSIWYG puts plain text (without formatting) in the clipboard. Enable **Markdown** copy format in **Settings > Markdown > Paste & Input** to put Markdown syntax in `text/plain` instead — headings keep their `#`, links keep their URLs, etc. Useful when pasting into terminals, code editors, or chat apps.

## CJK Formatting

Built-in Chinese/Japanese/Korean text formatting:

- 20+ configurable formatting rules
- CJK-English spacing
- Fullwidth character conversion
- Punctuation normalization
- Smart quote pairing with apostrophe/prime detection
- Technical construct protection (URLs, versions, times, decimals)
- Contextual quote conversion (curly for CJK, straight for Latin)
- Toggle quote style at cursor (`Shift + Mod + '`)
- [Learn more →](/guide/cjk-formatting)

## Document History

- Auto-save with configurable interval
- View and restore previous versions
- JSONL storage format
- Per-document history

## View & Focus

### Focus Mode (`F8`)

Dim everything except the current paragraph for distraction-free writing.

### Typewriter Mode (`F9`)

Keep the active line centered on screen for a typewriter-like experience.

### Word Wrap (`Alt + Z`)

Toggle soft line wrapping in the editor.

## Text Utilities

VMark includes utilities for text cleanup and formatting, available in the Format menu:

### Text Cleanup (Format → Text Cleanup)

- **Remove Trailing Spaces**: Strip whitespace from line endings
- **Collapse Blank Lines**: Reduce multiple blank lines to single

### CJK Formatting (Format → CJK)

Built-in Chinese/Japanese/Korean text formatting tools. [Learn more →](/guide/cjk-formatting)

### Image Cleanup (File → Clean Up Unused Images)

Find and remove orphaned images from your assets folder.

## Integrated Terminal

Built-in terminal panel with multiple sessions, copy/paste, search, clickable file paths and URLs, context menu, theme sync, and configurable font settings. Toggle with `` Ctrl + ` ``. [Learn more →](/guide/terminal)

## Auto-Update

VMark automatically checks for updates and can download and install them in-app:

- Automatic update checking on launch
- One-click update installation
- Release notes preview before updating

## Workspace Support

- Open folders as workspaces
- File tree navigation in sidebar
- Quick file switching
- Recent files tracking
- Window size and position remembered across sessions

## Customization

### Themes

Five built-in color themes:

- White (clean, minimal)
- Paper (warm off-white)
- Mint (soft green tint)
- Sepia (vintage look)
- Night (dark mode)

### Fonts

Configure separate fonts for:

- Latin text
- CJK (Chinese/Japanese/Korean) text
- Monospace (code)

### Layout

Adjust:

- Font size
- Line height
- Block spacing (gap between paragraphs and blocks)
- CJK letter spacing (subtle spacing for CJK readability)
- Editor width
- Block element font size (lists, blockquotes, tables, alerts)
- Heading alignment (left or center)
- Image & table alignment (left or center)

### Keyboard Shortcuts

All shortcuts are customizable in Settings → Shortcuts.

## Technical Details

VMark is built with modern technology:

| Component | Technology |
|-----------|------------|
| Desktop Framework | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript |
| State Management | Zustand v5 |
| Rich Text Editor | Tiptap (ProseMirror) |
| Source Editor | CodeMirror 6 |
| Styling | Tailwind CSS v4 |

All processing happens locally on your machine - no cloud services, no accounts required.
