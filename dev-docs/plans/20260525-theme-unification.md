# Theme & Token Unification

> **Status**: Phase 0 (spike) | **Date**: 2026-05-25 | **Owner**: hands-off automated workflow
>
> **Scope**: comprehensive — Option B (delete `terminalTheme.ts.ansiPalettes`, terminal becomes pure `ThemeTokens` consumer); merge `terminal.fontSize`/`terminal.lineHeight` into editor settings; gitignored screenshot harness.

## Problem

Adding a new theme to vmark today requires editing **three** places, and the typed `ThemeTokens` contract from ADR-014 silently doesn't include the terminal:

| Layer | Source of truth | Needs editing |
|-------|----------------|---------------|
| Theme catalog (5 themes) | `settingsStore.ts` `themes` const | ✗ |
| Dark-mode overrides | `useTheme.ts` | ✗ |
| Terminal ANSI palette | `terminalTheme.ts` `ansiPalettes` | ✗ |
| Typed contract | `src/theme/tokens.ts` (ADR-014 foundation) | not wired |

ADR-014 promised "reskin = implement a new `ThemeTokens`, regenerate, done." Currently false — the typed structure exists alongside the legacy runtime path, and terminal colors aren't in the typed structure at all.

## Goal

**One typed source of truth.** Adding a new theme means implementing `ThemeTokens` exactly once. Removing a theme means deleting one file. Terminal, editor, and app chrome all flow from the same active theme value.

## Target structure

```
src/theme/
├── tokens.ts                 # ThemeTokens type — extended with terminal/ansi
├── themes/
│   ├── white.ts             # ThemeTokens implementation
│   ├── paper.ts             # ThemeTokens implementation
│   ├── mint.ts              # ThemeTokens implementation
│   ├── sepia.ts             # ThemeTokens implementation
│   └── night.ts             # ThemeTokens implementation
├── applyTheme.ts            # writes CSS vars to :root (existing)
├── buildXtermTheme.ts       # reads from active ThemeTokens, builds ITheme
├── cssVars.ts               # (existing) flatten ThemeTokens → CSS var map
└── index.ts                 # barrel
```

- `settingsStore.themes` const becomes a re-export of `src/theme/themes/*` (consumer API preserved).
- `terminalTheme.ts` deleted; `buildXtermTheme()` moves to `src/theme/`.
- `useTheme.ts` becomes a thin React adapter — `useEffect(() => applyTheme(active, root))`. No more dark-mode override branch.
- `settingsStore.terminal.fontSize` / `terminal.lineHeight` removed; the editor's `appearance.editorFontSize` / `editorLineHeight` cover both surfaces.

## Phases

### Phase 0 — Spike: paper-theme end-to-end probe

**WI-0.1** Author one complete `ThemeTokens` for `paper`, including a `terminal` block that mirrors `terminalTheme.ansiPalettes.paper`. Save as `dev-docs/grills/theme-unification-2026-05/paper-probe.ts`.

**WI-0.2** Build a side-by-side proof: write a small script that builds the xterm `ITheme` two ways (current `buildXtermTheme()` vs new typed-path) and asserts every field is byte-identical.

**DoD**: probe script exits 0; no visual change expected.

### Phase 1 — Extend the typed contract (no behavior change)

**WI-1.1** Add `terminal: { ansi: AnsiPalette, cursor, cursorAccent, selectionBackground, scrollbar: { idle, hover, active } }` to `ThemeTokens`.

**WI-1.2** Create `src/theme/themes/{white,paper,mint,sepia,night}.ts`, each a `ThemeTokens` value backfilled from the legacy `themes` const + `ansiPalettes` table (mechanical copy).

**WI-1.3** Update `applyTheme.ts` to write the new terminal CSS vars (`--terminal-cursor`, `--terminal-scrollbar-idle`, etc.). The 16 ANSI colors stay out of CSS for now (xterm reads them via JS, not CSS).

**WI-1.4** Add `applyTheme` tests: theme switch writes every expected var; type check fails if any theme is incomplete.

**DoD**: `pnpm tsc --noEmit` clean; existing terminal renders unchanged; `pnpm vitest run src/theme` green.

### Phase 2 — Migrate terminal to read from typed tokens

**WI-2.1** Create `src/theme/buildXtermTheme.ts`. Reads from the active `ThemeTokens`, composes `ITheme`.

**WI-2.2** Update `src/components/Terminal/createTerminalInstance.ts` + `useTerminalSessions.ts` to import from `@/theme` instead of `./terminalTheme`.

**WI-2.3** Delete `src/components/Terminal/terminalTheme.ts` and its `ansiPalettes` const. Keep `terminalTheme.test.ts` updated to exercise the new path.

**WI-2.4** Update test mocks (30+ files mock `appearance: { theme: ... }` — most will work unchanged because they go through `useSettingsStore`).

**WI-2.5** Regression test: snapshot the `ITheme` output for each of 5 themes; assert no field changed vs the pre-migration baseline (captured in Phase 0).

