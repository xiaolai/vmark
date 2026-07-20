# G-B review 01 — durable-ledger-store plan (2026-07-21)

Reviewer: Codex gpt-5.6-sol (owner-delegated), thread `019f8057`.
Target: `dev-docs/plans/20260721-coherence-durable-ledger-store.md` v1.

**VERDICT: MAJOR GAPS.** Do not start Phase 0 from v1.

## Required (blocking) — addressed in plan v2
1. ADR-3's O(delta) proof is false — it hashes every sealed chunk per acquire
   (O(ledger)). Need a sound *skip* of applied chunks. → v2: git blob-OID oracle.
2. Numeric `{writer}-{NNN}` chunk names collide across same-WriterId branches;
   `merge=union` then mutates a "sealed" file. → v2: content-hash in identity.
3. Delta replay must preserve `read_all`'s canonical smallest-(time,id) idem
   winner; a later clock-skewed winner diverges. → v2: store winner sort key,
   rebuild on winner replacement.
4. Seal/reset needs a full durable-state recovery machine, not one crash window.
5. FS + SQLite transitions must be transactionally consistent; need a
   transaction-scoped apply primitive; atomic tail replacement not truncation.
6. 1 MiB tail bound contradicts 16 MiB `MAX_LINE_BYTES` — an oversized legal
   entry can't fit. → v2: oversized entry seals as its own one-entry chunk.
7. Migration assumed `{writer}.jsonl` is the tail; the real active file is the
   highest suffix. Rewrite around the real legacy layout, crash-certifiable.
8. Rewind detection + repair must run BEFORE destructive reconcile; must survive
   restart (last_git absent on reopen). → v2: persist last HEAD; detect→repair→reconcile.
9. `git_output` is private, UTF-8-lossy, byte-trimming — unusable for blob
   recovery. Need a bounded binary-safe blob reader + parent-tree enumeration;
   compare IDs + canonical winners, not just "idem absent".
10. Operation-specific parent recovery: revert (single pre-revert parent), merge
    (union all parents), octopus (every parent); fail closed on ambiguity.
11. Expand Phase 0: skip-soundness, branch chunk collision, duplicate-idem winner
    replacement, exhaustive seal crash injection, legal-line-larger-than-tail,
    legacy multi-segment migration w/ crash, git-mutation-during-flock, delta↔read_all
    parser equivalence. SP-0.2 must test parent-set/path/envelope semantics.
12. Amend `coherence-format-v0.md` §§1, 5.1, 5.2, 5.5, 9.4 before Phase 1 (R21).

## Suggested (non-blocking) — folded into v2
- Richer `applied_chunks` schema (immutable identity, writer, len, hash, gen).
- Land telemetry in Phase 1 (dogfood reveals rebuild frequency early).
- Typed reconcile outcomes (DeltaApplied / CanonicalWinnerChanged / LedgerRewind /
  CorruptChunk / UnavailableEvidence), not one undifferentiated NonMonotonic.
- Gate DoD on named suites + fault matrices + `pnpm check:all` + fmt/clippy +
  cross-target, not a raw "452 tests" count.
