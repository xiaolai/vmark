# Design — accept-consistency + group-commit redesign

> **Status: SIX reviews, all DO-NOT-SHIP (2026-07-20).** Round 2 (`019f7c7e…`,
> 8 MAJOR): 6 fix-now correctness bugs fixed — these unblocked **Phase 3, now
> GREEN** 8/8 perf PASS. The deferred multi-object group-commit was implemented as
> a durable prepare/commit/abort state machine; rounds 3–6 each returned
> DO-NOT-SHIP, each closing findings and uncovering the next layer. The 6th
> (`019f7d1d…`) CLOSED manifest validation + chronological expiry but left a
> **CRITICAL** lock-scope defect OPEN and surfaced **two regressions** from the
> `flock` attempt (half-init `.vmark`, lock leak). Root finding, evidence-backed
> across six reviews: cross-process serialization can't fence every threat (raw
> git checkouts, Windows) — but the owner chose **R1 (full pessimistic lock)** for
> cooperating VMark writers, and it is now **implemented + tested** (all 5 findings
> closed; 377 coherence tests green; fmt + clippy clean), **pending a SEVENTH
> review**. See "Owner decision + R1 implementation" at the bottom. **Phase 4 stays
> RED; the marker is never flipped on a hope — only on a passing review.**

## Re-review disposition (thread `019f7c7e…`, DO-NOT-SHIP, 8 MAJOR + 1 MINOR)

The re-review was correct on all counts (verified against the code). Triage:

| # | Finding | Verdict | Plan |
|---|---|---|---|
| 1 | **Heal-on-open compares cardinality, not identity.** The ledger is git-*tracked* and can be *replaced* on branch switch (different idem, same count) while the gitignored `index.db` persists → `raw==applied` wrongly skips reconcile. | VALID (serious — kills Fix A's invariant) | **Fix now:** reconcile on a canonical `(idem→winner entry_id)` fingerprint, not counts. |
| 2 | **Cross-process winner divergence.** Two processes append the same idem with different entry ids; `INSERT OR IGNORE` keeps the first-applied, but `read_all` picks the smallest `(time,id)` — index diverges from a rebuild, and count-equality hides it. | VALID | **Fix now** (same fingerprint fix as #1: compare winners, not counts). |
| 3 | **O(1) lookup not authoritative after an ambiguous append error.** `write_all` succeeds then `sync_all` fails → `append` returns Err with the line already written; `append_and_apply` returns without applying → an in-session retry double-appends. | VALID | **Fix now:** on any ambiguous append/apply error, mark the kernel unavailable until an exact reconcile succeeds. |
| 4 | **`group_id` under-identifies the group.** It hashes only sorted output *revisions* (content+parents), not object/inputs/kind/operator — two groups whose members share content+parents but differ elsewhere collide, so a partial of G1 validates a *different* G2. | VALID (real correctness bug) | **Fix now:** derive `group_id` from each member's full *ungrouped* accept preimage, sorted. |
| 5 | **No durable group manifest.** The group lives only in the opaque idem; the serialized transformation carries no membership. After a crash with the candidate list lost, the ledger cannot reconstruct the group or enumerate missing members — recovery needs the client to resubmit the exact group. | VALID (architectural) | **Defer:** append a durable prepare/manifest record (member identities + group id + reviewed-precondition digest). Needs design + re-review. |
| 6 | **Partial recovery can commit after unreviewed structural change.** A→crash→(another op adds a ratification/waiver touching B's incident edge)→retry: B's base-head is unchanged so preflight passes, present>0 skips the reproject, B commits against changed context. The per-root mutex does not cover the gap between crash and retry. | VALID (architectural) | **Defer:** persist the validated base snapshot; on recovery revalidate all non-member differences (or block other writes while a prepared group is incomplete). Ties to #5. |
| 7 | **Cross-process distinct writes → unrecoverable partial.** P1 preflights A,B; P2 advances B's object; P1 commits A then crashes; retry finds A present but B permanently stale → the group can never complete. Idem-dedupe only covers same-idem races. | VALID (architectural) | **Defer:** a cross-process workspace lock from presence-lookup through all appends, or a durable prepare + defined abort. My original #7 "convergent" claim overreached. |
| 8 | **New-edge preview state excluded from the precondition.** A member's new input edge pinned to external `X@x1` shows Fresh in preview; X advances to x2 before accept; base-head unchanged so the precondition (committed edges only) passes, and B commits an edge different from what was reviewed. "No pre-image" ≠ "stable after-state". | VALID (correctness) | **Fix now:** compare a stable map of the new edges' projected after-classes at accept (deterministic preview-only ids), recomputed on fresh accept + recovery. |
| — | **MINOR: nil synthetic id can read persisted state.** The parser accepts a nil envelope id, so a merged/external real edge could be `txf=nil`; synthetic edges then read persisted `all_res`/`live_checks` for `(nil, idx)`. `before=Retired` also conflates absent vs retired. | VALID (minor) | **Fix now:** pass empty res/checks for synthetic edges; add an `Absent` preview state; don't reserve a parser-accepted UUID. |

**Fix-now set — ✅ FIXED + tested (2026-07-20):** #1/#2 (heal-on-open now
reconciles on the canonical `(idem→winner)` map, not counts — `state.rs` +
`index_state::applied_map`; regression test `open_reconciles_when_the_ledger_is_replaced_at_equal_count`),
#3 (ambiguous append/apply failure poisons the kernel + reconciles;
`ensure_available` guards accepts — test
`an_append_failure_reconciles_and_asks_for_retry_without_losing_state`), #4
(`group_id` hashes sorted *ungrouped member idems* — full identity — test
`group_id_binds_full_member_identity_not_just_revisions`), #8 + MINOR (new-edge
after-classes gate the accept precondition via `new_edge_classes`; deterministic
preview-only ids, empty res/checks — test
`a_new_edge_going_stale_between_preview_and_accept_is_rejected`).

