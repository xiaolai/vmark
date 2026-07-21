# C2 recovery redesign — abort-and-compensate (owner directive, 2026-07-21)

> **SUPERSEDED by design review 01 (`c2-design-review-01.md`): the PHYSICAL
> revert approach below is broken — it cannot roll back a brand-new carrier
> object (no "return to absence" transformation exists; the carrier is committed
> FIRST, so it is the most likely crash window), it creates B→M→R staleness
> churn that breaks `supersede`, and it needs an incompatible new agent.type.
> The correct realization of "abort" is LOGICAL tentative-visibility (2PC):
> members are invisible to head projection until a durable `group-commit`
> marker; abort exposes nothing. A v2 design is pending. Kept for the record.**

Fixes G-B re-review 03's Critical-2: an aborted partial group left its committed
members live, and a retry rejected the committed member as stale, violating
all-or-nothing. Owner directive: **abort semantics — a partial group always rolls
back**, never completes-forward.

## The current (broken) model

`accept_group_locked` recovery is *complete-forward*: a retry commits the missing
members. The hole: when recovery `append_abort`s (because `revalidate` failed —
the workspace changed since prepare), the members already committed by the tip
attempt stay live. A retry folds a *different* idem (new `attempt_id`), so it
reads those members as missing, preflights them, and rejects them as stale
because their base head has moved (they moved it themselves). Deadlock, with a
live partial commit.

## The new model — always roll back

**Invariant:** a group is atomic. Either every member is live, or none is. There
is no durable state in which *some* members are live and the group is not
completing this instant. Recovery of any partial (tip attempt that is not being
completed right now) **compensates** the committed members back to their
pre-group base, then the attempt is dead. A retry is a fresh attempt that
re-previews against the (now rolled-back) current heads.

The manifest already carries what this needs: `GroupPrepare.snapshot`
(`GroupSnapshot`) records each affected object's base head at prepare time, and
`members` records each `PreparedMember`'s committed revision identity.

### Compensation = append a revert transformation (physical, localized)

For each committed member of the attempt being aborted:

1. If the object's **current head == the committed member revision** (the member
   is still the tip), append a compensating transformation
   `committed-revision → base-content` (the base from `GroupSnapshot`),
   `agent.type = "abort"`, parented on the committed revision. The object's
   content returns to base; its head becomes the revert revision.
2. If the object's head **moved past** the committed member (an external edit
   landed on top), **fail closed**: append a `group-abort-conflict` diagnostic
   naming the group, attempt, object, and the intervening revision. Do NOT
   silently revert — that would discard the user's external change. Manual
   resolution. (This is the rare "B moves" case from the review, handled
   honestly rather than guessed.)

**Why physical revert, not logical voiding of the projection.** A logical model
(abort record lists voided revisions; head projection skips them) returns each
head to its *true* base and appends fewer entries — but it changes the core
DAG/head projection to retroactively void committed transformations, exactly the
kind of wide-blast-radius change to core machinery that drove nine review rounds.
Physical revert is a *localized* append: the existing projection handles revert
transformations already, head/edge/staleness logic is untouched, and the outcome
(content back to base) is correct. Honest history: `base → member → abort-revert`.

### Idempotency (crash-safe, re-runnable)

Every compensation is keyed by `(attempt_id, object)`. Its idem is
`hash("group-abort" ‖ attempt_id ‖ object)`. Recovery, before appending a
member's compensation, checks the index for that idem; present ⇒ skip. So a crash
mid-compensation re-runs and completes only the outstanding reverts. The
`append_abort` record is appended **last**, after all compensations; recovery
that finds compensations done but no abort record simply appends it.

Ordering (each durable before the next):
1. For each committed member, in a stable object order: append its compensation
   (or the fail-closed diagnostic), fsync (see C1 — parent-dir fsync makes this
   durable on new segments).
2. Append `append_abort(attempt_id)`.

Recoverable states after a crash:

| Crash point | Recovery sees | Action |
|---|---|---|
| before any compensation | committed members live, no abort record | compensate all, then abort |
| mid-compensation | some compensations present (by idem) | compensate the rest (idem-skip the done), then abort |
| all compensated, no abort record | all compensation idems present | append abort |
| fully aborted | abort record present, heads at revert | done; a retry re-previews |

### Retry interaction

On abort, the accept returns `re-preview and re-run` (unchanged). The retry is a
new attempt (`supersedes` the aborted one), re-previews against the **current**
heads (the revert revisions), and commits members parented on them. No stale
rejection — it never parents on the old base. The aborted attempt's members are
already folded under its `attempt_id`, so they are never reused.

## Fresh-accept abort (zero committed members)

Unchanged and already correct: an abort with no committed members appends only
the abort record (nothing to compensate). The existing passing test covers this.

## What changes in code (Phase, TDD)

- `group_prepare`: a `compensate_member(kernel, attempt, member, base, now)`
  that appends the revert transformation (or the conflict diagnostic), idem-keyed;
  a `abort_partial(kernel, prepare, committed, now)` that drives step 1–2.
- `accept_group_locked`: replace the `append_abort` + return on `revalidate`
  failure with `abort_partial` (which compensates first). Any recovery decision
  that will NOT complete the group this call goes through `abort_partial`.
- Tests (the crux — the missing coverage review 03 named): abort a partial with
  ≥1 committed member and assert every object's head content == base and the group
  is gone; the "head moved past a committed member" fail-closed diagnostic; crash
  injection at each row of the table above; a retry after abort completes cleanly;
  idempotent double-recovery.

## Open question for the design review

Is a physical revert transformation (`agent.type = "abort"`) an acceptable new
`agent.type`, or should compensation reuse an existing type (e.g. a `git`-style
observed revert)? The spec §8 agent-type set must admit it. Flag before Phase 1.
