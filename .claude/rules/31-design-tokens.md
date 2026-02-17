# 31 - Design Tokens

Reference for CSS custom properties. Always use tokens over hardcoded values.

**Source of truth:** `src/styles/index.css`

## Core Color Tokens

| Token | Purpose | Light Default |
|-------|---------|---------------|
| `--bg-color` | Main background | `#eeeded` |
| `--bg-primary` | Alias for `--bg-color` | - |
| `--bg-secondary` | Secondary surfaces | `#e5e4e4` |
| `--bg-tertiary` | Hover backgrounds | `#f0f0f0` |
| `--hover-bg` | Explicit hover state | `rgba(0,0,0,0.04)` |
| `--hover-bg-strong` | Stronger hover | `rgba(0,0,0,0.08)` |
| `--hover-bg-dark` | Dark mode hover | `rgba(255,255,255,0.08)` |
| `--hover-bg-dark-strong` | Dark mode stronger hover | `rgba(255,255,255,0.12)` |
| `--subtle-bg` | Very subtle background | `rgba(0,0,0,0.02)` |
| `--subtle-bg-hover` | Subtle background hover | `rgba(0,0,0,0.03)` |
| `--text-color` | Primary text | `#1a1a1a` |
| `--text-primary` | Alias for `--text-color` | - |
| `--text-secondary` | Secondary text | `#666666` |
| `--text-tertiary` | Disabled/muted text | `#999999` |
| `--primary-color` | Links, primary actions | `#0066cc` |
| `--border-color` | Borders, dividers | `#d5d4d4` |
| `--selection-color` | Text selection | `rgba(0,102,204,0.2)` |
| `--contrast-text` | Text on colored backgrounds | `white` |

## Accent Tokens (Selection/Active States)

| Token | Purpose | Light Default |
|-------|---------|---------------|
| `--accent-primary` | Active icon/text color | `#0066cc` |
| `--accent-bg` | Active/selected background | `rgba(0,102,204,0.1)` |
| `--accent-text` | Accent text (alias) | `#0066cc` |

**Rule**: Use `--accent-bg` for all selected/active backgrounds, `--accent-primary` for active text/icons.

## Semantic Tokens

| Token | Purpose | Light Default |
|-------|---------|---------------|
| `--error-color` | Error states | `#cf222e` |
| `--error-color-hover` | Error hover state | `#b91c1c` |
| `--error-bg` | Error background | `#ffebe9` |
| `--warning-color` | Warning states | `#9a6700` |
| `--warning-bg` | Warning background | `rgba(245,158,11,0.1)` |
| `--warning-border` | Warning borders | `rgba(245,158,11,0.3)` |
| `--success-color` | Success states | `#16a34a` |
| `--success-color-hover` | Success hover state | `#15803d` |
| `--success-color-dark` | Success states (dark mode) | `#4ade80` |

## Alert Block Colors

| Token | Purpose | Default |
|-------|---------|---------|
| `--alert-note` | Note blocks | `#0969da` |
| `--alert-tip` | Tip blocks | `#1a7f37` |
| `--alert-important` | Important blocks | `#8250df` |
| `--alert-warning` | Warning blocks | `#9a6700` |
| `--alert-caution` | Caution blocks | `var(--error-color)` |

### Dark Mode Alert Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--alert-note-dark` | `#58a6ff` | Note blocks in dark mode |
| `--alert-tip-dark` | `#3fb950` | Tip blocks in dark mode |
| `--alert-important-dark` | `#a371f7` | Important blocks in dark mode |
| `--alert-warning-dark` | `#d29922` | Warning blocks in dark mode |
| `--alert-caution-dark` | `#f85149` | Caution blocks in dark mode |

## Highlight Tokens

| Token | Purpose | Default |
|-------|---------|---------|
| `--highlight-bg` | Highlight mark background | `#fff3a3` |
| `--highlight-text` | Highlight text color | `inherit` |

## Spacing Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--spacing-1` | `4px` | Small gaps, tight padding |
| `--spacing-2` | `8px` | Standard gaps |
| `--spacing-3` | `12px` | Larger spacing |

## Icon Size Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--icon-size-sm` | `22px` | StatusBar buttons |
| `--icon-size-md` | `26px` | Popup action buttons |
| `--icon-size-lg` | `28px` | Toolbar buttons |

## List Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--list-indent` | `1em` | Global list indent base |

## Editor Content Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--editor-content-padding` | `fontSize * 2` (px) | Horizontal padding for editor content (constrains selection highlight). Computed dynamically in `useTheme.ts` to ensure consistency across WYSIWYG and Source modes. |

## Size Tokens

### Border Radius

| Token | Value | Use For |
|-------|-------|---------|
| `--radius-sm` | `4px` | Small buttons, toggles |
| `--radius-md` | `6px` | Inputs, medium containers |
| `--radius-lg` | `8px` | Popups, dialogs, menus |
| `--radius-pill` | `100px` | Pill shapes, tags |
| `--popup-radius` | `8px` | Alias for popup containers |

**Acceptable hardcoded values:**
- `1px` or `2px` for inline elements (code spans, cursor indicators)
- Focus indicator corners (e.g., `0 0 4px 4px` for U-shape)
- @media print blocks (color-mix() may not render in all print pipelines)

