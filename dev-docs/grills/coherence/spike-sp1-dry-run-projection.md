# Spike SP1 — dry-run projection over a disposable clone

> **Status: PASS (2026-07-20).** 3/3 fixtures green
> (`src-tauri/tests/spike_sp1_dry_run_projection.rs`). Proves ADR-P1 /
> `design-runtime.md` D2: a candidate preview computed by overlaying the
> candidate on a **clone** of the revision DAG yields the same projection as an
> independent commit-rebuild, and mints nothing.

## What it proves

The forward-operator preview (ADR-P1) must compute a candidate's staleness
**blast radius without committing** — no ledger entry, no CAS write, no index
mutation. The load-bearing question: does the staleness projection *compose over
an uncommitted overlay*, and is that overlay a faithful, side-effect-free model
of the eventual commit?

SP1 answers yes, at the pure-kernel level where the projection actually lives
(`project_edge`, `project.rs:124` — pure over
`(edge, ctx, dag, resolutions, checks, now)`).

## Method

Two **independent** code paths reach the projected graph, and their projections
over the affected edge set are compared as multisets of
`(SemanticEdgeKey, Option<EdgeState>)`:

- **PREVIEW:** `base_dag.clone()` then `record_output(candidate)` on the clone.
- **COMMIT:** a fresh `RevisionDag` replayed from base outputs **and** the
  candidate, in ledger order — exactly what `rebuild_from` does.

`SemanticEdgeKey` is the plan's bag key
`(upstream, pinned, downstream, downstream_rev, role, input_ordinal)`; equality
is by multiset (multiplicity preserved), envelope id/time/idem excluded.

Three assertions per fixture:
1. **preview multiset == commit multiset** (the D2 property).
2. **the clone did not mutate the base DAG** (heads of the changed object equal
   before/after the overlay).
3. **on-disk immutability:** the base corpus is persisted through a real
   `Ledger`; the ledger directory bytes are byte-identical before and after the
   preview runs — the preview "mints nothing" in the literal, on-disk sense.

## Fixtures (each green)

| Fixture | Candidate | Property exercised |
|---|---|---|
| `linear_restale` | new upstream revision `u2` (child of `u1`) | version-stale edge reads `VersionStale` identically in preview and commit |
| `downstream_retirement` | new **downstream** revision `d2` | `resolve(D)` moves to `d2 ≠ d1`, so the edge retires (`Some → None`) — the D2 downstream-incident liveness change is caught by preview |
| `divergence_creating_candidate` | sibling upstream `u2b` while committed head is `u2a` | `resolve(U)` becomes `DivergedHeads`; the edge reads `Diverged{multi_head}` identically |

## Scope and honest limits

- SP1 proves the **projection property**, not the shipped `project_candidates` /
  `coherence_preview` API — those are Phase-3.0/Phase-3 work (WI-3.0a, WI-3.1).
  The kernel today exposes no disposable-clone or bounded-read-view API
  (`load_dag` is `pub(super)`); the bounded `ReadView` is design v4.4, built in
  Phase 3.0.
- The affected-set enumeration here is hand-constructed from a known corpus; the
  production form derives it from `edges_by_upstream(X) ∪ edges_by_downstream(X)`
  (v4.4), where `edges_by_downstream` does not yet exist.
- SP1 is the prerequisite the **SP0** end-to-end slice depends on (sequencing
  SP1 → Phase 3.0 → SP0 → Phase 3).

## Run

```
cargo test --manifest-path src-tauri/Cargo.toml \
  --test spike_sp1_dry_run_projection -- --nocapture
```
