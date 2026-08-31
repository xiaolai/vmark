# Audit Findings — Round 2 (of 3)

**Run**: audit-fix 20260831-211200 | **Scope**: the ~22 files touched by round 1 (`.cc-suite/audits/audit-fix-20260831-190500-findings.md`) | **Audit type**: mini (5-dim), 4 batches
**Model**: gpt-5.6-sol | **Effort**: medium | **Sandbox**: read-only (audit), Claude fixer
**Verify thread**: 01a057f5-5075-70f3-9896-5a2f0f3d2055 — all 15 fixes verdicted FIXED, REGRESSIONS: none
**Status values**: open | fixed | not-fixed | partial | regressed | skipped (deferred, justified)

Round-1 deferred items were listed in the audit preamble as known; only NEW findings appear here.

| # | File | Line | Severity | Dimension | Finding | Fix applied | Status | Round |
|---|------|------|----------|-----------|---------|-------------|--------|-------|
| R2-1 | src/services/terminal/createTerminalSession.ts | 25 | High | test-coverage | `canCreateTerminalSessionHere` / `createTerminalSessionInScope` parity has no direct tests | NEW `createTerminalSession.test.ts`: owner-stamping carve-outs + predicate⇔action parity across plain/hidden-scope/window-scoped/unscoped states | fixed | 2 |
| R2-2 | src/services/terminal/closeTerminalSession.ts | 36 | High | test-coverage | `onlyIfVisible` refusal, last-visible hide, no-resurrect untested directly | NEW `closeTerminalSession.test.ts` (6 tests incl. hidden-scope fallback pick) | fixed | 2 |
| R2-3 | src/services/terminal/terminalCdFollow.ts | 33 | High | test-coverage | unknown-session branch untested in either rail mode | NEW `terminalCdFollow.test.ts` (unknown-id both modes, stamps inert rail-off, check-time owner resolution) | fixed | 2 |
| R2-4 | src/services/terminal/revealTerminalSession.ts | 46 | High | test-coverage | stale-hidden-active fallback (#18) untested | NEW `revealTerminalSession.test.ts` (5 tests incl. fallback activation + cap null) | fixed | 2 |
| R2-5 | src/stores/uiStore/terminalScopeActions.ts | 58 | Medium | duplication | smallest-unused-ordinal loop duplicated with `nextTerminalOrdinal` | shared `smallestUnusedOrdinal()` exported from terminalSlice, both callers use it | fixed | 2 |
| R2-6 | src/stores/uiStore/terminalScopeActions.ts | 75 | Medium | duplication | `withActivation` re-implements `terminalSetActiveSession`'s activity-clear transition | shared `withActiveSession()` in terminalSlice; slice action + all scope actions use it | fixed | 2 |
| R2-7 | src/stores/uiStore/terminalScopeActions.ts | 87 | Low | size-debt | scope-actions factory growing | — deferred: adjacent to round-1 deferred size class; file is under the gate | skipped (deferred, justified) | 2 |
| R2-8 | src/stores/tabStoreClosedScopes.ts | 134 | High | correctness | unowned-tab fallback records history under a PLACEHOLDER-active id; placeholder eviction orphans it | fallback skips placeholder actives → `WINDOW_ALL_SCOPE`; regression test | fixed | 2 |
| R2-9 | src/stores/tabStoreClosedScopes.ts | 209 | High | correctness | hydration adds ids to `seenIds` BEFORE the cap, so an id capped out of scope A is suppressed from every later scope (exposed by round 1's sort fix) | dedup moved to acceptance time (only surviving entries enter `seenIds`); 3 regression tests | fixed | 2 |
| R2-10 | src/services/workspaces/finalizeInstanceRemoval.ts | 40 | High | test-coverage | the shared removal lifecycle has no focused tests | NEW `finalizeInstanceRemoval.test.ts`: table-driven close/move dispatch, placeholder/empty-window invariants, active-only hydration | fixed | 2 |
| R2-11 | src/services/workspaces/switchWorkspaceInstance.ts | 48 | Low | dead-code | `sanitizeSplitForInstance` re-export has no production importer | re-export removed; test imports `./restoreInstanceContext` directly | fixed | 2 |
| R2-12 | src/services/workspaces/closeWorkspaceInstance.ts | 113 | Medium | clarity/UX | convergence bound is a bare `5`; `busy` result discarded silently by the rail caller | `MAX_CLOSE_CONVERGENCE_PASSES` named + documented; exhaustion test; rail toasts `busy` (`toast.workspaceCloseBusy` added to all 10 locales) | fixed | 2 |
| R2-13 | src/services/workspaces/closeWorkspaceInstance.ts | 90 | Low | size-debt | extract the convergence loop | — deferred: function is cohesive and under repo norms; extraction is churn without a defect | skipped (deferred, justified) | 2 |
| R2-14 | src/services/workspaces/workspaceWindowActions.ts | 29 | High | correctness | `closing` and `transferring` are SEPARATE sets — a close can start during a move's ack wait (and vice versa) on the same instance | NEW `instanceOperationLock.ts` (one per-instance lock across close/move/duplicate); cross-operation exclusion tests | fixed | 2 |
| R2-15 | src/components/Terminal/TerminalPanel.tsx | 96 | High | correctness | rail-MODE toggle is not an auto-create dependency and nothing realigns the active session — a hidden active over an empty tab bar blocks auto-create | `terminalRealignActive` store action + `realignTerminalActiveToVisible` service; effect deps now `[visible, activeInstanceId, railEnabled]`, realign before auto-create; action + component tests | fixed | 2 |
| R2-16 | e2e/lib/rail.mjs | 46 | Medium | correctness | restore writes `before ?? false` — an ABSENT key comes back as explicit `false`, shadowing future default changes | presence-faithful restore: `patchPersistedSettings` gains `deleteKeys`; `clearRailMode()` deletes when the key was absent | fixed | 2 |
| R2-17 | e2e/lib/rail.mjs | 46 | High | correctness | restore errors swallowed (`.catch(() => {})`) — a failed restore leaves the profile flipped silently (hit live in round 1) | restore failure rethrows when the body succeeded; logged (not masking) when the body already failed | fixed | 2 |

Incidental (consequence of R2-12's fix): `WorkspaceRail.tsx` crossed the 300-line
gate → close/move/duplicate handlers extracted to
`src/components/WorkspaceRail/workspaceRailHandlers.ts` (behavior unchanged;
rail tests green).

Verification battery already run: 9 direct test files (104 tests), dependent
files (209 tests), `pnpm test:changed` (65 files / 1,237 tests), i18n gate,
`pnpm check:predelta` 41/41 green.
