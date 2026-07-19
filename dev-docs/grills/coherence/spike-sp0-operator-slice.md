# Spike SP0 — end-to-end disposable single-object operator slice

> **Status: FUNCTIONAL + FAULT GATES PASS (2026-07-20); PERF GATE PASS.** The
> full operator slice — propose → preview → accept — is built on the committable
> Phase-3.0 primitives and exercised against a **real `WorkspaceKernel`** (no
> provider). **perf benchmark: ✅ PASS** — at the §10 500k-envelope scale the
> preview p95 is **0.027 ms** (budget ≤ 20 ms) and it loads a **bounded** sub-dag
> of **2** revisions, not the 500k corpus (the full-dag load it replaced took
> 218.7 ms), so the 16 MiB RSS budget holds by construction. Benchmark:
> `preview.test.rs::perf_500k_preview_p95_under_20ms_and_sub_dag_is_bounded`.

## What it proves

The design record's SP0 is the integration gate for Phase 3: a private
deterministic single-object operator driven through the entire lifecycle, proving
the accept protocol (idempotency + optimistic concurrency) holds under faults.
Unlike the design's original framing, SP0 is **not** a Phase-0 no-production
probe — its seams are the committable Phase-3.0 primitives (design v4.9), and this
report records their end-to-end composition.

## The slice (all committed, tested)

| Step | Module | Test evidence |
|---|---|---|
| operator → candidates | `operator.rs` (`tidy_revise`) | `operator.test.rs` 9/9 — deterministic, content-addressed, base-as-parent |
| preview (dry-run projection) | `preview.rs` (`project_candidates`) | `preview.test.rs` 3/3 — restales the incident edge, **mints nothing** |
| transient verify prompt | `checker.rs` (`build_candidate_check_prompt`) | `checker.test.rs` — proposal-vs-inputs, fenced, advisory |
| accept (commit) | `accept.rs` (`accept_candidate`) | `accept.test.rs` 4/4 (below) |

## Fault / concurrency gates

| Gate | State | Evidence |
|---|---|---|
| Accept commits exactly one revision; edge restales | ✅ | `accept_commits_one_revision_and_restales_the_edge` |
| **Idempotent retry** returns the ORIGINAL receipt, no double-append | ✅ | `a_retry_returns_the_original_receipt_and_does_not_double_append` (v4.2 ledger-authoritative idem lookup) |
| **Concurrent base advance** rejected | ✅ | `a_stale_base_is_rejected` (D6 base-head revalidation) |
| **Candidate tamper** rejected | ✅ | `a_tampered_candidate_is_rejected` (v4.6 recompute content-hash + revision) |
| **Reproject precondition** — concurrent check never blocks; swap caught | ✅ | `accept_precondition.test.rs` 8/8 (v4.3 check-independent, physically keyed) |
| Downstream retirement caught by the delta | ✅ | `preview.test.rs` + `project.test.rs` (`Some → Retired`) |
| Crash before ledger append heals as `observed-external`; torn append quarantined; replay restores | ✅ (kernel) | `scan.test.rs`, `ledger.test.rs`, `state.test.rs` — the same append-only recovery accept inherits (D4) |

## Performance gate — PASS (2026-07-20)

The **mechanism** was already proven: the bounded read-view returns edges
**O(degree)**, not O(corpus) — `read_view.test.rs::incident_query_is_bounded_by_degree_not_corpus_size`.
The **absolute figure at §10 scale** is now measured too
(`preview.test.rs::perf_500k_preview_p95_under_20ms_and_sub_dag_is_bounded`, run
`--ignored --release`): at a **500,002**-revision corpus the preview p95 is
**0.027 ms** (≤ 20 ms) and it loads a **2**-revision sub-dag, so heap stays far
under 16 MiB. Both blockers below are resolved, so **perf benchmark: ✅ PASS**.

### Blocker 1 — accept idem lookup was O(n) → FIXED (2026-07-20)

`accept` step 2 used `read_all()` + a linear idem `.find()` — O(entries) in time
and memory. This is **resolved** by `design-accept-consistency.md` Fix A+B:
heal-on-open makes the index authoritative (now via a canonical winner-map
reconcile, re-review #1/#2), so the per-accept lookup is the O(1)
`entry_id_by_idem`. The per-accept ledger scan is gone.

### Blocker 2 — preview loaded + cloned the WHOLE dag → FIXED (2026-07-20)

`preview::project_candidates` / `project_group` now load a **bounded sub-dag**
(`index_query::load_sub_dag(affected_objects)` — the candidate object + each
affected/new edge's upstream+downstream) instead of the whole-corpus `load_dag()`
+ clone. The benchmark confirms the sub-dag is 2 revisions at a 500k corpus, and
`preview_is_scoped_to_the_affected_sub_dag_not_the_corpus` proves the result is
identical to the full-dag projection. Original characterization (now resolved):

`preview::project_candidates` / `project_group` used to call
`index_query::load_dag()` (a `SELECT … FROM revisions` over **all** revisions)
and then **`.clone()`** it for the candidate overlay. That was **O(corpus) memory
per preview**, NOT bounded by the read-view's `PREVIEW_MAX_EDGES` cap — at 500k
revisions the dag + its clone is easily >100 MB transient, which blows the 16 MiB
RSS budget *regardless* of Blocker 1. The bounded read-view caps the affected
*edge* set; it does not cap the *dag* load.

**The real WI-3.4 work is to bound the preview's dag materialization**: project
over a `load_sub_dag(affected_objects)` (the candidate object + each affected /
new edge's upstream+downstream — a bounded set) instead of the whole corpus. Only
then does the 16 MiB budget hold, and only then is the 500k benchmark worth
writing (it would otherwise just measure the full-dag clone blowing the budget).
This is a self-contained, headlessly-buildable optimization + a correctness test
(sub-dag preview == full-dag preview) — the remaining Phase-3 perf task.

## Scope and honest limits

- The transient verify (`build_candidate_check_prompt`) is built and unit-tested
  as a prompt, but a live advisory run needs a provider (Phase-1 dogfood territory).
- The propose/preview/accept **Tauri command surface** (WI-3.6) and the preview
  **UI** (WI-3.5) are not built here — this proves the kernel protocol; the IPC +
  frontend are the remaining Phase-3 surface, gated on the perf benchmark.

## Run

```
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  'coherence::accept::' 'coherence::preview' 'coherence::operator'
```
