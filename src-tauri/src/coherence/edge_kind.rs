//! Origin-edge kind registry (Phase 2, ADR-P2 — placement decided by SP3:
//! kernel-level typed registry, `grills/coherence/spike-sp3-classifier-placement.md`).
//!
//! An edge's *kind* is its **propagation class** — orthogonal to `InputRole`
//! (which is provenance liveness: direct vs contextual). The registry is a total
//! `match` with no wildcard, so adding a variant fails to compile until it is
//! registered here (compile-time totality, the reason SP3 chose the kernel over
//! a schema-pack table).
//!
//! **Contradiction is NOT a kind** — it is an `EdgeCheck` assessment folded in by
//! `project_edge` (design D-table, G-B round-2 consistency #2). `Propagation` has
//! no `semantic` variant, by construction.

use serde::{Deserialize, Serialize};

/// The kinds of origin edge. `Dependency` is the default and the only kind the
/// shipped kernel captures today; the rest are registered for Phase 4 (canon
/// conformance) and the long tail, and become live as capture learns to record
/// them (spec §13.6, an additive optional `InputRef.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum OriginEdgeKind {
    /// A derived object read an upstream at a pinned revision — today's edges.
    #[default]
    Dependency,
    /// A conforming object uses a canon (Phase 4). Carries version-staleness.
    Conformance,
    /// A revision replaces a prior one for a purpose. Carries version-staleness.
    Supersession,
    /// Structural containment — inert (captured, visible, never stale).
    PartOf,
    /// A soft reference — inert.
    Mention,
}

/// How staleness flows along an edge of this kind. Deliberately only two
/// variants — a semantic/contradiction axis is an assessment, never a kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Propagation {
    /// Version-staleness flows (axis 1): a newer upstream restales this edge.
    Version,
    /// Inert: captured and shown in read models, but never in the stale set.
    None,
}

/// Where an edge came from — captured by a real transformation, or discovered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    Captured,
    Discovered,
}

impl OriginEdgeKind {
    /// The registry: `kind -> propagation`. A no-wildcard `match`, so a new
    /// variant will not compile until it is given a propagation here.
    pub fn propagation(self) -> Propagation {
        match self {
            OriginEdgeKind::Dependency
            | OriginEdgeKind::Conformance
            | OriginEdgeKind::Supersession => Propagation::Version,
            OriginEdgeKind::PartOf | OriginEdgeKind::Mention => Propagation::None,
        }
    }

    /// The registry: `kind -> origin`.
    pub fn origin(self) -> Origin {
        match self {
            OriginEdgeKind::Dependency
            | OriginEdgeKind::Conformance
            | OriginEdgeKind::Supersession
            | OriginEdgeKind::PartOf => Origin::Captured,
            OriginEdgeKind::Mention => Origin::Discovered,
        }
    }

    /// Does version-staleness flow along this kind? The single predicate
    /// `project_edge` consults in place of "all direct edges are version-stale".
    pub fn propagates_version(self) -> bool {
        matches!(self.propagation(), Propagation::Version)
    }

    /// Stable wire tag (matches the `edge_kind` index column, spec §13.6).
    pub fn as_str(self) -> &'static str {
        match self {
            OriginEdgeKind::Dependency => "dependency",
            OriginEdgeKind::Conformance => "conformance",
            OriginEdgeKind::Supersession => "supersession",
            OriginEdgeKind::PartOf => "part-of",
            OriginEdgeKind::Mention => "mention",
        }
    }

    /// Parse the wire tag. An unknown/absent tag reads as `Dependency` — legacy
    /// rows have no tag and are dependencies (spec §13.6; format stays 0).
    pub fn parse(tag: &str) -> Self {
        match tag {
            "conformance" => OriginEdgeKind::Conformance,
            "supersession" => OriginEdgeKind::Supersession,
            "part-of" => OriginEdgeKind::PartOf,
            "mention" => OriginEdgeKind::Mention,
            _ => OriginEdgeKind::Dependency,
        }
    }
}

#[cfg(test)]
#[path = "edge_kind.test.rs"]
mod tests;
