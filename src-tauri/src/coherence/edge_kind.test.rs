// WI-2.1 — origin-edge kind registry. Freezes the propagation semantics SP3
// decided, and the legacy-default behaviour that keeps format 0 additive.

use super::*;

#[test]
fn dependency_is_the_default() {
    assert_eq!(OriginEdgeKind::default(), OriginEdgeKind::Dependency);
}

#[test]
fn version_carrying_kinds() {
    assert!(OriginEdgeKind::Dependency.propagates_version());
    assert!(OriginEdgeKind::Conformance.propagates_version());
    assert!(OriginEdgeKind::Supersession.propagates_version());
}

#[test]
fn inert_kinds_never_carry_version_staleness() {
    assert!(!OriginEdgeKind::PartOf.propagates_version());
    assert!(!OriginEdgeKind::Mention.propagates_version());
    assert_eq!(OriginEdgeKind::PartOf.propagation(), Propagation::None);
    assert_eq!(OriginEdgeKind::Mention.propagation(), Propagation::None);
}

#[test]
fn origins() {
    assert_eq!(OriginEdgeKind::Dependency.origin(), Origin::Captured);
    assert_eq!(OriginEdgeKind::Mention.origin(), Origin::Discovered);
}

#[test]
fn wire_tag_round_trips() {
    for kind in [
        OriginEdgeKind::Dependency,
        OriginEdgeKind::Conformance,
        OriginEdgeKind::Supersession,
        OriginEdgeKind::PartOf,
        OriginEdgeKind::Mention,
    ] {
        assert_eq!(OriginEdgeKind::parse(kind.as_str()), kind);
    }
}

#[test]
fn unknown_or_legacy_tag_is_dependency() {
    // Legacy rows have no edge_kind → read as dependency (format stays 0).
    assert_eq!(OriginEdgeKind::parse(""), OriginEdgeKind::Dependency);
    assert_eq!(OriginEdgeKind::parse("legacy"), OriginEdgeKind::Dependency);
    assert_eq!(
        OriginEdgeKind::parse("contradiction"),
        OriginEdgeKind::Dependency,
        "contradiction is not a kind — it never parses to one"
    );
}

#[test]
fn serde_uses_kebab_wire_form() {
    let json = serde_json::to_string(&OriginEdgeKind::PartOf).unwrap();
    assert_eq!(json, "\"part-of\"");
    let back: OriginEdgeKind = serde_json::from_str("\"conformance\"").unwrap();
    assert_eq!(back, OriginEdgeKind::Conformance);
}
