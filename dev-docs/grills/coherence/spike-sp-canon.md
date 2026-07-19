# SP-canon — canon ontology + conformance-edge mapping (Phase 4 gate)

> **Status: DESIGN RESOLVED (2026-07-20).** Resolves the G-B round-2 gap that
> sank the old SP2: *"claims are not revision-DAG atoms, so the zero-change
> conformance-edge proof is invalid."* The fix is a **canon carrier object** that
> grounds claim-based canon in the existing version axis. The conformance edge
> composes with **zero kernel change** — proven by
> `project.test.rs::conformance_edge_composes_like_a_dependency`.

## The problem the old SP2 hit

The owner decision (design-runtime.md owner-decision 1) is that **canon is
claim-based / Context-hinged** — fed established claims in an enforcing Context
(`claims.rs` / `contexts.rs`) — **not** an "authoritative object" flag. But the
version-staleness axis (`project_edge`, `dag.rs`) is defined over **object
revisions**, and a *claim* is a derived claim-object with its own lifecycle
(stable id ≠ entry id, `claims.rs:21-23`), **not** a node in the revision DAG. So
"a conformance edge from a conformer to a canon carries version-staleness" has no
upstream revision to hang on — the old SP2's zero-change proof was invalid.

## Resolution: the canon carrier object

Canon stays **claim-based** at the *semantic* layer, but is **carried** by an
ordinary Semantic Object at the *versioning* layer:

- A **canon carrier** is a normal object (a markdown doc, e.g. `canon/magic.md`)
  whose content states the established claims for a concept-in-Context. It is an
  atom like any other — it has revisions in the DAG.
- The claims it feeds are the Phase-2b `claim` records extracted from / attached
  to that object (the existing claim pipeline). "Canon" = those claims **fed** in
  an **enforcing** Context (`is_fed` × enforcement) — unchanged from the paper.
- A **conformance edge** is an ordinary directional `OriginEdgeKind::Conformance`
  edge from a **conforming object** (upstream = the canon carrier it uses,
  downstream = the conformer) — exactly the shape of a dependency edge.

**Why this closes the gap.** The conformance edge's upstream is the **carrier
object**, which *does* have DAG revisions. When the canon's claims change, that is
recorded as a **new revision of the carrier** (editing `canon/magic.md`), which
advances the carrier's head → every conformance edge pinned at the old carrier
revision **version-stales**, through the *existing* projection. No claim needs to
be a DAG node; the carrier object is the version anchor, and the claims ride on
its revisions.

## What composes with zero kernel change (proven)

`OriginEdgeKind::Conformance` is registered as **version-propagating** (SP3 /
`edge_kind.rs`), so `project_edge` treats a conformance edge exactly like a
dependency edge:

- Carrier advances (claims changed) → conformer reads `VersionStale`.
- Carrier ratified/waived → the conformer resolves like any stale edge.
- N conformers on one carrier = a **star** (N edges), not a pairwise mesh
  (N(N−1)/2) — the re-coherence-tax lever, and the edge count is linear by
  construction (each conformer has one edge to the carrier).

Test: `project.test.rs::conformance_edge_composes_like_a_dependency` asserts a
conformance edge and a dependency edge over the same advanced upstream project
**identically** (`VersionStale`). This is the old SP2 claim, now valid.

## Claim-lifecycle → conformance-endpoint mapping (the G-B gap, resolved)

| Claim event | Carrier / edge effect |
|---|---|
| A new/changed established claim for the concept | Edit the carrier object → new carrier revision → conformers version-stale |
| A conformer starts using the canon | Capture records a conformance edge (upstream = carrier@rev, downstream = conformer@rev) — edge inference, not homework |
| Claim retired / superseded | Carrier revised (claim removed) → conformers stale; human ratifies/waives per edge |
| Context enforcement toggled (greenhouse ↔ enforcing) | Changes labeling/severity of the conformer's state, not the edge's existence (the paper's enforcement axis) |

The claim's *semantic* identity (its stable claim-id) is unchanged; the
*versioning* is delegated to the carrier object's revisions. A conformer depends
on **the carrier at a pinned revision**, so "which claim-set was in force when I
conformed" is exactly "which carrier revision I pinned."

## Deferred to Phase-4 WIs (decomposed under this design)

- **WI-4.1** canon carrier convention (frontmatter marking an object a
  canon carrier for a concept-in-Context; context-relative `Diverged` canon).
- **WI-4.2** capture inference of conformance edges (already a registered kind).
- **WI-4.3** `Extract-Canon` operator: detect a concept referenced by ≥k objects
  with pairwise-drift risk → propose a **carrier object + conformance edges** as a
  candidate changeset → preview blast radius → human accepts. **Multi-object** (a
  carrier + N edges), so it needs the deferred group-commit protocol — *not*
  Increment-1's single-object accept. This is why Phase 4 follows Phase 3's
  multi-object increment, not Increment-1.
- **WI-4.4** facet-level carriers (`canon/magic.combat.md`) so a facet change
  stales only the conformers of that facet (the granularity knob).
- **WI-4.5** canon-of-canon: a carrier conforming to another carrier — ordinary
  directional edges; staleness stays **local** (a forward closure walks the
  carrier DAG for *preview only*, never mutating `EdgeState`).

## Verdict

**Design resolved; the zero-change composition is proven.** Phase 4 is unblocked
*as a design*, but its `Extract-Canon` operator is **multi-object** and therefore
gated on the multi-object accept increment (group-commit), not on Increment-1.
The canon *carrier + conformance edge* mechanism itself needs no kernel change.