### Shadows

| Token | Value | Use For |
|-------|-------|---------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.1)` | Hover tooltips, subtle elevation |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.12)` | Inline popups |
| `--popup-shadow` | `0 4px 12px rgba(0,0,0,0.15)` | Standard popups, dialogs |
| `--popup-shadow-dark` | `0 4px 12px rgba(0,0,0,0.4)` | Dark mode popups |

### Popup Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--popup-padding` | `6px` | Standard popup padding |
| `--popup-radius` | `8px` | Popup border radius |

### Button/Icon Sizes

Use the icon size tokens for button dimensions:

| Token | Value | Use For |
|-------|-------|---------|
| `--icon-size-sm` | `22px` | StatusBar, compact areas |
| `--icon-size-md` | `26px` | Popup action buttons |
| `--icon-size-lg` | `28px` | Toolbar buttons |

Icon SVG sizes (conventions, not tokens):

| Size | Value | Use For |
|------|-------|---------|
| Small icons | `14px` | Icon SVGs in popups |
| Standard icons | `18px` | Toolbar icon SVGs |

## Typography Tokens

| Token | Purpose | Static Default |
|-------|---------|----------------|
| `--font-sans` | UI text, body content | System fonts |
| `--font-mono` | Code, URLs, paths | System mono |
| `--editor-font-size` | Editor text size | `18px` |
| `--editor-font-size-sm` | Small text (90%) | `16.2px` |
| `--editor-font-size-mono` | Monospace text (85%) | `15.3px` |
| `--editor-line-height` | Line height ratio | `1.6` |
| `--editor-line-height-px` | Absolute line height | `28.8px` |
| `--editor-block-spacing` | Spacing between blocks | `1em` |
| `--cjk-letter-spacing` | CJK character spacing | `0.05em` |
| `--editor-width` | Max editor content width | `50em` |

**Note:** These tokens have static defaults in `:root` for print/SSR, but are dynamically updated by `useTheme.ts` based on user settings.

## Code/Syntax Tokens

| Token | Purpose | Light Default |
|-------|---------|---------------|
| `--code-bg-color` | Code block background | `#e5e4e4` |
| `--code-text-color` | Code text | `#1a1a1a` |
| `--code-border-color` | Code block border | `#d5d4d4` |
| `--code-line-height` | Code block line height | `1.45` |
| `--code-padding` | Code block horizontal padding | `18px` (dynamically set by `useTheme.ts` to base fontSize) |
| `--md-char-color` | Markdown syntax chars | `#777777` |
| `--meta-content-color` | Metadata content | `#777777` |

## Text Emphasis Tokens

| Token | Purpose | Default |
|-------|---------|---------|
| `--strong-color` | Bold text color | `rgb(63,86,99)` |
| `--emphasis-color` | Italic text color | `rgb(91,4,17)` |

## Layout Tokens

| Token | Purpose | Default |
|-------|---------|---------|
| `--sidebar-bg` | Sidebar background | `#e5e4e4` |
| `--sidebar-width` | Sidebar width | `260px` |
| `--outline-width` | Outline panel width | `200px` |
| `--table-border-color` | Table borders | `#d5d4d4` |

## Focus Mode Tokens

| Token | Purpose | Default |
|-------|---------|---------|
| `--blur-text-color` | Blurred text color | `#c8c8c8` |
| `--blur-image-opacity` | Blurred image opacity | `0.5` |
| `--source-mode-bg` | Source mode background | `rgba(0,0,0,0.02)` |

## Rules

1. **Never hardcode colors** - use tokens for all colors
2. **Check dark mode** - ensure token works in both themes
3. **Prefer semantic tokens** - use `--error-color` not `#cf222e`
4. **Use radius tokens** - prefer `--radius-sm/md/lg` over hardcoded px
5. **Use shadow tokens** - prefer `--shadow-sm/md`, `--popup-shadow` over hardcoded
6. **Update this doc** - when adding new tokens to index.css
7. **Frame ownership for nested containers** - When a wrapper exists (e.g., `.code-block-wrapper`), it owns background, border, and radius. Child elements (e.g., `pre`) should be transparent/flat.
8. **Scoped vars must be defined** - Don't use CSS vars that are only defined on sibling/unrelated selectors (e.g., using `--list-indent` inside blockquote when it's only defined on `ul/ol`).
9. **Scrollbars use tokens** - Scrollbar colors should use `--border-color` and `--md-char-color`, not hardcoded rgba.
10. **Dark alert tokens** - Use `--alert-*-dark` tokens in `.dark-theme` selectors with `color-mix()` for backgrounds.
11. **Use hover tokens** - Use `--hover-bg` and `--hover-bg-strong`, never `--bg-hover` or `--bg-active` (those don't exist).

## Visual QA

After CSS changes, verify rendering with the reference document:

1. Open `dev-docs/css-reference.md` in VMark (local, not in repo)
2. Check both light and dark themes
3. Compare against baseline screenshots in `dev-docs/archive/screenshots/` (local)

The reference document exercises all markdown elements: typography, lists, blockquotes, code blocks, tables, alerts, details, math, and footnotes.
