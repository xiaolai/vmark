//! Spike SP3 — relationship-classifier placement (plan WI-0.3).
//!
//! Resolves ADR-P2: does the edge-kind registry live in the **kernel** (a typed
//! `OriginEdgeKind` + a `(origin, shape, propagation)` table consulted by
//! `project_edge`) or in a **Tier-1 schema-pack declaration**?
//!
//! ## Recorded decision: KERNEL-LEVEL TYPED REGISTRY
//!
//! Propagation is *executable behavior*, not data: "a version-stale upstream
//! restales this edge" is a rule the projection runs, not a value it reads. In
//! the tier model (paper §10) declarative metadata is Tier 1, but executable
//! behavior is **Tier 5 (deferred)** — the same reason `design-runtime.md` D5
//! keeps operators built-in Rust rather than Tier-1 schema-pack functions. A
//! Tier-1 declaration could carry a kind's *metadata* (origin/shape) but its
//! *propagation* would still need kernel code, so a schema-pack placement buys
//! extensibility the runtime can't yet honor. The kernel registry is type-safe,
//! single-source, and characterization-testable. Revisit if/when Tier 5 lands.
//!
//! This probe prototypes the **chosen (kernel) side** and proves it reproduces
//! the two existing behaviors as registry entries: `Dependency` gets
//! propagation `Version` (today's hardcoded version axis), while inert kinds
//! (`PartOf`, `Mention`) get propagation `None` (captured and visible, but never
//! stale). Contradiction is deliberately **absent** from the registry — it is an
//! `EdgeCheck` assessment, not an origin-edge kind (G-B consistency #2).
//!
//! Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
//! spike_sp3_edge_kind_registry -- --nocapture`

// ---- the prototyped kernel registry (would live beside project.rs) ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OriginEdgeKind {
    /// A derived object read an upstream at a pinned revision (today's edges).
    Dependency,
    /// A conforming object uses a canon (Phase 4). Carries version-staleness.
    Conformance,
    /// A revision replaces a prior one for a purpose. Carries version-staleness.
    Supersession,
    /// Structural containment — inert.
    PartOf,
    /// A soft reference — inert.
    Mention,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Origin {
    /// Recorded by an actual transformation's input set.
    Captured,
    /// Inferred by a discovery pass (e.g. reference scan).
    Discovered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    Directional,
    /// Reserved for a future symmetric kind; no v1 kind registers it, which the
    /// `every_kind_...` test asserts. Kept in the enum so a symmetric kind is a
    /// deliberate registration, not an ad-hoc bool.
    #[allow(dead_code)]
    Symmetric,
}

/// The propagation class. **Not** a place for `semantic`/`contradiction`: that
/// axis is an assessment folded in by `project_edge`, never a kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Propagation {
    /// Version-staleness flows along this edge (axis 1).
    Version,
    /// Inert: captured and shown, never contributes to the stale set.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct KindMeta {
    origin: Origin,
    shape: Shape,
    propagation: Propagation,
}

/// THE registry — one total function, no runtime lookup table to drift.
fn meta(kind: OriginEdgeKind) -> KindMeta {
    use OriginEdgeKind::*;
    match kind {
        Dependency => KindMeta {
            origin: Origin::Captured,
            shape: Shape::Directional,
            propagation: Propagation::Version,
        },
        Conformance => KindMeta {
            origin: Origin::Captured,
            shape: Shape::Directional,
            propagation: Propagation::Version,
        },
        Supersession => KindMeta {
            origin: Origin::Captured,
            shape: Shape::Directional,
            propagation: Propagation::Version,
        },
        PartOf => KindMeta {
            origin: Origin::Captured,
            shape: Shape::Directional,
            propagation: Propagation::None,
        },
        Mention => KindMeta {
            origin: Origin::Discovered,
            shape: Shape::Directional,
            propagation: Propagation::None,
        },
    }
}

/// The single predicate a refactored `project_edge` would consult in place of
/// the hardcoded "all direct edges carry version staleness" assumption.
fn propagates_version(kind: OriginEdgeKind) -> bool {
    meta(kind).propagation == Propagation::Version
}

// ---- proofs -----------------------------------------------------------------

#[test]
fn dependency_reproduces_the_version_axis() {
    // Today `project.rs` treats every live direct edge as version-carrying.
    // Registering `Dependency` with propagation=Version reproduces exactly that.
    assert!(propagates_version(OriginEdgeKind::Dependency));
    assert_eq!(meta(OriginEdgeKind::Dependency).origin, Origin::Captured);
}