**Deferred set — ✅ IMPLEMENTED (2026-07-20); pending a THIRD review.** Built as a
durable prepare→commit | abort state machine (`group_prepare.rs` + the
`group-prepare`/`group-abort` envelope kinds), resolving the three tensions in the
notes below: #5 a fresh group appends a durable prepare (manifest + base-head/
resolution snapshot) before committing; #6 recovery revalidates the snapshot
against the current workspace (a committed member's own head move is expected,
any other drift is external) and completes only if unchanged; #7 external drift
appends a durable abort and rejects (a fresh re-preview supersedes it — never a
stuck deadlock). The prepare idem folds the snapshot so a fresh context is a new
attempt. **Full cross-process serialization under simultaneous instances remains
a documented follow-up** (the abort makes the outcome defined, not corrupt). Until
the third review is clean, Phase 4 stays red.

---

## Original design (below) — superseded in part by the disposition above

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

---

## Deferred-set design notes (#5/#6/#7) — tensions uncovered (2026-07-20)

An attempt to build the durable prepare/manifest surfaced three genuine design
tensions that make this a design pass, not a patch. Recorded so the pass starts
de-risked:

1. **Recovery representation shift.** A member's *new* input edges live in
   `new_edge_classes` (synthetic, preview-only) at prepare time, but once that
   member commits they become *persisted* and reappear in `group_classes`
   (committed). So a recovery that naively compares the current `group_classes`
   to a prepared `group_classes` snapshot **false-aborts** — the difference is
   the group's own progress, not an external change. The revalidation must
   compare against a representation that is invariant across members committing
   — e.g. snapshot the affected objects' **base heads + the resolution/check set
   on affected edges** (which only an *external* write changes), and on recovery
   accept a head that is either its prepared value OR a group member's own
   revision, everything else unchanged.

