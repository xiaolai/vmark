# Design — accept-consistency + group-commit redesign

> **Status: DESIGN (2026-07-20).** Settles the shared ledger/index-consistency
> boundary that blocks **both** Phase 3's perf gate (WI-3.4: the O(n) accept
> idem scan) **and** Phase 4's group-commit MAJOR GAPS (G-B review `019f7c17…`).
> Supersedes the band-aids in `accept.rs` (#4 heal-on-lookup) and the
> prototype notes in `accept_group.rs`. To be built with TDD, then G-B
> re-reviewed (rule 60 §6) before either phase ticks to complete.

## The one root cause

`accept` step 2 does `kernel.ledger().read_all()?` then a linear idem `find` —
a full ledger read + parse **per accept**, O(entries) in time and memory. It
does this because the index *could* be torn: the ledger append is durable
(fsync) but a crash before `apply_entry` commits to SQLite leaves the entry in
the ledger and not the index. The existing O(1) fast path
(`index_state::entry_id_by_idem`) is bypassed for that reason.

But the torn window is **narrower than the mitigation assumes**:

- `WorkspaceKernel::append_and_apply` already self-heals a *non-crash* apply
  failure — it rebuilds the index from the ledger before returning
  (`state.rs` lines 95-102). So **between** operations in a live process, the
  index always reflects the ledger.
- The only surviving gap is a **hard crash mid-apply**, which ends the process.
  On the next `open`, a *schema-valid* index is **loaded, not rebuilt**
  (`state.rs` lines 44-54 skip `read_all` when `needs_rebuild` is false) — so
  the un-applied tail entry stays torn **across opens**. That is the whole bug.

The invariant that makes this cheap to detect: `applied` is keyed by idem (PK)
and `read_all().entries` is idem-deduped, so

```
index caught up  ⟺  applied_count() == read_all().entries.len()
```

## Fix A — heal-on-open (close the cross-open torn window)

On `open`, after loading a schema-valid index, reconcile it against the ledger.
A precise reconcile is `read_all()` (O(n)) — acceptable as a one-time open cost
but wasteful on every open, so gate it behind a **cheap probe**:

- Add `Ledger::raw_entry_count()` — a byte-scan newline count across segments,
  **no JSON parse**. `raw >= applied_count()` always holds (dupes, quarantine,
  future-format, and un-applied torn entries only *add* raw lines). Therefore
  `raw == applied_count()` ⟹ caught up (skip, O(bytes-no-parse) ≈ free).
- On `raw != applied_count()` (torn tail, or merely dupes/quarantine): run the
  precise `read_all()` and, if `entries.len() != applied_count()`,
  `rebuild_from(&entries)`. Idempotent; heals the torn entry.

Single-writer caught-up repos (the primary scope) hit the O(1) skip every open.
Merged/multi-writer repos with idem dupes pay one `read_all` per open — a
one-time cost, never in the accept hot path.

**Open cost is not in the perf gate.** WI-3.4 measures per-accept preview p95 +
accept latency, not open latency, so Fix A never regresses the 20 ms / 16 MiB
budget — it *unblocks* it by making Fix B sound.

## Fix B — O(1) accept idem lookup

With Fix A, a loaded index is caught up on open, and `append_and_apply` keeps it
caught up within the session. So at the top of `accept_candidate` (holding the
kernel lock) the index is **authoritative** for idem lookups. Replace step 2's
`read_all` + linear find with:

```rust
if let Some(entry_id) = kernel.index().entry_id_by_idem(&idem)? {
    return Ok(AcceptReceipt { entry_id, revision, committed: false });
}
```

O(1). The #4 per-lookup heal is deleted from `accept` (the heal now lives at
open, where it belongs — heal-on-open, not heal-on-lookup). `accept_group`'s
per-member lookup changes the same way.

## Group-commit gaps

### #1 Durable group identity + manifest

