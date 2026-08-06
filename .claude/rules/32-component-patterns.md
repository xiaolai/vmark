# 32 - Component Patterns

Standard patterns for UI components. Follow these for consistency.

## Use the canonical components before writing a new class

| Need | Use | Defined in |
|---|---|---|
| Text button (start, stop, confirm, cancel) | `.vm-btn` (+ `--primary`, `--danger`) | `src/styles/button-shared.css` |
| Dropdown / `<select>` | `.vm-select` inside a `.vm-select-field` wrapper | `src/styles/select-shared.css` |
| Icon-only square button inside a popup | `.popup-icon-btn` (+ `--primary`, `--danger`) | `src/styles/popup-shared.css` |
| Editor toolbar button | `.universal-toolbar-btn` | `universal-toolbar.css` |
| Popup surface | `.popup-container` | `src/styles/popup-shared.css` |

A bare `<select>` keeps `appearance: auto`, so WebKit draws its own control —
native bezel, native chevron, 5px pill radius — and author styling only partly
applies. A fully tokenised stylesheet still renders as macOS chrome; text
inputs beside it look correct, which is why the drift survives review. Reach
for `.vm-select`, and note the wrapper is load-bearing: `select` cannot host a
reliable `::after`, so the chevron lives on `.vm-select-field` and is drawn
with `mask-image` + `currentColor` rather than a `background-image` data URI,
which would bake in a colour that no theme token can reach.

Writing a new `*-btn` class is a **gate failure** — `pnpm lint:bespoke-buttons`
(`scripts/check-bespoke-buttons.mjs`) ratchets the bespoke count down only.
The count exists because 88 hand-rolled button classes drifted apart: four
implementations of one control used four paddings, three radii, two font sizes,
and three spellings of a 1px border — including `--space-px`, a *spacing* token
misused as a border width. Passing the token gate is not the same as matching
the design system.

## Panels: dock in-flow, don't float over the editor

A full-height side panel must **displace** the editor, not occlude it. Render it
into `EditorArea`'s `sidePanel` slot (right dock) or its `panel` slot
(`panelPosition` top/bottom/left/right, the terminal's mechanism). A
`position: fixed` panel hides the document underneath and never reflows — the
Knowledge Base panel shipped that way and text simply vanished behind it.

`position: fixed` is correct only for **floating cards and modals** that are
deliberately transient and small: breakdown, window-status, quick-look, context
menus, inline popups.

ADR-007 says new top-level surfaces become "slot registrations, not edits to
`App.tsx`". **No registration mechanism exists** — a surface is mounted by
editing App.tsx's `<AppShell>` composition, and claiming otherwise in a file
header is a documentation bug (WI-12 removed one from
`KnowledgeBasePanel.tsx`). What `pnpm lint:shell-slots` enforces is the
checkable half: `scripts/shell-slots-baseline.json` holds the IDENTITY LIST of
the 20 surfaces App.tsx mounts, and the gate fails both ways — a surface that is
not listed, and a listed surface that is no longer mounted. When it fires,
bundle related surfaces behind one mount (see
`src/components/CoherenceOverlays.tsx`) or give the surface a real shell slot;
appending a name to the list is not the fix.

## Single Source of Truth

Each component's styles must live in ONE file only. Duplicating styles across files causes cascade hazards.

**Anti-pattern:**
- `.footnote-popup` defined in both `editor.css` AND `footnote-popup.css`
- Import order determines which wins → "break later" bug

**Correct pattern:**
- Popup styles live ONLY in their plugin's CSS file (e.g., `footnote-popup.css`)
- Content CSS (`editor.css`) should NOT define popup styles

## Popup Positioning

Editor popups use `position: fixed` with viewport coordinates:

```css
.popup-container {
  position: fixed;
  z-index: 9999;
}
```

Position is calculated in JS based on selection/cursor coordinates.

### Pattern by Component Type

| Type | Positioning | Z-Index | Container |
|------|-------------|---------|-----------|
| Inline popups (link, image, wiki-link, math, footnote) | fixed | 9999 | Inside EditorContainer |
| Toolbar dropdown | fixed | 103 | Inside toolbar |
| Context menus (file, tab) | fixed | 1000 | App-level |
| Mermaid preview | fixed | 1000 | Inside mermaid plugin |
| MCP status overlay | fixed | 1200 | StatusBar |
| Genie picker | fixed | 9999 | App-level |
| Table context menu | fixed | 10000 | Inside table plugin |
| Modal dialogs | portal to body | 9999 | React portal |

**Guidelines:**
1. Inline editor popups stay inside `<EditorContainer>` for theme inheritance
2. Use fixed positioning for viewport-relative placement
3. Calculate position from selection/cursor in editor space

## Popup/Dialog Surface

**Base pattern** (`src/styles/popup-shared.css`):

```css
.popup-container {
  position: fixed;
  z-index: 9999;
  padding: var(--popup-padding);              /* 6px */
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);            /* 8px */
  background: var(--bg-color);
  box-shadow: var(--popup-shadow);
  animation: popup-fade-in 0.1s ease-out;
}

.popup-container--vertical {
  flex-direction: column;
  gap: 6px;
}
```

**Popup animation:**
```css
@keyframes popup-fade-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Rules:**
- Compact padding (6px via `--popup-padding`)
- 1px border with `--border-color`
- Radius 8px (use `--radius-lg`)
- Shadow via `--popup-shadow`
- 0.1s fade-in animation

## Popup Inputs

```css
.popup-input {
  border: none;
  background: transparent;
  color: var(--text-color);
  outline: none;
  font-size: 12px;
  font-family: var(--font-sans);
}

.popup-input:focus {
  outline: none;
  box-shadow: none;
  /* Focus indicated by caret only */
}

.popup-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

/* URL/path inputs */
.popup-input--mono {
  font-family: var(--font-mono);
}

.popup-input--full {
  width: 100%;
}
```

**Rules:**
- Borderless, transparent background
- No focus ring/outline - caret is the focus indicator
- 12px font size
- Mono font for URLs/paths

## Popup Icon Buttons

```css
.popup-icon-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);            /* 4px */
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.popup-icon-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--text-color);
}

