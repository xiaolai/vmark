# Durable ledger store + git-revert auto-repair (Option 1)

> **Status: SUPERSEDED / WON'T-BUILD — owner chose Option A (2026-07-21).**
> The owner ratified O(ledger) reconcile as permanent; this durable-successor
> design is NOT being built. Retained as the record of why O(delta) was
> investigated and rejected (G-B review 02 proved it impossible without
> sacrificing soundness or the readable-ledger-as-truth invariant). See
> `dev-docs/grills/coherence/design-accept-consistency.md` §"Owner decision —
> Option A".
>
> --- original v2 status (historical) ---
> **DESIGN v2 — BLOCKED on an owner values decision (G-B review 02).**
> Review 02 falsified the load-bearing skip oracle (git HEAD certifies the
> COMMITTED tree, not the working-tree bytes reconcile reads) and proved
> {raw-JSONL-truth + O(delta) + soundness} cannot all hold. Choosing which
> constraint to relax (A concede O(delta) / B narrow threat model / C JSONL as
> projection) is a product-identity call, surfaced to the owner before further
> design. Records: `dev-docs/grills/coherence/durable-store/g-b-review-01.md`,
> `.../g-b-review-02.md`.
> Supersedes the interim "Option 2" ratification with the durable successor that
> ruling mandated. Owner directed the full build: O(delta) reconcile **and** full
> git-revert auto-repair — no telemetry-only stopgap, no diagnose-only revert.

## 1. Why

1. **Reconcile is O(ledger) per mutating op** — `with_write_lock` does
   `read_all()` + `rebuild_from(all)` every acquire. S2: 200k entries rebuild in
   1.34 s ⇒ ~130 ms at 20k. Correct, but a growing hot-path tax.
2. **`git revert` of a ledger-bearing commit loses provenance** — after reconcile
   to the reverted ledger, the head a git-mutation must be parented on is gone.

## 2. Non-negotiable constraints (owner ruling, 2026-07-21)

1. Human-readable plain-text JSONL stays canonical truth.
2. Ledger stays git-tracked, diffable, usable without VMark or SQLite.
3. SQLite projection stays disposable and fully rebuildable.
4. Normal local mutation is **O(delta)**; a non-monotonic external change may
   force a full rebuild.
5. **No inode/mtime/size fingerprint** may certify ledger↔index equivalence.

## 3. The soundness key — git blob OID, not metadata (review #1)

The nine-review fingerprint failed because it observed **metadata**
(inode/mtime/size). The sound, cheap oracle for a git-tracked file's content is
**git's own blob OID** — a content hash git already maintains. Any git operation
that changes a tracked file's committed bytes (revert, merge, checkout, reset,
rebase, amend, a pulled rewrite) changes its blob OID in the resulting HEAD tree.
This is a content identity, not metadata, so it satisfies constraint 5.

`git ls-tree -r HEAD -- <ledger-dir>` returns every committed chunk's
`(path, blob-oid)` in **one** subprocess. That is the whole applied-skip oracle:

- **Applied chunk, committed, OID unchanged** → skip, no re-read. Git guarantees
  the committed bytes. *(the O(delta) win)*
- **Applied chunk, committed, OID changed or absent from HEAD tree** → git
  rewrote/removed it → non-monotonic → §7 rebuild, or §8 rewind-repair if a
  MUTATION removed envelopes.
- **Sealed chunk present on disk but not in HEAD tree** → uncommitted → hash it
  (a small, recent set — the user commits periodically).
- **Active tail** → hash the bounded prefix (§5).

**Non-git workspace** (ledger present, no `.git`): no external agent can rewrite
tracked files, so the only writer is VMark itself under the flock. Fall back to
hashing all sealed chunks (O(ledger)) — correct, and only on the degenerate
never-in-git path. Constraint 2 keeps the ledger *usable* without git; it does
not promise O(delta) without git's identity service.

Soundness of the skip is **SP-0.1** — gating.

## 4. Architecture decisions

### ADR-1 — Sealed content-addressed chunks + one bounded active tail

