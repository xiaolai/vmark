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

## Media Type Colors

| Token | Purpose | Default |
|-------|---------|---------|
| `--media-video` | Video media tags | `#0d9488` |
| `--media-audio` | Audio media tags | `#6366f1` |
| `--media-youtube` | YouTube media tags | `#dc2626` |
| `--media-vimeo` | Vimeo media tags | `#00adef` |
| `--media-bilibili` | Bilibili media tags | `#fb7299` |

### Dark Mode Media Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--media-video-dark` | `#2dd4bf` | Video in dark mode |
| `--media-audio-dark` | `#818cf8` | Audio in dark mode |
| `--media-youtube-dark` | `#f87171` | YouTube in dark mode |
| `--media-vimeo-dark` | `#4ac3f0` | Vimeo in dark mode |
| `--media-bilibili-dark` | `#fc9cb5` | Bilibili in dark mode |

## Highlight Tokens

| Token | Purpose | Default |
|-------|---------|---------|
| `--highlight-bg` | Highlight mark background | `#fff3a3` |
| `--highlight-text` | Highlight text color | `inherit` |

## Multi-cursor Tokens

| Token | Purpose | Light Default | Dark Override |
|-------|---------|---------------|---------------|
| `--multi-cursor-color` | Secondary cursor caret color | `hsl(217 91% 60%)` | `hsl(217 91% 70%)` |
| `--multi-cursor-selection-bg` | Secondary cursor selection background | `hsla(217, 91%, 60%, 0.3)` | `hsla(217, 91%, 70%, 0.25)` |

## Spacing Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--spacing-1` | `4px` | Small gaps, tight padding |
| `--spacing-2` | `8px` | Standard gaps |
| `--spacing-3` | `12px` | Larger spacing |

**Use `--spacing-*` for `padding`, `margin`, and `gap` only.** A `4px` border-radius is `--radius-sm`, not `--spacing-1`. The numeric value coincidence does not imply semantic equivalence — see "Tokenize value vs. tokenize intent" below.

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

**Acceptable hardcoded values** (do not tokenize):
- `0.5px` for retina sub-pixel borders
- `1px` or `2px` for borders, dividers, and inline elements (code spans, cursor indicators, focus underlines)
- `3px` for fine positioning offsets (e.g., `top: 3px` on a dot indicator)
- Focus indicator geometry (e.g., `0 0 4px 4px` for the U-shape underline)
- `@media print` blocks (color-mix() may not render in all print pipelines)
- Component-internal one-off dimensions — define a **local** CSS var on the component class instead of adding a global token. Example pattern from `universal-toolbar.css`:
  ```css
  .universal-toolbar {
    --universal-toolbar-height: 40px;
    height: var(--universal-toolbar-height);
  }
  ```

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
| `--radius-lg` | `8px` | Popup border radius |

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

**Note:** These tokens have static defaults in `:root` for print/SSR, but are dynamically updated by `useTheme.ts` based on user settings. For example, `--editor-line-height` defaults to `1.6` in CSS, but the user-facing default is `1.8` (set in `settingsStore.ts` as "Relaxed" and applied dynamically by `useTheme.ts`).

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

## Two layers: semantic tokens above primitives

VMark's token system has **two layers**, both defined in `src/styles/index.css`:

1. **Semantic tokens** — named for their role (`--popup-padding`, `--icon-size-lg`, `--radius-sm`, `--spacing-2`, `--accent-bg`). **Always prefer these when one fits.**
2. **Primitives** — named for their value position on a scale (`--space-1-5: 6px`, `--font-size-sm: 12px`, `--duration-fast: 0.1s`, `--opacity-disabled: 0.4`, `--z-popup: 9999`). Reach for these **only when no semantic token covers the case**.

### Primitive scales

