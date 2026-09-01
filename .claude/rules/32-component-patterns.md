# 32 - Component Patterns

Standard patterns for UI components. Follow these for consistency.

## Use the canonical components before writing a new class

| Need | Use | Defined in |
|---|---|---|
| Text button (start, stop, confirm, cancel) | `.vm-btn` (+ `--primary`, `--cta`, `--plain`, `--danger`, `--compact`, `--pill`) | `src/styles/button-shared.css` |
| Dropdown / `<select>` | `.vm-select` inside a `.vm-select-field` wrapper | `src/styles/select-shared.css` |
| Icon-only square button inside a popup | `.popup-icon-btn` (+ `--primary`, `--danger`) — an alias of `.vm-icon-btn` base (md) | `src/styles/icon-button-shared.css` |
| Icon-only square button anywhere else | `.vm-icon-btn` (+ `--sm` 24 / `--lg` 28 / `--bordered` / `--primary` / `--danger`) | `src/styles/icon-button-shared.css` |
| Tab-strip add/close | `TabStripButton` (`src/components/shared/`) — `.vm-icon-btn--sm` Plus 14 / `.tab-strip-close` X 12 | `src/styles/icon-button-shared.css` |
| Editor toolbar button | `.universal-toolbar-btn` | `universal-toolbar.css` |
| Popup surface (anchored to a selection) | `.popup-container` | `src/styles/popup-shared.css` |
| Modal/finder overlay + panel | `.vm-overlay` + `.vm-overlay__panel` | `src/styles/overlay-shared.css` |
| Context menu | `.vm-menu` | `src/styles/overlay-shared.css` |
| Text input | `.vm-input` (+ `--field`, `--bare`, `--mono`) | `src/styles/input-shared.css` |
| Panel + header + rows | `.vm-panel` | `src/styles/panel-shared.css` |
| Chip / pill / kbd hint | `.vm-chip` | `src/styles/panel-shared.css` |
| Toggle switch | `.vm-switch` | `src/styles/panel-shared.css` |

**The current-tab idiom is a second, named vocabulary — raised, not selected.**
The active tab is a card raised above the page, not a selected list row, so it
carries `ui-ok(state): current-tab` where the C9 gate would otherwise ask for
`--accent-bg`; selected LIST rows stay the accent vocabulary (R6). Since audit
20260901 (WI-UA1/WI-UA2, reversing the short-lived 2026-08-31 exceptions) the
STATUS-BAR pill's active state LIFTS onto `--bg-tertiary` and carries the D8
`--control-border` ring as an inset box-shadow plus `--shadow-sm` — the
borderless card measured ~1.05:1 page-vs-bar on night, findable only by its
shadow — and pill hover speaks the ordinary R6 hover vocabulary
(`--hover-bg-strong` + text ink) instead of the old ink/page inversion. The
embedded browser's `.browser-page-tab` keeps its own control-border idiom.
Pinned by `tabPillSurface.test.ts`.

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

**The gate has THREE budgets, and the third measures a different thing.** The
first two count controls (by name, and by usage on a literal `<button>`). Those
cannot see the drift that survives a fully tokenised codebase: `.vm-btn` is
6/12 + `--radius-sm` + `--font-size-sm`, and `.approval-dialog__btn` was
6/14 + `--radius-md` + `--font-size-md`. Both were built entirely from tokens.
Both passed every gate. Side by side they read as two products.

`maxShapeDriftClasses` compares **which token** each button picked against
`.vm-btn`'s own declarations — read from `button-shared.css`, never hardcoded,
so a copy here cannot drift — after resolving `var()` through `index.css`, so a
literal and its token spelling count as equal rather than as a false positive.
It reports a **diff**, not a count:

```
.workflow-form__nav-btn  (src/components/.../WorkflowForm.tsx)
    padding: var(--space-2) var(--space-4)  ≠  var(--space-1-5) var(--space-3)
    border-radius: var(--radius-md)  ≠  var(--radius-sm)
```

Three ways to clear an entry, and the middle one is the one people forget:
migrate to `.vm-btn`; **promote a genuinely-missing variant onto the primitive**
(`.vm-btn--cta` exists because the approval dialog's solid CTA carried a real
WCAG-AA decision that deserved to live in one place, not be steamrolled); or
record `/* button-shape-ok: <reason> */` **in the rule body**. The reason is
required — a bare marker is rejected, same rule as `focus: caret-only` in rule 33.

Only the **base** rule is read. A `:focus-visible::after` ring legitimately
carries its own `border-radius`, and folding pseudo-element rules in would
report every correctly-built button as drift.

## The ui-consistency gate reads this file's vocabulary

`pnpm lint:ui-consistency` (WI-UI0.3) enforces the checkable half of these
patterns across CSS **and** JSX: overlay shells must compose
`.popup-container`/`.vm-overlay__panel`/`.vm-menu` (C4), state backgrounds must
speak the hover/selected vocabulary below (C9), every focusable element needs a
painting `:focus-visible` rule or the caret-only marker (C10), hit targets stay
≥ 24px (C8), and chrome type/icons/bar-heights stay on their tokens (C3, C7,
C11). Exemptions are `ui-ok(<check>): <reason>` in the rule body (JSX: the line
above) — the reason is required. Today's violations are frozen in
`scripts/ui-consistency-baseline.json`, which only ratchets down.

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
  z-index: var(--z-popup);
  display: flex;
  align-items: center;
  gap: var(--space-half);
  padding: var(--space-1-5);                  /* 6px */
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-lg);            /* 8px */
  background: var(--bg-color);
  box-shadow: var(--popup-shadow);
  animation: popup-fade-in var(--duration-fast) ease-out;
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
- Compact padding (6px via `--space-1-5`; the older `--popup-padding` token still exists for legacy consumers but `.popup-container` no longer reads it)
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
  font-family: var(--font-ui); /* R3: chrome never uses the reading face */
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
  cursor: var(--cursor-interactive, default); /* D7, platform-scoped (WI-UA15):
     arrow on macOS, pointer under .platform-windows/.platform-linux */
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

/* Focus: flat 2px bar (D4 — rule 33 §1, the one focus shape) */
.popup-icon-btn:focus-visible {
  outline: none;
}

.popup-icon-btn:focus-visible::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 4px;
  right: 4px;
  height: 2px;
  background: var(--accent-primary);
  border-radius: 1px;
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

/* Focus: flat 2px bar (D4 — rule 33 §1, the one focus shape) */
.toolbar-btn:focus-visible {
  outline: none;
}

.toolbar-btn:focus-visible::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 4px;
  right: 4px;
  height: 2px;
  background: var(--accent-primary);
  border-radius: 1px;
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
/* The GLOBAL scrollbar (index.css) is 10px — not thin. Dense lists opt into
   the 2px `.vm-scroll--thin` utility (panel-shared.css, WI-UI3.4). */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
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
