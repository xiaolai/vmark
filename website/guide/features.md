# Features

VMark is the plain-text workspace where humans and AI collaborate. Markdown is the centerpiece (with WYSIWYG, Source Peek, and Source modes), but the workspace also opens YAML, JSON, TOML, Mermaid, SVG, HTML, and 9 code-viewer formats — see [Supported Formats](/guide/formats) for the full list.

[[toc]]

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

### Split View (Source + Preview)

Edit the raw Markdown source on the left while a **live, read-only WYSIWYG
preview** updates on the right — the preview *is* the WYSIWYG renderer, so it
never drifts from what you'd see in Rich Text Mode. Formatting commands and the
toolbar act on the source pane; drag (or use the arrow keys on) the divider to
resize.

- Toggle per session with `Shift + F6`, **View → Markdown Split View**, or the
  command palette ("Toggle Markdown Split View")
- Make it the default for Markdown files in **Settings → Markdown → Layout →
  Split source/preview by default**

WYSIWYG remains the default; the split is opt-in. The three views are mutually
exclusive — `F6` toggles Source and `Shift + F6` toggles Split, each returning
to WYSIWYG — so switching between them is always a single keystroke.

The **View** menu shows the three modes — **WYSIWYG Mode**, **Source Code
Mode**, **Markdown Split View** — as a checkmarked group, so the active mode is
always visible and the mutual exclusivity is explicit. **Word Wrap** and
**Line Numbers** apply to the source editor only, so they are greyed out while
you are in WYSIWYG mode.

### Reading Position

Your place in a document survives leaving it. Switching to another tab and back,
toggling Source mode or Split View, or having the file reloaded from disk all
return you to where you were reading — not to the top.

Each surface remembers its own position, so Rich Text and Source keep separate
places in the same file. Coming back to the same surface — switching tabs, or
the file reloading — returns you to where you had scrolled, even if your cursor
is somewhere else; the cursor stays where you left it. Switching between Rich
Text and Source follows the cursor instead, when there is one, because that is
what keeps the same paragraph in view across the two.

Positions are per document and per session — closing a tab forgets it.

### Undo Across Modes

Undo and redo cross the WYSIWYG ⇄ Source boundary. Every mode switch records a checkpoint, and once the current editor's own history is exhausted, `Mod + Z` keeps going through those checkpoints — restoring the earlier content without switching the view you are in. Redo walks the same chain forward; a redo whose branch you abandoned by making a new edit is refused rather than applied over your work. The chain is kept per tab and cleared when the tab closes.

### Large Files

VMark auto-opens large files in Source mode for a sub-second open — files over 1 MB, or block-dense markdown with 1,200+ estimated blocks — warns before touching files above 5 MB, and refuses files over 50 MB. See the [Large Files](./large-files.md) guide for thresholds and settings.

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

All standard editing (typing, deletion, clipboard, navigation) works at every cursor independently. In prose, `Mod + D` and `Mod + Shift + L` search the whole document; inside a code block they stay within that block. `Alt + Mod + Shift + L` selects every match in the current block only.

[Learn more →](/guide/multi-cursor)

## Smart Select All

In WYSIWYG mode, `Mod + A` grows the selection one container at a time instead of jumping straight to the whole document: inside a table it selects the cell, then the row, then the table, then the document. `Mod + Z` steps an expansion back and `Escape` collapses the selection to a cursor.

In Source mode, `Mod + A` first selects the enclosing block — a code fence, table, blockquote or list — and then the whole document; `Mod + Z` steps an expansion back there too.

The binding belongs to the editor and is not customizable.

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
- Toggle a list off: clicking the active list type again removes the list formatting
- Convert to code: the Code Block action turns the whole list at the cursor — or any multi-block selection (paragraphs, headings, lists) — into a single code block, one line per block or list item
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
| Sort Lines Ascending | `F4` _(Source mode only)_ |
| Sort Lines Descending | `Shift + F4` _(Source mode only)_ |

Sorting works on plain text lines, so it is available only in Source mode.

## Tables

Full-featured table editing:

- Insert tables via menu or shortcut
- Add/delete rows and columns
- Cell alignment (left, center, right)
- Columns auto-size to content; wide tables scroll horizontally
- Fit to width — pin a table to the editor width with content-proportional columns (Settings → Markdown, or per-table via right-click)
- Context toolbar for quick actions
- Keyboard navigation — `Tab` / `Shift + Tab` move between cells, arrow keys leave the table at its edges, and `Mod + Enter` / `Mod + Shift + Enter` add a row below / above

## Images

Comprehensive image support:

