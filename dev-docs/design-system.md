# VMark Design System

> Single source of truth for UI design patterns, tokens, and component specifications.
> Token definitions live in `src/styles/index.css`. Dynamic overrides in `src/hooks/useTheme.ts`.

## Overview

VMark uses CSS custom properties with five themes (white, paper, mint, sepia, night). Principles:

- **Token-first** — no hardcoded colors
- **Accessible** — visible focus indicators everywhere
- **Theme parity** — all styles work in light and dark
- **Consistent** — standardized sizes, radii, shadows

## Color Tokens

| Token | Purpose | Default (Paper) |
|-------|---------|-----------------|
| `--bg-color` | Main background | `#eeeded` |
| `--bg-primary` | Alias for `--bg-color` | — |
| `--bg-secondary` | Secondary surfaces, sidebars | `#e5e4e4` |
| `--bg-tertiary` | Hover backgrounds | `#f0f0f0` |
| `--hover-bg` | Explicit hover state | `rgba(0,0,0,0.04)` |
| `--hover-bg-strong` | Stronger hover | `rgba(0,0,0,0.08)` |
| `--hover-bg-dark` | Dark mode hover | `rgba(255,255,255,0.08)` |
| `--hover-bg-dark-strong` | Dark mode stronger hover | `rgba(255,255,255,0.12)` |
| `--subtle-bg` | Very subtle background | `rgba(0,0,0,0.02)` |
| `--subtle-bg-hover` | Subtle hover | `rgba(0,0,0,0.03)` |
| `--text-color` | Primary text | `#1a1a1a` |
| `--text-primary` | Alias for `--text-color` | — |
| `--text-secondary` | Secondary/muted text | `#666666` |
| `--text-tertiary` | Disabled text | `#999999` |
| `--primary-color` | Links, primary actions | `#0066cc` |
| `--border-color` | All borders | `#d5d4d4` |
| `--selection-color` | Text selection highlight | `rgba(0,102,204,0.2)` |
| `--contrast-text` | Text on colored backgrounds | `white` |

### Accent Tokens (Selection/Active)

| Token | Purpose | Default |
|-------|---------|---------|
| `--accent-primary` | Active icon/text color | `#0066cc` |
| `--accent-bg` | Selected/active background | `rgba(0,102,204,0.1)` |
| `--accent-text` | Accent text alias | `#0066cc` |

### Semantic Tokens

| Token | Light | Dark |
|-------|-------|------|
| `--error-color` | `#cf222e` | `#f85149` |
| `--error-color-hover` | `#b91c1c` | — |
| `--error-bg` | `#ffebe9` | `rgba(248,81,73,0.15)` |
| `--warning-color` | `#9a6700` | `#d29922` |
| `--warning-bg` | `rgba(245,158,11,0.1)` | — |
| `--warning-border` | `rgba(245,158,11,0.3)` | — |
| `--success-color` | `#16a34a` | `#4ade80` |
| `--success-color-hover` | `#15803d` | — |

### Alert Block Tokens

| Token | Light | Dark Token |
|-------|-------|------------|
| `--alert-note` | `#0969da` | `--alert-note-dark` (`#58a6ff`) |
| `--alert-tip` | `#1a7f37` | `--alert-tip-dark` (`#3fb950`) |
| `--alert-important` | `#8250df` | `--alert-important-dark` (`#a371f7`) |
| `--alert-warning` | `#9a6700` | `--alert-warning-dark` (`#d29922`) |
| `--alert-caution` | `var(--error-color)` | `--alert-caution-dark` (`#f85149`) |

### Text Emphasis Tokens

| Token | Default |
|-------|---------|
| `--strong-color` | `rgb(63,86,99)` |
| `--emphasis-color` | `rgb(91,4,17)` |

### Highlight Tokens

| Token | Default |
|-------|---------|
| `--highlight-bg` | `#fff3a3` |
| `--highlight-text` | `inherit` |

---

## Size Tokens

### Border Radius

