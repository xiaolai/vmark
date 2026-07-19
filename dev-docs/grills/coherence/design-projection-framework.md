# Design pass — projection framework (Phase 6)

> **Status: DESIGN PASS (2026-07-20).** Vision stage 4: *one abstraction for many
> synchronized views of one state.* This defines the **minimal shared read-model
> interface** (Theme E: it must exist before more bespoke panels accrue) and
> decomposes Phase 6. It unifies the surfaces already built — `breakdown`,
> `project_candidates` (preview), `edges_affected_by` (merge audit), and the
> canon view — which today each re-implement "project state → display rows."

## The problem

Every coherence surface is the same shape underneath: **take the append-only
ledger-derived state, choose a lens, and produce a set of display rows over the
*pure* projection** (`project_edge`). But each is written bespoke:

- `breakdown` — all live non-fresh edges, all-live context.
- `project_candidates` (preview) — the affected set under a transient overlay,
  returning a delta.
- `edges_affected_by` (merge audit) — the incident edges of a changed-object set.
- the canon view (Phase 4) — conformance edges grouped by carrier.

They share the projection kernel but not a *contract*, so each new surface (canon,
operator preview, merge audit) reinvents row assembly, ordering, and truncation.
Vision stage 4 is to make a new surface a **registration**, not a new panel.

## The abstraction: a `Projection`

A projection is a **pure function from (state snapshot, view parameters) to a set
of keyed rows**, plus a rule for what its *affected set* is (so it can be
maintained incrementally later):

```
trait Projection {
    type Params;          // e.g. context id; or a candidate overlay; or a changed-object set
    type Row;             // the display row (already: EdgeRow / PreviewDelta)

    /// The edges this projection is over, from the bounded read-view — NOT the
    /// whole graph. (breakdown = all live; preview = incident∪candidate; merge =
    /// affected-by; canon = conformance-by-carrier.)
    fn affected(&self, index: &CoherenceIndex, p: &Self::Params) -> Result<Vec<OriginEdge>, String>;

    /// Assemble rows by running the PURE `project_edge` over the affected set +
    /// the view's DAG/resolutions/checks/context. One projection kernel, one
    /// row-assembly path — no per-surface staleness reimplementation.
    fn rows(&self, index: &CoherenceIndex, p: &Self::Params, now: &str) -> Result<Vec<Self::Row>, String>;
}
```

The **minimal shared read-model interface** every row carries: the physical edge
identity (`(txf, input, downstream, downstream_rev)`), the projected
`structural_class` (check-independent) plus the full `EdgeState`, the edge kind,
and display paths. That is exactly what `EdgeRow` + `PreviewDelta` already carry —
Phase 6 factors it into one `CoherenceRow` the surfaces share.

## How the existing surfaces map (validation)

| Surface | `affected` | `rows` |
|---|---|---|
| breakdown | all live edges | `project_edge`, drop Fresh |
| preview | `edges_incident_to(changed) ∪ candidate edges` (overlay) | base-vs-candidate delta |
| merge audit | `edges_affected_by(changed objects)` | `project_edge` over the merge set |
| canon | conformance edges grouped by carrier object | `project_edge`, grouped |

All four already call the same pure `project_edge`; Phase 6 makes that structural
by giving them one `Projection` contract and one row type.

## Incremental view maintenance (deferred mechanism)

v1 is **re-project-on-demand** — what `breakdown`/`project_candidates` already do,
bounded by the read-view. The framework's *shape* (affected-set + pure rows) is
chosen so incremental view maintenance (differential dataflow: maintain each
projection's output as the ledger appends, updating only the rows whose affected
edges changed) can be added **without changing the surface contracts**. That is a
performance evolution, explicitly deferred — the append-only ledger + derived
index already make full re-projection cheap at §10 scale (spike S2).

## Decomposition (Phase 6, by plan amendment)

- **WI-6.1** — the `CoherenceRow` shared read-model + the `Projection` trait, with
  `breakdown` re-expressed as the reference implementation (behaviour-preserving,
  characterization-tested).
- **WI-6.2** — port `project_candidates` (preview) and `edges_affected_by` (merge
  audit) onto the trait; the canon view (Phase 4) registers as a `Projection`
  rather than a bespoke panel.
- **WI-6.3** — a single frontend read-model consumer (one table component fed by
  any `Projection`'s rows), so operator-preview / canon / merge UIs are
  *configurations*, not new components. (Frontend — needs visual QA.)
- **WI-6.4** — (optional, deferred) incremental view maintenance behind the same
  contracts, if a §10-scale profile ever shows re-projection is the bottleneck.

## Why decompose only now

Phase 6 was correctly *outlined, not decomposed*, in the plan: decomposing it
before the operator preview and canon views existed would have guessed at their
shapes. Now that `breakdown`, `project_candidates`, `edges_affected_by`, and the
canon design all exist, the common contract is **observed, not predicted** — the
four rows in the mapping table above are the evidence. This design pass discharges
the plan's "decomposed by a plan amendment after its own design pass" gate.

## Verdict

**Design pass complete.** The minimal shared read-model interface (`CoherenceRow`
+ `Projection`) is defined and validated against the four surfaces already built.
The backend refactor (WI-6.1/6.2) is committable; the unified frontend consumer
(WI-6.3) needs visual QA. Incremental maintenance (WI-6.4) is a deferred
performance evolution the contracts already accommodate.
