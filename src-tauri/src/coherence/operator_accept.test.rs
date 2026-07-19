// WI-3.0c — accept idem (design v4.1). Freezes DETERMINISM (same payload → same
// idem) and INJECTIVITY (any distinct payload → a distinct idem, incl. the
// optional-field None-vs-Some("") aliasing G-B round-3 flagged).

use super::*;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, InputRef, InputRole, Intent, ObjectId, OutputRef,
    RevisionId, Transformation,
};

fn oid(n: u8) -> ObjectId {
    ObjectId(uuid::Uuid::from_u128(n as u128))
}
fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}
fn rev(n: u8) -> RevisionId {
    RevisionId::compute(&hash(n), &[])
}

/// A fully-populated single-output transformation (every optional present).
fn base() -> Transformation {
    Transformation {
        inputs: vec![InputRef {
            object: oid(1),
            revision: rev(1),
            role: InputRole::Direct,
            kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
        }],
        outputs: vec![OutputRef {
            object: oid(2),
            revision: rev(2),
            content_hash: hash(2),
            parents: vec![rev(1)],
        }],
        agent: Agent {
            kind: AgentType::Human,
            id: Some("alice".into()),
        },
        intent: Intent {
            kind: "operator:revise".into(),
            summary: "tighten the intro".into(),
            prompt_hash: Some(hash(9)),
        },
        confidence: Confidence::Exact,
    }
}

fn idem(t: &Transformation) -> uuid::Uuid {
    operator_accept_idem("revise", 0, t).expect("single output")
}

#[test]
fn deterministic_same_payload_same_idem() {
    assert_eq!(idem(&base()), idem(&base()));
}

#[test]
fn multi_output_is_rejected() {
    let mut t = base();
    t.outputs.push(t.outputs[0].clone());
    assert!(operator_accept_idem("revise", 0, &t).is_err());
    // Zero outputs is also rejected.
    let mut empty = base();
    empty.outputs.clear();
    assert!(operator_accept_idem("revise", 0, &empty).is_err());
}

#[test]
fn version_8_and_variant_bits_are_set() {
    let u = idem(&base());
    let b = u.as_bytes();
    assert_eq!(b[6] & 0xf0, 0x80, "version nibble is 8");
    assert_eq!(b[8] & 0xc0, 0x80, "variant is RFC-4122");
}

/// Every field is part of the identity: mutating any one changes the idem.
#[test]
fn injective_over_every_field() {
    let base_idem = idem(&base());

    let mut cases: Vec<(&str, Transformation)> = Vec::new();

    let mut t = base();
    t.outputs[0].object = oid(99);
    cases.push(("output object", t));

    let mut t = base();
    t.outputs[0].content_hash = hash(99);
    cases.push(("output content hash", t));

    let mut t = base();
    t.outputs[0].revision = rev(99);
    cases.push(("output revision", t));

    let mut t = base();
    t.outputs[0].parents = vec![rev(1), rev(3)];
    cases.push(("output parents", t));

    let mut t = base();
    t.inputs[0].revision = rev(88);
    cases.push(("input revision", t));

    let mut t = base();
    t.inputs[0].role = InputRole::Contextual;
    cases.push(("input role", t));

    // G-B group-commit review #6: the input's edge KIND is part of the identity —
    // a Dependency vs Conformance input over the same object/revision must differ.
    let mut t = base();
    t.inputs[0].kind = crate::coherence::edge_kind::OriginEdgeKind::Conformance;
    cases.push(("input kind", t));

    let mut t = base();
    t.inputs.push(InputRef {
        object: oid(5),
        revision: rev(5),
        role: InputRole::Direct,
        kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
    });
    cases.push(("extra input", t));

    let mut t = base();
    t.agent.kind = AgentType::Model;
    cases.push(("agent kind", t));

    let mut t = base();
    t.agent.id = Some("bob".into());
    cases.push(("agent id", t));

    let mut t = base();
    t.intent.kind = "operator:split".into();
    cases.push(("intent kind", t));

    let mut t = base();
    t.intent.summary = "different summary".into();
    cases.push(("intent summary", t));

    let mut t = base();
    t.intent.prompt_hash = Some(hash(7));
    cases.push(("prompt hash", t));

    let mut t = base();
    t.confidence = Confidence::Inferred;
    cases.push(("confidence", t));

    for (label, t) in &cases {
        assert_ne!(idem(t), base_idem, "changing {label} must change the idem");
    }
    // The operator name and format are part of the tag/preimage too.
    assert_ne!(
        operator_accept_idem("split", 0, &base()).unwrap(),
        base_idem
    );
    assert_ne!(
        operator_accept_idem("revise", 1, &base()).unwrap(),
        base_idem
    );
}

/// None must never alias Some("") — the presence byte (`opt`) guarantees it.
#[test]
fn none_is_distinct_from_empty_string() {
    let mut with_none = base();
    with_none.agent.id = None;
    let mut with_empty = base();
    with_empty.agent.id = Some(String::new());
    assert_ne!(
        idem(&with_none),
        idem(&with_empty),
        "agent.id None vs Some(\"\")"
    );

    let mut ph_none = base();
    ph_none.intent.prompt_hash = None;
    // (prompt_hash is a ContentHash, which can't be empty — the None case is the
    // meaningful one: it must differ from any present hash.)
    assert_ne!(idem(&ph_none), idem(&base()), "prompt_hash None vs Some");
}

/// Parents are sorted, so declaration order of a parent set is irrelevant — but
/// the set itself is part of the identity.
#[test]
fn parents_are_order_independent_but_set_matters() {
    let mut a = base();
    a.outputs[0].parents = vec![rev(1), rev(3)];
    let mut b = base();
    b.outputs[0].parents = vec![rev(3), rev(1)]; // same set, reversed
    assert_eq!(idem(&a), idem(&b), "parent order must not matter");

    let mut c = base();
    c.outputs[0].parents = vec![rev(1), rev(4)]; // different set
    assert_ne!(idem(&a), idem(&c), "a different parent set must differ");
}