2. **Abort-vs-retry `group_id` conflict.** `group_id` must be **stable** for the
   same candidate set (so an idempotent retry finds the committed members and
   never double-commits). But if a partial group is **aborted** (its context
   changed, #6), a fresh re-preview of the *same* candidates must be treated as a
   NEW attempt — yet it hashes to the *same* `group_id`, so it would re-enter
   recovery against the stale prepare and abort forever. Resolution: separate a
   stable **group identity** (the member set) from a per-attempt **attempt id**
   (folds in the preview/base snapshot); the prepare and any abort record are
   keyed by attempt id, and a fresh re-preview is a new attempt that supersedes
   the aborted one.

3. **Append-only abort.** On an append-only ledger an abort cannot delete the
   prepare; it must append a durable `group-abort` (keyed by attempt id) that
   recovery honours — a prepared-then-aborted attempt is dead, and only a newer
   attempt id can commit its members. This interacts with member idems: a member
   idem currently folds `group_id`; it likely needs to fold the **attempt id**
   so an aborted attempt's members can never be mistaken for a fresh attempt's.

Net: the deferred set is a small state machine (prepare → commit | abort → fresh
attempt) over the append-only ledger, plus a base-head/resolution snapshot for
external-change detection, plus the cross-process serialization (#7) that the
abort path makes a *defined* outcome rather than a stuck partial. It wants its
own design doc + a review of the state machine BEFORE implementation.

---

## Third review — DO-NOT-SHIP (thread `019f7cbd…`, 7 MAJOR + 1 MINOR)

The durable prepare/commit/abort implementation was re-reviewed and returned a
THIRD DO-NOT-SHIP. All findings verified correct. This is decisive: the
group-commit is a genuine distributed-systems design project, not session-tail
patching — three independent reviews, three DO-NOT-SHIP, each finding *deeper*
real issues after the prior round's were fixed.

Findings:
1. **MAJOR — no cross-process fence.** P1 revalidates a partial and pauses; P2
   aborts; P1 resumes and commits (no lifecycle recheck between revalidate and
   the commit loop), and a later retry returns DONE without consulting the abort.
   The O(1) presence index is also stale vs another live process. Needs a
   workspace-wide cross-process lock held from lifecycle lookup through the final
   append, + reconcile-after-acquire.
2. **MAJOR — wall-clock lifecycle ordering can deadlock.** `find_latest` sorts by
   `(time,id)`; a clock-skewed abort can sort BEFORE its prepare, so it is ignored
   and every retry recomputes the same (deduped) abort → the group aborts forever.
   Needs a real `attempt_id` + a causal `supersedes` relation, not "latest wins".
3. **MAJOR — snapshot misses edges created after prepare.** A commits + creates a
   new edge; an external waiver on that edge (excluded from the frozen digest) is
   invisible → B commits against unreviewed state. Also a new external incident
   edge that doesn't advance its object is missed. Needs to revalidate the current
   incident-edge set, allowing only committed members' own new edges.
4. **MAJOR — resolution EXPIRY is time-blind.** A Waived edge with expiry T;
   recovery after T is Waived→Stale but no head/resolution-id changed → revalidate
   wrongly passes. Needs the earliest time-dependent transition persisted (abort
   past it) or a reproject at recovery `now`.
5. **MAJOR — old-attempt member reuse.** Attempt 1 commits A then aborts; an
   external writer advances A→A2; the client re-previews the same A+B; the fresh
   path skips A's preflight (its group-only idem is present) and returns A's stale
   receipt though A's revision is no longer a head. Member idem must fold an
   `attempt_id`, or adoption must require the member's current head == its revision.
6. **MAJOR — prepare is not a recoverable manifest.** `PreparedMember` stores only
   `{object, revision}` — not the full transformation/idem/content — and content
   isn't staged in CAS until `commit_member`. So the ledger alone still cannot
   reconstruct a missing member; recovery needs the client to resubmit. #5 is only
   partially fixed. Needs full canonical member transformations + CAS-staged
   content fsync'd before the prepare append.
7. **MAJOR — malformed `group-prepare` permanently poisons the group.** A body
   without `snapshot` passes `Envelope::typed()` (validation only checks
   `group_id` + `members`), then EVERY `find_latest` hard-errors on deserialize —
   even if a valid later record exists. Needs full body validation at typing
   (quarantine on malformed) + a resilient `find_latest`. **← the one fix-now item
   (robustness, independent of the protocol architecture).**
8. **MINOR — synthetic new edges still show `Retired`, not `Absent`.**

Fix-now: #7 (a real availability bug). Everything else (#1/#2/#3/#4/#5/#6) is the
**dedicated design project**: cross-process lock + causal `attempt_id` +
time-aware recovery + CAS-backed manifest + current-incident-edge revalidation.
Phase 4 stays RED. Do not flip the ship-ready marker.

---

## Fourth review — DO-NOT-SHIP (thread `019f7ceb…`)

Four reviews, four DO-NOT-SHIP. The 4th CLOSED #5 (attempt-folded idems + fresh
preflight — verified correct) and confirmed my #2/#3/#4/#7 fixes were partial:

| # | Status after round 4 | Remaining defect |
|---|---|---|
| #1 cross-process fence | OPEN | no OS lock / reconcile-after-acquire |
| #2 lifecycle ordering | OPEN (narrower) | clock-skew fixed, but **multi-writer FORKS** (two offline branches both superseding the same abort → two maximal tips; `max_by(attempt_id)` can pick the stale fork → deadlock). A workspace lock does NOT fix git-branch forks. Cycles → `None` also unsafe. Needs a DAG-aware lifecycle (validate acyclicity; on multiple tips fail-closed or a join attempt over a sorted parent list). |
| #3 post-prepare edges | OPEN (3 sub-bugs) | **3a** ownership by `(downstream,revision)` collides — an external txf producing the same `A@R` masquerades as member-owned; needs ownership by committed **entry-id**. **3b** over-broad scan — `affected_edges` is only candidates' edges, but recovery scans ALL `snapshot.heads` incl. neighbours → a neighbour's pre-existing edge is falsely "new" → false abort. **3c** truncation — `compute_snapshot` + `accept_group` ignore `inc.truncated`/`preview.truncated`, so a >2000-edge hub commits on an incomplete precondition. |
| #4 expiry | OPEN | lexicographic RFC3339 compare is wrong for mixed offsets; needs chrono instant compare. |
| #5 old-attempt reuse | **CLOSED** | verified correct. |
| #6 recoverable manifest | OPEN | `PreparedMember` still object+revision only; content not CAS-staged pre-prepare. |
| #7 malformed prepare | OPEN (narrower) | missing-snapshot fixed, but a prepare with a non-UUID `affected_edge`, an unverified `attempt_id`, or a manifest inconsistent with the group still deserializes → poisons/bypasses recovery. Needs full lifecycle-body validation at typing. |
| #8 | OPEN (MINOR) | synthetic edge still `Retired` not `Absent`. |

**Conclusion (evidence-backed, four reviews).** The group-commit is a dedicated
distributed-systems design project. Its hard core — multi-writer fork resolution
in a git-synced append-only ledger (#2) — is essentially a **consensus/merge**
problem, not a patch; #1 (cross-process lock) and #6 (CAS-staged manifest) are
substantial; #3a/#3b/#3c/#4/#7 are tractable but keep uncovering the next layer.
This CANNOT be responsibly closed by session-tail iteration. The clearest small
correctness bugs it found (#4 chronological compare, #3c truncation rejection)
are fixed next; the marker stays RED and the rest is the project.

## Fifth review — DO-NOT-SHIP (thread `019f7d08…`)

The redesign landed (`attempt_id`, DAG lifecycle, CAS-staged manifest, `Absent`
before-state, sub-DAG bounds). The 5th CLOSED #2/#3a/#3b/#3c/#5/#8 and left four:
#1 (workspace-wide lock), #2 (manifest validation), #4 (chronological
`earliest_expiry`), #6 (CAS-only bounded manifest). All four were then addressed:
every ledger writer takes the exclusive workspace `flock`; `recover_group` reads
from CAS + fully validates + recomputes `group_id`; expiry selected by instant;
the manifest stores only the transformation. A `sync_dir_of` (fatal dir fsync)
was added for the group-staging path.

## Sixth review — DO-NOT-SHIP (thread `019f7d1d…`)

Six reviews, six DO-NOT-SHIP. The 6th CLOSED #2 (manifest validation — verified
correct) and #4 (chronological `earliest_expiry` — verified correct), and left
the group-commit still not shippable:

| # | Severity | Status | Defect |
|---|---|---|---|
| #1 lock scope | **CRITICAL** | OPEN | The `flock` is acquired *inside* `append_and_apply`, **below** the accept's validation boundary. `accept_candidate` does idem lookup + base-head revalidation + reprojection (accept.rs:74/87/94) *outside* any lock; only the final append locks. Two-process trace: P2 validates `B(parent=b0)` unlocked → P1 locks + commits group `{A1,B1(parent=b0)}` + unlocks → P2 appends stale `B2` → `B` forks `{B1,B2}` while the group returned as an isolated success. The lock guards the write, not the read-validate-write span. |
| #2 CAS durability | MAJOR | OPEN | `put_raw`'s destination-dir fsync is best-effort + error-discarded (cas.rs:94); newly-created `sha256/<aa>` ancestor dirs unsynced. A staged member's rename can be lost on power-loss after the prepare is durable → client-less recovery impossible. |
| #3 manifest bounds | MAJOR | OPEN | `GroupPrepare.members` is an unbounded `Vec`; each member embeds an unbounded transformation (inputs/intent). A single `group-prepare` line can exceed `MAX_SEGMENT_BYTES` (only a pre-append rotation threshold); recovery `fs::read`s whole segments → memory-exhaustion prevents recovery. |
| #4 half-init `.vmark` | MAJOR | **NEW regression** | `acquire_lock_file` creates `.vmark` directly; `open` treats mere existence as initialized; a group accept that errors before `ensure_initialized` leaves `.vmark` with only `group.lock` → on reopen, `.gitignore`/`.gitattributes`/`merge=union` never written. |
| #5 lock leak | MAJOR | **NEW regression** | `begin_group_lock` stores the file in `self.lock` *before* `reconcile_index_from_ledger`; a reconcile error returns via `?` before `end_group_lock` → the `flock` is held until the kernel is dropped. A panic in a locked inner fn similarly skips the manual `end`. |

**Reviewer's own scope note (decisive):** the `flock` is `#[cfg(unix)]` (Windows
has only the in-process mutex — no fence) and **git does not honor `group.lock`**
(a live checkout can mutate the tracked ledger mid-operation). The reviewer
recommends the spec say **"cooperating VMark writers"** rather than imply every
writer is fenced.

