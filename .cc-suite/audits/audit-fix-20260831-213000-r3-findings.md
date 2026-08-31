# Audit Findings — Round 3 (of 3)

**Run**: audit-fix 20260831-213000 | **Scope**: the files touched by round 2 (`.cc-suite/audits/audit-fix-20260831-211200-r2-findings.md`) | **Audit type**: mini (5-dim), 3 batches
**Model**: gpt-5.6-sol | **Effort**: medium | **Sandbox**: read-only (audit), Claude fixer
**Verification**: the Codex verify call STALLED (thread 01a05815-285b-7c20-8604-958c13916f91, no output; per the skill, a stalled call is not retried). Fallback: Claude evidence-based verification — every production edit spot-checked present in the tree, every fix's pinned test run green, plus `check:predelta` 41/41 and a full `pnpm check:all` green (36,825 passed | 1 expected fail | 82 skipped).
**Status values**: open | fixed | not-fixed | partial | regressed | skipped (deferred, justified)

Round-1/round-2 deferred items were listed in the audit preamble as known.
Batch 2 nevertheless re-surfaced the deferred **transfer state machine** class
(5 High findings at workspaceWindowActions.ts:41/115/178/190/250 — mid-move
mutation freeze, atomic claim/commit protocol, Rust ack-route retention,
target-side rollback, cancellation race). All five need the Rust-side transfer
protocol redesign that round 1 recorded as deferred; same disposition here,
not new work items. Every other batch-2 file was CLEAN.

| # | File | Line | Severity | Dimension | Finding | Fix applied | Status | Round |
|---|------|------|----------|-----------|---------|-------------|--------|-------|
| R3-1 | src/stores/uiStore/terminalSlice.ts | 195 | Medium | correctness | `terminalRemoveSession` assigned its fallback `activeSessionId` directly, bypassing `withActiveSession` — an activated fallback kept a stale activity dot | removal now applies the fallback through `withActiveSession` (D-T11); regression tests in `terminalSlice.scope.test.ts` | fixed | 3 |
| R3-2 | src/stores/tabStoreClosedScopes.ts | 88 | High | correctness | `isValidClosedEntry` accepted incomplete tabs (no title/isPinned/formatId/automationMode/persistPolicy) that reopen restores VERBATIM into tabStore | full per-kind required-shape + enum validation; moved to NEW `tabStoreClosedScopesValidation.ts` (file-size split, `ClosedTabEntry` re-exported); per-field rejection tests | fixed | 3 |
| R3-3 | src/stores/tabStoreClosedScopes.ts | 112 | Medium | correctness | the canonical URL was computed for validation then DISCARDED — noncanonical persisted spellings bypassed the live creation invariant | `normalizeAcceptedEntry` rewrites the URL to canonical at acceptance; pinned by test | fixed | 3 |
| R3-4 | src/stores/tabStoreClosedScopes.ts | 206 | Medium | correctness | hydration accepted scope keys for nonexistent/cross-window instances — unreachable history retained and re-persisted forever | scope-key whitelist (window-all, browser, THIS window's instance ids — same restore ordering R2-F16 relies on); test + fixtures seeded | fixed | 3 |
| R3-5 | src/stores/tabStoreClosedScopes.ts | 267 | Low | dead-code | `removeWindowClosedScopes` had tests but zero production callers | wired into `windowCloseFlow.ts` teardown beside tabStore/paneStore `removeWindow` | fixed | 3 |
| R3-6 | src/stores/tabStoreClosedScopes.test.ts | 180 | Medium | test-coverage | hydration fixtures were themselves malformed Tabs, institutionalizing the incomplete validation | `doc()`/`browserTab()`/`docEntry()`/`webEntry()` now build complete typed shapes; rejection cases added per missing field | fixed | 3 |
| R3-7 | src/stores/tabStoreClosedScopes.test.ts | 200 | Medium | test-coverage | hydration tests used `wsi-a`/`wsi-b` without creating instances, so orphan-scope acceptance was undetectable | affected describes seed real instances; explicit ghost-scope rejection test | fixed | 3 |
| R3-8 | src/components/WorkspaceRail/WorkspaceRail.tsx | 145 | High | correctness | claim: a genuine outside-viewport drag ends with `dropEffect === "none"`, so the cancel guard may suppress the move-to-new-window gesture | — deferred: the guard predates this plan train (0.8.10-era audit fix for Esc-cancel-treated-as-move); whether a real outside drag reports "none" in Tauri WebKit is only decidable by a LIVE drag test, and removing the guard risks regressing the documented cancel bug. Needs manual/e2e verification before any change | skipped (deferred, justified) | 3 |
| R3-9 | e2e/lib/rail.mjs | 68 | High | correctness | deleting the persisted key cannot reset the LIVE store — the storage-event reconciler deep-merges, so the journey's forced value survived (confirmed against `reconcile.ts`) | absent-key restore now pushes the shipped default (`false`) through the event FIRST, then deletes the key | fixed | 3 |
| R3-10 | src/components/WorkspaceRail/workspaceRailHandlers.ts | 39 | Medium | correctness | service rejections escaped the void-fired handlers — unhandled rejection, no failure toast | all three handlers catch, log via `workspaceError`, and toast (`toast.workspaceCloseFailed` added to all 10 locales); rejection tests | fixed | 3 |
| R3-11 | src/components/WorkspaceRail/WorkspaceRail.tsx | 56 | Low | correctness | disabling the rail kept `menu` state — re-enabling resurrected a stale context menu | render-time guarded `setMenu(null)` before the early return; toggle-while-open test | fixed | 3 |
| R3-12 | src/components/WorkspaceRail/workspaceRailHandlers.ts | 42 | Low | test-coverage | the close busy/cancelled/missing toast policy had no assertions | NEW `workspaceRailHandlers.test.ts`: table-driven policy + rejection paths for all three handlers | fixed | 3 |

Incidental (consequence of R3-2): `tabStoreClosedScopes.ts` crossed the
300-line gate → validation extracted to `tabStoreClosedScopesValidation.ts`;
a type-only back-import tripped dependency-cruiser's `no-circular`, so
`ClosedTabEntry` is defined in the validation module and re-exported.

Batch-3 CLEAN files: visibleTerminalSessions.ts, the four new terminal test
files, TerminalPanel.tsx, settingsPatch.mjs (aside from R3-9's pairing).
Batch-1 CLEAN files: terminalScopeActions.ts, types.ts, terminalScopeActions.test.ts.