| Token | Value | Use Case |
|-------|-------|----------|
| `--radius-sm` | `4px` | Small buttons, toggles |
| `--radius-md` | `6px` | Input fields, medium containers |
| `--radius-lg` | `8px` | Popups, dialogs, context menus |
| `--radius-pill` | `100px` | Pills, tags, badges |
| `--popup-radius` | `8px` | Alias for popup containers |

### Shadows

| Token | Value | Use Case |
|-------|-------|----------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.1)` | Hover tooltips, subtle elevation |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.12)` | Inline popups |
| `--popup-shadow` | `0 4px 12px rgba(0,0,0,0.15)` | Standard popups, dialogs |
| `--popup-shadow-dark` | `0 4px 12px rgba(0,0,0,0.4)` | Dark mode popups |

### Icon Button Sizes

These tokens define both button width/height and are used for layout:

| Token | Value | Use Case |
|-------|-------|----------|
| `--icon-size-sm` | `22px` | StatusBar buttons |
| `--icon-size-md` | `26px` | Popup action buttons |
| `--icon-size-lg` | `28px` | Toolbar buttons |

Icon SVG sizes (conventions, not tokens):

| Size | Value | Context |
|------|-------|---------|
| Small | `14px` | Icons inside popups |
| Standard | `18px` | Toolbar icons |

### Spacing

| Token | Value |
|-------|-------|
| `--spacing-1` | `4px` |
| `--spacing-2` | `8px` |
| `--spacing-3` | `12px` |

### Popup

| Token | Value |
|-------|-------|
| `--popup-padding` | `6px` |
| `--popup-radius` | `8px` |

---

## Typography Tokens

| Token | Purpose | Default |
|-------|---------|---------|
| `--font-sans` | UI text, body content | System fonts (PingFang, SF Pro, etc.) |
| `--font-mono` | Code, URLs, file paths | Charis SIL, Courier New, etc. |
| `--editor-font-size` | Editor text | `18px` |
| `--editor-font-size-sm` | Small text (90%) | `16.2px` |
| `--editor-font-size-mono` | Mono text (85%) | `15.3px` |
| `--editor-line-height` | Line height ratio | `1.6` |
| `--editor-line-height-px` | Absolute line height | `28.8px` |
| `--editor-block-spacing` | Block spacing | `1em` |
| `--editor-content-padding` | Horizontal padding | `36px` (fontSize * 2) |
| `--cjk-letter-spacing` | CJK spacing | `0.05em` |
| `--editor-width` | Max content width | `50em` |

**Note:** These have static defaults for print/SSR but are dynamically updated by `useTheme.ts` based on user settings.

### Code Tokens

| Token | Default |
|-------|---------|
| `--code-bg-color` | `#e5e4e4` |
| `--code-text-color` | `#1a1a1a` |
| `--code-border-color` | `#d5d4d4` |
| `--code-line-height` | `1.45` |
| `--code-padding` | `18px` (dynamically set to fontSize) |
| `--md-char-color` | `#777777` |
| `--meta-content-color` | `#777777` |

---

## Layout Tokens

| Token | Default |
|-------|---------|
| `--sidebar-bg` | `#e5e4e4` |
| `--sidebar-width` | `260px` |
| `--outline-width` | `200px` |
| `--table-border-color` | `#d5d4d4` |
| `--list-indent` | `1em` |
| `--source-mode-bg` | `rgba(0,0,0,0.02)` |
| `--blur-text-color` | `#c8c8c8` |
| `--blur-image-opacity` | `0.5` |

---

## Component Specifications

### Popup/Dialog Surface

```css
.popup {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);       /* 8px */
  box-shadow: var(--popup-shadow);
  padding: var(--popup-padding);         /* 6px */
  animation: popup-fade-in 0.1s ease-out;
}
```

### Popup Inputs

```css
.popup-input {
  border: none;
  background: transparent;
  color: var(--text-color);
  outline: none;
  font-size: 12px;
  font-family: var(--font-sans);
}

/* URL/path inputs use --font-mono */
/* Focus: caret only, no ring */
```

### Popup Icon Buttons

