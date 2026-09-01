# 31 - Design Tokens

Reference for CSS custom properties. Always use tokens over hardcoded values.

**Source of truth (post-ADR-014):**
- Typed theme catalog: `src/theme/themes/<id>.ts` (paper, white, mint, sepia, night, solarized) implementing `ThemeTokens` from `src/theme/tokens.ts`.
- Runtime CSS-var writer: `src/theme/applyTheme.ts` (emits `--color-*`, `--space-*`, etc. for the typed pathway).
- Legacy CSS-var values (the `--bg-color` / `--accent-bg` / `--alert-note` names the app's CSS actually consumes) also flow from the typed catalog: the per-theme dark overrides live on `ThemeTokens.color.legacy` (night, solarized), and the shared light-mode statics live in `legacyLight` (`src/theme/tokens.ts`). `useTheme.ts` reads both from the catalog — it no longer carries its own `darkModeColors`/`lightModeColors` literals.
- Dynamic per-user overrides (font size, line-height, editor width) are still computed in `src/hooks/useTheme.ts`; static fallbacks remain in `src/styles/index.css`.

Adding/retinting a theme is a single-file edit in `src/theme/themes/` (plus
appending the ID to `themes/index.ts` and the `ThemeId` union). The table
below mirrors the runtime CSS-var names that consumers see; the
authoritative values for those names live in the typed catalog.

## Core Color Tokens

| Token | Purpose | Light Default |
|-------|---------|---------------|
| `--bg-color` | Main background | `#eeeded` |
| `--bg-primary` | Alias for `--bg-color` | - |
| `--bg-secondary` | Secondary surfaces | `#e5e4e4` |
| `--bg-tertiary` | Hover backgrounds | `#f0f0f0` |
| `--hover-bg` | Explicit hover state (retuned 4%→6%, audit 20260901 WI-UA5 — 4% was below perception on grey card surfaces) | `rgba(0,0,0,0.06)` |
| `--hover-bg-strong` | Stronger hover | `rgba(0,0,0,0.08)` |
| `--hover-bg-dark` | Dark mode hover | `rgba(255,255,255,0.08)` |
| `--subtle-bg` | Very subtle background (retuned with WI-UA5) | `rgba(0,0,0,0.03)` |
| `--subtle-bg-hover` | Subtle background hover | `rgba(0,0,0,0.04)` |
| `--surface-raised` | Elevated control face — the `.vm-btn` BASE since WI-UB1 (debuted as the welcome variant, WI-UA13); white on light themes, lifted `#383d46` under `.dark-theme` | `#ffffff` |
| `--cursor-interactive` | D7 cursor, platform-scoped (WI-UA15): `default` on macOS, `pointer` under `.platform-windows`/`.platform-linux` (root class set by `main.tsx` from `platformRootClass()`) | `default` |
| `--text-color` | Primary text | `#1a1a1a` |
| `--text-primary` | Alias for `--text-color` | - |
| `--text-secondary` | Secondary text | `#666666` |
| `--text-tertiary` | Disabled/muted text | `#999999` |
| `--primary-color` | Links, primary actions — static ALIAS of `--accent-primary` (WI-UA7); the runtime emits both from one catalog value | `var(--accent-primary)` |
| `--border-color` | Borders, dividers | `#d5d4d4` |
| `--control-border` | Control boundary (≥ 3:1 on primary+secondary, D8) — never a divider | `#7e7d7d` |
| `--selection-color` | Text selection | `rgba(0,102,204,0.2)` |
| `--quote-text` | Blockquote body ink (readable prose — R5/WI-UI1.3) | `var(--text-secondary)` |
| `--contrast-text` | Text on colored backgrounds | `white` |

## Accent Tokens (Selection/Active States)

| Token | Purpose | Light Default |
|-------|---------|---------------|
| `--accent-primary` | Active icon/text color | `#0066cc` |
| `--accent-bg` | Active/selected background | `rgba(0,102,204,0.1)` |

**Rule (R6 — selection keeps its ink)**: Use `--accent-bg` for all selected/active
backgrounds, with `--text-color` for the row's TEXT and `--accent-primary` for
icons and indicators only. Accent-coloured text on the accent tint measures
3.84:1 on paper — below AA — which is why the older "accent-primary for text"
wording was retired. The raised-card current-tab idiom — a `--bg-tertiary`
lift with an inset `--control-border` ring since audit 20260901 (WI-UA1) — is
a named exception carrying `ui-ok(state): current-tab`.

**Font roles (R3, WI-UI2.1)**: `--font-sans` is the READING font — the user's
choice, written from settings by `useTheme.ts`, consumed only under document
selectors. Chrome uses `--font-ui` (static system stack) so the UI never
restyles when the reading font changes. `--font-ui` is declared in `:root` and
the C5 check of `lint:ui-consistency` enforces the split at a zero baseline —
a chrome `--font-sans` site fails the gate.

**Tertiary is decorative (R5/D3)**: `--text-tertiary` never colours readable
text or an enabled control — it is the disabled/decorative tier (its rule-31
row has always said "Disabled/muted text"). Readable secondary content uses
`--text-secondary`.

**Arriving control tokens**: `--control-border` (D8) landed with WI-UI1.2 —
use it for any boundary that makes a control findable; `--border-color` stays a
divider. `--target-min` (24px hit-target floor, D2) landed with WI-UI2.3 —
no interactive element takes a smaller hit box; paint-small controls centre a
`--target-min` square over themselves with a `::before` expander (see
`icon-button-shared.css`).

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

## Syntax Tokens

| Family | Tokens | Use For |
|---|---|---|
| Syntax palette (per theme via `ThemeTokens.syntax`, D11) | `--syntax-keyword`, `--syntax-type`, `--syntax-function`, `--syntax-property`, `--syntax-variable`, `--syntax-string`, `--syntax-number`, `--syntax-operator`, `--syntax-punctuation`, `--syntax-comment`, `--syntax-escape`, `--syntax-constant`, `--syntax-attribute`, `--syntax-tag`, `--syntax-link`, `--syntax-invalid` | Code highlighting in Source mode (`source-syntax.css`), WYSIWYG code blocks (`hljs-syntax.css`) and data trees (`json-view-theme.css`). Every value clears 4.5:1 on bg.primary AND bg.secondary (C1e). |

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

## Search & Divergence Tokens

| Token | Purpose | Light Default | Dark Override |
|-------|---------|---------------|---------------|
| `--search-match-color` | Find-bar match highlight | `rgba(255, 180, 0, 0.8)` | `rgba(255, 200, 0, 0.7)` |
| `--search-match-active-color` | Active find-bar match | `rgba(255, 200, 0, 0.7)` | `rgba(255, 200, 0, 0.5)` |
| `--divergent-border-dark` | Split-view divergence border (dark themes) | — | `rgba(0, 136, 255, 0.25)` |

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
| `--icon-size-sm` | `24px` | Bar buttons (`.vm-icon-btn--sm`); also the D2 hit-target floor |
| `--icon-size-md` | `26px` | Popup action buttons |
| `--icon-size-lg` | `28px` | Toolbar buttons |
| `--target-min` | `24px` | Minimum clickable square (D2); `::before` expanders consume it |

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
| `--radius-pill` | `100px` | Pill shapes, tags, `.vm-btn--pill` capsule buttons |

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
| `--shadow-popup` | theme-adaptive (written by `applyTheme()`; static fallback aliases `--popup-shadow`) | Tailwind `shadow-popup` utility and typed-pathway consumers — adapts in dark themes without a `.dark-theme` rule |

### Popup Tokens

| Token | Value | Use For |
|-------|-------|---------|
| `--popup-padding` | `6px` | Standard popup padding |
| `--radius-lg` | `8px` | Popup border radius |

### Button/Icon Sizes

Use the icon size tokens for button dimensions:

| Token | Value | Use For |
|-------|-------|---------|
| `--icon-size-sm` | `24px` | Bar buttons, compact areas (`.vm-icon-btn--sm`) |
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
| `--font-ui` | CHROME text — the system face, never touched by settings (R3) | `system-ui, -apple-system, …` |
| `--font-sans` | READING text — the user's chosen document face; document selectors only | System fonts (runtime-written) |
| `--font-mono` | Code, URLs, paths — the user's mono face | `ui-monospace, monospace` (runtime-written) |
| `--editor-font-size` | Editor text size | `18px` |
| `--editor-font-size-mono` | Monospace text (85%) | `15.3px` |
| `--editor-line-height` | Line height ratio | `1.8` (runtime default; the `:root` static is 1.6 for print/SSR — see Note) |
| `--editor-line-height-px` | Absolute line height | `32.4px` (18px × 1.8; static 28.8px) |
| `--editor-block-spacing` | Spacing between blocks | `1em` |
| `--cjk-letter-spacing` | CJK character spacing | `0.05em` |
| `--editor-width` | Max editor content width | `50em` |

**A monospace font stack must be MEASURED, never assumed (#1334).** Reach for
`verifiedMonoStack()` from `src/services/fonts/`, not `resolveMonoFontStack()`,
anywhere the result feeds a character grid — the terminal, code blocks, Source
mode.

The CSS cascade is supposed to skip a family that is not installed. On
WebKitGTK under a CJK locale it does not: fontconfig returns a best match for
**any** family name rather than reporting no match, WebKit accepts it, and the
cascade stops at the unmatched head family instead of reaching the generic
behind it. Measured on Ubuntu 24.04.4 + `fonts-noto-cjk`, `'W' × 32` vs
`'i' × 32` (how xterm.js sizes its cell):

| stack | `LANG=C` | `LANG=zh_CN.UTF-8` |
|---|---|---|
| `"No Such Family XYZ", monospace` | 8 / 8 | **11 / 4 — proportional** |
| `"JetBrains Mono", monospace` (absent) | 8 / 8 | **11 / 4 — proportional** |
| `monospace` | 8 / 8 | 7 / 7 |

`verifiedMonoStack` drops leading families until the remainder measures
monospace — performing the cascade step the engine skipped — so an installed
font is kept and an absent one degrades. Measured on the repro host: **9 of 16
mono settings were broken before it, 0 after**, and it is a no-op under
`LANG=C`.

**Two plausible-sounding explanations for this bug were refuted by
measurement**, so do not re-derive them: it is not that `ui-monospace` is
unimplemented on GTK and "wins" the cascade (in a list it is skipped like any
absent family), and it is not the GTK UI font shadowing the stack (setting
`gtk-font-name` changes nothing). `ui-monospace` is still kept out of the Linux
tail in `src/utils/fontStacks.ts` as hygiene — it means nothing there — while
remaining on macOS, where it is the only way to reach SF Mono (`"SF Mono"` and
`SFMono-Regular` do not match by family name; the real family is the hidden
`.SF NS Mono`).

**A font test that measures real fonts asserts nothing on a machine without the
trigger.** The first guard written for this bug did exactly that and passed on
macOS and on CI's Linux WebKit while the bug was live. `verifiedMonoStack`'s
unit test injects the measurement, and its WebKit test constructs the failure
with `sans-serif` — a generic that always resolves and is always proportional —
so it can fail on any engine.

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
| `--workspace-rail-width` | Workspace rail column width | `30px` |
| `--bar-height` | Status bar / universal toolbar height | `40px` |
| `--shell-card-inset` | Gutter around the leading rail+sidebar card | `8px` |
| `--shell-card-radius` | Leading card radius, concentric with the 21px window corner | `13px` |
| `--shell-top-inset` | Top inset a full-height column leaves clear | `0px` |
| `--traffic-lights-zone` | Horizontal space the title bar keeps clear of the window controls | `0px` |
| `--traffic-lights-centre` | The window controls' optical line, which the title bar centres content on | `0px` |
| `--outline-width` | Outline panel width | `200px` |
| `--settings-nav-width` | Settings nav column width (read by Settings.tsx AND SettingsNav) | `13rem` |
| `--table-border-color` | Table borders | `#d5d4d4` |

**Every `--shell-*`, `--traffic-lights-*`, `--workspace-rail-width` and `--bar-height` row above is written by `shellChromeVars()`, not by CSS.** The `:root` values
are static defaults; `App.tsx` overrides them on the shell root from
`src/shell/shellChrome.ts` (`WORKSPACE_RAIL_WIDTH`, re-exported by
`components/WorkspaceRail`, and `SHELL_TOP_INSET`), which stays the source
of truth because the same numbers also feed layout arithmetic in TS —
`shellSideWidth()` in that module is the one definition of the chrome left of
the editor, shared by `App.tsx` and the terminal's sizing. The two
`--traffic-lights-*` values come from `src/shell/trafficLights.ts`.
Change the TS constant, not the CSS.
The `:root` declaration exists so consumers that use the var **without a
fallback** — `title-bar.css` does — still resolve if the shell root has not
applied its override yet.

**`--shell-top-inset` is `0px` off macOS, and that is the point (#1296).**
The chrome strip is mounted, and the traffic lights sit inside the webview, only
where the app overlays the native title bar (`usesOverlayTitleBar()`, true on
macOS alone). The sidebar spacer and the workspace rail's top padding each
hardcoded `28px`, so on Windows and Linux both opened with a gap clearing
buttons that are not there. Consume the var; never write a literal again.

**It is `CHROME_HEIGHT` on macOS, not the height of the lights — the strip is
the binding constraint.** `.title-bar` is `position: absolute; left: 0; right: 0`
over the WHOLE shell and carries `data-tauri-drag-region` on its own root, so it
takes the pointer everywhere it paints, the sidebar and the rail included. At
the old `28` against a 40px strip the sidebar's header buttons ran 36→64px and
their **top 4px were un-clickable**, and a window-drag handle instead. Measured,
not inferred: screenshot at 2×, active button fill y 36.0→63.5pt, strip 0→40pt.
The same 12px stepped the sidebar's first row above the editor's, since the
primary column reserves the full `CHROME_HEIGHT`.

`SHELL_TOP_INSET` is therefore `Math.max(CHROME_HEIGHT, TRAFFIC_LIGHTS_CLEARANCE)`
— either input can bind, and today the strip is taller. That `max` has already
earned its keep: moving the buttons onto Finder's line took the clearance from
23 to 33 and this number did not move.

### The window controls are described in `shell/trafficLights.ts`

Everything about them derives from ONE value — `TRAFFIC_LIGHT_POSITION`, what
`tauri.conf.json` asks AppKit for — so a change to the position carries the
clearances with it:

| Derived | Value | From |
|---|---|---|
| top edge, below the window top | 19pt | `y − 9`, AppKit's standard titlebar inset |
| optical centre (`--traffic-lights-centre`) | 26pt | top + half of the 14pt button |
| downward clearance | 33pt | top + 14pt |
| sideways reach | 78.5pt | `x` + the 59.5pt cluster span |
| `--traffic-lights-zone` | 82pt | reach + 3.5pt of air |

**Why 19/19 and not AppKit's default.** Measured against a live Finder window,
VMark's buttons sat exactly **10.00pt up and 10.00pt left** of where every
native window puts them — on all four measures, so the whole cluster was jammed
into the corner. Finder insets 19pt from both edges, centre 25.75pt (the 0.25 is
antialiasing on a 14pt circle; paper-one measured Finder's centre at 25.8pt
independently). `{x: 19, y: 28}` reproduces it.

**Take TWO measurements before believing a mapping.** A single reading fits
`top = y − 9` and `top = 29 − y` equally well and they disagree about which way
the axis runs; paper-one shipped the wrong sign off one point.

**Three surfaces declare the position and no compiler joins them:**
`tauri.conf.json` (the main window only), `window_manager/mod.rs` (every window
built at RUNTIME — those do not inherit the config's window entry, so a
settings or document window would keep the old position), and
`trafficLights.ts`. `src/shell/trafficLights.test.ts` reads all three and fails
if they disagree, and also fails if the inset is raised without the zone — the
half-change paper-one warns about.

**It needs the `macos-private-api` cargo feature**, without which the position
is ignored SILENTLY. The feature must be spelled out literally in `Cargo.toml`'s
`tauri` dependency line; tauri-build reads that array as manifest text. It also
bars the Mac App Store, which costs nothing while VMark ships Developer ID DMGs.

## Browser Chrome Tokens

A browser frame has to be a **true neutral**. A tinted frame around arbitrary web
content reads as wrong — paper's warm grey `#eeeded`, mint and sepia all do it —
which is why every real browser uses neutral chrome. So the browser surface does
not use the theme's colours; it uses this family, which is white in light themes
and dark in dark ones.

| Token | Light | Dark (`.dark-theme`) |
|---|---|---|
| `--browser-bg-color` | `#ffffff` | `#23262b` |
| `--browser-bg-secondary` | `#f7f7f7` | `#2a2e34` |
| `--browser-bg-tertiary` | `#f1f3f4` | `#32363d` |
| `--browser-text-color` | `#202124` | `#d6d9de` |
| `--browser-text-secondary` | `#5f6368` | `#9aa0a6` |
| `--browser-text-tertiary` | `#80868b` | `#6b7078` |
| `--browser-border-color` | `#dadce0` | `#3a3f46` |
| `--browser-hover-bg` | `rgba(60,64,67,.08)` | `rgba(255,255,255,.08)` |
| `--browser-hover-bg-strong` | `rgba(60,64,67,.12)` | `rgba(255,255,255,.12)` |
| `--browser-accent-bg` | `#e8f0fe` | `rgba(88,166,255,.12)` |
| `--browser-accent-primary` | `#1a73e8` | `#58a6ff` |

**Do not consume these directly.** `shell/app-shell.css` SHADOWS the global names
onto them under `.browser-workspace-active`, so a descendant writes
`var(--bg-color)` as usual and resolves to the browser palette when a browser tab
is focused. That indirection is why 54 consumer sites across four files needed no
change when the dark branch was added. Adding a `--browser-*` read to a component
bypasses the scoping and will apply the browser palette everywhere.

**The terminal is the exception, and it is not CSS.** xterm.js paints a canvas
from a JS `ITheme`, so no custom property reaches it — the chrome went neutral
while the terminal stayed the tinted theme colour, a seam down the full height of
the window. `theme/terminalThemeForBrowser.ts` applies the same rule in JS,
collapsing the terminal to the `white` or `night` theme by `isDark`. The two
neutrals are chosen so the match is **exact**: `--browser-bg-color` equals
`white.color.bg.primary` (`#FFFFFF`) and `night.color.bg.primary` (`#23262b`)
respectively, and `terminalThemeForBrowser.test.ts` pins that equality. Change one
side and you must change the other.

## Focus Mode Tokens

| Token | Purpose | Default |
|-------|---------|---------|
| `--blur-text-color` | Blurred text color | `#c8c8c8` |
| `--blur-image-opacity` | Blurred image opacity | `0.5` |
| `--focus-dim-opacity` | Focus Mode dim level (useTheme.ts overrides) | `1` |
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
| UI font sizes | `--font-size-xs` (11), `--font-size-sm` (12), `--font-size-base` (13), `--font-size-md` (14), `--font-size-lg` (16), `--font-size-xl` (22 — identity/display text, WI-UA13) | UI labels and metadata. **Not** for editor body text — that uses runtime `--editor-font-size*`. 10px (`--font-size-2xs`) was RETIRED outright by the 20260901 re-audit (WI-UB2) — the token, its `text-2xs` Tailwind bridge and all consumers are gone; UI text floors at `xs`. |
| Component dimensions | `--size-icon-xs` (14), `--size-icon-medium` (18), `--size-btn-xs` (20) | Width/height of small icons not covered by `--icon-size-*`. `--size-btn-sm` is gone — a 24px square is `.vm-icon-btn--sm`. |
| Line heights | `--line-height-tight` (1.25), `--line-height-snug` (1.35), `--line-height-base` (1.4), `--line-height-normal` (1.5), `--line-height-relaxed` (1.6) | `line-height` on UI text |
| Letter spacing | `--letter-spacing-tight` (0.3px), `--letter-spacing-loose` (0.5px), `--letter-spacing-caps` (0.5px) | `caps` is THE tracking for every `text-transform: uppercase` micro-label (WI-UA6, pinned by `uiAuditFixes.test.ts`); tight/loose serve non-caps uses |
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
