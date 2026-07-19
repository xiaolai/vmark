# Spike SP3 — relationship-classifier placement (ADR-P2)

> **Status: PASS / DECISION RECORDED (2026-07-20).** 5/5 green
> (`src-tauri/tests/spike_sp3_edge_kind_registry.rs`). **Decision: kernel-level
> typed `OriginEdgeKind` registry**, not a Tier-1 schema-pack declaration.

## The question

Phase 2 generalizes the hardcoded **version** axis into an edge-kind registry so
conformance (Phase 4) and the long tail (`supersession`, `part-of`, `mention`)
become registrations rather than new hardcoded branches. ADR-P2 asks *where the
registry lives*: in the kernel (a typed enum + a `(origin, shape, propagation)`
table consulted by `project_edge`) or as a Tier-1 schema-pack declaration loaded
at runtime.

## Decision: kernel-level typed registry

**Propagation is executable behavior, not data.** "A version-stale upstream
restales this edge" is a rule the projection *runs*, not a value it *reads*. In
the tier model (paper §10), declarative metadata is Tier 1 but executable
behavior is **Tier 5 (deferred)**. A Tier-1 schema-pack could declare a kind's
metadata (origin, shape) but its *propagation rule* would still need kernel code
— so a schema-pack placement would buy an extensibility the runtime can't yet
honor, and split each kind's definition across two tiers.

This is the same argument `design-runtime.md` D5 used to keep operators built-in
Rust rather than Tier-1 functions. Consistency: edge-kind propagation and
operators are both behavior, so both are kernel-Rust in v1.

**Trade accepted:** adding a kind is a code change. That is correct — kinds are
few, semantically load-bearing, and each carries a propagation consequence that
must be characterization-tested anyway. The kernel registry is type-safe,
single-source (no runtime table to drift), and totality-checked by the compiler
(a non-wildcard `match` fails to compile until a new variant is registered).
Revisit only if/when Tier 5 (executable schema packs) ships.

## Prototype (the chosen side), proven

| Kind | origin | shape | propagation | Proves |
|---|---|---|---|---|
| `Dependency` | Captured | Directional | **Version** | reproduces today's hardcoded version axis |
| `Conformance` | Captured | Directional | **Version** | Phase-4 canon edges compose with zero projection change |
| `Supersession` | Captured | Directional | **Version** | long-tail version-carrying kind |
| `PartOf` | Captured | Directional | **None** | inert — captured/visible, never stale |
| `Mention` | Discovered | Directional | **None** | inert, discovery-origin |

Contradiction is **deliberately absent** from `OriginEdgeKind` — `Propagation`
has only `Version | None`, no `semantic`. The semantic axis stays an `EdgeCheck`
verdict folded in by `project_edge` (G-B round-2 consistency #2 / design
D-table). The `contradiction_is_not_representable_as_a_kind` test is the review
tripwire against re-introducing it.

## How Phase 2 consumes this

- `OriginEdge` (project.rs) gains `kind: OriginEdgeKind`; the `edges` table gains
  `edge_kind TEXT NOT NULL DEFAULT 'dependency'` (design v4.7). Legacy rows read
  `Dependency`, so behavior is unchanged until a non-dependency kind is captured.
- `project_edge` consults `propagates_version(kind)` where it currently assumes
  all direct edges carry version staleness. Inert kinds project to a visible-but-
  not-stale read-model row (never in the stale set).
- `edge_kind` is **orthogonal to `InputRole`**: role (Direct/Contextual) is
  provenance liveness; kind is the propagation class.

## Scope and limits

- This is a standalone prototype of the *decision*, not the wired-in Phase-2
  refactor (that is WI-2.1, characterization-tests-first against the shipped
  `project.rs`). The prototype's `meta`/`propagates_version` are the shape the
  kernel function will take.

## Run

```
cargo test --manifest-path src-tauri/Cargo.toml \
  --test spike_sp3_edge_kind_registry -- --nocapture
```
