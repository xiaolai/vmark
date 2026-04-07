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
- Interactive popups for math, links, images, wiki links, and media — same editing experience as WYSIWYG
- Smart paste — HTML from web pages and Word documents is automatically converted to clean Markdown
- Clipboard image paste — screenshots and copied images are saved to the assets folder and inserted as `![](path)`
- Code-fence-aware multi-cursor with CJK word boundary support
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

## Multi-Cursor Editing

Edit multiple locations simultaneously — VMark supports full multi-cursor in both WYSIWYG and Source modes.

| Action | Shortcut |
|--------|----------|
| Add cursor at next match | `Mod + D` |
| Skip match, jump to next | `Mod + Shift + D` |
| Select all occurrences | `Mod + Shift + L` |
| Add cursor above/below | `Mod + Alt + Up/Down` |
| Add cursor at click | `Alt + Click` |
| Undo last cursor | `Alt + Mod + Z` |
| Collapse to single cursor | `Escape` |

All standard editing (typing, deletion, clipboard, navigation) works at every cursor independently. Block-scoped by default to prevent unintended edits across sections.

[Learn more →](/guide/multi-cursor)

## Auto-Pair & Tab Escape

When you type an opening bracket, quote, or backtick, VMark auto-inserts the closing pair. Press **Tab** to jump past the closing character instead of reaching for the arrow key.

- Brackets: `()` `[]` `{}`
- Quotes: `""` `''` `` ` ` ``
- CJK: `「」` `『』` `（）` `【】` `《》` `〈〉`
- Curly quotes: `""` `''`
- Formatting marks in WYSIWYG: **bold**, *italic*, `code`, ~~strike~~, links

Backspace deletes both characters when the pair is empty. Auto-pair and Tab bracket jump are both **disabled inside code blocks and inline code** — brackets in code stay literal. Configurable in **Settings → Editor**.

[Learn more →](/guide/tab-navigation)

## Text Formatting

### Basic Styles

- **Bold**, *Italic*, <u>Underline</u>, ~~Strikethrough~~
- `Inline code`, ==Highlight==
- Subscript and Superscript
- Links, Wiki Links, and Bookmark Links with preview popups
- Footnotes with inline editing
- HTML comment toggle (`Mod + /`)
- Clear formatting command

### Text Transformations

Quickly change text case via Format → Transform:

| Transform | Shortcut |
|-----------|----------|
| UPPERCASE | `Ctrl + Shift + U` (macOS) / `Alt + Shift + U` (Win/Linux) |
| lowercase | `Ctrl + Shift + L` (macOS) / `Alt + Shift + L` (Win/Linux) |
| Title Case | `Ctrl + Shift + T` (macOS) / `Alt + Shift + T` (Win/Linux) |
| Toggle Case | — |

### Block Elements

- Headings 1-6 with easy shortcuts (increase/decrease level with `Mod + Alt + ]`/`[`)
- Blockquotes (nested supported)
- Code blocks with syntax highlighting
- Ordered, unordered, and task lists
- Cycle list type: convert a paragraph to bullet, ordered, or task list in sequence
- Horizontal rules
- Tables with full editing support

### Hard Line Breaks

Press `Shift + Enter` to insert a hard line break within a paragraph.
VMark uses two-space style by default for maximum compatibility.
Configure in **Settings > Editor > Whitespace**.

### Line Operations

Powerful line manipulation via Edit → Lines:

| Action | Shortcut |
|--------|----------|
| Move Line Up | `Alt + Up` |
| Move Line Down | `Alt + Down` |
| Duplicate Line | `Shift + Alt + Down` |
| Delete Line | `Mod + Shift + K` |
| Join Lines | `Mod + J` |
| Remove Blank Lines | — |
| Sort Lines Ascending | `F4` |
| Sort Lines Descending | `Shift + F4` |

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
- Double-click to edit source path, alt text, and dimensions
- Toggle between inline and block display

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

## Frontmatter Panel

Edit YAML frontmatter directly in WYSIWYG mode without switching to Source mode.

- **Collapsed by default** — a small "Frontmatter" label appears at the top of the document when frontmatter is present
- **Click to expand** — opens a plain-text editor for the YAML content
- **`Mod + Enter`** — save changes and collapse the panel
- **`Escape`** — revert to the last saved value and collapse
- **Blur auto-saves** — if you click away, changes are saved automatically after a brief delay