- **Sealed chunk** — immutable JSONL, identity = SHA-256 of its exact bytes.
  On-disk name embeds the hash so identity is collision-free even across
  same-WriterId branches (review #2): `{writer}-{seq:06}-{hash16}.jsonl`, where
  `hash16` is the first 16 hex of the content SHA-256 and `seq` is **display
  metadata only**, never identity. `merge=union` cannot mutate a sealed file:
  two branches that sealed different content produce different `hash16` → distinct
  filenames → no union conflict. (Same content ⇒ same name ⇒ idempotent.)
- **Active tail** — the single appendable file `{writer}.tail.jsonl`. Distinct
  suffix (`.tail.jsonl`) so migration and listing never confuse it with a sealed
  chunk. Bounded to `SEAL_THRESHOLD` (candidate 4 MiB — see review #6 / §4.4).

### ADR-2 — Applied-state in the disposable index (review suggested #1)

```sql
CREATE TABLE applied_chunks (
  chunk_hash  TEXT PRIMARY KEY,   -- full sha256 of sealed bytes = identity
  file_name   TEXT NOT NULL,      -- {writer}-{seq}-{hash16}.jsonl (display/locate)
  writer      TEXT NOT NULL,
  byte_len    INTEGER NOT NULL,
  git_oid     TEXT,               -- HEAD blob OID when applied; NULL if uncommitted
  format_gen  INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE applied_tail (
  writer      TEXT PRIMARY KEY,
  offset      INTEGER NOT NULL,   -- bytes of tail applied
  prefix_hash TEXT NOT NULL       -- sha256 of tail[0..offset]
) WITHOUT ROWID;
CREATE TABLE reconcile_state (
  k TEXT PRIMARY KEY, v TEXT      -- e.g. last_head_sha (survives restart, review #8)
) WITHOUT ROWID;
-- canonical idem winner (review #3): rebuild if a new envelope beats the stored winner
CREATE TABLE applied_winner (
  idem TEXT PRIMARY KEY, sort_key TEXT NOT NULL
) WITHOUT ROWID;
```

`PRAGMA user_version` bump ⇒ mismatch forces a full rebuild = the migration path.

### ADR-3 — Canonical-winner-preserving delta replay (review #3)

`read_all` keeps the smallest `(time,id)` per idem; naive first-applied replay
diverges when a later-arriving chunk holds a smaller winner (clock skew across a
seal boundary). Rule: on replaying an entry whose idem is already in
`applied_winner`, compare sort keys. New key **larger** → ignore (loser).
New key **smaller** → it replaces the canonical winner → **force full rebuild**
(a determinate, rare event; correctness over cleverness). Reconcile returns the
typed outcome `CanonicalWinnerChanged` (review suggested #3).

### ADR-4 — Reconcile = detect topology → repair → apply delta → else rebuild

Typed outcomes: `DeltaApplied`, `CanonicalWinnerChanged`, `LedgerRewind`,
`CorruptChunk`, `UnavailableEvidence`, `FullRebuild`.

On the outermost `with_write_lock` acquire (under the flock):

1. **Topology first (review #8).** Read `reconcile_state.last_head_sha`; observe
   current HEAD (`gitops`). This happens BEFORE any destructive step, and works on
   reopen because `last_head_sha` is persisted, not the in-memory `last_git`.
2. **Applied-skip oracle (§3).** One `git ls-tree` (if git). Partition sealed
   chunks into unchanged-committed (skip), changed/removed-committed (→ 4/5), and
   uncommitted (hash).
3. **Rewind check (§8).** If applied chunks were removed/changed AND git classifies
   the HEAD move as MUTATION → `LedgerRewind` → §8 repair BEFORE reconciling away
   the pre-revert head. Never rebuild first.
4. **Apply new sealed chunks** (uncommitted-new or freshly committed-new): validate
   + apply each in **one SQLite transaction per chunk** (review #5), updating
   `applied_chunks` + `applied_winner` atomically.
5. **Tail delta.** Re-hash `tail[0..offset]`; equal → replay after `offset` (O(new
   bytes)); unequal → tail was externally rewritten → `FullRebuild` (§7).
6. Persist `last_head_sha`. Common case touches only new bytes + one git call.

### ADR-5 — Seal/reset durable-state machine (review #4, #5)

Sealing must be crash-certifiable. Ordered, each step durable before the next:

1. Write the sealed chunk to `tmp` (content = current tail bytes), fsync, rename
   to `{writer}-{seq}-{hash16}.jsonl`, fsync parent dir. *(chunk now durable)*
2. In one SQLite txn, insert its `applied_chunks` row + fold its entries into
   `applied_winner`. *(index knows the chunk)*
3. Atomically replace the tail with a fresh empty file (write empty `tmp`, fsync,
   rename over `{writer}.tail.jsonl`, fsync dir); reset `applied_tail` to (0, hash("")).

Recoverable durable states and their reconcile handling:

| Durable state after crash | Reconcile sees | Action |
|---|---|---|
| old tail only (pre-seal) | tail unsealed, prefix matches | replay tail delta — normal |
| sealed chunk written, txn not committed | new chunk on disk, absent from `applied_chunks` | apply it (step 4) — idempotent by content hash |
| chunk applied, tail not yet reset | chunk in `applied_chunks`; tail still full | tail prefix still matches `applied_tail`; replay re-sees already-applied entries → **deduped by idem** — safe |
| tail reset, `applied_tail` not reset | empty tail; `applied_tail.offset>0` | prefix hash of empty tail ≠ stored → detected; reset to (0,·) |
| fully sealed | fresh tail, chunk applied | normal |

Re-sealing after a crash reuses the **same content-addressed name** (same bytes ⇒
same hash16) — never allocates a second chunk (review #4).

### ADR-6 — Oversized legal entry seals immediately (review #6)

`MAX_LINE_BYTES` is 16 MiB; a group-prepare may be 4 MiB. If an entry would push
the tail past `SEAL_THRESHOLD`, the tail is sealed first; if the entry **alone**
exceeds `SEAL_THRESHOLD`, it is written as its **own one-entry sealed chunk**
directly (never buffered in the bounded tail). So the tail stays ≤ `SEAL_THRESHOLD`
and every legal entry has a home. `SEAL_THRESHOLD` is chosen from SP-0.1 (tail
re-hash cost) but MUST NOT be the reason a legal entry is unwritable — the
one-entry-chunk rule removes that coupling. Delta checkpointing handles torn final
lines, oversized lines, quarantine, and future-format entries **identically to
`read_all`** (shared parsing; SP-0.8 asserts equivalence).

### ADR-7 — Migration around the real legacy layout (review #7)

Legacy layout: per-writer `{writer}.jsonl`, `{writer}-{NNN}.jsonl`; the **active
file is the highest suffix** (`ledger.rs::active_segment`). Migration (one
crash-certifiable operation, gated by `user_version`):

1. Full `read_all()` + `rebuild_from()` (unchanged) → derived index.
2. Recompute canonical `applied_winner` for every idem.
3. Convert each legacy segment **except the active one** into a sealed chunk:
   compute its hash, record `applied_chunks` (+ `git_oid` from `ls-tree` if
   committed). The files may keep their legacy names — `file_name` locates them;
   identity is the hash. (No rename needed; avoids touching git history.)
4. Convert the active legacy segment into the new tail: record `applied_tail` =
   (len, prefix_hash) over its current bytes.
5. Bump `user_version` LAST, as the commit point. A crash before it re-runs the
   whole migration (idempotent — content-addressed).

Mixed old/new branches: a branch created pre-migration merges in legacy-named
segments; §3's `ls-tree` + content hashing treat them uniformly (name is not
identity).

## 5. Auto-repair (9R-3, full) — review #8, #9, #10

Triggered by ADR-4 step 3 `LedgerRewind`:

1. **Binary-safe recovery reader (review #9).** `git_output` is UTF-8-lossy and
   trims — unusable. Add `git_blob(root, sha, path) -> Vec<u8>` via
   `git cat-file blob {sha}:{path}` capturing raw stdout (no lossy String), bounded
   by `MAX_LINE_BYTES`×N. Enumerate parent ledger paths via
   `git ls-tree -r {parent} -- <ledger-dir>`.
2. **Operation-specific parents (review #10).** From the mutation commit:
   - revert (incl. revert-of-merge): its single pre-revert parent holds the
     evidence.
   - merge mutation: union evidence across **all** parents.
   - octopus: every parent (not a fixed two-parent helper).
   Resolve parents with `git rev-list --parents -n1 {HEAD}`.
3. **Recover by identity + canonical winner (review #9).** For each parent ledger,
   parse envelopes; a removed envelope is one whose **id** is absent from the
   current ledger, OR whose idem's canonical **winner** changed. "idem absent"
   alone is insufficient — a present loser whose smaller winner was removed must
   also be recovered.
4. **Validate** each (typed, well-formed idem). Any failure → `UnavailableEvidence`
   → §9.4.1 fail-closed diagnostic (never invent a parent).
5. **Idempotent reappend** into the recovering writer's own tail — the reader
   dedups by idem, so repeated repair is safe. A recovered envelope from **another**
   writer is reappended under a dedicated `recovery` provenance, never by pretending
   to own that writer's tail (review #9).
6. **Reconcile** (now monotonic), **rescan**, **mint** the git transformation from
   the restored per-operation heads; fail closed on missing snapshots rather than
   using every resulting head.

## 6. Fail-closed rebuild (§7 retained)

`read_all` + `rebuild_from` remains the recovery path for `FullRebuild` /
`CorruptChunk` / `CanonicalWinnerChanged`, recomputing all applied-state. Kept off
the common path by ADR-4.

## 7. Spec amendments before Phase 1 (review #12, R21)

Amend `coherence-format-v0.md`: §1 (format generation + `user_version` semantics),
§5.1 (sealed-chunk + tail layout, naming, `merge=union` interaction), §5.2 (seal
state machine + durability), §5.5 (reader over chunks+tail; delta≡read_all
equivalence), §9.4/§9.4.1 (rewind detect-before-reconcile; recovery segments).

## 8. Phases, WIs, DoD (review #11, suggested #4)

**Phase 0 — spikes (all PASS before Phase 1; `durable-store/`):**
- **SP-0.1** git-blob-OID skip soundness across revert/merge/checkout/reset/rebase;
  and the non-git fallback. *The load-bearing spike.*
- **SP-0.2** parent-set/path/envelope recovery semantics (revert, revert-of-merge,
  octopus) via `git cat-file` — not merely "git show returns a blob".
- **SP-0.3** same-WriterId branch chunk collision under `merge=union` (hash-named
  chunks don't collide; same-writer concurrent tail union is detected).
- **SP-0.4** legacy multi-segment migration with crash/restart: byte-identical
  `read_all` + identical index digest vs from-scratch.
- **SP-0.5** exhaustive seal crash injection over every ADR-5 durable state.
- **SP-0.6** canonical duplicate-idem winner replacement forces rebuild, not silent
  divergence.
- **SP-0.7** legal line larger than the tail → one-entry sealed chunk.
- **SP-0.8** delta-parser ≡ `read_all` (torn tail, oversized, quarantine,
  future-format) — property test over random append/seal/crash sequences.
- **SP-0.9** git mutation *during* a flocked op (observed-vs-applied topology).

**Phase 1 — chunked store + O(delta) reconcile (fail-closed on rewind).** DoD:
ADR-1/-3/-5/-6 store; ADR-2 tables + migration (ADR-7); ADR-4 reconcile with typed
outcomes + persisted `last_head_sha`; **delta path issues no `read_all` in the
common case** (counter-asserted); Phase-1 telemetry landed (suggested #2); named
suites + fault matrices green; `pnpm check:all`, `cargo fmt --check`, `clippy -D
warnings`, cross-target compile all green.

**Phase 2 — full git-revert auto-repair (§5).** DoD: binary-safe recovery reader;
op-specific parent recovery; identity+winner detection; idempotent reappend;
`ledger-history-rewound` fail-closed floor when evidence missing; the removed
`git_revert_is_captured_as_git_mutation` positive case restored + green; idempotent
across repeated scans; revert-of-merge and octopus covered.

**Phase 3 — telemetry warning surface.** DoD: rolling p95 + once-per-workspace
threshold warning (p95 50 ms / 7,500 entries); never makes a workspace unavailable.

Machine DoD: add `scripts/check-coherence-durable-phase.sh <N>`. WI linkage per
rule 60 §2.

## 9. Risks (updated)

- **Skip soundness rests entirely on git blob OID.** If SP-0.1 finds a git op that
  changes committed bytes without changing the HEAD-tree blob OID, the O(delta)
  claim collapses to the non-git fallback (O(ledger)). SP-0.1 is therefore the
  gate: no Phase 1 until it passes.
- **Seal ↔ tail-reset crash windows** — bounded by ADR-5's state table; SP-0.5
  injects each.
- **Auto-repair thrash** — validation gate + idem dedup make reappend idempotent
  and bounded.
- **Effort honesty** — this is a source-of-truth storage change; Phase 0 may
  invalidate an ADR (esp. SP-0.1/-0.8) and loop back to design before any
  production code. That is the intended control, not a failure.
