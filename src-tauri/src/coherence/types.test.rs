// WI-1.1 — kernel core types: identity validation, revision-ID DAG identity
// (hash + sorted parents), spec §5.3/§5.4 wire-format round-trips, and the
// append-only envelope typing rules (unknown kinds preserved, malformed
// known kinds rejected). Golden vectors shared with the G1 capture probe
// (dev-docs/grills/coherence/probes/g1-capture.mjs) so the Rust and JS
// implementations cannot drift apart.

use super::*;
use serde_json::json;

const BARE_HASH: &str = "sha256:e59856b8f84f657f19d657aa2504758f3504e79dcc6e4aa999b0f9125edd4221";
const REV_ROOT: &str = "rev1:718593b8aaccb1613cb31899b20304b1b41cd9fc901b92a21f38a765760bce7f";
const REV_CHILD: &str = "rev1:08e1172b299cfa1d6dc7cd4dfc3cf435adcfc9f1e634633d3caedbc65d8395d0";
const REV_MERGE: &str = "rev1:ccde6633946fc024552ca8687826d123acd6a5670522d820e3b86e14e810908b";

fn ch() -> ContentHash {
    ContentHash::parse(BARE_HASH).unwrap()
}

#[test]
fn content_hash_parse_accepts_valid_and_rejects_invalid() {
    assert!(ContentHash::parse(BARE_HASH).is_ok());
    assert!(ContentHash::parse("sha256:zz").is_err());
    assert!(ContentHash::parse("md5:e59856b8").is_err());
    assert!(ContentHash::parse("").is_err());
    // 63 hex chars — one short
    assert!(ContentHash::parse(&format!("sha256:{}", "a".repeat(63))).is_err());
    // uppercase hex is not canonical
    assert!(ContentHash::parse(&format!("sha256:{}", "A".repeat(64))).is_err());
}

#[test]
fn revision_id_parse_accepts_valid_and_rejects_invalid() {
    assert!(RevisionId::parse(REV_ROOT).is_ok());
    assert!(RevisionId::parse("rev2:abcd").is_err()); // unknown scheme for v0 writers
    assert!(RevisionId::parse(BARE_HASH).is_err());
    assert!(RevisionId::parse(&format!("rev1:{}", "g".repeat(64))).is_err());
}

#[test]
fn revision_id_compute_matches_golden_vectors() {
    let root = RevisionId::compute(&ch(), &[]);
    assert_eq!(root.as_str(), REV_ROOT);
    let child = RevisionId::compute(&ch(), std::slice::from_ref(&root));
    assert_eq!(child.as_str(), REV_CHILD);
    let merge = RevisionId::compute(&ch(), &[child.clone(), root.clone()]);
    assert_eq!(merge.as_str(), REV_MERGE);
}

#[test]
fn revision_id_parent_order_is_canonicalized() {
    let root = RevisionId::parse(REV_ROOT).unwrap();
    let child = RevisionId::parse(REV_CHILD).unwrap();
    let a = RevisionId::compute(&ch(), &[root.clone(), child.clone()]);
    let b = RevisionId::compute(&ch(), &[child, root]);
    assert_eq!(a, b, "parent ordering must not affect identity (R30)");
}

#[test]
fn revision_id_distinguishes_content_parents_and_recreation() {
    let other = ContentHash::parse(&format!("sha256:{}", "0".repeat(64))).unwrap();
    let root = RevisionId::compute(&ch(), &[]);
    assert_ne!(RevisionId::compute(&other, &[]), root, "content matters");
    // A -> B -> A: same content as root, different parent => distinct revision
    let child = RevisionId::compute(&ch(), std::slice::from_ref(&root));
    let re_created = RevisionId::compute(&ch(), &[child]);
    assert_ne!(re_created, root, "recreated content is a new revision");
}

#[test]
fn transformation_round_trips_spec_wire_format() {
    let body = json!({
        "inputs": [
            { "object": "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7", "revision": REV_ROOT, "role": "direct" },
            { "object": "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c8", "revision": REV_CHILD, "role": "contextual" }
        ],
        "outputs": [
            { "object": "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7", "revision": REV_CHILD,
              "content_hash": BARE_HASH, "parents": [REV_ROOT] }
        ],
        "agent": { "type": "model", "id": "claude-fable-5" },
        "intent": { "kind": "genie", "summary": "Rewrite scene 12" },
        "confidence": "exact"
    });
    let t: Transformation = serde_json::from_value(body.clone()).unwrap();
    assert_eq!(t.inputs.len(), 2);
    assert_eq!(t.inputs[0].role, InputRole::Direct);
    assert_eq!(t.agent.kind, AgentType::Model);
    assert_eq!(t.confidence, Confidence::Exact);
    let back = serde_json::to_value(&t).unwrap();
    assert_eq!(back, body, "serialization must match the spec wire format");
}

#[test]
fn agent_without_id_omits_the_field() {
    let a = Agent {
        kind: AgentType::Human,
        id: None,
    };
    assert_eq!(
        serde_json::to_value(&a).unwrap(),
        json!({ "type": "human" })
    );
}

