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

### Diagrams

Mermaid diagram support with live preview:

- Flowcharts, sequence diagrams, Gantt charts
- Class diagrams, state diagrams, ER diagrams
- Live preview panel in Source mode (drag, resize, zoom)
- [Learn more →](/guide/mermaid)

## Search & Replace

- Find bar (`Cmd/Ctrl + F`)
- Find next/previous
- Use selection for find
- Regular expression search
- Replace all functionality

## Export Options

### HTML Export

Export to standalone HTML with GitHub-style CSS.

### PDF Export

Print to PDF with native system dialog.

### Copy as HTML

Copy formatted content for pasting into other apps.

## CJK Formatting

Built-in Chinese/Japanese/Korean text formatting:

- 20+ configurable formatting rules
- CJK-English spacing
- Fullwidth character conversion
- Punctuation normalization
- Smart quote pairing with apostrophe/prime detection
- Technical construct protection (URLs, versions, times, decimals)
- Contextual quote conversion (curly for CJK, straight for Latin)
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
