# Settings Dialog — Comprehensive Gap Audit (multi-perspective)

**Date:** 2026-06-01
**Status:** Addressed (branch `settings-dialog-gaps`)

> **Resolution (2026-06-01).** All prioritized backlog items P1–P3 were
> implemented end-to-end with tests, i18n across all 10 locales, and website-doc
> sync. Summary:
> - **P1** — D1 platform-gating (`isMac`/`isWindows` helpers); exposed the 3 CJK
>   orphans, `update.checkFrequency`, and `update.autoDownload`.
> - **P2** — `markdown.pasteMode` control; `formats.associations` review/reset
>   surface; global **Reset to Defaults** (About); **settings search** (context +
>   CSS `:has`, panels stay the source of truth).
> - **P3** — deleted dead `image.autoResizeCustom`/`inlineThreshold`; numeric
>   **clamping** at the updater and persist boundary (D4); fixed the `index.css`
>   line-height comment + fallback (C); collapsible focus-on-expand (D5);
>   **focus-mode dim level** (Appearance); terminal **Accessibility** subsection
>   (bell mode + minimum contrast, both live).
> - **Deliberate non-goal** (kept hardcoded per §E anti-bloat): the terminal
>   file-link size cap — the audit itself flagged it "maybe / workflow-dependent".
**Scope:** the whole settings surface — schema (`settingsTypes.ts`), store
(`settingsStore.ts`), the dialog (`src/pages/Settings.tsx` + `src/pages/settings/*`),
and the feature code that consumes settings; plus hardcoded behaviors that *could*
be settings.
**Method:** schema↔UI field diff (every settings field grepped against every panel
and its consumers) + three parallel read-only deep-dives (persistence/migration/
defaults; hardcoded-should-be-settings; dialog UX/a11y/validation), then verification
of high-signal claims. Findings are **calibrated** — a large "keep hardcoded / not a
gap" bucket is recorded on purpose to prevent settings-dialog bloat.

> **TL;DR.** The store↔persistence machinery is genuinely well-built (deep-merge +
> sanitize migration; no undefined-after-upgrade). The real gaps are: a handful of
> **built-but-unexposed** settings, two **dead** settings, a **platform-gating** slip,
> **no settings search**, **no reset-to-default UI**, and inconsistent **input
> validation**. Most "hardcoded constants" should *stay* hardcoded.

---

## A. Built + consumed, but no UI control — the real "catch up" list

These capabilities exist and are read by feature code; the dialog just doesn't expose them.

| Setting | Panel | Consumed by | Gap | Confidence |
|---|---|---|---|---|
| `update.autoDownload` | About → Updates | `useUpdateChecker`, `UpdateIndicator` | Updates exposes only "Automatic updates" (`autoCheckEnabled`) + "Check Now" — **no auto-download toggle** | High |
| `update.checkFrequency` | About → Updates | `useUpdateChecker` | **No control** for how often to check | High |
| `cjkFormatting.contextualQuotes` | Language (CJK) | `cjkFormatter/rules/applyRules.ts` | Curly-for-CJK / straight-for-Latin — absent from the CJK panel | High |
| `cjkFormatting.quoteToggleMode` | Language (CJK) | `toolbarActions`, `cjkFormatter/quoteToggle.ts` | Simple (2-state) vs full-cycle (4-state) quote toggle — not exposed | High |
| `cjkFormatting.skipReferenceSections` | Language (CJK) | `cjkFormatter/markdownParser.ts`, `formatter.ts` | "Skip `## References`/`## Further Reading`" — not exposed | High |
| `markdown.pasteMode` | Markdown | `smartPaste`, `codePaste`, `markdownPaste` plugins | smart/plain/rich clipboard handling is **read but set by nothing** (no row, no menu) → locked to default | High — **verify intent** (menu vs setting) |
| `formats.associations` | Formats | formats `registry`/`formatSettingsBridge`/`formatCommands` | per-extension→editor map; **no dialog surface** to view/reset | Med — **verify intent** (likely context-menu "Open with") |

