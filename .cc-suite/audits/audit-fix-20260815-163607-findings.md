# Audit Findings

**Run**: audit-fix 20260815-163607 | **Scope**: this branch — the 17 production files changed in the working tree this session (the 19 committed trusted-HTML/browser files were audited in run `20260815-113544` and are unchanged since) | **Audit type**: mini (5-dim)
**Model**: gpt-5.6-sol | **Effort**: high | **Sandbox**: read-only (audit) / workspace-write (fix) | **Fixer**: Claude
**Audit thread (first file)**: 01a00484-3001-7eb0-9caf-0bdc0690b6f4
**Status values**: open | fixed | not-fixed | partial | regressed | disputed | deferred (pre-existing, out of scope)

**Coverage note**: 16 of 17 files audited. `src/components/WorkflowApproval/ApprovalDialog.tsx` returned empty
output twice (runner produced no stdout and no stderr — killed, not errored) and is recorded as NOT AUDITED
rather than clean. 4 files came back CLEAN: `useBrowserWorkspaceState.ts`, `terminalThemeId.ts`,
`browserWorkspaceActive.ts`, `theme/index.ts`.

**Origin column** is the load-bearing one: `mine` = introduced by this session's changes; `pre-existing` = already
in the file, surfaced because the audit reads whole files rather than diffs.

