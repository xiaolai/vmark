# Audit Findings

**Run**: audit-fix 20260806 | **Scope**: coherence write gate (WI-2.2) + scan observation seam (WI-4.1) | **Audit type**: full
**Model**: gpt-5.6-sol | **Effort**: high | **Audit thread**: 019fd724-4ca5-7d20-9398-e7e0aca37b70

| # | File | Line | Severity | Dimension | Finding | Status | Round |
|---|------|------|----------|-----------|---------|--------|-------|
| 1 | src-tauri/src/coherence/state_write.rs | 192 | High | concurrency | Gate checks at lock acquire; append happens later with no revalidation, so an external writer (git pull) can land a future-format segment mid-operation | open (design-scope) | 1 |
| 2 | src-tauri/src/coherence/ledger_lines.rs | 98 | High | correctness | Version checked AFTER deserializing into this build's Envelope, so a newer format that changes a required field is quarantined as Malformed and never counted as future-format — the gate never fires | fixed | 1 |
| 3 | src-tauri/src/coherence/scan_git.rs | 29 | High | correctness | `Option<GitObservation>` conflated "not a repo" with "git read failed"; a real git failure classified as ExternalUnknown, so the scan ran and overwrote its good baseline | fixed | 2 |
| 4 | src-tauri/src/coherence/commands.rs | 135 | Medium | correctness | `perform_breakdown_in` (behind coherence_breakdown AND coherence_status) opens with a scan, so the write gate took the READ surfaces down — contradicting the gate's stated guarantee | fixed | 2 |
| 5 | src-tauri/src/coherence/command_errors.rs | 88 | Medium | correctness | `classify_write` inferred the code from a cached count that can be stale in both directions, so unrelated failures could report "upgrade VMark" | fixed | 1 |

## Finding 1 — why it is recorded rather than fixed

The window is real, and it is NOT introduced by this change: the workspace
`flock` serializes cooperating VMark processes and has never serialized `git`.
Every ledger invariant in this subsystem has the same exposure, which is why
reconcile runs unconditionally at every acquire.

Closing it properly needs the ledger-generation validation the finding names.
The two cheap alternatives are both wrong:

- Re-reading the ledger at each append is O(ledger) per append, and a scan
  appends once per changed file.
- A cheap `(len, mtime, inode)` fingerprint is exactly the oracle this codebase
  already removed after four consecutive audits found false negatives — the
  reasoning is written out at length in `with_write_lock`. Reintroducing it to
  guard a narrower property would be repeating a known mistake.

Net effect of the gate as shipped: exposure drops from "always writes on a short
read" to "writes only if a newer-format segment lands inside one locked
operation". Recorded as outstanding design scope, not as done.


## Round 2 — independent verification (thread re-run, read-only)

Verdicts: #2 FIXED, #5 FIXED, #1 NOT FIXED (as recorded), **#3 PARTIAL**,
**#4 PARTIAL**, plus **one new defect introduced by #4's fix**. All three were
closed in round 2.

| # | Round-2 verdict | What was still wrong | Resolution |
|---|---|---|---|
| 3 | PARTIAL | The "unreliable" decision was made by contradicting the PREVIOUS observation, so it could not fire on the FIRST scan — a git failure with no baseline still reconciled and could mint external-edit history | `rev-parse --git-dir` now separates an UNBORN repo from an UNREADABLE one, so `Unreadable` is unambiguous and is refused on its own without needing a baseline to argue with |
| 4 | PARTIAL | Availability was restored SILENTLY: `perform_breakdown_in` discarded the report and `CoherenceStatus` had no field for it, so `open_items: 0` on a workspace full of them was indistinguishable from a clean one | `CoherenceStatus.ledger_short_read` surfaces it; test asserts a healthy ledger reports false and a short one reports true |
| NEW | — | `coherence_check_sweep` consumes the same degraded breakdown and would call PAID providers over a partial edge set, then fail at `record_check` — or return a "successful" empty sweep, reporting clean coverage of history it never read | The sweep refuses up front with `unsupported` when the read was short, before any provider call |

