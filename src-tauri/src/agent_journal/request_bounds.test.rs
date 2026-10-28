// WI-AL2.2f — the request state is bounded: past the in-flight cap a new id is refused busy, not admitted, and fenced; a page generation holding PER_GENERATION fences and in-flight entries is sealed, after which its new ids are staleGeneration and nothing more is stored for it; a burst of unknown abandons stops at the seal; and the page recovers by registering a replacement, which drops the old generation's state
//! R68, R75 rules 1–2 and R81 rule 4, through `Controller::prepare_framed`
//! and `Controller::abandon`.

use serde_json::json;

use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::admission::requests::{INFLIGHT, PER_GENERATION};
use crate::agent_journal::ids::RevisionId;

/// A prepare refused before admission: its parent is not the head.
fn refused_p(r: &Rig, page: &Page) -> String {
    r.p(page, Some(RevisionId::new()), "text")
}

#[test]
fn the_limits_are_the_documented_ones() {
    assert_eq!((INFLIGHT, PER_GENERATION), (64, 1024));
}

#[test]
fn the_65th_blocked_request_is_busy_not_admitted_and_its_original_abandoned() {
    // The cap lowered to one entry: the test holds one original, where the
    // default needs 64 held at once.
    let r = rig();
    r.c.writer.lock().requests.set_limits(1, PER_GENERATION);
    let a = r.page("doc-a", 1);
    let held = r.p(&a, None, "text");
    let (h, go) = hold_original(&r, &a, &held);

    let next = r.p(&a, None, "other");
    let e = r.prepare(&a, &next).expect_err("past the cap");
    assert_eq!(
        answer(&e),
        ("JOURNAL_BUSY".into(), "notAdmitted".into(), Some(false))
    );
    assert_eq!(
        r.sizes(),
        (1, 1, 0, 0, 0),
        "the refused id fenced, nothing else"
    );

    go.send(()).unwrap();
    h.join().unwrap().expect("the held original admits");
    let e = r
        .prepare(&a, &next)
        .expect_err("the refused id's later attempt");
    assert_eq!(
        answer(&e),
        ("STALE_REQUEST".into(), "abandoned".into(), Some(false))
    );
}

#[test]
fn refusals_and_one_inflight_seal_the_generation() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let refused: Vec<String> = (0..PER_GENERATION - 1).map(|_| refused_p(&r, &a)).collect();
    for p in &refused {
        assert_eq!(state(&r.prepare(&a, p).unwrap_err()), "notAdmitted");
    }
    assert_eq!(r.sizes(), (0, PER_GENERATION - 1, 0, 0, 0));

    let last = refused_p(&r, &a);
    let (h, go) = hold_original(&r, &a, &last);
    let fresh = r.p(&a, None, "text");
    let e = r
        .prepare(&a, &fresh)
        .expect_err("the one in flight sealed it");
    assert_eq!(
        answer(&e),
        ("STALE_REQUEST".into(), "staleGeneration".into(), Some(true))
    );
    go.send(()).unwrap();
    let e = h.join().unwrap().expect_err("the in-flight one is refused");
    assert_eq!(state(&e), "notAdmitted");
    assert_eq!(
        r.sizes(),
        (0, PER_GENERATION - 1, 0, 0, 0),
        "nothing fenced into a sealed generation"
    );

    for p in [&refused[0], &refused[PER_GENERATION - 2], &last] {
        assert_eq!(state(&r.prepare(&a, p).unwrap_err()), "staleGeneration");
    }
}

#[test]
fn sealed_generation_replaced_and_old_payload_is_stale_generation() {
    let r = rig();
    r.c.writer.lock().requests.set_limits(INFLIGHT, 4);
    let a = r.page("doc-a", 1);
    let refused: Vec<String> = (0..4).map(|_| refused_p(&r, &a)).collect();
    for p in &refused {
        r.prepare(&a, p).expect_err("refused");
    }
    let old = r.p(&a, None, "text");
    assert_eq!(
        state(&r.prepare(&a, &old).unwrap_err()),
        "staleGeneration",
        "sealed"
    );

    let reg = r
        .pages
        .register(
            Some(&r.c.writer),
            &a.label,
            &ident(2),
            Some((&a.identity, &a.generation)),
        )
        .expect("replace the sealed pair");
    let b = Page {
        label: a.label.clone(),
        identity: reg.page_identity.to_string(),
        generation: reg.webview_generation.to_string(),
    };
    assert_eq!(r.pages.registrations(&a.label), 1, "replaced, not added");
    for p in refused.iter().chain([&old]) {
        assert_eq!(
            state(&r.prepare(&a, p).unwrap_err()),
            "staleGeneration",
            "an old payload"
        );
    }
    r.prepare(&b, &r.p(&b, None, "text"))
        .expect("the replacement admits");
    assert_eq!(
        r.sizes(),
        (0, 0, 1, 1, 1),
        "the old generation's fences dropped"
    );
}

#[test]
fn an_unknown_abandon_burst_is_bounded() {
    let r = rig();
    let a = r.page("doc-a", 1);
    for _ in 0..PER_GENERATION + 100 {
        let reply = r
            .abandon(&a.label, &r.p(&a, None, "text"))
            .expect("abandon");
        assert_eq!(reply, json!({ "state": "fenced" }));
    }
    assert_eq!(
        r.sizes(),
        (0, PER_GENERATION, 0, 0, 0),
        "stopped at the seal"
    );
    let e = r.prepare(&a, &r.p(&a, None, "text")).expect_err("sealed");
    assert_eq!(state(&e), "staleGeneration");
}
