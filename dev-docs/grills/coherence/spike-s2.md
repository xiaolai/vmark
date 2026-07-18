# Spike S2 — rusqlite (bundled): index rebuild-from-scan + breakdown-query budgets

- **Work item:** WI-0.6 (`dev-docs/plans/20260718-coherence-layer.md`); validates R16, O6.
- **Budgets under test:** `dev-docs/specs/coherence-format-v0.md` §10 (rebuild ≤ 10 s,
  breakdown ≤ 100 ms, single-edge projection ≤ 1 ms, at 5,000 objects / 200,000 entries /
  ~500,000 edges / p95 ≤ 500 revisions per object).
- **Probe:** `dev-docs/grills/coherence/probes/s2-rusqlite/` (standalone cargo project,
  spike-class, not app code). Measured numbers: `probes/s2-rusqlite/results.json`.
- **Date:** 2026-07-18. **Host:** Apple M5, 32 GiB, macOS (Darwin 25.5). `cargo run --release`.

> Status: **PASS** — rebuild 1.3s (budget 10s), breakdown query 84.5ms (budget 100ms)

## 1. Method

### 1.1 Synthetic workspace (generation — excluded from all budgets)

The probe synthesizes a full `.vmark/ledger/` at spec §10 target scale and writes it as
**real JSONL segment files** in the §5.3 envelope (`format`/`id`/`kind`/`time`/`writer`/
`idem`/`body`, UUIDv7 ids, RFC 3339 times, spec-recipe `idem` digests, real SHA-256
`rev1:` revision ids per §2.3):

- 5,000 objects; 200,000 entries = 199,200 `transformation` + 400 `navigation` +
  200 `ratification` + 150 `waiver` + 50 `check-result`.
- Revisions per object follow a capped power law (exponent 1.3, cap 500): p50 = 10,
  p95 = 199, max = 500 — "most objects few revisions, some hundreds", p95 ≤ 500 ✓.
- 498,729 input references (407,484 `direct`, 91,245 `contextual`); every non-root
  transformation carries its own previous revision as input 0 plus 0–4 Zipf-sampled
  upstreams **pinned at the upstream's head at generation time**, so old edges go
  version-stale naturally as upstreams advance.
- Revision DAGs are mostly linear with 2% branch / 1% merge events → 1,052 objects end
  multi-head (their referencing edges must project Diverged under all-live).