#[test]
fn inert_kinds_are_captured_but_never_stale() {
    for kind in [OriginEdgeKind::PartOf, OriginEdgeKind::Mention] {
        assert!(
            !propagates_version(kind),
            "{kind:?} must be inert (visible, never stale)"
        );
    }
}

#[test]
fn conformance_and_supersession_carry_version_staleness() {
    assert!(propagates_version(OriginEdgeKind::Conformance));
    assert!(propagates_version(OriginEdgeKind::Supersession));
}

#[test]
fn every_kind_has_exactly_one_registry_entry() {
    // Totality: `meta` is a match with no wildcard, so adding a variant fails to
    // compile until it is registered — the registry can never silently omit a
    // kind. This test documents the property; the compiler enforces it.
    let all = [
        OriginEdgeKind::Dependency,
        OriginEdgeKind::Conformance,
        OriginEdgeKind::Supersession,
        OriginEdgeKind::PartOf,
        OriginEdgeKind::Mention,
    ];
    for kind in all {
        let m = meta(kind);
        // Shape is currently always directional; symmetric is reserved for a
        // future kind and must be a deliberate registration, not a default.
        assert_eq!(m.shape, Shape::Directional, "{kind:?}");
    }
}

#[test]
fn contradiction_is_not_representable_as_a_kind() {
    // This is a compile-time guarantee, asserted here as documentation: there is
    // no `OriginEdgeKind::Contradiction`. The semantic axis is an `EdgeCheck`
    // verdict projected by `project_edge`, never a registry entry (G-B
    // consistency #2 / design D-table). If a future edit adds such a variant,
    // this test's comment is the tripwire in review.
    let kinds_with_no_semantic = [
        OriginEdgeKind::Dependency,
        OriginEdgeKind::Conformance,
        OriginEdgeKind::Supersession,
        OriginEdgeKind::PartOf,
        OriginEdgeKind::Mention,
    ];
    // No kind carries a "semantic" propagation — Propagation has only Version|None.
    for kind in kinds_with_no_semantic {
        let p = meta(kind).propagation;
        assert!(matches!(p, Propagation::Version | Propagation::None));
    }
}

// ---- the REFUTED side (b): a Tier-1 schema-pack declaration ------------------
//
// WI-0.3 asks to prototype BOTH placements. This is the minimal schema-pack
// declaration — a *data* record with no executable behavior, as Tier 1 requires
// (paper §10). It demonstrates by construction why schema-pack placement is
// refuted: the declaration can carry `origin`/`shape` metadata, but a kind's
// *propagation rule* is behavior that a declarative record cannot express — it
// would need Tier 5 (executable schema packs, deferred). So a schema-pack kind
// still requires kernel code for propagation, splitting each kind's definition
// across two tiers. The kernel registry (side a) keeps it whole.

/// A Tier-1 declaration carries only *nameable data* — never a rule/closure.
struct SchemaPackKindDecl {
    name: &'static str,
    origin: &'static str, // "captured" | "discovered"  (data)
    shape: &'static str,  // "directional" | "symmetric" (data)
                          // NOTE: there is deliberately NO `propagation: fn(...) -> ...` field here.
                          // Executable behavior is Tier 5; a Tier-1 record cannot hold it. That
                          // absence IS the refutation.
}

#[test]
fn schema_pack_declaration_cannot_carry_propagation_behavior() {
    // A schema pack CAN declare the metadata...
    let decl = SchemaPackKindDecl {
        name: "conformance",
        origin: "captured",
        shape: "directional",
    };
    assert_eq!(decl.name, "conformance");
    assert_eq!(decl.origin, "captured");
    assert_eq!(decl.shape, "directional");

    // ...but the propagation RULE for "conformance" — "a version-stale canon
    // restales its conformers" — is not derivable from this record; it must be
    // supplied by kernel code (the `meta`/`propagates_version` functions above).
    // The declaration alone cannot answer the one question projection needs:
    assert!(propagates_version(OriginEdgeKind::Conformance));
    // ^ that answer came from the KERNEL registry, not from `decl`. A pure Tier-1
    // pack would have to defer this to kernel behavior anyway — so the kernel is
    // where the kind belongs. Decision: kernel registry (recorded in the report).
}
