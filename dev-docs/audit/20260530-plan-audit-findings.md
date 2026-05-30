# Plan Audit — Implementation Conformance

> Date: 2026-05-30
> Subject: branch `chore/audit-remediation`
> Audited against: `dev-docs/plans/20260530-audit-remediation.md` (WI acceptance criteria)
> and `dev-docs/audit/20260530-dead-code-and-optimization.md` (source findings).
> Method: inspection pass (no test runs). Follows a Codex cross-model review whose
> 5 correctness findings were already fixed and re-verified (see plan §7 / git log).

## Verdict

The implementation is a **faithful execution of the plan** — every WI landed with a
present, behavioral (non-wiring-only) test, and the defers/aborts are recorded. There
are **no open Critical/High correctness findings**. The gaps below are
**conformance/completeness** issues: places where the *plan under-covers the source
audit*, or where a WI's literal AC sub-item was not delivered.

## Findings (by severity)

### Medium

| ID | Finding | Evidence | Expected per plan/audit |
|----|---------|----------|--------------------------|
| **M1** | Audit finding **T4 (Medium)** — `as unknown as` double-casts over persisted/3rd-party JSON — has **no WI** and is **not** in §4 non-goals. Missed by the Codex §7 review too. | `audit:88` (`aiStore/provider.ts:230`, `settingsStore.ts:286-288`, `secureStorage.ts:49`); plan grep `T4` = 0 | A WI **or** an explicit defer rationale. Neither existed (now recorded — see §"Disposition"). |
| **M2** | **WI-4.1 partial** — only 2 of the 4 ADR-2-named validate boundaries shipped. mcpBridge ✓ + AI chunk ✓ (settings is WI-4.2 ✓); **workspace config** and **session/hot-exit restore** were **not** validated. | ADR-2 `plan:42-46`, WI-4.1 `plan:302-306`; `openWorkspaceWithConfig.ts` has no shape guard | All four validated, or the narrowing recorded. Narrowing rationale (Rust serde already validates `read_workspace_config`) is defensible but was unrecorded. |
| **M3** | **WI-0.2 partial** — AC sub-item **(a) store-level `initDocument` orphan test** not delivered; only (b) the `useFileOpen` integration test shipped. `initDocument` has no guard (caller-side re-check chosen, which the prose permits). | AC `plan:108`; `documentStore/document.ts:156-166` unguarded | Both (a) and (b). (a) is literally unmet. |

### Low

| ID | Finding | Evidence |
|----|---------|----------|
| **L1** | Audit findings **O8, D8, A4, C6 (all Low)** absent from the plan and §4. `C6` includes `cancel_workflow` ignoring `execution_id` (a real, low, correctness item). | `audit:67,104,165,154`; plan grep = 0 |
| **L2** | "Record evidence in the WI" ACs satisfied in **commits/subagent reports, not the plan doc**: WI-1.3 zero-reference `rg` evidence, WI-2.7 compatibility matrix, WI-3.1 skip list. | WI text `plan:181,241,265` |
| **L3** | **WI-1.1 visual-QA AC unverified** — the 539-line CSS removal is gate-verified (build + `lint:design-tokens`) but has **no human visual confirmation** (light+dark via `css-reference.md`); cannot be done autonomously. | AC `plan:169` |
| **L4** | **WI-4.5 "clear in `finally`" not literal** — `saveToPath.ts` clears in `catch` (`:96`) + delayed `setTimeout` on success (`:144`), no `finally`. Rationale: the success path intentionally delays the clear ~1000 ms for watcher matching, so a naive `finally` would break it; the error path already clears. | AC `plan:328` |
| **L5** | **WI-2.5 "non-asserting large-input timing sanity check"** not added; equivalence covered by 213 passing rule tests. The `performance.now()` in `linter.test.ts:38` is pre-existing. | AC `plan:231` |

## Test coverage gaps

- **WI-0.2**: no store-level `initDocument` orphan test (AC-a). Behavior *is* covered by the shipped integration test (controlled deferred read + `vi.waitFor`); only the second AC test is missing.
- **WI-4.1**: no test for workspace-config / hot-exit payload validation (those validators were not built).
- **Meaningfulness — verified good**: spot-checked `OutlineView.render.test.tsx` (render-counter delta, RED-on-old proven), the genie workflow-race test (drives real listeners), the codePreview prose-only + AttrStep tests (`Node.descendants` spy), the document.ts active-vs-background dispatch pair. None are wiring-only.

## Notes / risks