The panel creates an undo point in the editor history, so you can always `Mod + Z` to revert frontmatter changes.

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

### Inline Table of Contents

Type `[TOC]` on its own line to insert a live table of contents:

- Auto-generated from document headings with proper nesting
- Click any heading to scroll directly to it
- Updates in real-time as you edit
- Renders in WYSIWYG, export (HTML/PDF), and Source mode round-trips cleanly

## AI Genies

Built-in AI writing assistance powered by your choice of provider:

- 13 genies across four categories — editing, creative, structure, and tools
- Spotlight-style picker with search and freeform prompts (`Mod + Y`)
- Inline suggestion rendering — accept or reject with keyboard shortcuts
- Supports CLI providers (Claude, Codex, Gemini) and REST APIs (Anthropic, OpenAI, Google AI, Ollama)

[Learn more →](/guide/ai-genies) | [Configure providers →](/guide/ai-providers)

## Search & Replace

Open the find bar with `Mod + F`. It appears inline at the top of the editor area and works in both WYSIWYG and Source modes.

**Navigation:**

| Action | Shortcut |
|--------|----------|
| Find next match | `Enter` or `Mod + G` |
| Find previous match | `Shift + Enter` or `Mod + Shift + G` |
| Use selection for find | `Mod + E` |
| Close find bar | `Escape` |

**Search options** — toggle via buttons in the find bar:

- **Case sensitive** — match exact letter casing
- **Whole word** — only match complete words, not substrings
- **Regular expression** — use regex patterns (enable in Settings first)

**Replace:**

Click the expand chevron on the find bar to reveal the replace row. Type replacement text, then use **Replace** (single match) or **Replace All** (every match at once). The match counter displays the current position and total (e.g., "3 of 12") so you always know where you are.

## Markdown Lint

VMark includes a built-in markdown linter that checks your document for common syntax mistakes and accessibility issues. Enable it in **Settings > Markdown > Lint**.

**How to use:**

| Action | Shortcut |
|--------|----------|
| Run lint check | `Alt + Mod + V` |
| Jump to next issue | `F2` |
| Jump to previous issue | `Shift + F2` |

When you run a lint check, diagnostics appear as inline highlights and gutter markers. If no issues are found, a toast notification confirms the document is clean. Issues are classified as errors or warnings.

**Rules checked (13 total):**

- Undefined reference links
- Mismatched table column counts
- Reversed link syntax `(text)[url]` instead of `[text](url)`
- Missing space after `#` in headings
- Spaces inside emphasis markers
- Empty link text or empty link URLs
- Duplicate link/image definitions
- Unused link/image definitions
- Heading level increments that skip levels (e.g., H1 to H3)
- Images without alt text (accessibility)
- Unclosed fenced code blocks
- Broken fragment links (`#anchor` not matching any heading)

Lint results are ephemeral and cleared when you edit the document. Re-run the check at any time with `Alt + Mod + V`.

## Universal Toolbar

A formatting toolbar anchored at the bottom of the editor, providing quick access to all formatting actions in both WYSIWYG and Source modes.

- **Toggle:** `Mod + Shift + P` opens the toolbar and gives it focus. Press it again to return focus to the editor while keeping the toolbar visible.
- **Keyboard navigation:** Use `Left`/`Right` arrows to move between groups. `Enter` or `Space` opens a dropdown menu. Arrow keys navigate within menus.
- **Two-step Escape:** If a dropdown menu is open, `Escape` closes the menu first. Press `Escape` again to close the entire toolbar.
- **Session memory:** The toolbar remembers which button was last focused during the current session, so re-focusing picks up where you left off.
- **AI Genies shortcut:** The toolbar includes an AI Genies button that opens the genie picker (`Mod + Y`).

## Export Options

VMark offers flexible export options for sharing your documents.

### HTML Export

Export to standalone HTML with two packaging modes:

- **Folder mode** (default): Creates `Document/index.html` with assets in a subfolder
- **Single file mode**: Creates a self-contained `.html` file with embedded images