**DoD**: terminal renders pixel-identical on all 5 themes; full vitest run green.

### Phase 3 — Migrate `settingsStore.themes` and `useTheme.ts`

**WI-3.1** Replace `settingsStore.ts` `themes` const with `export { themes } from "@/theme"`. Add `themes` barrel export to `src/theme/index.ts` (built from `themes/*.ts`).

**WI-3.2** Migrate `useTheme.ts` dark-mode override block into the `night` theme's `ThemeTokens` directly. Remove the conditional branch.

**WI-3.3** Reduce `useTheme.ts` to: read `appearance.theme` → look up `ThemeTokens` → call `applyTheme(theme, root)`. The font-size / line-height / dynamic editor variables stay where they are (those aren't theme-bound).

**WI-3.4** Settings UI: theme picker reads `Object.keys(themes)` — verify still works post-rewrite.

**WI-3.5** Merge `settings.terminal.fontSize` → `settings.appearance.editorFontSize` consumer. Merge `terminal.lineHeight` → editor's. Add a persist migration to copy old values forward.

**DoD**: theme switching at runtime works on all 5 themes for app + terminal + editor; settings persist test confirms migration of terminal font/lineHeight.

### Phase 4 — Collapse `index.css` (T04 from requirements brief)

**WI-4.1** Audit `src/styles/index.css`: every CSS var that has a `useTheme.ts` runtime override moves to `ThemeTokens` (most already do via Phase 3). Statics (`--space-*`, `--radius-*`, `--font-size-*`, `--duration-*`) stay.

**WI-4.2** Remove alias chains. Pick one canonical name per concept (`--bg-color` over `--bg-primary`, `--space-1` over `--spacing-1`) and rewrite consumers via codemod.

**WI-4.3** Optional: split `index.css` into `src/styles/{primitives.css, reset.css, animations.css}`. The dynamic layer comes from `applyTheme.ts` writes.

**WI-4.4** Screenshot harness: `scripts/screenshot-themes.mjs` (Tauri-driven; or simple HTML page in `dev-docs/baselines/` rendered by playwright). Output: 5 PNGs (one per theme) in `dev-docs/baselines/` — **gitignored**. Document the regenerate workflow in `dev-docs/baselines/README.md`.

**DoD**: pre/post `index.css` diff = 0 pixels in screenshot baseline; `.gitignore` covers `dev-docs/baselines/*.png`.

### Phase 5 — Adding-a-theme test (the real acceptance criterion)

**WI-5.1** Add a 6th theme (`high-contrast` or `solarized-dark`) by implementing `ThemeTokens` once in `src/theme/themes/`. Verify zero edits to `settingsStore.ts`, `useTheme.ts`, `index.css`.

**WI-5.2** CI guard: a script that fails if a theme-name string (`paper`, `mint`, etc.) appears outside `src/theme/themes/` or `settings.appearance.theme` enum. Optional — defer if time-bound.

**DoD**: 6th theme works end-to-end (app + editor + terminal) with no edits outside `src/theme/themes/`.

## Verification gates

Per phase:
- `pnpm tsc --noEmit` clean
- `pnpm lint:deps` 0 errors
- `pnpm vitest run` green
- `cargo test --lib` green
- Visual QA: open `dev-docs/css-reference.md` in vmark for each theme; toggle source/wysiwyg; open a terminal; confirm no visual regression

## Risk + rollback

| Risk | Mitigation |
|------|-----------|
| ANSI palettes have invisible visual constraints I'll regress on | Phase 0 spike asserts byte-identical `ITheme` output before migration |
| Test mocks fan-out: 30+ files mock `appearance.theme` | Phase 2.4 quantifies; most go through `useSettingsStore.getState()` so they should be unaffected. Worst case: test churn |
| Terminal font/lineHeight merger breaks user preferences | Phase 3.5 includes a persist-store migration that copies `terminal.fontSize` → `appearance.editorFontSize` on first load if the latter is unset |
| Removing alias chains breaks third-party CSS in user content | Audit `index.css` consumers; deprecated aliases stay for one release with a comment |

Each phase is independently revertable. Phase 0 is non-destructive (adds dead code). Phase 5 is additive only.

## Open decisions resolved (per /hands-off input)

1. **Scope**: complete, comprehensive (Option B — delete `terminalTheme.ts`)
2. **Settings unification**: merge terminal font/lineHeight into editor settings (one knob for both)
3. **Screenshot harness**: gitignored PNGs in `dev-docs/baselines/`
4. **Plan home**: this file, under `dev-docs/plans/`

## Coordinates with

- **ADR-014** (theme tokens as typed data) — this plan completes ADR-014 by wiring the typed foundation as the runtime source of truth.
- **T04** from the design-team requirements brief (token collapse) — Phase 4 fulfills T04.
- **T01** (doc counts refresh) — `architecture.md` and `design-system.md` token counts need re-counting after Phase 4.
- **.claude/rules/31-design-tokens.md** — that rule's "Source of truth: `src/styles/index.css`" line moves to "Source of truth: `src/theme/`" after Phase 3.
