# G-B review 02 — durable-ledger-store plan v2 (2026-07-21)

Reviewer: Codex gpt-5.6-sol (owner-delegated), thread `019f8057`.
**VERDICT: STILL NEEDS REVISION — load-bearing skip oracle falsified.**

## The fundamental finding (required #1 → OPEN)

The v2 skip oracle uses git's HEAD-tree blob OID to skip re-reading applied
chunks. But HEAD certifies the COMMITTED tree; reconcile reads the WORKING tree.
Operations that change on-disk ledger bytes WITHOUT moving HEAD/OID:
`git restore --worktree`, index-only restore, stash apply, conflict resolution,
manual edit. The oracle mis-certifies all of them — the same false-negative class
as the banned inode/mtime/size fingerprint.

**Impossibility:** {raw JSONL working-tree = truth} + {O(delta)} + {sound vs
arbitrary external mutation} cannot all hold. Sound skip of externally-mutable
working-tree files requires re-reading them = O(ledger). The three honest exits:

- **A. Concede O(delta).** Keep JSONL-truth + soundness; accept O(ledger)
  reconcile (the interim Option 2, made permanent, with the S2 numbers: ~130 ms
  at 20k entries, ~1.34 s at 200k). Simplest; the current code already does it.
- **B. Narrow the threat model.** Declare ledger changes arrive via COMMITS
  (HEAD moves — merges on sync, reverts), which the HEAD-OID oracle DOES catch;
  treat working-tree-only tampering (restore/stash/manual edit of a
  machine-managed, git-tracked ledger) as out-of-model, detected coarsely
  (session-boundary or optional integrity re-hash), not per-op. Gets O(delta)
  soundness for the realistic 99% path; concedes the false-negative class is not
  closed for hand-tampering.
- **C. JSONL becomes a projection of a genuinely immutable store.** Gets O(delta)
  + soundness; abandons constraint 2 (JSONL as canonical truth).

This is an OWNER VALUES decision (which constraint to relax), not a plan fix.

## Other dispositions (all resolvable once #1's model is chosen)
- #6, #10, #12 CLOSED. #2,#3,#4,#5,#7,#9,#11 PARTIAL with specific fixes given
  (full-SHA filenames + create_new; parsed (instant,UUID) winner key with
  equal-key CorruptChunk rule; tail-reset cryptographically linked to the sealed
  chunk hash==prefix_hash & len==offset; one-txn tail replay; migration preflight
  + atomic active-segment→tail conversion + rewind-before-rebuild; content-addressed
  recovery segment preserving original envelope bytes/ids/idems/writer as an
  explicit foreign-writer format exception).
- #8 OPEN: an active-TAIL rewind (recent-entry revert) must enter LedgerRewind,
  not FullRebuild; migration must check rewind before rebuild; last_head_sha alone
  can't reconstruct the classifier after restart — persist enough topology or
  derive it.

Full fix list in thread `019f8057`.