Exported HTML includes the [**VMark Reader**](/guide/export#vmark-reader) — interactive controls for settings, table of contents, image lightbox, and more.

[Learn more about export →](/guide/export)

### PDF Export

Print to PDF with native system dialog (`Cmd/Ctrl + P`).

### Copy as HTML

Copy formatted content for pasting into other apps (`Cmd/Ctrl + Shift + C`).

### Copy Format

By default, copying from WYSIWYG puts plain text (without formatting) in the clipboard. Enable **Markdown** copy format in **Settings > Editor > Behavior** to put Markdown syntax in `text/plain` instead — headings keep their `#`, links keep their URLs, etc. Useful when pasting into terminals, code editors, or chat apps.

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

VMark automatically saves snapshots of your documents so you can recover earlier versions.

- **Auto-save** with configurable interval captures snapshots in the background
- **Per-document history** stored locally in JSONL format
- Open the History sidebar with `Ctrl + Shift + 3` to browse past versions
- Snapshots are **grouped by day** with timestamps showing the exact time each version was saved
- **Restore** a previous version by clicking the restore button next to any snapshot (a confirmation dialog prevents accidental reverts)
- **Delete** individual snapshots you no longer need with the trash button
- The current content is saved as a new snapshot before any revert, so you never lose your work
- History requires the document to be saved to a file (untitled documents have no history)
- Enable or disable history tracking in **Settings > General**

## Session Recovery (Hot Exit)

When you quit VMark or it exits unexpectedly, your session is preserved and restored on the next launch.

**What's saved:**
- All open tabs and their content (including unsaved changes)
- Cursor positions and undo/redo history
- UI layout: sidebar state, outline visibility, source/focus/typewriter mode, terminal state
- Window position and size
- Active workspace and file explorer settings

**How it works:**
- On quit, VMark captures the complete session state from all windows
- On relaunch, tabs are restored exactly as you left them, with dirty (unsaved) documents marked accordingly
- Crash recovery runs automatically after an unexpected exit, restoring documents from periodic recovery snapshots
- Recovery snapshots older than 7 days are cleaned up automatically

No configuration needed. Session recovery is always active.

## View & Focus

### Focus Mode (`F8`)

Focus Mode dims all blocks except the one you are currently editing, reducing visual noise so you can concentrate on a single paragraph. The active block is highlighted at full opacity while surrounding content fades to a muted color. Toggle it with `F8` — it works in both WYSIWYG and Source modes and persists until you toggle it off.

### Typewriter Mode (`F9`)

Typewriter Mode keeps the active line vertically centered in the viewport, so your eyes stay in a fixed position while the document scrolls beneath you — just like typing on a physical typewriter. Toggle it with `F9`. It works in both editing modes and uses smooth scrolling with a small threshold to avoid jittery adjustments on minor cursor moves.

### Combining Focus + Typewriter

Focus Mode and Typewriter Mode can be enabled simultaneously. Together they provide a fully distraction-free writing environment: surrounding blocks are dimmed *and* the current line stays centered on screen.

### Word Wrap (`Alt + Z`)

Toggle soft line wrapping with `Alt + Z`. When enabled, long lines wrap at the editor width instead of scrolling horizontally. The setting persists across sessions.

### Read-Only Mode (`F10`)

Lock a document to prevent accidental edits. Toggle with `F10`. When active, all keyboard input and formatting commands are blocked — you can still scroll, select text, and copy. Useful for reviewing finished documents or referencing content while writing in another tab.

### Outline Panel (`Ctrl + Shift + 1`)

The Outline panel displays your document's heading structure as a collapsible tree in the sidebar. Open it with `Ctrl + Shift + 1`.

- Click any heading to scroll the editor to that section
- Collapse and expand heading groups to focus on specific parts of your document
- The currently active heading is highlighted as you scroll or type
- Updates live as you add, remove, or rename headings

### Zoom

Adjust the editor font size without opening Settings:

| Action | Shortcut |
|--------|----------|
| Zoom in | `Mod + =` |
| Zoom out | `Mod + -` |
| Reset to default | `Mod + 0` |

Zoom changes the editor font size in 2px increments (range: 12px to 32px). It modifies the same font size value found in **Settings > Appearance**, so keyboard zoom and the settings slider always stay in sync.

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

[Learn more →](/guide/workspace-management)

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