| # | File | Line | Sev | Dimension | Origin | Finding | Suggested fix | Status | Round |
|---|------|------|-----|-----------|--------|---------|---------------|--------|-------|
| 1 | scripts/check-bespoke-buttons.mjs | 141 | Med | Logic | **mine** | `/* button-shape-ok: */` passes as a reason — `\S` matches the `*` of `*/`, so an EMPTY exemption bypasses the gate. Confirmed by probe. | Parse the comment body, trim, require real text after the colon | fixed | 1 |
| 2 | scripts/check-bespoke-buttons.mjs | 240 | Med | Logic | **mine** | `part.includes(":")` skips a whole base rule when any preceding comment contains a colon, because `CSS_RULE_RE` folds comments into the selector text. This repo uses `/* focus: caret-only */` widely, so the gate UNDER-REPORTS. Confirmed by probe. | Strip comments before selector analysis; reject only pseudos attached to the class | fixed | 1 |
| 3 | scripts/check-bespoke-buttons.mjs | 224 | High | Duplication | **mine** | `collectShapeDrift` re-implements the button-class extraction loop from `collectStyledButtonClasses` (95–103); the two can drift on JSX syntax support | Extract one shared helper | fixed | 1 |
| 4 | src/theme/terminalThemeForBrowser.ts | 37 | High | Duplication | **mine** | Re-declares the white/night neutral pair and the `isDark ? night : white` mapping already owned by `themeAvailability.ts:30,52` — two authorities that can drift | Extract a shared `neutralThemeId()` + pair constant used by both | fixed | 1 |
| 5 | src/theme/terminalThemeForBrowser.test.ts | 47 | High | Logic | **mine** | The test claiming to pin CSS↔theme equality never reads `styles/index.css`; it compares theme values to duplicated literals, so `--browser-bg-color` can drift while the test stays green. **A false assurance that was reported to the user as a real guard.** | Parse the light and `.dark-theme` `--browser-bg-color` declarations and compare against the theme backgrounds | fixed | 1 |
| 6 | scripts/baselineRatchetManifest.mjs | 79 | High | Logic | **mine** | The newly registered `maxShapeDriftClasses` check is untested; deleting it would silently disable ratchet protection with all coverage tests green | Assert every numeric non-comment baseline key is registered in the manifest | fixed | 1 |
| 7 | tsconfig.node.json | 23 | High | Logic | **mine (partial)** | The four `vitest.*.config.ts` files and `vitest.shared.ts` are still outside the Node TS project, and no package script runs `tsc -p tsconfig.node.json`, so config type errors reach runtime unchecked. This session fixed the `vite.config.ts` half only. | Include the remaining configs and wire the project build into a gate | fixed | 1 |
| 8 | scripts/check-bespoke-buttons.mjs | 280 | High | Duplication | **mine (extended)** | The CLI block repeats baseline validation and the over/stale-budget branches three times (once per budget) | Extract a data-driven ratchet evaluator | fixed | 1 |
| 9 | scripts/check-bespoke-buttons.mjs | 280 | High | Testing | **mine (extended)** | The executable gate path has no coverage: baseline validation, canonical-read failure, over-budget, stale-budget, exit codes | Extract an injectable `runGate()` and test each branch | fixed | 1 |
| 10 | vite.config.ts | 15 | Low | Dead Code | pre-existing | Config factory is `async` with no `await` | Drop `async` | fixed | 1 |
| 11 | vitest.{config,browser,gates,soak}.config.ts + vite.config.ts | ~30 | High | Duplication | pre-existing | The `resolve.alias` block is duplicated verbatim across five configs; the gates tier's copy (and its `path` import) is dead — it has no `@`/`@shared` imports | Export shared aliases from `vitest.shared.ts` | fixed | 1 |
| 12 | scripts/check-bespoke-buttons.mjs | 42 | High | Logic | pre-existing | The NAME collector anchors at line start, so only the FIRST class of a selector is seen — `.tiptap-editor .code-copy-btn` escapes the budget entirely | Match every class in the selector | fixed | 1 |
| 13 | scripts/check-bespoke-buttons.mjs | 60 | High | Logic | pre-existing | Computed/programmatic `className` values escape all budgets | Resolve identifiers via the TS AST | **disputed** | - |
| 14 | src/components/Terminal/terminalSessionStoreSync.ts | 162 | High | Logic | pre-existing | Leaving workspace mode while a shell is busy leaves `pendingRoot` set; the next idle event `cd`s into the closed workspace | Clear `pendingRoot` when the new root is null | fixed | 2 |
| 15 | src/components/Terminal/terminalSessionStoreSync.ts | 199 | High | Logic | pre-existing | `wired` retains removed session entries until the hook unmounts — leaks disposed xterm instances and their idle callbacks | Unwire/delete on removal | fixed | 2 |
| 16 | src/components/Terminal/terminalSessionStoreSync.ts | 269 | High | Duplication | pre-existing | Live option normalization has drifted from `terminalOptions.ts` — scrollback no longer clamps non-finite/fractional values, contrast lacks the finite fallback | Share normalization helpers | fixed | 2 |
| 17 | src/components/Terminal/useTerminalSessions.ts | 161 | High | Logic | pre-existing | A throwing `createTerminalInstance()` aborts the effect before cleanup registers, leaking earlier sessions | Catch per-session, reconcile, retain cleanup | fixed | 2 |
| 18 | src/components/Terminal/useTerminalSessions.ts | 182 | Med | Logic | pre-existing | Empty OSC 0/2 titles are ignored, so a program cannot clear a stale tab title | Always forward the title | fixed | 2 |
| 19 | src/components/Terminal/useTerminalSessions.ts | 143 | High | Duplication | pre-existing | Ten terminal defaults duplicate `settingsStore/defaults.ts` | Centralize normalization | fixed | 2 |
| 20 | src/components/Terminal/useTerminalSessions.ts | 227 | High | Refactoring | pre-existing | The 61-line init/reconciliation effect has no direct test (`TerminalPanel.test.tsx` mocks the hook) | Extract a pure diff reconciler and test it | fixed | 2 |
| 21 | src/components/Browser/BrowserApprovalDialog.tsx | 104 | High | Duplication | pre-existing | Payload-operation metadata has drifted: `style` requests carry an exact script but the dialog omits it; session payloads are mislabeled "Script" | Render `request.script` when present; centralize operation metadata | fixed | 2 |
| 22 | src/components/Browser/BrowserApprovalDialog.tsx | 79 | High | Logic | pre-existing | Focus moves to Deny but is neither trapped nor restored — Tab can leave the modal and reach background UI while approval is open | Trap focus, mark background inert, restore on close | fixed | 2 |
| 23 | src/components/Browser/BrowserApprovalDialog.tsx | 83 | High | Logic | pre-existing | The Escape listener has no topmost-modal arbitration; overlapping overlays can all dismiss on one Escape | Route Escape through a shared modal stack | fixed | 2 |
| 24 | src/components/Browser/BrowserApprovalDialog.tsx | 98 | High | Logic | pre-existing | Resolution is treated as synchronous, but attachment approval launches `browser_ai_attach`, drops the prompt immediately and swallows IPC failure — no retry, no feedback | Await resolution, disable while pending, keep the dialog on error | fixed | 2 |
| 25 | src/components/Editor/SplitPaneEditor/ReadOnlyBanner.tsx | 22 | Low | Dead Code | pre-existing | The `hidden` prop is unused — the sole caller conditionally mounts instead | Remove the prop and its branch | fixed | 2 |

