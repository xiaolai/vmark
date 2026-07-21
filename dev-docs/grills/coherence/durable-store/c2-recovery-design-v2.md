# C2 recovery redesign v2 — tentative-visibility 2PC (2026-07-21)

> **DIRECTION CONFIRMED, MECHANICS NEED REVISION (review `c2-v2-review-01.md`,
> NEEDS REVISION 7).** The 2PC/tentative-visibility direction is correct (3 of 6
> prior findings closed). But a CORRECT build requires, per the review: FORMAT
> VERSION 1 for all group entries (prepare + members + markers) with fail-closed
> mutation when `future_format > 0`; membership bound to an explicit
> `group_attempt` field + member-idem on each tentative transformation (NOT the
> unsound `(object, revision)` map — revision ids omit the object and
> provenance-confirmation re-emits revisions); commit validity requiring the
> COMPLETE exact manifest (else expose none, fail-closed on missing prepare);
> ONE-TRANSACTION atomic projection publication (the per-entry apply + rebuild
> publish members one-by-one); commit/abort coexistence failing closed;
> SCHEMA_VERSION bump. This has crossed from "bug fix" to a protocol + storage
> subproject — pending an owner decision on whether to commission it or defer
> group-commit. See the review for the concrete recipe.**

Supersedes the physical-revert design (`c2-abort-recovery-design.md`), which
design review 01 falsified (`c2-design-review-01.md`, 3 Critical + 3 High). This
v2 realizes the owner's "abort" directive the way the review recommends:
**group members are invisible to the head projection until a durable
`group-commit` marker; abort exposes nothing.** No compensation, no reverts, no
new agent type.

## The core idea

A multi-object group is a two-phase commit over the append-only ledger:

1. **prepare** — a durable `group-prepare` manifest (already exists) lists the
   attempt's member revisions + base snapshot.
2. **members** — each member `transformation` is appended, but **tentative**: the
   projection does NOT apply a member to `revisions` until its attempt commits.
3. **commit** — a single durable `group-commit` marker (new entry kind) naming
   the `attempt_id`. This is the **atomic linearization point**: before it, no
   member is visible; after it, all are.
4. **abort** — a `group-abort` marker (exists) naming the attempt. Its members
   stay tentative forever, i.e. never visible.

Because an uncommitted member never enters `revisions`, it is never a head, never
an ancestor, never a parent anything can build on. There is nothing to roll back.

## Why this fixes every review-01 finding