The round-2 reviewer could not execute tests (read-only sandbox) and said so
rather than implying it had. Its verdicts came from code, call-graph and diff
inspection — and all three findings above were real.

## Still outstanding

- **#1 TOCTOU** — see above. Design scope; the remedy the finding names is a
  ledger-generation scheme, and both cheap alternatives are wrong (an O(ledger)
  read per append, or the exact fingerprint oracle this codebase already removed
  after four audits found false negatives).
- **`.git`-at-root assumption** — a workspace opened on a SUBDIRECTORY of a repo
  reads as `NotGit`, so git operations there are never classified. Pre-existing,
  and correcting it is a product decision about what "the workspace's
  repository" means, not a bug fix.

## Round 3 — verification of the round-2 fixes

Verdicts: B (sweep refusal) **FIXED**; A (status flag) **PARTIAL**;
C (unborn/unreadable split) **REGRESSED**. All three closed.

| Item | Round-3 verdict | What was wrong | Resolution |
|---|---|---|---|
| C | **REGRESSED** | Making `Unreadable` unconditionally `ObservationUnreliable` meant a machine with **no git binary** could never reconcile a git-backed workspace again — the spawn failure became `Unreadable`, every scan stopped, and ordinary edits were never captured. This broke the contract stated in `gitops.rs`'s own doc comment. | `GitRun` now separates `Unavailable` (spawn failed — a fact about the MACHINE, degrade to non-git) from `Failed` (git ran and refused — a fact about the REPOSITORY, stop the scan). Tested through a pure mapping so it needs no uninstall. |
| C | PARTIAL (2nd) | `--git-dir` succeeding only proves discovery works; a corrupt HEAD was then mislabelled `Unborn`. | A second probe: `symbolic-ref -q HEAD` succeeds on an unborn branch and fails on a corrupt HEAD. |
| A | PARTIAL | `perform_status` skips the breakdown when the workspace is uninitialized, then read `refused_for_short_read()` anyway — a verdict left over from an earlier refusal. | Gated on `scanned`, so the flag is only reported when this call actually attempted the lock. |

This round is the reason the loop was worth running: round 2's fix was a real
regression, and it would have shipped. It was found by review, not by the test
suite — every gate was green with it in place.

## Final state

Findings 2, 3, 4, 5 fixed; the round-2 defect and both round-3 defects fixed;
finding 1 (TOCTOU) recorded as design scope with reasons.


## 2026-08-07 — all three residual items CLOSED

| Item | Close |
|---|---|
| **#1 TOCTOU** (was: design scope) | **Detection, not prevention.** `verify_no_concurrent_short_read` re-checks after any locked scope that appended; a newer-format entry arriving mid-operation now poisons the kernel and says so instead of silently becoming the next decision's base. Prevention stays impossible while the ledger is a git-tracked plain file external tools rewrite — that is the ratified architecture. Both cheap "fixes" remain rejected. Read-only scopes skip the check, so the breakdown hot path pays nothing. |
| **214 raw English error strings** | **Localized at the boundary.** All six classifiers use `localized_error!`; verified total — no coherence command builds a `CommandError` directly and no raw-string constructor remains. The internal `format!` strings survive as `%{detail}` inside translated sentences, keeping the specific cause visible. 60 entries across 10 locales. |
| **Two dark commands** | **Removed** (−1,281 lines). `check_sweep` spent real money with no surface to see, approve or stop a run; `operator_verify` had no caller either. Wiring a UI is a product decision, not a gap to fill in passing. Recoverable at `07e0fd01`. Also removed the three items the deletion orphaned — `checked_cursor`, `CandidateCheckInput`, `build_candidate_check_prompt` — found by enumeration, since `pub` items are exempt from dead-code analysis. |

Every close is mutation-checked: reverting the fix makes its test fail.

**Residual, and deliberately so:** the `.git`-at-root assumption (a workspace
opened on a subdirectory of a repo reads as non-git) is unchanged. Correcting
it is a product decision about what "the workspace's repository" means, not a
bug fix.