`LanguageSettings.tsx` already renders ~25 CJK toggles (smartQuote, emdash, …) — the
three CJK orphans were simply never added to that panel (clean, low-risk additions).

---

## B. Dead / incomplete settings — NOT exposure gaps (cleanup, not "add a row")

Stored, typed, but consumed **nowhere** — exposing UI would be inert:

- `image.autoResizeCustom` — `imageResize.ts` reads only `autoResizeMax`, and the
  panel's options are fixed presets (off/800/1200/1920/2560) with **no "custom"
  choice** → the custom-px path is unimplemented. (`FilesImagesSettings.tsx:209`,
  `services/media/imageResize.ts:18`.)
- `image.inlineThreshold` — referenced nowhere in the codebase.

→ Either wire them up or delete them; this belongs in a dead-code pass, not the dialog.

---

## C. Persistence / migration / defaults — mostly healthy, two minor items

**Healthy (verified, no action):**
- Zustand `persist` → localStorage key `vmark-settings`, `version: 1` with a `migrate`
  callback, a `sanitizePersistedSettings` zero-trust pass, and a **`deepMerge`** so
  new nested fields get their defaults on upgrade. No undefined-after-upgrade risk —
  proven by `settingsStore.fault.test.ts` (e.g. a blob missing the whole `terminal`
  section still yields `terminal.position === "auto"`). A `paragraphSpacing → blockSpacing`
  rename migration exists. This is well-engineered.

**Minor:**
- **Defaults-comment drift (Low):** store default `appearance.lineHeight = 1.8`
  (`settingsStore.ts:141`) but CSS `:root --editor-line-height: 1.6`
  (`index.css:128`) with a comment claiming "Defaults match settingsStore … lineHeight=1.6"
  — the comment is **wrong** (store is 1.8). Runtime is correct (`useTheme.ts` applies
  1.8); only the pre-hydration/print fallback differs. Fix the comment (and optionally
  align the CSS fallback to 1.8).
- **Settings are global, not per-window** (`settingsStore.ts:22`) — intentional today,
  but worth noting if per-document overrides are ever wanted.

---

## D. Dialog UX / accessibility / validation

Shell: `src/pages/Settings.tsx` — 10 categories + a hidden **Advanced** (Ctrl+Opt+Cmd+D).

| # | Finding | Sev | Detail |
|---|---|---|---|
| D1 | **Platform-gating slip** | **Med** | `macOptionIsMeta` and `shellIntegration` render on **all platforms** (`TerminalSettings.tsx:218-230`), unlike `clearMacQuarantineOnOpen` which is correctly `{isMac && …}`. Nuance: `macOptionIsMeta` is genuinely **macOS-only** (gate to `isMac`); `shellIntegration` is **Unix/zsh** (hide on Windows, keep on Linux) — not a blanket `isMac`. |
| D2 | **No settings search** | Med | ~120 settings across 11 panels, no keyword filter. Finding `historyMaxAgeDays` or `cjkEnglishSpacing` requires knowing the category. A search box over SettingRow titles/descriptions would help discoverability. |
| D3 | **No reset-to-default in UI** | Med | `resetSettings()` exists in the store but is **never exposed** (test-only). No global or per-category reset, no import/export. A bad state can only be fixed by clearing localStorage. |
| D4 | **Validation only via presets** | Low | All numeric inputs are preset dropdowns (safe from typed garbage) — good. But store updaters don't validate, so a manual localStorage/devtools value (e.g. `fontSize: 999`) is accepted and renders broken. Only `terminal.scrollback` is defensively clamped (added in the recent terminal audit); the pattern is inconsistent. Consider clamping in the section updaters. |
| D5 | **Collapsible focus** | Low | Expanding a `SettingsGroup` leaves focus on the chevron button rather than moving to the first revealed control (`components.tsx:334-353`). |