| Review-01 finding | Resolution |
|---|---|
| C1 can't roll back a brand-new carrier | A tentative carrier is simply never visible. "Return to absence" is the default state, not a transformation. |
| C2 diagnostic-as-compensation / idem poison | No compensation and no diagnostics in the happy path. Abort is one marker. |
| C3 no atomic visibility / no recovery barrier | The `group-commit` marker IS the atomic visibility point. The projection's pre-pass (below) is the barrier: tentative members are excluded before any head is computed, so no cooperating writer can extend one. |
| H1 revert ≠ base, breaks supersede, churn | No reverts. Bases never move (tentative members aren't heads), so a retry re-previews against the SAME base and supersedes cleanly. Zero churn. |
| H2 contradicts always-abort directive | A pending attempt (no commit marker) is invisible; recovery marks it aborted. There is no complete-forward path and no "revalidate-then-complete". |
| H3 agent.type "abort" | `group-commit`/`group-abort` are MARKER entry kinds, not transformations — no agent.type change, no format-compat break for existing readers of `transformation`. |

## Projection change (the one real change, in `index.rs`)

`rebuild_from` gains a **pre-pass** before applying entries:

1. `committed = { attempt_id : a group-commit marker exists }`.
2. `member_rev = { output.revision → attempt_id }` from every `group-prepare`
   manifest.

Then in the apply pass, a `transformation` whose output revision is in
`member_rev` is applied to `revisions` **iff** its `attempt_id ∈ committed`.
Non-member transformations apply exactly as today. Members of a pending or
aborted attempt are skipped — present in the ledger as history, absent from the
head projection.

This is bounded: it touches only which `transformation`s contribute to
`revisions`; edges/resolutions/registry/check_results are unaffected except that
a member's edges also wait on the commit marker (same gate, applied uniformly).

Under Option A (unconditional O(ledger) reconcile every acquire), the pre-pass
runs on every mutating op, so visibility is always correct from the ledger alone
— no incremental-apply subtlety, no in-memory tentative buffer.

## accept_group flow (much simpler than today)

```
prepare (durable manifest)           # exists
for each not-present member:
    preflight (arity + base-is-head)  # H2 fix already landed
    append member transformation      # tentative — invisible until commit
append group-commit marker(attempt)   # atomic visibility point (durable)
```

No winner-map heal, no complete-forward, no revalidate-then-commit-missing. The
partial-recovery machinery that drew ten review rounds is deleted, not patched.

### Idempotency & crash windows

- Member idem folds `attempt_id` (exists). The `group-commit` marker idem =
  `hash("group-commit" ‖ attempt_id)`; re-append is a dedup no-op.
- Crash BEFORE the commit marker → members tentative → group invisible → a
  retry starts fresh (same bases, they never moved). Recovery appends
  `group-abort(attempt)` so the dead attempt is explicit and a retry can
  `supersede` it.
- Crash AFTER the commit marker → all members visible → the group happened;
  recovery is a no-op (marker present).
- Crash mid-member-append → the last line may be torn; the existing torn-tail
  termination + the missing commit marker make the whole attempt invisible.

## Recovery (the barrier)

On lock acquire, after the reconcile rebuild, **settle pending attempts**: for
each `group-prepare` with neither a `group-commit` nor a `group-abort` marker,
append `group-abort(attempt)` (owner directive: always abort a pending partial;
never auto-complete). This is idempotent and cheap. It runs BEFORE any accept or
scan mutates, so no operation ever observes or extends a pending group's tentative
members.

(Alternative, NOT chosen per the directive: complete a pending attempt whose
members are all durably present by appending its commit marker. The directive
says always abort; recorded here only to note the model supports either.)

## Retry interaction

After abort, the tentative members are invisible and the bases are untouched. A
retry with the same candidates has the same `group_id`, re-previews against the
same bases, `supersedes` the aborted attempt, and commits fresh. No stale
rejection is possible — nothing moved.

## Spec + format

- `group-commit` is a new **marker** entry kind (not a transformation): body
  `{ "attempt_id": "...", "group_id": "..." }`. Amend `coherence-format-v0.md`
  §5.4 (entry kinds) + §5.1 (visibility rule: a member is projected iff its
  attempt has a `group-commit`). Older readers: a `group-commit` marker is an
  unknown kind → they must treat an unknown REQUIRED-for-visibility marker
  conservatively. **Compatibility decision to confirm in review:** bump
  `FORMAT_VERSION` so a reader without the visibility rule does not apply tentative
  members as live (it would over-expose). This is the one format-compat question
  v2 must settle before Phase 1.

## What changes in code (Phase, TDD)

- `index.rs`: the rebuild pre-pass + conditional member apply. Tests: a member
  before its commit marker is invisible; after, visible; an aborted attempt's
  members never visible; a member's edges gate on the marker too.
- `types.rs`/`envelope.rs`: the `group-commit` marker kind + typing + bound checks.
- `accept_group.rs`: append the commit marker after members; delete the
  complete-forward/compensation paths; recovery settles pending → abort.
- `group_prepare.rs`: `member_rev` extraction for the pre-pass.
- `state.rs`: the recovery barrier (settle pending attempts on acquire) before
  mutation.
- Tests (review-03's missing coverage): crash before/after commit marker; retry
  after abort; a cooperating writer cannot see/extend a tentative member;
  carrier-first group aborted leaves no object; idempotent double-recovery;
  Extract-Canon end-to-end atomic.

## Open questions for the re-review

1. The `FORMAT_VERSION` bump + exact older-reader rule for an unknown
   visibility-gating marker — is a version bump the right compat story, or should
   the marker be a field on the prepare instead of a separate entry?
2. Is settling-pending-as-abort on every acquire the right barrier placement, or
   should it be lazy (only when an attempt's object is next touched)?
3. Edges/resolutions produced by a member: confirm they gate on the commit marker
   identically to the member's revision, with no separate leak.
