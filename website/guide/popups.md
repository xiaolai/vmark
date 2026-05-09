# Inline Popups

VMark provides contextual popups for editing links, images, media, math, footnotes, and more. These popups work in both WYSIWYG and Source modes with consistent keyboard navigation.

## Common Keyboard Shortcuts

All popups share these keyboard behaviors:

| Action | Shortcut |
|--------|----------|
| Close/Cancel | `Escape` |
| Confirm/Save | `Enter` |
| Navigate fields | `Tab` / `Shift + Tab` |

## Link Tooltip & Popup

VMark uses a two-tier system for links: a read-only tooltip on hover, and an edit popup via keyboard shortcut.

### Hover Tooltip (Read-Only)

**Trigger:** Hover over link (300ms delay)

**Shows:**
- **URL preview** — Truncated URL with full URL on hover
- **Open button** — Opens link in browser (or jumps to heading for `#bookmarks`)

**Behavior:** View-only. Move mouse away to dismiss.

### Edit Existing Link

**Trigger:** Place cursor in link + `Mod + K`

**Fields:**
- **URL** — Edit the link destination
- **Open target** — Opens an external URL in the browser, jumps to the heading for `#bookmark` links, or opens a local file in a new tab for cross-file links
- **Copy** — Copy URL to clipboard
- **Delete** — Remove link, keep text

### Create New Link

**Trigger:** Select text + `Mod + K`

**Smart clipboard:** If your clipboard contains a URL, it's auto-filled.

**Fields:**
- **URL input** — Enter destination
- **Confirm** — Press Enter or click ✓
- **Cancel** — Press Escape or click ✗

### Source Mode

- **`Cmd + Click`** on link → external URLs open in the browser, `#bookmark` links jump to the heading, and local file paths open the file in a new tab
- **Click** on `[text](url)` syntax → shows edit popup
- **`Mod + K`** inside link → shows edit popup

::: tip Bookmark Links
Links starting with `#` are treated as bookmarks (internal heading links). Open jumps to the heading instead of opening a browser.
:::

::: tip Cross-File Links
Links pointing to local files — relative paths like `../appendix/cards.md` or `./notes.md`, including `#fragment` suffixes — open the target file in a new tab. Paths are resolved against the current document's directory; if the document is untitled, only absolute paths can be opened. Fragment navigation inside the opened file is not yet supported — the file opens at its top.
:::

## Media Popup (Images, Video, Audio)

A unified popup for editing all media types — images, video, and audio.

### Edit Popup

**Trigger:** Double-click on any media element (image, video, or audio)

**Common fields (all media types):**
- **Source** — File path or URL

**Type-specific fields:**

| Field | Image | Video | Audio |
|-------|-------|-------|-------|
| Alt text | Yes | — | — |
| Title | — | Yes | Yes |
| Poster | — | Yes | — |
| Dimensions | Read-only | — | — |
| Inline/Block toggle | Yes | — | — |

**Buttons:**
- **Browse** — Pick file from filesystem
- **Copy** — Copy source path to clipboard
- **Delete** — Remove the media element

**Shortcuts:**
- `Mod + Shift + I` — Insert new image
- `Enter` — Save changes
- `Escape` — Close popup

### Source Mode

In Source mode, clicking on image syntax `![alt](path)` opens the same media popup. Media files (video/audio extensions) show a floating preview with native playback controls on hover.

## Image Context Menu

Right-clicking on an image in WYSIWYG mode opens a context menu with quick actions (separate from the double-click edit popup).

**Trigger:** Right-click on any image

**Actions:**
| Action | Description |
|--------|-------------|
| Change Image | Open a file picker to replace the image |
| Delete Image | Remove the image from the document |
| Copy Path | Copy the image source path to clipboard |
| Reveal in Finder | Open the image file location in your file manager (label adapts per platform) |

Press `Escape` to dismiss the context menu without taking action.

## Math Popup

Edit LaTeX math expressions with live preview.

