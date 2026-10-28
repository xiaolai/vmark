---
paths:
  - "**/*.css"
  - "src/**/*.tsx"
  - "src/theme/**"
  - "src/styles/**"
  - "src/hooks/useTheme.ts"
  - "src/shell/**"
---

# 31 - Design Tokens

Reference for CSS custom properties. Always use tokens over hardcoded values.

**Source of truth (post-ADR-014, `.claude/adr/ADR-014-theme-tokens-as-typed-data.md`):**
- Typed theme catalog: `src/theme/themes/<id>.ts` (paper, white, mint, sepia, night, solarized) implementing `ThemeTokens` from `src/theme/tokens.ts`.
- Runtime CSS-var writer: `src/theme/applyTheme.ts` (emits `--color-*`, `--space-*`, etc. for the typed pathway).
- Legacy CSS-var values (the `--bg-color` / `--accent-bg` / `--alert-note` names the app's CSS actually consumes) also flow from the typed catalog: the per-theme dark overrides live on `ThemeTokens.color.legacy` (night, solarized), and the shared light-mode statics live in `legacyLight` (`src/theme/tokens.ts`). `useTheme.ts` reads both from the catalog — it no longer carries its own `darkModeColors`/`lightModeColors` literals.
- Dynamic per-user overrides (font size, line-height, editor width) are still computed in `src/hooks/useTheme.ts`; static fallbacks remain in `src/styles/index.css`.

Adding/retinting a theme is a single-file edit in `src/theme/themes/` (plus
appending the ID to `themes/index.ts` and the `ThemeId` union). The tables
below name each runtime CSS var and its role. They carry no values: values
drift, and the typed catalog and `src/styles/index.css` are authoritative.
`pnpm lint:design-tokens` keeps every row and every declaration in parity.

## Core Color Tokens

| Token | Purpose |
|---|---|
| `--bg-color` | Main background |
| `--bg-primary` | Alias for `--bg-color` |
| `--bg-secondary` | Secondary surfaces |
| `--bg-tertiary` | Hover backgrounds |
| `--hover-bg` | Explicit hover state (6%: 4% was below perception on grey card surfaces) |
| `--hover-bg-strong` | Stronger hover |
| `--hover-bg-dark` | Dark mode hover |
| `--subtle-bg` | Very subtle background |
| `--subtle-bg-hover` | Subtle background hover |
| `--surface-raised` | Elevated control face — the `.vm-btn` base; white on light themes, lifted under `.dark-theme` |
| `--cursor-interactive` | D7 cursor, platform-scoped: `default` on macOS, `pointer` under `.platform-windows`/`.platform-linux` (root class set by `main.tsx` from `platformRootClass()`) |
| `--text-color` | Primary text |
| `--text-primary` | Alias for `--text-color` |
| `--text-secondary` | Secondary text |
| `--text-tertiary` | Disabled/muted text |
| `--primary-color` | Links, primary actions — static ALIAS of `--accent-primary`; the runtime emits both from one catalog value |
| `--border-color` | Borders, dividers |
| `--control-border` | Control boundary (≥ 3:1 on primary+secondary, D8) — never a divider |
| `--selection-color` | Text selection |
| `--quote-text` | Blockquote body ink (readable prose — R5) |
| `--contrast-text` | Text on colored backgrounds |

## Accent Tokens (Selection/Active States)

| Token | Purpose |
|---|---|
| `--accent-primary` | Active icon and indicator color (not text on `--accent-bg`; see R6) |
| `--accent-bg` | Active/selected background |

**Rule (R6 — selection keeps its ink)**: Use `--accent-bg` for all selected/active
backgrounds, with `--text-color` for the row's TEXT and `--accent-primary` for
icons and indicators only. Accent-coloured text on the accent tint measures
3.84:1 on paper — below AA — which is why the older "accent-primary for text"
wording was retired. The current-tab idiom is the NEGATIVE treatment: ink and page swap tokens (`--text-color` fill,
`--bg-color` text), AA by construction on every theme — a named exception
carrying `ui-ok(state): current-tab`. Inside the ink face, page ink carries
the signals (dirty dot, focus bar, close affordance).

**Font roles (R3)**: `--font-sans` is the READING font — the user's
choice, written from settings by `useTheme.ts`, consumed only under document
selectors. Chrome uses `--font-ui` (static system stack) so the UI never
restyles when the reading font changes. `--font-ui` is declared in `:root` and
the C5 check of `lint:ui-consistency` enforces the split at a zero baseline —
a chrome `--font-sans` site fails the gate.

**Tertiary is decorative (R5/D3)**: `--text-tertiary` never colours readable
text or an enabled control — it is the disabled/decorative tier. Readable secondary content uses
`--text-secondary`.

**Control tokens**: use `--control-border` (D8) for any boundary that makes a
control findable; `--border-color` stays a divider. `--target-min` (24px
hit-target floor, D2): no interactive element takes a smaller hit box; paint-small controls centre a
`--target-min` square over themselves with a `::before` expander (see
`icon-button-shared.css`).

## Semantic Tokens

| Token | Purpose |
|---|---|
| `--error-color` | Error states |
| `--error-color-hover` | Error hover state |
| `--error-bg` | Error background |
| `--warning-color` | Warning states |
| `--warning-bg` | Warning background |
| `--warning-border` | Warning borders |
| `--success-color` | Success states |
| `--success-color-hover` | Success hover state |
| `--success-color-dark` | Success states (dark mode) |

## Alert Block Colors

| Token | Purpose |
|---|---|
| `--alert-note` | Note blocks |
| `--alert-tip` | Tip blocks |
| `--alert-important` | Important blocks |
| `--alert-warning` | Warning blocks |
| `--alert-caution` | Caution blocks |

### Dark Mode Alert Tokens

| Token | Use For |
|---|---|
| `--alert-note-dark` | Note blocks in dark mode |
| `--alert-tip-dark` | Tip blocks in dark mode |
| `--alert-important-dark` | Important blocks in dark mode |
| `--alert-warning-dark` | Warning blocks in dark mode |
| `--alert-caution-dark` | Caution blocks in dark mode |

## Media Type Colors

| Token | Purpose |
|---|---|
| `--media-video` | Video media tags |
| `--media-audio` | Audio media tags |
| `--media-youtube` | YouTube media tags |
| `--media-vimeo` | Vimeo media tags |
| `--media-bilibili` | Bilibili media tags |

### Dark Mode Media Tokens

| Token | Use For |
|---|---|
| `--media-video-dark` | Video in dark mode |
| `--media-audio-dark` | Audio in dark mode |
| `--media-youtube-dark` | YouTube in dark mode |
| `--media-vimeo-dark` | Vimeo in dark mode |
| `--media-bilibili-dark` | Bilibili in dark mode |

## Syntax Tokens

| Family | Tokens | Use For |
|---|---|---|
| Syntax palette (per theme via `ThemeTokens.syntax`, D11) | `--syntax-keyword`, `--syntax-type`, `--syntax-function`, `--syntax-property`, `--syntax-variable`, `--syntax-string`, `--syntax-number`, `--syntax-operator`, `--syntax-punctuation`, `--syntax-comment`, `--syntax-escape`, `--syntax-constant`, `--syntax-attribute`, `--syntax-tag`, `--syntax-link`, `--syntax-invalid` | Code highlighting in Source mode (`source-syntax.css`), WYSIWYG code blocks (`hljs-syntax.css`) and data trees (`json-view-theme.css`). Every value clears 4.5:1 on bg.primary AND bg.secondary (C1e). |

## Highlight Tokens

| Token | Purpose |
|---|---|
| `--highlight-bg` | Highlight mark background |
| `--highlight-text` | Highlight text color |

## Multi-cursor Tokens

| Token | Purpose |
|---|---|
| `--multi-cursor-color` | Secondary cursor caret color |
| `--multi-cursor-selection-bg` | Secondary cursor selection background |

## Search & Divergence Tokens

| Token | Purpose |
|---|---|
| `--search-match-color` | Find-bar match highlight |
| `--search-match-active-color` | Active find-bar match |
| `--divergent-border-dark` | Split-view divergence border (dark themes) |

## Spacing Tokens

| Token | Use For |
|---|---|
| `--spacing-1` | Small gaps, tight padding |
| `--spacing-2` | Standard gaps |
| `--spacing-3` | Larger spacing |

**Use `--spacing-*` for `padding`, `margin`, and `gap` only.** A border-radius is a `--radius-*` token, never `--spacing-1`. The numeric value coincidence does not imply semantic equivalence — see "Tokenize value vs. tokenize intent" below.

## Icon Size Tokens

| Token | Use For |
|---|---|
| `--icon-size-sm` | Bar buttons (`.vm-icon-btn--sm`); also the D2 hit-target floor |
| `--icon-size-md` | Popup action buttons |
| `--icon-size-lg` | Toolbar buttons |
| `--target-min` | Minimum clickable square (D2); `::before` expanders consume it |

## List Tokens

| Token | Use For |
|---|---|
| `--list-indent` | Global list indent base |

## Editor Content Tokens

| Token | Use For |
|---|---|
| `--editor-content-padding` | Horizontal padding for editor content (constrains selection highlight). Computed dynamically in `useTheme.ts` to ensure consistency across WYSIWYG and Source modes. |

## Size Tokens

### Border Radius

| Token | Use For |
|---|---|
| `--radius-sm` | Controls: buttons, icon squares, selects, field inputs, chips — and rows INSIDE floating surfaces (near-concentric) |
| `--radius-md` | Content blocks (code, alerts, details…) and page/panel rows |
| `--radius-lg` | Floating surfaces: popups, dialogs, menus, dropdowns |
| `--radius-pill` | Pill shapes, tags, `.vm-btn--pill` capsule buttons |

**The φ curvature ladder**: window `21` → shell card `13` →
`--radius-lg 8` → `--radius-md 5` → `--radius-sm 3` — each step ≈ ×0.62
(Fibonacci: 3, 5, 8, 13, 21). Pick radius by TIER, never by taste; pills and
circles stay off-ladder. Bare Tailwind `rounded` (a 0.25rem literal) is
BANNED — `tailwindTheme.test.ts` enforces it; use `rounded-sm/md/lg`, which
resolve through these tokens.

**Acceptable hardcoded values** (do not tokenize):
- `0.5px` for retina sub-pixel borders
- `1px` or `2px` for borders, dividers, and inline elements (code spans, cursor indicators, focus underlines, scrollbar thumbs)
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

| Token | Use For |
|---|---|
| `--shadow-sm` | Hover tooltips, subtle elevation |
| `--shadow-md` | Inline popups |
| `--popup-shadow` | Standard popups, dialogs |
| `--popup-shadow-dark` | Dark mode popups |
| `--shadow-popup` | Tailwind `shadow-popup` utility and typed-pathway consumers — adapts in dark themes without a `.dark-theme` rule |

### Popup Tokens

| Token | Use For |
|---|---|
| `--popup-padding` | Standard popup padding |
| `--radius-lg` | Popup border radius |

### Button/Icon Sizes

Use the icon size tokens for button dimensions:

| Token | Use For |
|---|---|
| `--icon-size-sm` | Bar buttons, compact areas (`.vm-icon-btn--sm`) |
| `--icon-size-md` | Popup action buttons |
| `--icon-size-lg` | Toolbar buttons |

Icon SVG sizes (conventions, not tokens):

| Size | Value | Use For |
|------|-------|---------|
| Small icons | `14px` | Icon SVGs in popups |
| Standard icons | `18px` | Toolbar icon SVGs |

## Typography Tokens

| Token | Purpose |
|---|---|
| `--font-ui` | CHROME text — the system face, never touched by settings (R3) |
| `--font-sans` | READING text — the user's chosen document face; document selectors only |
| `--font-mono` | Code, URLs, paths — the user's mono face |
| `--editor-font-size` | Editor text size |
| `--editor-font-size-mono` | Monospace text (85%) |
| `--editor-line-height` | Line height ratio |
| `--editor-line-height-px` | Absolute line height |
| `--editor-block-spacing` | Spacing between blocks |
| `--cjk-letter-spacing` | CJK character spacing |
| `--editor-width` | Max editor content width |

**Monospace stacks for character grids** (terminal, code blocks, Source mode): use `verifiedMonoStack()` from `src/services/fonts/`, never `resolveMonoFontStack()`. WebKitGTK under CJK locales does not skip absent families (#1334); the module header has the measurements.

**Note:** These tokens have static defaults in `:root` for print/SSR, but are dynamically updated by `useTheme.ts` based on user settings. For example, `--editor-line-height` defaults to `1.6` in CSS, but the user-facing default is `1.8` (set in `settingsStore.ts` as "Relaxed" and applied dynamically by `useTheme.ts`).

## Code/Syntax Tokens

| Token | Purpose |
|---|---|
| `--code-bg-color` | Code block background |
| `--code-text-color` | Code text |
| `--code-border-color` | Code block border |
| `--code-line-height` | Code block line height |
| `--code-padding` | Code block horizontal padding |
| `--md-char-color` | Markdown syntax chars |
| `--meta-content-color` | Metadata content |

## Text Emphasis Tokens

| Token | Purpose |
|---|---|
| `--strong-color` | Bold text color |
| `--emphasis-color` | Italic text color |

## Layout Tokens

| Token | Purpose |
|---|---|
| `--sidebar-bg` | Sidebar background |
| `--workspace-rail-width` | Workspace rail column width |
| `--bar-height` | Status bar / universal toolbar height |
| `--shell-card-inset` | Gutter around the leading rail+sidebar card |
| `--shell-card-radius` | Leading card radius, concentric with the 21px window corner |
| `--shell-top-inset` | Top inset a full-height column leaves clear |
| `--traffic-lights-zone` | Horizontal space the title bar keeps clear of the window controls |
| `--traffic-lights-centre` | The window controls' optical line, which the title bar centres content on |
| `--outline-width` | Outline panel width |
| `--settings-nav-width` | Settings nav column width (read by Settings.tsx AND SettingsNav) |
| `--table-border-color` | Table borders |

**Shell chrome vars are written by `shellChromeVars()`** (`src/shell/shellChrome.ts`), not CSS. The `:root` values are fallbacks; change the TS constant. Consume `--shell-top-inset` (0 off macOS), never a literal. Traffic-light geometry derives from `TRAFFIC_LIGHT_POSITION` in `src/shell/trafficLights.ts`, declared in three places (`tauri.conf.json`, `window_manager/mod.rs`, `trafficLights.ts`) that `trafficLights.test.ts` keeps in sync; it needs the `macos-private-api` cargo feature.

## Browser Chrome Tokens

The browser frame is a true neutral — white in light themes, dark in dark ones — never theme-tinted.

| Token | Purpose |
|---|---|
| `--browser-bg-color` | Browser-frame counterpart of `--bg-color` |
| `--browser-bg-secondary` | Browser-frame counterpart of `--bg-secondary` |
| `--browser-bg-tertiary` | Browser-frame counterpart of `--bg-tertiary` |
| `--browser-text-color` | Browser-frame counterpart of `--text-color` |
| `--browser-text-secondary` | Browser-frame counterpart of `--text-secondary` |
| `--browser-text-tertiary` | Browser-frame counterpart of `--text-tertiary` |
| `--browser-border-color` | Browser-frame counterpart of `--border-color` |
| `--browser-hover-bg` | Browser-frame counterpart of `--hover-bg` |
| `--browser-hover-bg-strong` | Browser-frame counterpart of `--hover-bg-strong` |
| `--browser-accent-bg` | Browser-frame counterpart of `--accent-bg` |
| `--browser-accent-primary` | Browser-frame counterpart of `--accent-primary` |

Do not consume `--browser-*` directly: `shell/app-shell.css` shadows the global names onto them under `.browser-workspace-active`. The terminal (xterm canvas) follows via `theme/terminalThemeForBrowser.ts`; its test pins the neutral backgrounds equal to `white`/`night`.

## Focus Mode Tokens

| Token | Purpose |
|---|---|
| `--blur-text-color` | Blurred text color |
| `--blur-image-opacity` | Blurred image opacity |
| `--focus-dim-opacity` | Focus Mode dim level (useTheme.ts overrides) |
| `--source-mode-bg` | Source mode background |

## Rules

1. **Never hardcode colors** - use tokens for all colors
2. **Check dark mode** - ensure token works in both themes
3. **Prefer semantic tokens** - use `--error-color` not `#cf222e`
4. **Use radius tokens** - prefer `--radius-sm/md/lg` over hardcoded px
5. **Use shadow tokens** - prefer `--shadow-sm/md`, `--popup-shadow` over hardcoded
6. **Update this doc** - add a row when adding a token to index.css (`pnpm lint:design-tokens` checks both directions)
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
| UI font sizes | `--font-size-xs` (11), `--font-size-sm` (12), `--font-size-base` (13), `--font-size-md` (14), `--font-size-lg` (16), `--font-size-xl` (22 — identity/display text) | UI labels and metadata. **Not** for editor body text — that uses runtime `--editor-font-size*`. There is no 10px size: UI text floors at `xs`. |
| Component dimensions | `--size-icon-xs` (14), `--size-icon-medium` (18), `--size-btn-xs` (20) | Width/height of small icons not covered by `--icon-size-*`. `--size-btn-sm` is gone — a 24px square is `.vm-icon-btn--sm`. |
| Line heights | `--line-height-tight` (1.25), `--line-height-snug` (1.35), `--line-height-base` (1.4), `--line-height-normal` (1.5), `--line-height-relaxed` (1.6) | `line-height` on UI text |
| Letter spacing | `--letter-spacing-tight` (0.3px), `--letter-spacing-loose` (0.5px), `--letter-spacing-caps` (0.5px) | `caps` is THE tracking for every `text-transform: uppercase` micro-label (pinned by `uiAuditFixes.test.ts`); tight/loose serve non-caps uses |
| Opacity | `--opacity-disabled` (0.4), `--opacity-muted` (0.5), `--opacity-subtle` (0.6), `--opacity-half-faded` (0.7), `--opacity-mostly-opaque` (0.85) | Visual de-emphasis. **Not** for `0` or `1` — those stay literal. |
| Durations | `--duration-fast` (0.1s), `--duration-base` (0.15s), `--duration-medium` (0.2s), `--duration-slower` (0.6s), `--duration-1s`, `--duration-1-5s`, `--duration-5s` | `transition`, `animation` durations |
| Z-index | `--z-resize-handle` (10), `--z-panel-overlay` (12), `--z-bar` (100), `--z-toolbar` (102), `--z-toolbar-dropdown` (103), `--z-context-menu` (1000), `--z-mcp-overlay` (1200), `--z-popup` (9999), `--z-table-context` (10000) | Stacking context. Mirrors hierarchy in `32-component-patterns.md`. |

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

Pick a token by the CSS property's purpose, not by value coincidence (`4px` padding is not `--radius-sm`). Never run `/ui-tokenize:fix` here; treat `/ui-tokenize:audit` output as candidates only.

| CSS property | Use |
|---|---|
| `border-radius` | `--radius-*` |
| `padding`, `margin`, `gap` | `--spacing-*` (or `--popup-padding` in popups) |
| `width`/`height` of icon buttons | `--icon-size-*` |
| `top`/`left`/`right`/`bottom` | usually literal |

## Visual QA

After CSS changes, verify rendering with the reference document:

1. Open `dev-docs/css-reference.md` in VMark
2. Check both light and dark themes
3. Compare against baseline screenshots in `dev-docs/archive/screenshots/` (gitignored)

The reference document exercises all markdown elements: typography, lists, blockquotes, code blocks, tables, alerts, details, math, and footnotes.