- Insert via file dialog
- Drag & drop from file system
- Paste from clipboard
- Auto-copy to project assets folder
- Double-click to edit the source path and alt text — the image's dimensions are shown read-only
- Right-click for Change Image, Delete Image, Copy Path and Reveal in Finder (Show in Explorer on Windows, Show in File Manager on Linux)
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
- ChatGPT-style delimiters are recognized on open/paste and normalized to
  `$`-form: `\( ... \)` becomes inline math, and a standalone `\[ ... \]`
  becomes a display block
- A `$$` block must close before a blank line (pandoc's rule) — an unclosed
  `$$` renders as literal text instead of swallowing the paragraphs after it.
  Trailing blank lines directly before the closer are fine (an empty
  `$$` … `$$` block stays a math block)
- Full LaTeX syntax support
- Helpful error messages with syntax hints

### Diagrams

Mermaid diagram support with live preview:

- Flowcharts, sequence diagrams, Gantt charts
- Class diagrams, state diagrams, ER diagrams
- Live preview panel in Source mode (drag, resize, zoom)
- [Learn more →](/guide/mermaid)

Graphviz DOT support with the same preview surfaces:

- ` ```dot ` and ` ```graphviz ` fenced blocks render locally (WASM)
- Pan, zoom, and PNG export like Mermaid diagrams
- [Learn more →](/guide/graphviz)

### SVG Graphics

Render raw SVG inline via ` ```svg ` code blocks:

- Instant rendering with pan, zoom, and PNG export
- Live preview in both WYSIWYG and Source modes
- Ideal for AI-generated charts and custom illustrations
- [Learn more →](/guide/svg)

### Inline Table of Contents

Choose **Insert → Table of Contents** to insert a live table of contents at once in either mode (the menu item has no default shortcut; assign one in Settings → Shortcuts). You can also write `[TOC]` on its own line: in Source mode that line is the table of contents, while in WYSIWYG a typed `[TOC]` stays plain text until the document is parsed again — for example after switching to Source and back, or reopening the file. `[TOC]` inside other text is never converted:

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

Open the find bar with `Mod + F`. It opens in the bar at the bottom of the window and works in both WYSIWYG and Source modes.

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

The replace field sits next to the find field — both are always visible, and `Tab` moves from one to the other. Type replacement text, then use **Replace** (single match) or **Replace All** (every match at once). The match counter displays the current position and total (e.g., "3 of 12") so you always know where you are.

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

Lint results are not updated as you type. In Source mode, an edit clears them. In WYSIWYG mode, an edit removes the highlights, but the issue count in the status bar and the `F2` / `Shift + F2` targets stay from the last run until you run the check again or close the tab. Re-run the check at any time with `Alt + Mod + V`.

## Universal Toolbar

A formatting toolbar anchored at the bottom of the editor, providing quick access to all formatting actions in both WYSIWYG and Source modes.

- **Toggle:** `Mod + Shift + B` opens the toolbar and gives it focus. Press it again to return focus to the editor while keeping the toolbar visible.
- **Keyboard navigation:** Use `Left`/`Right` arrows to move between groups. `Enter` or `Space` opens a dropdown menu. Arrow keys navigate within menus.
- **Two-step Escape:** If a dropdown menu is open, `Escape` closes the menu first. Press `Escape` again to close the entire toolbar.
- **Session memory:** The toolbar remembers which button was last focused during the current session, so re-focusing picks up where you left off.
- **AI Genies shortcut:** The toolbar includes an AI Genies button that opens the genie picker (`Mod + Y`).

## Editor Context Menu

Right-click anywhere in the editor (WYSIWYG or Source mode) to open a context menu with common actions.

- **Clipboard:** Cut, Copy, Paste, and Select All. On macOS these use the native clipboard pipeline, so pasting rich content (e.g. HTML copied from a browser) keeps its formatting — identical to `Mod + V`.
- **Inline formatting:** Bold, Italic, Strikethrough, and Inline Code, with checkmarks showing the active marks at the cursor.
- **Block operations:** Heading level and List type submenus, Blockquote, and Code Block — checkmarks reflect the current block.
- **Links:** Insert Link on plain text; on an existing link the section swaps to Edit Link, Copy Link, and Remove Link.
- **Context aware:** Inside tables the dedicated table menu appears instead; right-clicking an image opens the image menu; inside code blocks only clipboard actions are offered. Non-Markdown files (JSON, YAML, …) get a reduced clipboard-only menu.
- **Selection handling:** Right-clicking inside a selection keeps it; right-clicking elsewhere moves the cursor there first (macOS convention).
- **Keyboard:** Arrow keys navigate (disabled items are skipped), `Right`/`Left` enter and leave submenus, `Escape` closes the submenu first and then the menu. Shortcut hints reflect your custom key bindings.

## Command Palette

Press `Mod + Shift + P` to open the command palette. With an empty query it lists every available command grouped by category — file, workspace, view, export, formatting, headings, lists, tables, lines, selection, transform, CJK, lint, history, AI and more; type to filter and rank by match. `↑`/`↓` move, `Enter` runs the command, `Escape` (or a click on the backdrop) closes. Only commands that apply right now are shown — an editor command disappears when no document is open, a workspace command when no workspace is — and the command runs in the window you opened the palette from. Pages in this guide name their palette commands in quotes ("Toggle Markdown Split View", "Coherence Breakdown", "Window Status"). The palette has no menu item; its shortcut is customizable in **Settings → Shortcuts**.

## Export Options

VMark offers flexible export options for sharing your documents.

### HTML Export

**File → Export → HTML** writes a folder holding both `index.html` (with a linked `assets/` folder) and `standalone.html` (everything embedded) — there is no mode to pick; use whichever file suits.

Exported HTML includes the [**VMark Reader**](/guide/export#vmark-reader) — interactive controls for settings, table of contents, image lightbox, and more.

[Learn more about export →](/guide/export)

### PDF Export

**File → Export → PDF** opens VMark's own export dialog — page size (A4, Letter, A3, Legal) and orientation, margin presets or a draggable custom margin box, font size, line height, Latin and CJK fonts, style presets, and page numbers — then writes the PDF on macOS, Windows and Linux, with a clickable heading outline in the viewer's sidebar. **Print** (`Cmd/Ctrl + P`) is the separate path through the system print dialog. [Learn more →](/guide/export#print-export-pdf)

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
- **Per-document history** stored locally in VMark's application data folder — an index file plus one Markdown file per snapshot
- Open the History sidebar with `Ctrl + Shift + 3` to browse past versions
- Snapshots are **grouped by day** with timestamps showing the exact time each version was saved
- **Restore** a previous version by clicking the restore button next to any snapshot (a confirmation dialog prevents accidental reverts)
- **Delete** individual snapshots you no longer need with the trash button
- The current content is saved as a new snapshot before any revert, so you never lose your work
- History requires the document to be saved to a file (untitled documents have no history)
- Enable or disable history tracking in **Settings → Files & Images → Saving** (**Keep document history**)

## Session Recovery (Hot Exit)

When VMark restarts to install an update, or exits unexpectedly, your work is preserved and restored on the next launch.

**What an update restart saves:**
- All open tabs and their content (including unsaved changes)
- Cursor positions and undo/redo history
- UI layout: sidebar state, outline visibility, source/focus/typewriter mode, terminal state
- Window position and size
- Active workspace and file explorer settings

**How it works:**
- When you choose to restart and install an update, VMark captures the complete session state from all windows first
- On relaunch, tabs are restored exactly as you left them, with dirty (unsaved) documents marked accordingly
- Unsaved changes are also written to recovery snapshots every 10 seconds. After an unexpected exit, VMark restores them on the next launch as unsaved tabs
- Recovery snapshots older than 7 days are cleaned up automatically
- An ordinary quit does not capture the session: VMark asks you to save unsaved documents first (see [Closing tabs and windows](/guide/tab-navigation#closing-tabs-and-windows)). A workspace's open tabs still come back the next time you open it (see [Session Restore](/guide/workspace-management#session-restore))

No configuration needed. Session recovery is always active.

## Status Bar

The status bar runs along the bottom of the window (`F7` hides it). The left side holds the tab strip — see [Switching between open tabs](/guide/tab-navigation#switching-between-open-tabs) — and short notices such as *"Opened in Source mode (large file)."* The right side, from left to right:

| Indicator | What it shows | Click |
|---|---|---|
| Auto-save | A save icon and how long ago the document was auto-saved; fades after a few seconds | — |
| Counts | Words and characters (spaces not counted); with a selection, *selected / total* | Opens a **Word Count** popover: words, characters, characters without spaces, CJK characters, characters without punctuation |
| Lint | ⊗ errors or ⚠ warnings found by the last [lint](#markdown-lint) run; hidden when there are none | Jumps to the next issue |
| AI | While a genie runs, *Thinking…* with the elapsed seconds and a × to cancel; then *Done*, or the error with **Retry**, which runs the failed request again, and **Dismiss**; Retry is absent when the failure has nothing to re-run, such as a missing provider | — |
| MCP | A satellite icon, tinted when an AI client is connected; the word *off*, *…* or *error* when it is not running normally. The tooltip names the connected clients | Opens **Settings → Integrations** |
| MCP listener | A warning, *MCP unavailable in this window*, when this window's request listener could not start after every retry: AI clients cannot reach this window, even while the MCP server runs. Restart VMark to try again | — |
| MCP history | A history icon with the number of AI versions of the focused document, in a warning colour when its changes are not being recorded; the panel lists who made each version, with **Restore this version** and **Restore to before this change**, plus [Earlier checkpoints](/guide/mcp-setup#edit-checkpoints) | Opens the panel |
| Terminal | — | Shows or hides the terminal |
| Mode | The current mode — Source or WYSIWYG (hidden for GitHub Actions workflow files) | Switches mode |
| Lock | Whether the document is read-only | Toggles read-only |

The right side is hidden while a browser tab is active. A hidden status bar comes back on its own while an AI genie reports progress or a browser tab is active.

## Editing Details

A few behaviours that work without any setting:

- **The selection stays visible when the editor loses focus.** Click into the terminal, the sidebar or a popup and the selected text keeps a dimmer highlight, so you can see what a command or an AI tool will act on. Source mode shows every range of a multi-cursor selection.
- **Typing at the left edge of inline code goes inside it.** With the cursor just before an inline code span in WYSIWYG mode — however you got there — the next character joins the code rather than landing outside it.
- **Input methods (IME) are safe.** While you compose with a Chinese, Japanese or Korean input method, and for 50 ms after the composition ends, editor shortcuts and automatic conversions do not fire, so pressing Enter to accept a candidate does not also split the paragraph. Undo and redo still work. A Korean syllable confirmed with Enter also starts the new line. Leftover romanization in front of committed text is removed, and a character committed into an empty table cell stays as typed. Informational toasts wait until the composition ends; errors and warnings show at once. An edit from an AI client over MCP is refused (the client retries) or held until the composition ends, and a change to the file on disk waits too, so neither overwrites text you are still composing.
- **Reduced motion is honoured.** When your operating system's *reduce motion* accessibility setting is on, VMark turns its animations and transitions off and scrolls instantly instead of smoothly (typewriter mode included). There is no separate setting in VMark. The system's *reduce transparency* setting likewise turns off background blur.

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
- Long titles wrap to two lines and reveal in full on hover
- A filter input at the top of the panel narrows the tree to headings whose text matches your query (case-insensitive, ancestors are kept so the path stays visible). Press `Esc` to clear.

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

**Remove Trailing Spaces** and **Collapse Blank Lines** leave fenced code blocks untouched, including an unclosed fence, which runs to the end of the document. Indented code blocks are not protected.

### CJK Formatting (Format → CJK)

Built-in Chinese/Japanese/Korean text formatting tools. [Learn more →](/guide/cjk-formatting)

### Image Cleanup (Format → Text Cleanup → Clean Up Unused Images…)

Find and remove orphaned images from your assets folder (also available from the command palette). VMark shows what it found and asks before deleting, and deleted images go to the system trash. An image that any open document still uses — including unsaved changes in another VMark window — is kept. If VMark cannot confirm that an image is unused (for example, another window does not answer in time), it deletes nothing.

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
- Window Status panel — see every open window's live Claude Code / AI status and jump straight to the one that needs you; pin it in this window or across all windows (including ones you open later) to keep it open while you jump between windows

[Learn more →](/guide/workspace-management)

## Coherence, Knowledge Base & Slidev

- **Coherence & the Coherence Breakdown panel** — opt-in provenance tracking records which documents each AI generation read, flags downstream documents when an upstream changes, and adds semantic checks, canon claims and contexts on top. Open it from **Window → Coherence Breakdown**. [Learn more →](/guide/coherence)
- **Knowledge base** — serves an open workspace as a cross-linked site (wiki links, backlinks, relationship graph, full-text search) on `127.0.0.1`, in a panel (`Ctrl + Shift + 4`) or in your browser, and previews and exports Slidev decks. No release build includes the content-server runtime it needs yet, so the panel, its menu item, palette command and shortcut are hidden unless **Settings → Advanced → Developer tools** is on. [Learn more →](/guide/knowledge-base)

## Customization

### Themes

Six built-in color themes:

- White (clean, minimal)
- Paper (warm off-white)
- Mint (soft green tint)
- Sepia (vintage look)
- Night (dark mode)
- Solarized (dark, Solarized palette)

### Fonts

Configure separate fonts for:

- Latin text
- CJK (Chinese/Japanese/Korean) text
- Monospace (code)

Each picker offers a short list of recommended fonts, the fonts installed on your computer, and a **Custom…** entry where you type any font family name. [Details →](/guide/settings#typography)

The monospace font is checked before it is used, in Source mode, code and the terminal: if the font you picked is not installed, or turns out not to be monospaced, VMark falls back along the stack to the next one that is. This matters most on Linux with a CJK locale, where a missing font name can otherwise resolve to a proportional CJK font and break the terminal's grid.

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