```css
.popup-icon-btn {
  width: 26px;                           /* --icon-size-md */
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);       /* 4px */
  background: transparent;
  color: var(--text-secondary);
}

.popup-icon-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--text-color);
}

/* Focus: U-shaped underline via ::after */
```

### Toolbar Buttons

```css
.toolbar-btn {
  width: 28px;                           /* --icon-size-lg */
  height: 28px;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: var(--text-color);
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
}

.toolbar-btn.active::before {            /* dot indicator */
  /* 6px circle at top-right */
  background: var(--accent-primary);
}

/* Focus: U-shaped underline via ::after */
```

### Context Menu (macOS Style)

```css
.context-menu {
  background: color-mix(in srgb, var(--bg-color) 97%, transparent);
  backdrop-filter: blur(20px);
  border: 0.5px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--popup-shadow);
  padding: 5px;
  min-width: 180px;
}

.context-menu-item:hover {
  background: var(--primary-color);
  color: var(--contrast-text);
}
```

### Scrollbars

```css
::-webkit-scrollbar { width: 1px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: var(--md-char-color); }
```

### Resize Handles

```css
.resize-handle { width: 4px; background: transparent; cursor: col-resize; }
.resize-handle:hover { background: var(--border-color); }
```

---

## Popup Positioning

Editor popups use `position: fixed` with viewport coordinates.

| Type | Z-Index | Container |
|------|---------|-----------|
| Inline popups (link, image, math, footnote, heading, wiki-link) | 9999 | Inside EditorContainer |
| Genie picker | 9999 | App-level |
| Table context menu | 10000 | Inside table plugin |
| MCP status overlay | 1200 | StatusBar |
| Context menus (file, tab) | 1000 | App-level |
| Mermaid preview | 1000 | Inside mermaid plugin |
| Toolbar dropdown | 103 | Inside toolbar |
| Toolbar | 102 | — |
| StatusBar, FindBar, TitleBar | 100 | — |
| Inline previews | 50–60 | — |
| Base content, resize handles | 0–10 | — |

---

## Focus Indicators

| Pattern | Component Type | Indicator |
|---------|---------------|-----------|
| U-shaped underline | Toolbar/popup buttons | `::after` pseudo-element |
| Caret only | Popup inputs | No visible outline |
| Bottom border | Dialog inputs | `border-bottom-color: var(--primary-color)` |
| Standard outline | Standalone buttons | `outline: 2px solid var(--primary-color)` |
| Background | List items | `background: var(--accent-bg)` |

Global focus reset: `:where(*):focus-visible { outline: none; }` — components MUST define their own.

---

## Dark Theme

**Selector:** `.dark-theme` (primary), `.dark` (Tailwind compat).

Most tokens auto-adapt via `useTheme.ts`. Override only for:
- `rgba()` values needing different opacity
- Shadows (`--popup-shadow-dark`)
- Visual effects

---

## Theme System

| ID | Name | Background | Dark |
|----|------|------------|------|
| `white` | White | `#ffffff` | No |
| `paper` | Paper | `#eeeded` | No |
| `mint` | Mint | `#cce6d0` | No |
| `sepia` | Sepia | `#f9f0db` | No |
| `night` | Night | `#23262b` | Yes |

Implementation: `useTheme.ts` reads from `useSettingsStore`, sets CSS variables on `document.documentElement`, and toggles `.dark-theme` / `.dark` classes.

---

## File Locations

| Purpose | Path |
|---------|------|
| Global tokens (source of truth) | `src/styles/index.css` |
| Shared popup styles | `src/styles/popup-shared.css` |
| Theme hook | `src/hooks/useTheme.ts` |
| Theme definitions | `src/stores/settingsStore.ts` |
| Component CSS | `src/components/*/` |
| Plugin CSS | `src/plugins/*/` |

## Rules Reference

See `.claude/rules/` for enforcement:
- `31-design-tokens.md` — token catalog and usage rules
- `32-component-patterns.md` — component specs, z-index hierarchy
- `33-focus-indicators.md` — accessibility focus patterns
- `34-dark-theme.md` — dark theme rules