- 4 writers, per-writer segments with the §5.1 8 MiB rotation → 28 segment files,
  205.4 MiB. Entries are round-robin-interleaved across writers, so any single segment
  read in isolation is massively out of causal order — the rebuild is forced to honor
  R17 order-independence (an input pin routinely arrives before the entry that mints
  that revision, from another writer's segment).
- Generation: 1.06 s (recorded separately; not part of any budget).

### 1.2 Rebuild-from-scan (the R16 path; ≤ 10 s budget)

Parse every segment line-by-line (serde with borrowed `&RawValue` bodies; malformed
lines counted for quarantine — 0 here; `idem` de-duplication via in-memory set), and
build the index in one transaction with prepared statements:

- **Interning:** object UUIDs → `INTEGER oid`, `(object, rev1:…)` → `INTEGER rid`.
  Interning is on-first-sight, so cross-segment out-of-order references cost nothing.
  All TEXT identity is stored exactly once (`objects`, `revisions`).
- **Derived tables after the scan:** per-object heads (revisions with no children),
  `obj_heads` (head count `n`, the single head `h1` when unique, revision count), and
  `head_anc` — the strict ancestor closure of each head, materialized **only for
  objects with > 64 revisions** (spec §9.3); 231,342 rows.
- Resolution entries collapse to latest-per-`(txf, input, resolved_against)` (350 rows),
  matching §9.2's "latest resolution record for E with `resolved_against == sel`".
- Pragmas during rebuild: `journal_mode=OFF`, `synchronous=OFF` — safe because the
  index is disposable by contract (R16); a steady-state app connection would use WAL.
- Indices `edges(out_rev, role)` and `edges(txf, input_idx)` created after load; `ANALYZE`.
- Validation: 0 dangling pins (every pinned revision was eventually minted), 0
  quarantined, 0 idem duplicates; unknown/other kinds preserved-and-ignored (§5.3).

### 1.3 Breakdown query (≤ 100 ms warm) — ancestor-check design

**Documented choice:** neither a recursive CTE nor a full transitive closure is needed
for the all-live breakdown, because of a small theorem: *in a finite DAG every revision
reaches some head; if an object has exactly one head, every other revision is a strict
ancestor of it.* Under the all-live default context the §9.2 projection therefore
collapses to: multi-head upstream → Diverged; pin == the single head → Fresh (modulo
ratification/waiver); otherwise → VersionStale. The breakdown is a single join against
`obj_heads` plus a LEFT JOIN against the 350-row `resolved` table — no per-edge
ancestor walk at all. The materialized `head_anc` closure (and the ≤ 64-revision BFS
fallback) is still required and exercised — by pinned contexts and by the single-edge
projector, which implements §9.2 literally.

Two variants measured (5 warm runs each, median reported; timings include Rust-side
materialization of every result row):

- **Current-head breakdown** (the WI-1.9 view semantics: edges of the transformations
  that produced each object's current head revisions): 15,199 rows.
- **All-edges stress variant** (every direct edge in the ledger, historical included,
  per the spike brief): 407,484 rows.

### 1.4 Single-edge projection (≤ 1 ms warm) and R16 equivalence

The projector follows §9.2 literally with prepared statements: edge lookup → head
resolve → resolution lookup → ancestor check via `head_anc` (> 64 revisions) or naive
BFS over `parents` (≤ 64). 1,000 edges sampled across the table; the projector's
verdict was cross-checked against the set-based breakdown on every sampled edge
(**0 mismatches** — closure, BFS, and the single-head shortcut agree).

Equivalence: run both breakdowns → digest sorted `(txf, input_idx, state)` → delete
`index.db` → rebuild from the same segments → re-run → **identical digests** (this
prefigures the WI-1.5 delete-and-rescan test).

## 2. Schema DDL (as built by the probe)

```sql
PRAGMA user_version = 1;
CREATE TABLE objects   (oid INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE);
CREATE TABLE revisions (rid INTEGER PRIMARY KEY, object INTEGER NOT NULL,
                        rev TEXT NOT NULL, txf TEXT, UNIQUE(object, rev));
CREATE TABLE parents   (rid INTEGER NOT NULL, parent INTEGER NOT NULL,
                        PRIMARY KEY (rid, parent)) WITHOUT ROWID;
CREATE TABLE edges     (eid INTEGER PRIMARY KEY, txf TEXT NOT NULL,
                        input_idx INTEGER NOT NULL, upstream INTEGER NOT NULL,
                        pinned INTEGER NOT NULL, downstream INTEGER NOT NULL,
                        out_rev INTEGER NOT NULL, role INTEGER NOT NULL);
CREATE TABLE heads     (object INTEGER NOT NULL, rev INTEGER NOT NULL,
                        PRIMARY KEY (object, rev)) WITHOUT ROWID;
CREATE TABLE obj_heads (object INTEGER PRIMARY KEY, n INTEGER NOT NULL,
                        h1 INTEGER, revs INTEGER NOT NULL);
CREATE TABLE head_anc  (head INTEGER NOT NULL, anc INTEGER NOT NULL,
                        PRIMARY KEY (head, anc)) WITHOUT ROWID;
CREATE TABLE resolved  (txf TEXT NOT NULL, input_idx INTEGER NOT NULL,
                        against INTEGER NOT NULL, kind INTEGER NOT NULL,
                        PRIMARY KEY (txf, input_idx, against)) WITHOUT ROWID;
-- post-load: CREATE INDEX idx_edges_outrev ON edges(out_rev, role);
--            CREATE INDEX idx_edges_txf    ON edges(txf, input_idx);
```

## 3. Measured results (release build, Apple M5)

| Operation / dimension | Spec target · budget | Measured | Headroom |
|---|---|---|---|
| Objects / entries / edges | 5,000 / 200,000 / ~500,000 | 5,000 / 200,000 / 498,729 | — |
| Revisions per object (p95) | ≤ 500 | 199 (p50 10, max 500) | ✓ |
| Full index rebuild from scan | ≤ 10 s | **1.337 s** (2nd run 1.123 s; scan+insert 0.98 s, derive 0.11 s, index 0.24 s) | **7.5×** |
| Breakdown, current-head edges (WI-1.9 semantics) | ≤ 100 ms | **6.4 ms** median (15,199 rows) | **15.7×** |
| Breakdown, ALL direct edges (stress) | ≤ 100 ms | **84.5 ms** median (407,484 rows) | 1.2× |
| Single-edge projection (warm) | ≤ 1 ms | **p95 60 µs** (mean 13.5 µs, max 207 µs, n=979) | **16.7×** |
| Delete-index → rebuild → re-query | identical results | identical digests | ✓ |
| Projector vs. breakdown agreement | — | 0 mismatches / 979 | ✓ |
| `index.db` size | — | 106.5 MiB | — |
| Ledger size / segments | — | 205.4 MiB / 28 segments (4 writers) | — |
| Generation (not budgeted) | — | 1.06 s | — |

State distribution (all-live context): current-head breakdown 511 fresh / 4,789
version-stale / 9,899 diverged; all-edges 2,222 / 92,218 / 313,044. The high diverged
share is an artifact of the synthetic 2%-branch rate compounding over long chains
(21% of objects end multi-head); it does not flatter the timings — query cost is
row-count-driven, not state-driven. Waived showed 0 because all 150 synthetic waivers
were bound to a `resolved_against` the upstream later advanced past — exactly the §5.4.3
re-open behavior; the resolution join itself was exercised (350 `resolved` rows).

## 4. ADR-C1 decision: **bundled** SQLite (confirmed)

`rusqlite 0.40.1` with the `bundled` feature (SQLite **3.53.2** compiled in). Note the
crate is now past the 0.3x series; 0.40.1 is current latest.

Rationale, in order of weight:

1. **Windows has no system SQLite.** VMark ships macOS + Windows + Linux; a non-bundled
   build would need per-platform link strategies anyway. Bundled makes all three
   platforms run byte-identical SQLite.
2. **Deterministic version.** macOS system `sqlite3` here is 3.51.0 (an Apple build —
   note the `…aapl` suffix), and it varies by OS release; Apple compiles it with
   non-default options. The disposable-index contract (R16) tolerates version drift,
   but "same query planner everywhere" removes a whole class of cross-platform
   performance surprises for zero ongoing cost.
3. **Feature floor is not the issue** — the schema uses `WITHOUT ROWID` (≥ 3.8.2) and
   nothing newer (no recursive CTE needed, see §1.3; no generated columns) — but with
   bundled we never have to reason about it again.
4. **Cost is negligible:** the entire release spike binary is 2.7 MiB including SQLite
   (~1.2 MiB of it); rusqlite compiles the C amalgamation once (~20 s cold, cached
   thereafter).

Per rule 60 §4: rusqlite is an established crate (rust-lang-nursery lineage, ~20M
downloads); `cargo audit` must run on the PR that adds it to `src-tauri` (WI-1.5).

## 5. Implications for WI-1.5 index design

1. **Adopt the interning schema.** INTEGER `oid`/`rid` keys with TEXT identity stored
   once keep the DB at ~107 MiB at 10×-headroom scale and make every hot join
   integer-only. Without interning, `head_anc` + `edges` alone would carry hundreds of
   MB of repeated 69-byte revision strings.
2. **Materialize `obj_heads` (n, h1, revs).** It is what makes the all-live breakdown
   ancestry-free (single-head theorem, §1.3) and the projector's first probe O(1).
   Invalidation is per-object (spec §9.2): on any new revision/resolution touching
   object X, recompute X's heads row (+ its `head_anc` rows if revs > 64) — no global
   recompute.
3. **Serve the WI-1.9 view with the current-head query** (6.4 ms, 15× headroom). The
   all-edges variant passes (84.5 ms) but with only 1.2× headroom — treat it as a
   stress bound, not a UI query; historical-edge audits should paginate.
4. **Keep both ancestor paths of §9.3.** BFS-under-64 and closure-above-64 agree
   (0 mismatches) and the projector's p95 is 60 µs — 16× under budget — so the 64
   threshold needs no tuning.
5. **No parallelism needed.** Rebuild is single-threaded and 7.5× under budget with
   per-row `execute()` calls; don't add rayon or batched value-list INSERTs in v1.
6. **Rebuild pragmas:** `journal_mode=OFF, synchronous=OFF` during rebuild (index is
   disposable, R16), WAL for the steady-state connection.
7. **`resolved` keyed `(txf, input_idx, against)`** with latest-wins collapse matches
   the §9.2 resolution rule and keeps the breakdown's LEFT JOIN trivially cheap.
8. **Create secondary indices after bulk load** (`edges(out_rev, role)`,
   `edges(txf, input_idx)`), then `ANALYZE` — 0.24 s of the 1.34 s total.

## 6. Caveats

- Synthetic content: revision content hashes are hashes of random seeds; real
  canonicalization/CAS cost is WI-1.3/S1 territory and is not in the rebuild number
  (the rebuild parses the ledger only, which is also true of the real R16 path).
- The scan keeps interning maps and an idem set in RAM (~100 MB peak at this scale) —
  acceptable; note it if target scale ever grows another 10×.
- Timings measured on Apple M5; spec budgets are defined for Apple Silicon release
  builds (debug ≤ 4× allowance — headroom covers it).
- `check-result` entries are parsed and counted but not consulted by projection
  (Phase 2b; schema-fixed, reader-preserved per spec).

## 7. Reproduce

```bash
cd dev-docs/grills/coherence/probes/s2-rusqlite
cargo run --release -- /tmp path/to/results.json   # arg1: work dir base, arg2: results path
```