- The dominant gap is **plan-vs-audit completeness** (M1 + L1), which the implementation inherited — not implementation infidelity to the plan.
- WI-2.6 (abort, `size:why` unavailable) and WI-2.8 (defer, sync-paste/async-claim UX risk) are **properly recorded** decisions, not gaps.

## Disposition (recordkeeping, this pass)

Per the request, the missing defer-rationale/notes were added to the plan so the
audit ↔ plan ↔ shipped chain is fully accounted for (no code changes):

- §4 non-goals: T4 (M1) and O8/D8/A4/C6 (L1) added with deferral reasons.
- Per-WI notes appended for WI-0.2 (M3), WI-4.1 (M2), WI-4.5 (L4), WI-1.1 (L3).

**Open follow-ups (NOT done this pass — require code):**
- **M1** — implement T4 (typed validators for the 3 persisted/3rd-party JSON casts).
- **M2** — implement the workspace-config + hot-exit restore validators.
- **L3** — run the WI-1.1 visual QA in the live app (light + dark via `css-reference.md`).

## Remediation follow-up (2026-05-30, implementation pass)

The open follow-ups above (plus the deferred Low items, by request) were
implemented. Each landed with a behavioral test; `cargo test` (597) and the
frontend suite are green.

| Item | Status | What shipped |
|------|--------|--------------|
| **M1 (T4)** | ✅ Implemented | Hand-written shape guards replace the 3 `as unknown as` casts: `sanitizeAiProviderPersist` (`aiStore/provider.ts` migrate), `sanitizePersistedSettings` (`settingsStore.ts` merge — drops group-shape mismatches before deepMerge), `assertSecureStore` (`secureStorage.ts` — validates the plugin shape, falls back to localStorage on mismatch). Unit-tested. |
| **M2** | ✅ Implemented | `isValidWorkspaceConfig` (`openWorkspaceWithConfig.ts` — rejects malformed `read_workspace_config` payloads, opens with defaults; mirrors the real Rust struct: no `showAllFiles`, numeric `version`) and `isValidWindowState` (`restoreHelpers.ts` — top-level guard at `pullWindowStateWithRetry`, discards malformed hot-exit payloads without retry). Unit-tested. ADR-2's named set is now fully covered. |
| **M3 (AC-a)** | ✅ Implemented | Store-level guard added via dependency injection: `setTabExistenceGuard` (wired in `main.tsx` to `tabStore.findTabById`); `initDocument` no-ops when the tab is gone. Decoupled from tabStore (no static import) so the 46 isolation tests stay permissive. Faithful AC-a test (real tabStore: createTab → close → initDocument → no orphan) added. Also covers the previously-unguarded `WindowContext` open-race. |
| **C6 (L1)** | ✅ Implemented | `cancel_workflow` now honors `execution_id`: `WorkflowRunnerState.current_execution` tracks the running id; pure `decide_cancel` helper + Rust tests; `RunningGuard::drop` clears it. A stale cancel can no longer cancel a workflow that started after the target finished. |
| **A4** | ✅ Implemented | ContentSearch + PromptHistory rows → `role=option`/`aria-selected`; ProviderSwitcher → `role=menu`/`menuitemradio` + focus-in on open + trigger `aria-haspopup`/`aria-expanded`; frontmatter panel header → `aria-expanded` (synced) + textarea `aria-label`; FileNode rename input → `aria-label`; UniversalToolbar AI-Prompts button folded into the roving-tabindex model (was keyboard-unreachable). No new i18n keys (reused existing). |
| **O8** | ◑ Partial (calibrated) | Implemented the one genuine, safe win: `findAllOccurrences` now uses `nodesBetween` (bounded traversal) instead of a full-doc `descendants` walk. `stripMarkdown` regex passes and lint inline regexes were investigated and left as-is — they are engine-cached literals (no recompilation) and the lint `new RegExp` is necessarily dynamic; merging `stripMarkdown` passes would risk word-count correctness for zero measured benefit. |
| **D8** | ◑ Partial (calibrated) | Routed the 3 inline `path.split("/").pop()` filename extractions through the cross-platform `getFileName`. The two `getFileName` functions were confirmed to have **genuinely different semantics** (display-verbatim vs. normalizing) and were left separate — merging would be a bug. The Rust `contains("..")` traversal checks were left local (security-sensitive, distinct contexts, the audit's `\`/symlink warning). |
| **L3** | ⏳ Human-only | Still pending: the WI-1.1 dead-CSS removal needs live visual QA (light + dark via `dev-docs/css-reference.md`). Cannot be done autonomously — requires the running app. |
