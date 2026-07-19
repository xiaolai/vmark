# Spike SP0 — end-to-end disposable single-object operator slice

> **Status: FUNCTIONAL + FAULT GATES PASS (2026-07-20); PERF GATE PENDING a
> benchmark.** The full operator slice — propose → preview → accept — is built on
> the committable Phase-3.0 primitives and exercised against a **real
> `WorkspaceKernel`** (no provider). The 20 ms / 16 MiB performance envelope
> needs a dedicated benchmark harness and is the one remaining gate.

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

## Performance gate — PENDING

The **mechanism** is proven: the bounded read-view returns edges **O(degree)**,
not O(corpus) — `read_view.test.rs::incident_query_is_bounded_by_degree_not_corpus_size`
puts 200 unrelated edges in the index and confirms `edges_incident_to(X)` returns
only X's 2 incident edges. That is the property the envelope rests on
(`PREVIEW_MAX_EDGES` caps a pathological hub on top of it).

What remains is the **absolute figure at §10 scale**: a dedicated benchmark
harness at 500k edges measuring preview p95 (≤ 20 ms), RSS delta (≤ 16 MiB), and a
timed accept. RSS measurement is platform-specific and belongs in a `criterion`
benchmark, not a unit test — so this is deferred to that harness. **SP0 clears the
functional, fault, and perf-*mechanism* gates; only the absolute 500k-scale
benchmark is outstanding**, and it is what the design governance treats as the
final bar before Phase-3 *surface* work.

### Known blocker the benchmark must not paper over — accept idem lookup is O(n)

`accept::accept_candidate` step 2 does `kernel.ledger().read_all()?` then a linear
`.iter().find()` for the idem (same in `accept_group`). That is a **full ledger
read + deserialize per accept** — O(entries), and it holds the whole ledger in
memory, so at 500k it will blow **both** the 20 ms and the 16 MiB budgets. The
O(1) fast path exists (`index_state::entry_id_by_idem`, WI-3.0b) but the hot path
does not use it, deliberately: the ledger is authoritative and the index can be
torn (the #4 append-before-apply window), so an index-only lookup could miss a
torn entry and wrongly re-append.

The real fix is **heal-on-open, not heal-on-lookup**: replay the un-applied ledger
tail into the index at `WorkspaceKernel::open` (bounded startup recovery, e.g. via
a persisted last-applied offset), which makes the index authoritative for idem
lookups — so per-accept becomes an O(1) index query and the per-accept ledger scan
disappears. The current per-lookup heal (accept.rs #4) is a correctness band-aid,
not the perf answer. This is the same ledger/index-consistency boundary the
group-commit redesign has to settle (see `accept_group.rs`), so the two should be
designed together. **Writing the 500k benchmark before this lands would only
measure the O(n) path failing — the optimization is the actual WI-3.4 work.**

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