`present > 0` cannot mean "this group was validated" because members carry no
group id. Give the group a **content-addressed identity**:
`group_id = hash("vmark-group-v1" ‖ list(sorted(member_idems)))`, carried in
each member transformation's `intent` (so it is in the ledger and the index).
Then membership is durable: `members_present = entries carrying this group_id`.
FRESH = 0 present, RETRY = all present, PARTIAL = some present — for *this*
group, never confused with unrelated prior accepts.

### #2 Whole-group preflight before the first append

Preflight **every** member (tamper + base-head + arity + carrier-absence)
*before* appending any. Only if all pass does the commit loop run. A member-3
failure can no longer leave members 1-2 committed. (A hard crash mid-loop still
leaves a partial — that is #3's job, now well-defined.)

### #3 Defined partial-recovery

With the manifest (#1), recovery commits **exactly** the missing members of the
validated group (identified by `group_id`), skipping the base re-preview (the
group was validated at first accept). A member's per-object base-head check
stays; it can only fail if an **external** writer advanced that base between the
partial and the retry. Under the kernel's serialized single-writer path
(`KernelRegistry` hands out one `Arc<Mutex<WorkspaceKernel>>` per root; spec
§5.1 serializes all in-app writes), no concurrent in-process writer exists, so a
member base cannot advance mid-group — recovery always completes. Cross-process
is the #7 mitigation.

### #5 Preview overlays the new edges members create

`preview::project_group` currently overlays only members' output DAG nodes and
projects **persisted** incident edges — so Extract-Canon's *new* conformance
edges are invisible in the preview. Fix: for each candidate, synthesize its
would-be edges from its declared inputs (`upstream = input.object @ revision`,
`downstream = candidate.object @ candidate.revision`, `kind = input.kind`) and
include them in the affected set (before = absent/`Retired`, after = projected).
Display-only: the accept precondition still compares **committed** edges (a
brand-new edge has no pre-image to be unstable against), which stays correct.

### #7 Cross-process concurrency

The idem-lookup→append is a TOCTOU only **across processes** (within a process
the per-root mutex serializes accepts). Two instances accepting the *same*
candidate can both append its idem — but `read_all` **dedupes by idem** (smallest
`(time, id)` wins), so the duplicate collapses to one logical entry on the next
read/rebuild. Distinct candidates use per-writer segments + `merge=union` and
never conflict. So cross-process concurrency is **already convergent** for the
single-user-desktop scope; we document it rather than add cross-process locking
(the 20260719 viability report validated append-only-union as sufficient here).

## Build order (TDD)

1. **Fix A** — `Ledger::raw_entry_count` + `open` reconcile. Test: append to the
   ledger only (simulate a torn crash), reopen, assert the index healed.
2. **Fix B** — `accept` / `accept_group` use `entry_id_by_idem`; delete the
   per-accept `read_all` + the #4 heal-on-lookup. Existing accept suites stay
   green; add a cross-open torn-retry test.
3. **#1/#2/#3** — `group_id` in intent; `accept_group` preflight-all →
   commit-all; recovery by group_id. Tests: partial-crash completes, unrelated
   prior accepts are not misread as a group, a mid-group stale member is caught
   at preflight (no partial written).
4. **#5** — `project_group` overlays synthesized member edges. Test: an
   Extract-Canon preview shows the conformance edges.
5. Document #7 in `accept_group.rs`.

## Definition of Done

- The accept suites (`accept`, `accept_group`, `operator_accept`) stay green;
  new tests cover torn-across-open recovery, group misread, preflight rejection,
  and preview edge overlay.
- `accept` no longer calls `ledger().read_all()` on the hot path (grep-checked).
- G-B re-review returns **no MAJOR/CRITICAL** findings.
- Then, and only then: the perf benchmark (WI-3.4) is written against the O(1)
  path, and the plan's Phase 3 + Phase 4 markers flip to ship-ready.
