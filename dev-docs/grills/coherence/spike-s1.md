# Spike S1 — Ledger Segments Under Git Branch + Merge (WI-0.5)

- **Traces:** R17 (paper §8; spec §5.1/§5.3/§5.5 of
  `dev-docs/specs/coherence-format-v0.md`)
- **Probe:** `probes/s1-ledger-merge.mjs` (Node, zero deps) — results in
  `probes/s1-results.json`
- **Environment:** macOS (darwin 25.5.0), git 2.50.1 (Apple Git-155),
  Node 26.5.0. All probe repos created in fresh `mktemp`-style temp
  directories; nothing ran inside the vmark repo.

> Status: **PASS** — all 7 scenarios behave acceptably for the spec §5.1 reader rules on macOS

## Purpose

Spec §5.5 claims that per-writer JSONL segments plus
`ledger/*.jsonl merge=union` (declared in `.vmark/.gitattributes`) survive
real git branching and merging: no conflict markers, no lost entries, and
any duplication/reordering rendered harmless by self-identified idempotent
entries (R17). This spike verifies the claim end-to-end with real repos,
real merges, and spec-shaped entries (§5.3 envelope:
`format`/`id`/`kind`/`time`/`writer`/`idem`/`body`; UUIDv7 ids; `idem` per
the §5.4.1 recipe), plus a reference reader implementing §5.1 (merge all
segments → dedupe by `idem` keeping smallest `(time, id)` → sort by
`(time, id)`).

## Method

Each scenario builds a fresh temp repo with `.vmark/ledger/`,
`.vmark/.gitattributes` (`ledger/*.jsonl merge=union`) and
`.vmark/.gitignore` committed at the base, then branches, appends entries,
merges, and asserts on the merged bytes and on the reader's logical output.
A control scenario (A0) runs the same-segment merge **without** the
attribute to prove the union driver — not ordinary 3-way merging — is what
resolves the EOF race.

## Scenario matrix

7/7 acceptable (`probes/s1-results.json`, generated 2026-07-18):

| # | Scenario | Key assertions | Observed | Pass |
|---|---|---|---|---|
| A0 | Control: same-segment appends on two branches, **no** `merge=union` | Merge must conflict (attribute is load-bearing) | Conflict + markers, as expected | ✅ |
| A | Same writer segment, branches `a`/`b`, distinct appends, merge `b` into `a` | Exit 0; no markers; all 5 entries present; valid JSONL | Clean union; 5 lines; file order `base, a1, a2, b1, b2` | ✅ |
| B | Two per-writer segments, one edited per branch | Clean merge; both segments intact; 4 logical entries | Clean; 2+2 lines; 4 logical | ✅ |
| C | Same `idem` appended on both branches (different `id`/`time` — replay) | Reader yields exactly 1 logical entry; winner = smallest `(time, id)` | 3 physical lines (2 dup copies); 1 logical; earlier-time entry won | ✅ |
| D | Interleaved append times → non-chronological file order after union | Reader deterministic under read order; output sorted by `(time, id)` | File order `t1, t3, t2, t4` (non-chronological); reader identical under reversed read; sorted output | ✅ |
| E | BOTH branches append THE SAME byte-identical line | Valid JSONL; exactly 1 logical entry | **1 physical copy** after merge (git resolved identical additions to one line); 1 logical | ✅ |
| F | Same NEW segment file created on both branches (add/add) | Union applies to add/add; no markers; both entries present | Clean union; 2 lines; both present | ✅ |

## Findings — `merge=union` behavior actually observed

1. **The attribute is load-bearing.** Without it, two branches appending
   to the same segment is a real merge conflict with markers (A0). The
   kernel must guarantee `.vmark/.gitattributes` is written at init and
   committed with (or before) the first segment — which the spec's
   lazy-init already does, since init writes both in the same step.
2. **Union does not preserve chronology.** The union driver keeps "ours"
   lines before "theirs" within the conflicting EOF hunk: scenario A
   produced `a1, a2, b1, b2`; scenario D produced `t1, t3, t2, t4`. File
   order after a merge is meaningless — exactly the premise R17 bakes in.
3. **Byte-identical lines added by both branches collapsed to one copy**
   (E). git resolves identical same-position additions as one change (the
   trivial-merge path; union's "keep both sides" applies to *differing*
   hunks). For the ledger this is the good direction — exactly-once
   physically — and the reader's `idem` dedupe covers the two-copy case
   anyway (O_APPEND replay after crash recovery can still produce physical
   duplicates outside git).
4. **Replayed logical operations (same `idem`, different `id`/`time`)
   survive as two physical lines** (C) — union has no idea they are the
   same operation. The §5.1 reader rule (dedupe by `idem`, keep smallest
   `(time, id)`) resolved them to exactly one logical entry with a
   deterministic winner. This rule is not optional.
5. **Add/add unions cleanly** (F). A segment file created independently on
   both branches (the spec's "two branches of one clone share a writer ID"
   case, §5.5) merges without conflict under the attribute, both first
   entries preserved. The §5.5 claim holds even when the segment did not
   exist at the branch point.
6. **Quirk: git prunes the empty `ledger/` directory on branch switch.**
   Empty directories are untracked; switching to a branch where the
   segment doesn't exist deletes the file *and* the then-empty directory.
   The first probe run failed on exactly this. **The writer must
   `mkdir -p` the ledger directory before every append**, not only at
   init. (WI-1.2 implementation note.)
7. **Caveat (untested, by design):** merge attributes are resolved from
   the merging side's checkout. A branch that somehow predates
   `.vmark/.gitattributes` would merge segments without union. Lazy init
   writes the attributes file together with the first segment, so segments
   cannot exist without it; noted for completeness only.

## Implications for the WI-1.2 reader

- **Order-independence is mandatory, verified, and sufficient.** The
  reader must never assume chronological or contiguous entries in a
  segment (D). Sorting by `(time, id)` after reading yields a
  deterministic result regardless of physical order — verified identical
  under adversarial read order.
- **`idem` dedupe with the `(time, id)` tie-break is required.** Git
  union-merge (C) and crash-replay both produce physical duplicates;
  keeping the smallest `(time, id)` gave a deterministic single winner.
- **Merging all segments is the read unit** (B): per-writer files are an
  anti-conflict measure, not a partition of meaning.
- **The writer must create the ledger directory before each append**
  (finding 6) and must treat a missing segment file as normal (branch
  switch can remove it; subsequent appends recreate it, and git merge
  reunites the histories).
- **JSONL single-line discipline matters:** union is line-based, so an
  entry containing internal newlines would be shredded by a merge. The
  spec already forbids internal newlines (§5.2); torn final lines are a
  quarantine case (§5.6), not a merge case, since merges operate on
  committed content.

## Reproduce

```bash
node dev-docs/grills/coherence/probes/s1-ledger-merge.mjs   # KEEP=1 to keep temp repos
```