.popup-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Focus: U-shaped underline */
.popup-icon-btn:focus-visible {
  outline: none;
}

.popup-icon-btn:focus-visible::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 4px;
  right: 4px;
  height: 4px;
  border-bottom: 2px solid var(--primary-color);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
}

/* Icon sizing */
.popup-icon-btn svg {
  width: 14px;
  height: 14px;
}

/* Variants */
.popup-icon-btn--primary:hover:not(:disabled) {
  color: var(--primary-color);
}

.popup-icon-btn--danger:hover:not(:disabled) {
  color: var(--error-color);
}
```

## Toolbar Buttons

```css
.toolbar-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
}

.toolbar-btn:active:not(:disabled) {
  background: var(--bg-secondary);
}

.toolbar-btn:disabled {
  opacity: 0.4;
}

/* Active state: dot indicator */
.toolbar-btn.active::before {
  content: '';
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  background: var(--accent-primary);
  border-radius: 50%;
}

/* Focus: U-shaped underline */
.toolbar-btn:focus-visible {
  outline: none;
}

.toolbar-btn:focus-visible::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 4px;
  right: 4px;
  height: 4px;
  border-bottom: 2px solid var(--accent-primary);
  border-radius: 0 0 4px 4px;
}
```

## Context Menu (macOS Style)

```css
.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  padding: 5px;
  background: color-mix(in srgb, var(--bg-color) 97%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 0.5px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--popup-shadow);
}

.context-menu-item {
  padding: 5px 10px;
  border-radius: 5px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: default;
}

.context-menu-item:hover {
  background: var(--primary-color);
  color: var(--contrast-text);
}

.context-menu-item .icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.context-menu-item .icon svg {
  width: 14px;
  height: 14px;
}

.context-menu-separator {
  height: 1px;
  background: var(--border-color);
  opacity: 0.6;
  margin: 4px 0;
}
```

## Selection/Active States

**Always use tokens:**

```css
/* Correct */
.item.active {
  background: var(--accent-bg);
  color: var(--accent-primary);
}

/* Wrong - hardcoded */
.item.active {
  background: rgba(0, 102, 204, 0.1);
  color: #0066cc;
}
```

## Table Rendering

Tables must be horizontally safe — no clipped columns.

**Problem:** `.editor-content { overflow-x: hidden }` clips wide tables.

**Solution:** Wrap tables in a scroll container:

```css
.table-scroll-container {
  overflow-x: auto;
  max-width: 100%;
}

.table-scroll-container table {
  width: max-content;
  min-width: 100%;
}
```

**Rules:**
- Tables must scroll horizontally when wider than container
- Never use `overflow-x: hidden` on table ancestors without a scroll wrapper
- Users must be able to reach all columns

## Frame Ownership (Nested Containers)

When a wrapper exists, it owns the visual "frame" (background, border, radius). Children are flat.

**Example: Code blocks**

```css
/* CORRECT: Wrapper owns frame */
.code-block-wrapper {
  background: var(--code-bg-color);
  border: 1px solid var(--code-border-color);
  border-radius: var(--radius-md);
}

.code-block-wrapper pre {
  background: transparent;
  border: none;
  border-radius: 0;
}

/* WRONG: Both layers have frames */
.code-block-wrapper {
  border-radius: var(--radius-sm);
  background: var(--code-bg-color);
}
pre {
  border-radius: var(--radius-md);  /* Conflicts! */
  background: var(--code-bg-color);  /* Double layer! */
}
```

**Rule:** When line numbers wrapper is present, `pre` must be flat.

## Scrollbars

```css
/* Global thin scrollbars (from index.css) */
::-webkit-scrollbar {
  width: 1px;
  height: 4px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 2px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--md-char-color);
}
```

## Resize Handles

```css
.resize-handle {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  transition: background 0.15s;
}

.resize-handle:hover {
  background: var(--border-color);
}
```

## Z-Index Hierarchy

| Layer | Z-Index | Components |
|-------|---------|------------|
| Base | 0-10 | Content, sidebar panels, resize handles |
| Floating | 50-60 | Inline previews |
| Bars | 100-102 | StatusBar (100), FindBar (100), TitleBar (100), Toolbar (102) |
| Toolbar dropdown | 103 | UniversalToolbar dropdown menu |
| Context/preview | 1000 | FileExplorer menu, TabContextMenu, spellcheck, Mermaid preview |
| MCP status | 1200 | StatusBar MCP status overlay |
| Inline popups | 9999 | Link, image, wiki-link, math, heading, footnote, Genie picker popups |
| Table context | 10000 | Table context menu (highest) |

**Notes:**
- StatusBar and FindBar share z-index 100 (mutually exclusive in layout)
- Table context menu at 10000 ensures it appears above inline popups
- Modal dialogs use React portals

## File References

- Popup base styles: `src/styles/popup-shared.css`
- Toolbar styles: `src/components/Editor/UniversalToolbar/universal-toolbar.css`
- Context menus: `src/components/Sidebar/FileExplorer/ContextMenu.css`
- Global styles: `src/styles/index.css`