| Family | Tokens | Use when |
|---|---|---|
| Spacing (px) | `--space-px`, `--space-half` (2), `--space-1` (4), `--space-1-5` (6), `--space-2` (8), `--space-2-5` (10), `--space-3` (12), `--space-3-5` (14), `--space-4` (16), `--space-5` (20), `--space-6` (24), `--space-7` (28), `--space-8` (32), `--space-10` (40), `--space-15` (60) | A semantic spacing token (`--spacing-1/2/3`, `--popup-padding`) doesn't match the value |
| Border widths | `--border-hairline` (0.5px), `--border-thin` (1px), `--border-medium` (2px), `--border-thick` (4px) | Setting `border-width`, `border-{top,right,bottom,left}-width` |
| UI font sizes | `--font-size-2xs` (10), `--font-size-xs` (11), `--font-size-sm` (12), `--font-size-base` (13), `--font-size-md` (14), `--font-size-lg` (16) | UI labels and metadata. **Not** for editor body text — that uses runtime `--editor-font-size*`. |
| Component dimensions | `--size-icon-xs` (14), `--size-icon-medium` (18), `--size-btn-xs` (20), `--size-btn-sm` (24) | Width/height of small icons or buttons not covered by `--icon-size-*` |
| Line heights | `--line-height-tight` (1.25), `--line-height-snug` (1.35), `--line-height-base` (1.4), `--line-height-normal` (1.5), `--line-height-relaxed` (1.6) | `line-height` on UI text |
| Letter spacing | `--letter-spacing-tight` (0.3px), `--letter-spacing-loose` (0.5px) | UI labels (uppercase, semibold) |
| Opacity | `--opacity-disabled` (0.4), `--opacity-muted` (0.5), `--opacity-subtle` (0.6), `--opacity-half-faded` (0.7), `--opacity-mostly-opaque` (0.85) | Visual de-emphasis. **Not** for `0` or `1` — those stay literal. |
| Durations | `--duration-fast` (0.1s), `--duration-base` (0.15s), `--duration-medium` (0.2s), `--duration-slow` (0.3s), `--duration-slower` (0.6s), `--duration-1s`, `--duration-1-5s`, `--duration-2s`, `--duration-5s` | `transition`, `animation` durations |
| Z-index | `--z-resize-handle` (10), `--z-bar` (100), `--z-toolbar` (102), `--z-toolbar-dropdown` (103), `--z-context-menu` (1000), `--z-mcp-overlay` (1200), `--z-popup` (9999), `--z-table-context` (10000) | Stacking context. Mirrors hierarchy in `32-component-patterns.md`. |

### What stays literal even with primitives

- **Animation keyframe percentages** (`0%`, `50%`, `100%`)
- **Transform scale/translate values** (`scale(0.78)` — optical adjustment, not a design knob)
- **`calc()` arithmetic with mixed units**
- **`var(--xyz, #fallback)` defensive fallbacks** (the fallback is intentionally a literal)
- **`rgba()` lines that precede `color-mix()` lines** (browser-fallback pattern)
- **CSS pseudo-element generated content** (`content: "✓"`)
- **`opacity: 0` / `opacity: 1`** (visibility flags, not design opacity)
- **`50%` for circles** (`border-radius: 50%`)
- **`100%` and `auto` keywords** (semantic CSS, not values)

## Tokenize value vs. tokenize intent

Before replacing a literal with a token, the question is **not** "does a token with this value exist?" — it's "does the CSS *property* match the token's purpose?"

The `ui-tokenize` plugin (`/ui-tokenize:audit`, `/ui-tokenize:fix`) matches on **value coincidence**, not property semantics. Empirically, ≥0.85-confidence suggestions from the audit are wrong about **58% of the time**: it suggests `--radius-sm` for any `4px`, `--list-indent` for any `16px`, `--cjk-letter-spacing` for any `1px`, etc. — regardless of whether the property is `border-radius`, `padding`, `gap`, `top`, or anything else.

**Operating rules:**
- **Never run `/ui-tokenize:fix` on this repo.** It will silently insert wrong tokens.
- **Treat audit suggestions as candidates, not answers.** Verify property → token mapping for every change.
- **Property-token mapping** (use this, not the audit's first suggestion):
  | CSS property | Use |
  |---|---|
  | `border-radius` | `--radius-*` |
  | `padding`, `margin`, `gap` | `--spacing-*` (or `--popup-padding` in popups) |
  | `width`/`height` of icon buttons | `--icon-size-*` |
  | `font-size` (UI text) | currently no static token; either keep literal or define a new one |
  | `top`/`left`/`right`/`bottom` (positioning) | usually keep literal (focus offsets, dot indicators) |
- **TS/TSX has no token consumer system.** Suggestions like `tokens.media.youtube` refer to a system that doesn't exist. Components consume tokens via CSS classes only.
- **The audit's `#NNN` regex matches GitHub issue references** in code comments (e.g. `// fix for (#823)`). Treat short pure-numeric hex matches in `.ts`/`.tsx` as noise.

The `.tokenize/ignore` file in the project root encodes the structural exclusions (export bundle, token-definer files, syntax-highlight palettes, fixtures).

## Visual QA

After CSS changes, verify rendering with the reference document:

1. Open `dev-docs/css-reference.md` in VMark
2. Check both light and dark themes
3. Compare against baseline screenshots in `dev-docs/archive/screenshots/` (gitignored)

The reference document exercises all markdown elements: typography, lists, blockquotes, code blocks, tables, alerts, details, math, and footnotes.