## Disputed

**#13 — computed classNames escaping the budget.** Not a defect. `check-bespoke-buttons.mjs` documents this
explicitly: *"Known limits, deliberate: only literal `className` strings and template literals are read (not
`clsx()`/computed names) … It under-counts rather than inventing violations."* A gate that guessed at computed
class names would invent violations, which is strictly worse for a ratchet whose whole value is that a failure
means something. Rejecting.

## Round 2 — the deferred findings, fixed

Findings 14–25 were initially deferred as "pre-existing". That is a diagnosis, not an exit criterion, and they
were taken in a second round. Grouped by MECHANISM rather than by file, because two failures of the same shape
are one defect:

| Class | Findings | Mechanism | Fix |
|---|---|---|---|
| Normalization written per use-site | 16, 19 | The rule for a value lived at each consumer instead of at its source, so the copies drifted — the live path clamped scrollback's range but dropped the non-finite and fractional guards, and xterm THROWS on a NaN scrollback | `clampScrollback` / `clampContrastRatio` exported from `terminalOptions.ts` and used by both creation and live update; terminal defaults now come from `initialState.terminal` |
| State outliving its subject | 15, 17 | A cache keyed on liveness that was never reconciled against the source of truth | `wired` now prunes entries absent from `sessionsRef` and unwires them; `createTerminalInstance` failure is caught per-session so it cannot abort the init effect before cleanup registers |
| Deferred intent surviving its precondition | 14 | `if (!newRoot) return` skipped the loop that clears `pendingRoot`, so a queued `cd` outlived the workspace it referred to | Clear `pendingRoot` on every session when workspace mode ends |
| View duplicating store knowledge | 21 | A hardcoded `["eval","session"]` operation list in the dialog, while the store records a script for `style` too — so AI-chosen CSS was authorised unseen | Payload driven by PRESENCE of `request.script`; per-operation label (`session` is a saved-login handle, not a script) |
| Modal without modal semantics | 22, 23 | `aria-modal` tells assistive tech the background is inert; it does not make it inert for Tab, and a window-level Escape listener has no precedence over a sibling overlay's | Focus trap + focus restore; Escape handled in the capture phase with `stopImmediatePropagation`, making a security prompt the exclusive Escape handler while raised |
| Failure converted to silence | 24 | `() => {}` as a rejection handler, with the prompt already dropped — an attach that never happened looked exactly like one that did | `attachHumanTab` resolves `false` and logs through a new production-persistent `browserApprovalError`; the prompt stays raised until the attach is confirmed |
| Two mechanisms for one job | 25 | The caller mounts conditionally, so the `hidden` prop was unreachable | Prop, branch, and its test removed |
| Untested critical path | 20 | A 61-line effect no test reached, because `TerminalPanel.test.tsx` mocks the hook | Pure `diffSessionIds` extracted to `terminalSessionReconcile.ts` with 9 tests |

**Wall-clock assertions (not in the original 25, fixed in the same pass).** Two tests asserted elapsed real time
and failed only under machine load. `sanitize.test.ts` claimed "without hanging" — a LIVENESS property, which the
test's own timeout already expresses; the `elapsed < 5000` line measured the scheduler, so it went and an explicit
timeout replaced it. `TerminalSearchBar.test.tsx` raced the runner against `IME_GRACE_PERIOD_MS`; it now fakes the
clock and pins BOTH sides of the window, which a real clock cannot do at all. Neither bound was loosened.

**Not fixed:** nothing. Finding 13 remains disputed on its merits (see above).