**Conclusion (evidence-backed, six reviews).** This confirms the round-4
conclusion. #1 is exclusively a *multi-process* race — within one process the
per-workspace `Arc<Mutex<WorkspaceKernel>>` already serializes single **and**
group accepts for their whole span. The `flock` was an attempt to extend that
cross-process; it can't fence the real threats (git checkouts, Windows,
non-cooperating writers), it created **false safety** (#1 CRITICAL) and **two
regressions** (#4, #5). The honest fork in the road is a scope decision (below),
not another patch. Marker stays RED.

## Owner decision + R1 implementation (post-6th-review, 2026-07-20)

Presented the 6th-review scope fork; the owner chose **R1 — full pessimistic
cross-process lock**. Implemented, with a regression test per finding:

| Finding (6th review) | Fix | Test |
|---|---|---|
| **#1 CRITICAL** lock below the validation boundary | `state::with_write_lock` — EVERY mutating op (single accept via `operator_commands`, group accept/recover, lone `append_and_apply`) holds the exclusive `flock` across its WHOLE read-validate-append span, reconciling the index from the ledger on acquire. A nested per-member append reuses the held lock. | `accept::…::wrapped_accept_reconciles_a_concurrent_commit_and_rejects_the_stale_base` |
| **#4** half-init `.vmark` | Init detection is marker-based: `.gitattributes` (the merge=union rule) is written LAST by `ensure_initialized` and is what `open` trusts — a bare `.vmark/group.lock` never reads as initialized. | `state::…::a_bare_lock_file_is_not_mistaken_for_an_initialized_workspace` |
| **#5** reconcile-error lock leak | The `flock` lives in a stack local (releases on every exit incl. panic-unwind); `in_write_txn` is set only AFTER a successful acquire+reconcile and cleared on normal return. `begin/end_group_lock` are gone. | `state::…::a_reconcile_failure_during_lock_acquire_does_not_leak_the_workspace_lock` |
| **#2** CAS staging durability | `SnapshotStore::sync_dir_of` fatally fsyncs the staged blob's dir AND every new ancestor up to the store root, before the prepare references it. | `cas::…::sync_dir_of_is_fatal_and_walks_ancestors` |
| **#3** unbounded manifest | `group_prepare::validate_bounds` caps members / inputs-per-member / intent bytes / snapshot heads+edges / total serialized bytes — enforced before staging AND at the `append_prepare` choke point. `ledger::read_all` streams each segment with a per-line `MAX_LINE_BYTES` cap (quarantine, not OOM). | `group_prepare::…::an_oversized_group_prepare_is_rejected_before_it_is_written`, `ledger::…::read_all_quarantines_an_oversized_line_and_keeps_its_neighbours` |

**Documented scope limits (the spec should adopt "cooperating VMark writers"):**
the lock is `#[cfg(unix)]` (Windows keeps only the in-process `Arc<Mutex>` fence),
and it does NOT fence a raw `git` checkout mutating the tracked ledger mid-op —
that drift is caught by the prepare's revalidation, which appends a durable
`group-abort` (outcome defined, never corrupt) and requires a re-preview.

**Marker stays RED until the 7th review is clean.**
