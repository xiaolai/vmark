// WI-AL1.2 — provenance bounds: a cap too small for the accumulator's fixed entries is refused, a transaction whose result would pass 2^53-1 is refused before anything changes (also through a bounded break), and a persisted map must account for the whole postimage (L(0) = 0, R(lenA) = lenB)
use crate::agent_journal::hunk_id::text_hash;
use crate::agent_journal::provenance::{
    BreakReason, Provenance, ProvenancePayload, Section, MAX_SAFE,
};
use serde_json::Value;

fn insert(at: i64, n: i64) -> Section {
    Section {
        from_a: at,
        to_a: at,
        from_b: at,
        to_b: at + n,
    }
}

#[test]
fn a_cap_below_the_fixed_entries_is_refused() {
    // Two pieces from the start, four after a whole break.
    for cap in 1..4 {
        assert!(Provenance::new(3, cap).is_err(), "cap {cap}");
    }
    assert!(Provenance::new(3, 4).is_ok());
}

#[test]
fn a_payload_with_a_cap_below_four_is_refused() {
    let p = Provenance::new(3, 4).unwrap();
    let payload = ProvenancePayload::encode("d", "1", "b", "abc", "abc", &p).unwrap();
    let mut v = serde_json::to_value(&payload).unwrap();
    for cap in [1, 3] {
        v["cap"] = Value::from(cap);
        assert!(serde_json::from_value::<ProvenancePayload>(v.clone()).is_err());
    }
    v["cap"] = Value::from(4);
    assert!(serde_json::from_value::<ProvenancePayload>(v).is_ok());
}

#[test]
fn an_insertion_before_a_suffix_cannot_push_the_length_past_max_safe() {
    // Each endpoint is in range; the shifted suffix is not.
    let mut p = Provenance::new(10, 16).unwrap();
    let before = p.clone();
    assert!(p.compose(&[insert(0, MAX_SAFE - 5)]).is_err());
    assert_eq!(p, before, "nothing changed");
    // Exactly at the limit is fine.
    assert!(p.compose(&[insert(0, MAX_SAFE - 10)]).is_ok());
    assert_eq!(p.len_b(), MAX_SAFE);
}

#[test]
fn a_refused_bounded_break_leaves_the_accumulator_unchanged() {
    let mut p = Provenance::new(10, 16).unwrap();
    let before = p.clone();
    let r = p.break_range(0, 0, MAX_SAFE - 5, BreakReason::UncertifiedRange, "wysiwyg");
    assert!(r.is_err());
    assert_eq!(p, before, "no sticky break from a refused range");
}

/// A payload for `pre` → `post` whose map is `p`'s with `l0`, `r0` and the
/// lengths replaced: hashes and lengths match the texts.
fn forged(pre: &str, post: &str, l0: u64, r0: u64) -> Value {
    let p = Provenance::new(pre.encode_utf16().count() as i64, 16).unwrap();
    let payload = ProvenancePayload::encode("d", "1", "b", pre, pre, &p).unwrap();
    let mut v = serde_json::to_value(&payload).unwrap();
    v["postHash"] = Value::from(text_hash(post));
    v["body"]["lenB"] = Value::from(post.encode_utf16().count() as u64);
    v["body"]["map"]["L0"] = Value::from(l0);
    v["body"]["map"]["R0"] = Value::from(r0);
    v
}

#[test]
fn a_map_leaving_a_leading_prefix_unaccounted_is_refused() {
    // Identity shifted right by one: "Z" was inserted, yet nothing touched.
    let v = forged("abc", "Zabc", 1, 1);
    assert!(serde_json::from_value::<ProvenancePayload>(v).is_err());
}

#[test]
fn a_map_leaving_a_trailing_suffix_unaccounted_is_refused() {
    // Identity, but the postimage has one more unit at the end.
    let v = forged("abc", "abcZ", 0, 0);
    assert!(serde_json::from_value::<ProvenancePayload>(v).is_err());
}

#[test]
fn a_genuine_insertion_at_either_end_still_decodes() {
    let mut p = Provenance::new(3, 16).unwrap();
    p.compose(&[insert(0, 1)]).unwrap();
    p.compose(&[insert(4, 1)]).unwrap();
    let payload = ProvenancePayload::encode("d", "1", "b", "abc", "ZabcZ", &p).unwrap();
    let v = serde_json::to_value(&payload).unwrap();
    let back: ProvenancePayload = serde_json::from_value(v).expect("decodes");
    back.check_texts("abc", "ZabcZ").expect("maps the texts");
}
