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
