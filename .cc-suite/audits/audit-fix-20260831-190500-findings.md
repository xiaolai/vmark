# Audit Findings

**Run**: audit-fix 20260831-190500 | **Scope**: uncommitted changes (terminal-scoping plan + pill/tab UI, 36 files) | **Audit type**: mini
**Model**: gpt-5.6-sol | **Effort**: high | **Audit threads**: 01a05769-9cdb-7f81-9e20-26bc21eebd8d (b1); b2a/b2b/b3a per job logs; b3b+b4 stalled → Claude fallback
**Status values**: open | fixed | not-fixed | partial | regressed | skipped (severity filter) | skipped (user stop)

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Status | Round |
|---|------|------|----------|-----------|---------|---------------|--------|-------|
| 1 | src/stores/uiStore.ts | 203 | Low | Logic | Comment says 50% cap; TERMINAL_MAX_RATIO is 0.8 | Fix comment | fixed | 1 |
| 2 | src/stores/uiStore/terminalSlice.ts | 71 | High | Duplication | creationUnion reimplements the scope-visibility predicate (also in terminalScopeSelectors + terminalScopeActions) | One shared pure predicate | fixed | 1 |
| 3 | src/stores/uiStore/terminalSlice.ts | 210 | Medium | Shortcuts | Title sanitization strips only C0+DEL; C1 and bidi controls pass through | Strip C1 + bidi controls too | fixed | 1 |
| 4 | src/stores/uiStore/terminalScopeActions.ts | 31 | High | Duplication | visibleIn/renumber duplicate the visibility rule | Reuse shared predicate | fixed | 1 |
| 5 | src/stores/uiStore/terminalScopeSelectors.ts | 37 | Low | Dead Code | selectVisibleSessionCount has no production caller | Use it at production count gates (canOpenTerminalHere) | not-fixed (deferred — see report) | 1 |
| 6 | src/stores/workspaceInstancesStore.ts | 94 | High | Logic | ID-accepting placeholder/loose paths don't reject IDs owned by another instance (pre-existing) | Needs a design decision (reject vs reconcile) | not-fixed (deferred — see report) | 1 |
| 7 | src/stores/workspaceInstancesStore.ts | 118 | High | Debt | ensureLooseInstance 109-line action (pre-existing) | Extract pure reducer | not-fixed (deferred — see report) | 1 |
| 8 | src/stores/workspaceInstancesStore.ts | 180 | High | Duplication | Placeholder filtering duplicates applyAddWorkspaceInstance/removePlaceholdersFromWindow (pre-existing) | One placeholder-removal helper | not-fixed (deferred — see report) | 1 |
| 9 | src/stores/workspaceInstancesStore.ts | 218 | High | Logic | Rekey fan-out omits tabStoreClosedScopes — closed history orphaned under old id; publishes before dependent rekeys | Add closed-scopes rekey follower | fixed | 1 |
| 10 | src/stores/workspaceInstancesStore/helpers.ts | 106 | High | Logic | Same-ID placeholder→real corrupts state: id filtered from membership then record deleted (pre-existing, moved verbatim) | Exclude incoming id from placeholder eviction; regression test | fixed | 1 |
| 11 | src/stores/workspaceInstancesStore/helpers.ts | 77 | Medium | Debt | applyAddWorkspaceInstance >30 lines (pre-existing) | Split into pure helpers | not-fixed (deferred — see report) | 1 |
| 12 | src/stores/tabStoreClosedScopes.ts | 80 | High | Logic | isValidClosedEntry validates a subset of Tab; malformed persisted entries reach tabStore (pre-existing) | Validate full discriminated schema | not-fixed (deferred — see report) | 1 |
| 13 | src/stores/tabStoreClosedScopes.ts | 195 | Medium | Logic | Hydration slices before sorting; reordered payload keeps wrong entries (pre-existing) | Sort by closedSeq desc before cap | fixed | 1 |
| 14 | src/stores/tabStoreClosedScopes.ts | 207 | Medium | Logic | closedSeq near MAX_SAFE_INTEGER breaks monotonic nextSeq (pre-existing) | Reject entries without safe headroom | fixed | 1 |
| 15 | src/stores/tabStoreClosedScopes.ts | 222 | Medium | Dead Code | removeWindowClosedScopes has no production caller (pre-existing; known in plan) | Wire into window teardown or remove | not-fixed (deferred — see report) | 1 |
| 16 | src/services/terminal/terminalCdFollow.ts | 29 | High | Logic | Rail-off early return treats an unknown/removed session as followable | Lookup first; absent → false | fixed | 1 |
| 17 | src/services/terminal/maybeAutoCreateTerminalSession.ts | 54 | High | Duplication | Owner-aware creation repeated across 4 creators | One shared creation service | fixed | 1 |
| 18 | src/services/terminal/revealTerminalSession.ts | 44 | High | Logic | activeSessionId reused without visible-membership check; fallback not activated | Verify membership; setActive on fallback | fixed | 1 |
| 19 | src/services/terminal/revealTerminalSession.ts | 53 | High | Logic | Non-null assertion on creation result | Explicit null handling (fail loud) | fixed | 1 |
| 20 | src/services/terminal/openTerminalHere.ts | 46 | High | Logic | canOpenTerminalHere counts visible; creation uses owner union — can diverge | One authoritative can-create predicate | fixed | 1 |
| 21 | src/services/terminal/openTerminalHere.ts | 36 | Medium | Debt | OpenTerminalHereResult not a discriminated union | Discriminate on ok | fixed | 1 |
| 22 | src/services/workspaces/switchWorkspaceInstance.ts | 113 | High | Duplication | restoreIncomingInstance duplicates hydrate's restoration block | Shared context-restoration helper | fixed | 1 |
| 23 | src/services/workspaces/switchWorkspaceInstance.ts | 173 | High | Logic | Missing-record outgoing satisfies kind!=="placeholder" → adopt stamps dead owner; incoming record unchecked | Require present records | fixed | 1 |
| 24 | src/services/workspaces/closeWorkspaceInstance.ts | 108 | High | Logic | Owned tabs snapshotted before await; tabs opened during prompt orphaned on removal (pre-existing) | Re-collect and re-close until empty/cancelled | fixed | 1 |
| 25 | src/services/workspaces/closeWorkspaceInstance.ts | 126 | High | Logic | Active-close successor gets ONLY terminal hydration; panes/sidebar/config stale | Run full hydrateWorkspaceInstanceContext | fixed | 1 |
| 26 | src/services/workspaces/closeWorkspaceInstance.ts | 123 | High | Duplication | Post-removal lifecycle duplicates move's and has drifted | Shared removal finalizer | fixed | 1 |
| 27 | src/services/workspaces/workspaceWindowActions.ts | 38 | High | Duplication | Move cleans fewer per-instance stores than close (ui/pane) | Plan G2 explicitly defers cross-window ui/pane orphan cleanup | not-fixed (deferred — see report) | 1 |
| 28 | src/services/workspaces/workspaceWindowActions.ts | 31 | High | Logic | Move/duplicate have no in-flight lock (close has `closing` set) | Mirror the closing-set guard | fixed | 1 |
| 29 | src/services/workspaces/workspaceWindowActions.ts | 103 | High | Logic | Transfer application has no rollback (pre-existing machinery) | Needs transactional design + Rust changes | not-fixed (deferred — see report) | 1 |
| 30 | src/services/workspaces/workspaceWindowActions.ts | 163 | High | Logic | Ack retry vs backend route removal (pre-existing, Rust interplay) | Needs backend contract change | not-fixed (deferred — see report) | 1 |
| 31 | src/services/workspaces/workspaceWindowActions.ts | 239 | High | Logic | Timeout cancel cannot stop a claimed in-progress target (pre-existing) | Needs transfer state machine | not-fixed (deferred — see report) | 1 |
| 32 | src/components/Terminal/TerminalPanel.tsx | 191 | High | Duplication | handleClose duplicates closeSessionOnCleanExit; predicates drifted; stale hidden active removable | One shared close helper, membership-verified | fixed | 1 |
| 33 | src/components/Terminal/TerminalPanel.tsx | 62 | Medium | Debt | Panel mixes many concerns (~290 lines, pre-existing shape) | Extract hooks (defer) | not-fixed (deferred — see report) | 1 |
| 34 | src/components/Terminal/TerminalTabBar.tsx | 130 | Medium | Logic | renamingId survives scope switches; rename mode resurrects | Clear when session not visible | fixed | 1 |
| 35 | src/components/Terminal/TerminalTabBar.tsx | 94 | Medium | Debt | Component combines many roles (pre-existing shape) | Extract subcomponents (defer) | not-fixed (deferred — see report) | 1 |
| 36 | src/components/Terminal/terminalKeyHandler.ts | 58 | High | Duplication | DEFAULT_TERMINAL_FONT_SIZE=13 duplicates settings defaults | Import canonical default | fixed | 1 |
| 37 | src/components/Terminal/terminalKeyHandler.ts | 90 | High | Debt | 182-line order-sensitive handler (pre-existing) | Split handlers (defer) | not-fixed (deferred — see report) | 1 |
| 38 | src/components/Terminal/useTerminalSessions.ts | 153 | High | Logic | createTerminalInstance throw leaves store session alive → permanent blank tab (pre-existing) | Remove store session on failure + test | fixed | 1 |
| 39 | src/components/Terminal/useTerminalSessions.ts | 65 | Medium | Debt | Hook + 70-line createSession (pre-existing) | Factory extraction (defer) | not-fixed (deferred — see report) | 1 |
| 40 | src/components/Terminal/useTerminalSessions.ts | 239 | Low | Dead Code | sessionsRef exposed in return with no consumer | Remove from return | fixed | 1 |
| 41 | src/components/Terminal/useTerminalSessionsInit.ts | 40 | Medium | Debt | 57-line effect (this plan; concerns are documented) | Extract helpers (defer) | not-fixed (deferred — see report) | 1 |
| 42 | src/components/Terminal/useTerminalShellLifecycle.ts | 102 | Medium | Debt | startShell ~120 lines (pre-existing, Claude-fallback finding) | Extract spawn phases (defer) | not-fixed (deferred — see report) | 1 |
| 43 | src/components/Terminal/spawnPty.ts | 52 | Low | Dead Code | resolveTerminalCwd has no production caller post-WI-TS4.1 (tests only; documented contract) | Keep-or-remove decision | not-fixed (deferred — see report) | 1 |
| 44 | src/components/Terminal/terminalSessionStoreSync.ts | 152 | Medium | Debt | syncRoot long/nested (pre-existing, Claude-fallback finding) | Extract loop body (defer) | not-fixed (deferred — see report) | 1 |
| 45 | e2e/lib/rail.mjs | 36 | Medium | Duplication | Settings StorageEvent writer duplicates browser.mjs's (Claude-fallback finding) | Shared patchPersistedSettings helper | fixed | 1 |
| 46 | scripts/check-tscope-phase.sh | 40 | Low | Duplication | Helper fns copied from check-gha-phase.sh — governance §3 prescribes copy-as-template | Justified; skip | skipped (justified: governance §3 copy-as-template) | 1 |