#[test]
fn envelope_typing_dispatches_known_kinds() {
    let env = Envelope::new_test(
        "transformation",
        json!({
            "inputs": [], "outputs": [
                { "object": "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7", "revision": REV_ROOT,
                  "content_hash": BARE_HASH, "parents": [] }],
            "agent": { "type": "external" },
            "intent": { "kind": "observed-external-edit", "summary": "changed outside VMark" },
            "confidence": "unknown"
        }),
    );
    match env.typed().unwrap() {
        TypedBody::Transformation(t) => assert_eq!(t.confidence, Confidence::Unknown),
        other => panic!("expected transformation, got {other:?}"),
    }
}

#[test]
fn envelope_typing_preserves_unknown_kinds() {
    let env = Envelope::new_test("hologram-sync", json!({ "future": true }));
    match env.typed().unwrap() {
        TypedBody::Unknown { kind, body } => {
            assert_eq!(kind, "hologram-sync");
            assert_eq!(body, json!({ "future": true }));
        }
        other => panic!("unknown kind must be preserved, got {other:?}"),
    }
}

#[test]
fn envelope_typing_rejects_malformed_known_kind() {
    // 'transformation' missing outputs entirely -> malformed, quarantine path
    let env = Envelope::new_test("transformation", json!({ "inputs": [] }));
    assert!(env.typed().is_err());
}

#[test]
fn envelope_rejects_future_format_number() {
    let mut env = Envelope::new_test(
        "navigation",
        json!({ "git": { "op": "checkout", "from": "a", "to": "b" } }),
    );
    env.format = 1;
    assert!(
        env.typed().is_err(),
        "readers must reject newer formats (spec §header)"
    );
}

#[test]
fn check_result_and_claim_are_preserved_not_parsed() {
    // Phase 2b kinds: schema-validated now (spec §5.6), preserved untouched.
    let env = Envelope::new_test(
        "check-result",
        json!({
            "edge": { "txf": "018f3c7a-a001-7def-8a3c-1b2c3d4e5f60", "input": 0 },
            "pinned": REV_ROOT,
            "checked_against": REV_CHILD,
            "verdict": "unknown"
        }),
    );
    match env.typed().unwrap() {
        TypedBody::Preserved { kind, .. } => assert_eq!(kind, "check-result"),
        other => panic!("expected preserved, got {other:?}"),
    }
    // Malformed known kinds quarantine instead of festering.
    assert!(
        Envelope::new_test("check-result", json!({ "verdict": "maybe" }))
            .typed()
            .is_err()
    );
    assert!(Envelope::new_test("claim", json!({ "statement": "no id" }))
        .typed()
        .is_err());
    let ok_claim = Envelope::new_test(
        "claim",
        json!({ "claim": "018f3c7a-a001-7def-8a3c-1b2c3d4e5f61", "statement": "Elena is Marcus's daughter" }),
    );
    assert!(ok_claim.typed().is_ok());
}

#[test]
fn resolution_round_trips_and_requires_actor() {
    let body = json!({
        "edge": { "txf": "018f3c7a-a001-7def-8a3c-1b2c3d4e5f60", "input": 0 },
        "upstream_object": "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7",
        "pinned": REV_ROOT,
        "resolved_against": REV_CHILD,
        "actor": { "type": "human", "id": "xiaolai" },
        "reason": "Divergence intentional"
    });
    let r: Resolution = serde_json::from_value(body).unwrap();
    assert_eq!(r.edge.input, 0);
    assert_eq!(r.actor.id, "xiaolai");
    let missing_actor = json!({
        "edge": { "txf": "018f3c7a-a001-7def-8a3c-1b2c3d4e5f60", "input": 0 },
        "upstream_object": "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7",
        "pinned": REV_ROOT,
        "resolved_against": REV_CHILD
    });
    assert!(serde_json::from_value::<Resolution>(missing_actor).is_err());
}

#[test]
fn entry_sort_key_orders_across_precisions_then_id() {
    let mut a = Envelope::new_test("diagnostic", json!({ "code": "x", "message": "m" }));
    a.time = "2026-07-18T09:30:12Z".into();
    let mut b = a.clone();
    b.time = "2026-07-18T09:30:12.500Z".into();
    assert!(a.sort_key().unwrap() < b.sort_key().unwrap());
    let mut c = a.clone();
    c.time = a.time.clone();
    // identical times fall back to id ordering; ids are UUIDv7 so mint order
    let (x, y) = if a.id < c.id { (&a, &c) } else { (&c, &a) };
    assert!(x.sort_key().unwrap() <= y.sort_key().unwrap());
}

#[test]
fn entry_sort_key_rejects_garbage_time() {
    let mut a = Envelope::new_test("diagnostic", json!({ "code": "x", "message": "m" }));
    a.time = "yesterday-ish".into();
    assert!(a.sort_key().is_none());
}