**a11y is otherwise solid:** focus rings on Toggle/Select/inputs (rule 33), `role="switch" aria-checked`, `aria-labelledby`/`aria-describedby` wired via `SettingRow`. No focus trap (intended).

---

## E. Hardcoded behaviors that *could* be settings — calibrated (mostly: don't)

A sweep found ~40 hardcoded constants. **The honest answer is that almost all should
stay hardcoded** — exposing timing/debounce/physics constants as settings is bloat,
a maintenance burden, and a support-surface, with little real user demand. Calibrated:

**Worth considering (a small, coherent cluster — accessibility/visual prefs):**
- **Terminal bell mode** (audible/visual/off) — currently activity-indicator only (the descoped G10 from the terminal audit). A real preference for some users.
- **Terminal `minimumContrastRatio`** (`createTerminalInstance.ts:166`, fixed 4.5/WCAG-AA) — an *accessibility* knob (raise to 7.0 / lower to 3.0). Pair it with bell mode under a Terminal "Accessibility" subsection.
- **Focus-mode blur opacity** (`focus-mode.css`, fixed 0.3) — a visual preference; a slider fits Appearance → Focus Mode.
- **Terminal file-link size cap** (`setupFileLinks.ts:31`, 10 MB) — *maybe*; workflow-dependent.

**Keep hardcoded (do NOT expose — recorded so they're not re-litigated):**
all debounce/timing constants (resize 100 ms, search 150/200 ms, outline 250 ms,
autosave floor 1 s + 5 s debounce, IME dedup 150 ms, quit-feedback 2 s, tab-drag
physics, sidebar-resize step); the 5-session terminal cap; PTY flow-control watermarks;
all IPC/protocol/memory-safety caps (`CALLBACK_BYTE_LIMIT`, `MAX_DIR_ENTRIES`,
content-search/workflow limits, network timeouts); fuzzy-match scoring; file-size
tiers (already covered by `largeFile.*`). These are internal correctness/perf tuning —
"a power user might want to change it" is not sufficient justification.

---

## F. Consistency notes

- **`copyOnSelect` exists twice** — `markdown.copyOnSelect` (editor) and
  `terminal.copyOnSelect` (terminal). Two genuinely separate features, so two settings
  is defensible, but the identical name across panels can confuse; labels already
  disambiguate (Markdown vs Terminal panel). Low.
- **CJK panel density** — `LanguageSettings` carries ~25 CJK toggles in 4 collapsible
  groups. Well-grouped, but a candidate for a dedicated "CJK Formatting" sub-page if it
  grows further. Suggestion only.

---

## Prioritized backlog

| Pri | Item | Bucket |
|---|---|---|
| **P1** | D1 — gate `macOptionIsMeta` (isMac) and `shellIntegration` (non-Windows) | UX bug |
| **P1** | A — expose the 3 CJK orphans + update `autoDownload`/`checkFrequency` (clean, capability already built) | Exposure |
| **P2** | A — decide `pasteMode` (setting vs menu) and `formats.associations` (dialog surface vs context-menu) — **needs an intent decision before building** | Exposure (verify) |
| **P2** | D3 — "Reset to defaults" button (global; optionally per-group) wired to existing `resetSettings()` | UX feature |
| **P2** | D2 — settings search/filter | UX feature |
| **P3** | E — Terminal "Accessibility" subsection (bell mode + contrast); focus-mode blur slider | Promote-to-setting |
| **P3** | B — delete or wire `autoResizeCustom` + `inlineThreshold` | Dead-code |
| **P3** | C — fix the `index.css` lineHeight comment (and align fallback); D4 clamp in updaters; D5 collapsible focus | Polish |

### Explicit non-goals (anti-bloat)
Do **not** turn debounce/timing/physics/IPC/safety constants (§E "keep hardcoded")
into settings. The dialog already has ~120 controls; growth should be justified by
real preference demand, not "it's a constant."