**Trigger:**
- **WYSIWYG:** Click on inline math `$...$`
- **Source:** Place cursor inside `$...$`, `$$...$$`, or ` ```latex ` blocks

**Fields:**
- **LaTeX Input** — Edit the math expression
- **Preview** — Real-time rendered preview
- **Error Display** — Shows LaTeX errors with helpful syntax hints

**Shortcuts:**
- `Mod + Enter` — Save and close
- `Escape` — Cancel and close
- `Shift + Backspace` — Delete inline math (works even when non-empty, WYSIWYG only)
- `Alt + Mod + M` — Insert new inline math

::: tip Error Hints
When you have a LaTeX syntax error, the popup shows helpful suggestions like missing braces, unknown commands, or unbalanced delimiters.
:::

::: info Source Mode
Source mode provides the same editable math popup as WYSIWYG mode — a textarea for LaTeX input with a live KaTeX preview below it. The popup opens automatically when your cursor enters any math syntax (`$...$`, `$$...$$`, or ` ```latex `). Press `Mod + Enter` to save or `Escape` to cancel.
:::

## Footnote Popup

Edit footnote content inline.

**Trigger:**
- **WYSIWYG:** Hover over footnote reference `[^1]`

**Fields:**
- **Content** — Multi-line footnote text (auto-resizing)
- **Go to Definition** — Jump to footnote definition
- **Delete** — Remove footnote

**Behavior:**
- New footnotes auto-focus the content field
- Textarea expands as you type

## Wiki Link Popup

Edit wiki-style links for internal document connections.

**Trigger:**
- **WYSIWYG:** Hover over `[[target]]` (300ms delay)
- **Source:** Click on wiki link syntax

**Fields:**
- **Target** — Workspace-relative path (`.md` extension handled automatically)
- **Browse** — Pick file from workspace
- **Open** — Open linked document
- **Copy** — Copy target path
- **Delete** — Remove wiki link

## Table Context Menu

Quick table editing actions.

**Trigger:**
- **WYSIWYG:** Use toolbar or keyboard shortcuts
- **Source:** Right-click on table cell

**Actions:**
| Action | Description |
|--------|-------------|
| Insert Row Above/Below | Add row at cursor |
| Insert Column Left/Right | Add column at cursor |
| Delete Row | Remove current row |
| Delete Column | Remove current column |
| Delete Table | Remove entire table |
| Align Column Left/Center/Right | Set alignment for current column |
| Align All Left/Center/Right | Set alignment for all columns |
| Format Table | Auto-align table columns (prettify markdown) |

## Spell Check Popup

Fix spelling errors with suggestions.

**Trigger:**
- Right-click on misspelled word (red underline)

**Actions:**
- **Suggestions** — Click to replace with suggestion
- **Add to Dictionary** — Stop marking as misspelled

## Mode Comparison

| Element | WYSIWYG Edit | Source |
|---------|--------------|--------|
| Link | Hover tooltip / `Mod+K` | Click / `Mod+K` / `Cmd+Click` to open |
| Image | Double-click | Click on `![](path)` |
| Video | Double-click | — |
| Audio | Double-click | — |
| Math | Click | Cursor in math → popup |
| Footnote | Hover | Direct edit |
| Wiki Link | Hover | Click |
| Table | Toolbar | Right-click menu |
| Spell Check | Right-click | Right-click |

## Popup Navigation Tips

### Focus Flow
1. Popup opens with first input focused
2. `Tab` moves forward through fields and buttons
3. `Shift + Tab` moves backward
4. Focus wraps within popup

### Quick Editing
- For simple URL changes: edit and press `Enter`
- For canceling: press `Escape` from any field
- For multi-line content (footnotes, math): use `Mod + Enter` to save

### Mouse Behavior
- Click outside popup to close (changes are discarded)
- Hover popups (link, footnote, wiki) have 300ms delay before showing
- Moving mouse back to popup keeps it open

<!-- Styles in style.css -->
