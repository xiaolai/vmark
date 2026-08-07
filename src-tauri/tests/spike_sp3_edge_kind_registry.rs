//! Spike SP3 — relationship-classifier placement (plan WI-0.3).
//!
//! Resolves ADR-P2: does the edge-kind registry live in the **kernel** (a typed
//! `OriginEdgeKind` + a `(origin, shape, propagation)` table consulted by
//! `project_edge`) or in a **Tier-1 schema-pack declaration**?
//!
//! ## Recorded decision: KERNEL-LEVEL TYPED REGISTRY
//!
//! Both placements can express the *current* propagation classes as **data** —
//! propagation for v1 is a small enum (`version | none`), not a closure. (The
//! earlier "propagation is behavior, not data" rationale was wrong, per G-B
//! round-5 #4; a genuinely *new* propagation behavior would need kernel code in
//! BOTH placements, so that is not what separates them.) The real trade is
//! **type-safety and single-source vs runtime data-extensibility**:
//!
//! - **Kernel (a):** the `kind -> (origin, shape, propagation)` mapping is a Rust
//!   `match` with no wildcard, so adding a variant **fails to compile until it is
//!   registered** — compile-time totality. No external data to parse, trust, or
//!   validate. One source of truth.
//! - **Schema-pack (b):** a data table `[{name, origin, shape, propagation}]`
//!   plus a generic kernel **interpreter** that reads the `propagation` tag.
//!   Adding a kind whose tag the interpreter already knows is a *data* change —
//!   genuine runtime extensibility. But a typo'd or unknown tag compiles and
//!   fails at **runtime**; the table must be parsed, validated, and trusted; and
//!   a new propagation class still needs the interpreter (kernel) extended.
//!
//! For v1 the kind set is small and semantically load-bearing — each kind's
//! propagation is a deliberate design decision, not user-supplied data — so the
//! kernel's compile-time totality and type-safety outweigh a runtime
//! extensibility the runtime does not need. **Decision: kernel registry.**
//! Revisit if/when kinds become user-authored (schema packs, Tier 5).
//!
//! This probe prototypes **both** sides and proves each reproduces the version
//! axis, then demonstrates the trade (the interpreter's runtime-failure mode).
//! Contradiction is deliberately **absent** from either registry — it is an
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

// ---- side (b), FAIRLY prototyped: a schema-pack table + kernel interpreter ---
//
// The honest schema-pack placement (G-B round-5 #4): kinds are DATA rows that
// carry a `propagation` *tag*, and a generic kernel INTERPRETER reads the tag.
// This genuinely reproduces the version axis — adding a kind whose tag the
// interpreter knows is a data change, not a code change. It is a real
// alternative, not a straw man.

/// One kind declared as pure data (what a schema pack would ship).
struct KindDecl {
    name: &'static str,
    origin: &'static str,      // "captured" | "discovered"
    shape: &'static str,       // "directional" | "symmetric"
    propagation: &'static str, // "version" | "none"  ← the decision-bearing datum
}

/// A schema pack: a table of declarations, parsed/trusted at load.
const SCHEMA_PACK: &[KindDecl] = &[
    KindDecl {
        name: "dependency",
        origin: "captured",
        shape: "directional",
        propagation: "version",
    },
    KindDecl {
        name: "conformance",
        origin: "captured",
        shape: "directional",
        propagation: "version",
    },
    KindDecl {
        name: "supersession",
        origin: "captured",
        shape: "directional",
        propagation: "version",
    },
    KindDecl {
        name: "part-of",
        origin: "captured",
        shape: "directional",
        propagation: "none",
    },
    KindDecl {
        name: "mention",
        origin: "discovered",
        shape: "directional",
        propagation: "none",
    },
];

/// The generic kernel interpreter: reads a declaration's tag → a Propagation.
/// `None` means the tag is unknown — a **runtime** failure the kernel `match`
/// (side a) makes impossible at compile time.
fn interpret_propagation(tag: &str) -> Option<Propagation> {
    match tag {
        "version" => Some(Propagation::Version),
        "none" => Some(Propagation::None),
        _ => None, // unknown propagation class — needs the interpreter extended
    }
}

fn schema_pack_lookup(name: &str) -> Option<&'static KindDecl> {
    SCHEMA_PACK.iter().find(|d| d.name == name)
}

#[test]
fn schema_pack_reproduces_the_version_axis() {
    // Side (b) answers the same question side (a) does, via data + interpreter.
    let dep = schema_pack_lookup("dependency").expect("declared");
    assert_eq!(
        interpret_propagation(dep.propagation),
        Some(Propagation::Version)
    );
    let part = schema_pack_lookup("part-of").expect("declared");
    assert_eq!(
        interpret_propagation(part.propagation),
        Some(Propagation::None)
    );

    // ...and it agrees with the kernel registry for every shared kind.
    assert_eq!(
        interpret_propagation(schema_pack_lookup("conformance").unwrap().propagation),
        Some(meta(OriginEdgeKind::Conformance).propagation)
    );

    // The declaration also carries origin/shape as data — the full metadata a
    // schema pack would ship, matching the kernel `meta` for the shared kind.
    assert_eq!(dep.origin, "captured");
    assert_eq!(dep.shape, "directional");
    assert_eq!(schema_pack_lookup("mention").unwrap().origin, "discovered");
}

#[test]
fn schema_pack_fails_at_runtime_where_the_kernel_fails_at_compile_time() {
    // The decision-bearing difference: a schema-pack kind with a mistyped or
    // not-yet-supported propagation tag COMPILES and only fails when interpreted.
    let typo = KindDecl {
        name: "citation",
        origin: "captured",
        shape: "directional",
        propagation: "verison", // typo — nothing catches this at build time
    };
    assert_eq!(
        interpret_propagation(typo.propagation),
        None,
        "an unknown tag is a runtime failure; the kernel `match` would not compile"
    );
    // Side (a): `meta` has no wildcard, so a new/typo'd variant fails the BUILD —
    // `every_kind_has_exactly_one_registry_entry` documents that totality. That
    // compile-time safety, plus single-source and no external-data trust, is why
    // the decision is the kernel registry for v1 (see the module header).
}
