# Spike SP3 — relationship-classifier placement (ADR-P2)

> **Status: PASS / DECISION RECORDED (2026-07-20).** 7/7 green
> (`src-tauri/tests/spike_sp3_edge_kind_registry.rs`). **Decision: kernel-level
> typed `OriginEdgeKind` registry.** Both placements are **fairly** prototyped —
> a kernel `match` (side a) and a schema-pack data table + generic interpreter
> (side b) that genuinely reproduces the version axis. The decision rests on
> type-safety/totality/single-source, not on the (wrong) claim that propagation
> can't be data.

## The question

Phase 2 generalizes the hardcoded **version** axis into an edge-kind registry so
conformance (Phase 4) and the long tail (`supersession`, `part-of`, `mention`)
become registrations rather than new hardcoded branches. ADR-P2 asks *where the
registry lives*: in the kernel (a typed enum + a `(origin, shape, propagation)`
table consulted by `project_edge`) or as a Tier-1 schema-pack declaration loaded
at runtime.

## Decision: kernel-level typed registry

**Both placements can express v1 propagation as data.** Propagation for v1 is a
small enum (`version | none`), not a closure — so a schema-pack data table
*can* carry it, read by a generic kernel interpreter. The earlier rationale
("propagation is behavior, not data") was **wrong** (G-B round-5 #4): a genuinely
new propagation *behavior* would need kernel code in **both** placements, so that
is not what separates them.

**The real trade — type-safety/single-source vs runtime data-extensibility:**

| | Kernel `match` (side a) | Schema-pack table + interpreter (side b) |
|---|---|---|
| Add a known-tag kind | code change | **data change** (runtime-extensible) |
| Totality | compile-time (no-wildcard `match` won't build until registered) | runtime (unknown/typo'd tag → `None` at interpret time) |
| External data | none to parse/trust | table must be parsed, validated, trusted |
| Source of truth | one | split (table + interpreter) |
| New propagation *class* | extend kernel | extend interpreter (kernel) either way |

For v1 the kind set is small and semantically load-bearing — each kind's
propagation is a deliberate design decision, not user-supplied data — so the
kernel's **compile-time totality**, type-safety, and single-source win over a
runtime extensibility the runtime does not need. Revisit if/when kinds become
user-authored (schema packs, Tier 5). The spike's
`schema_pack_fails_at_runtime_where_the_kernel_fails_at_compile_time` test makes
the decisive difference concrete: a mistyped propagation tag compiles under (b)
and only fails when interpreted, whereas (a) would not build.

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

## Side (b), fairly prototyped and then out-competed

WI-0.3 asks to prototype *both* placements. Side (b) is a real schema-pack:
`SCHEMA_PACK` is a `const` data table of `KindDecl { name, origin, shape,
propagation }` rows, and `interpret_propagation` is a generic kernel interpreter
that reads the `propagation` tag → a `Propagation`. The test
`schema_pack_reproduces_the_version_axis` proves it answers the same question the
kernel does and agrees with `meta` for every shared kind — so it is *not* a straw
man; it genuinely works and is runtime-extensible for known tags.

It loses on the trade above, not on capability. `schema_pack_fails_at_runtime_...`
shows the decisive weakness: a typo'd/unknown propagation tag compiles and fails
only at interpret time, whereas the kernel's no-wildcard `match` would not build.
For a small, load-bearing, non-user-authored kind set, compile-time totality +
single-source beat runtime extensibility.

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
