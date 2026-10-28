// WI-AL2.2f — the order a framed request is answered in: a malformed identity is an invalid request before anything is read; a stale incarnation precedes the generation's liveness, which precedes the receipt lookup; a pair that does not belong together is a conflict; and page generations travel as canonical u64 decimal strings everywhere they are named
//! R86, R90 rule 6, R93 and R94, through `Controller::prepare_framed`,
//! `Controller::abandon` and `PageTable::register`.

use serde_json::json;

use crate::agent_journal::admission::request_support::*;

#[test]
fn a_malformed_identity_is_invalid_request() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    let upper = format!("{}A", &a.identity[..31]);
    let cases = [
        ("pageIdentity", json!(upper)),
        ("pageIdentity", json!("short")),
        ("incarnation", json!("not-hex")),
        ("webviewGeneration", json!("abc")),
        ("webviewGeneration", json!(null)),
    ];
    for (key, value) in cases {
        let bad = with(&p, key, value.clone());
        let e = r.prepare(&a, &bad).expect_err("malformed");
        assert_eq!(journal_code(&e), "INVALID_REQUEST", "{key} = {value}");
        assert!(
            detail(&e).get("uncertain").is_none(),
            "decided before any request state"
        );
        let e = r.abandon(&a.label, &bad).expect_err("malformed abandon");
        assert_eq!(
            journal_code(&e),
            "INVALID_REQUEST",
            "abandon {key} = {value}"
        );
    }
    let mut missing: serde_json::Value = serde_json::from_str(&p).unwrap();
    missing.as_object_mut().unwrap().remove("pageIdentity");
    let e = r.prepare(&a, &missing.to_string()).expect_err("missing");
    assert_eq!(journal_code(&e), "INVALID_REQUEST");
    assert_eq!(
        r.sizes(),
        (0, 0, 0, 0, 0),
        "nothing recorded for a malformed frame"
    );
}

#[test]
fn u64_identity_forms_through_register_prepare_and_abandon() {
    let r = rig();
    r.pages.set_next(u64::MAX - 1);
    let a = r.page("doc-a", 1);
    assert_eq!(
        a.generation,
        (u64::MAX - 1).to_string(),
        "above 2^53, exact"
    );
    let p = r.p(&a, None, "text");
    r.prepare(&a, &p).expect("a canonical string generation");
    assert_eq!(
        r.abandon(&a.label, &p).expect("abandon above 2^53")["state"],
        "aborted"
    );

    // u64::MAX is well-formed everywhere, though the counter never mints
    // it: a payload naming it is answered by liveness, and a `replaces`
    // naming it is no page's, so the register mints afresh.
    let top = "18446744073709551615";
    let q = with(&r.p(&a, None, "text"), "webviewGeneration", json!(top));
    assert_eq!(state(&r.prepare(&a, &q).unwrap_err()), "staleGeneration");
    assert_eq!(
        state(&r.abandon(&a.label, &q).unwrap_err()),
        "staleGeneration"
    );
    let fresh = rig();
    let b = fresh.page("doc-b", 1);
    fresh
        .pages
        .register(
            Some(&fresh.c.writer),
            &b.label,
            &ident(5),
            Some((&b.identity, top)),
        )
        .expect("a well-formed replaces, on a counter not yet exhausted");

    for bad in [
        json!("18446744073709551616"),
        json!(u64::MAX - 1),
        json!("018446744073709551614"),
        json!("+1"),
        json!("1e3"),
    ] {
        let q = with(&r.p(&a, None, "other"), "webviewGeneration", bad.clone());
        let e = r.prepare(&a, &q).expect_err("non-canonical");
        assert_eq!(journal_code(&e), "INVALID_REQUEST", "prepare {bad}");
        let e = r.abandon(&a.label, &q).expect_err("non-canonical abandon");
        assert_eq!(journal_code(&e), "INVALID_REQUEST", "abandon {bad}");
    }
    let e = r
        .pages
        .register(
            Some(&r.c.writer),
            &a.label,
            &ident(2),
            Some((&a.identity, "01")),
        )
        .expect_err("a non-canonical replaces");
    assert_eq!(journal_code(&e), "INVALID_REQUEST");
}

#[test]
fn stale_incarnation_precedes_generation_and_lookup() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    r.prepare(&a, &p).expect("prepare");
    let r = r.reopen();
    // Dead generation, and a body that conflicts with the receipt.
    r.pages.started(&a.label);
    let q = with(&p, "preimage", json!("other text"));
    let e = r.prepare(&a, &q).expect_err("old incarnation");
    assert_eq!(
        answer(&e),
        (
            "STALE_REQUEST".into(),
            "staleIncarnation".into(),
            Some(true)
        )
    );
    let e = r
        .abandon(&a.label, &q)
        .expect_err("old incarnation abandon");
    assert_eq!(state(&e), "staleIncarnation");
}

#[test]
fn receipt_owner_proof_requires_current_incarnation() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p(&a, None, "text");
    r.prepare(&a, &p).expect("prepare");
    let r = r.reopen();
    let e = r
        .prepare(&a, &p)
        .expect_err("the receipt answers only its own incarnation");
    assert_eq!(state(&e), "staleIncarnation");
    // Re-framing under the new incarnation changes the digest the receipt holds.
    let reframed = with(
        &p,
        "incarnation",
        json!(r.c.writer.incarnation().to_string()),
    );
    let e = r.prepare(&a, &reframed).expect_err("a re-framed payload");
    assert_eq!(
        answer(&e),
        ("INVALID_REQUEST".into(), "conflict".into(), Some(true))
    );
}

#[test]
fn payload_identity_mismatch_with_its_generation_is_conflict() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.register("doc-a", 2);
    let p = r.p(&a, None, "text");
    for (key, value) in [
        ("pageIdentity", json!(b.identity)),
        ("pageIdentity", json!(ident(9))),
    ] {
        let e = r
            .prepare(&a, &with(&p, key, value))
            .expect_err("pair mismatch");
        assert_eq!(
            answer(&e),
            ("INVALID_REQUEST".into(), "conflict".into(), Some(true))
        );
    }
    let other = r.page("doc-b", 3);
    let e = r
        .prepare_as(&other.label, &p)
        .expect_err("another label's generation");
    assert_eq!(state(&e), "conflict");
    assert_eq!(r.sizes(), (0, 0, 0, 0, 0), "a conflict records nothing");
}

#[test]
fn identity_byte_changes_follow_refusal_precedence() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.register("doc-a", 2);
    let p = r.p(&a, None, "text");
    r.prepare(&a, &p).expect("prepare");
    let cases = [
        ("incarnation", json!(ident(7)), "staleIncarnation"),
        ("webviewGeneration", json!("999"), "staleGeneration"),
        ("webviewGeneration", json!(b.generation), "conflict"),
        ("pageIdentity", json!(b.identity), "conflict"),
        ("preimage", json!("texT"), "conflict"),
    ];
    for (key, value, want) in cases {
        let q = with(&p, key, value);
        let e = r.prepare(&a, &q).expect_err("one byte changed");
        assert_eq!(state(&e), want, "prepare with {key} changed");
        let e = r.abandon(&a.label, &q).expect_err("one byte changed");
        assert_eq!(state(&e), want, "abandon with {key} changed");
    }
    assert_eq!(r.sizes(), (0, 0, 1, 1, 1), "the original untouched");
}
