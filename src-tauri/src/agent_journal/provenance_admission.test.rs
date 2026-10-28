// WI-AL1.4 — what a window's provenance may not do to the operation carrying it: a malformed map refuses as field "provenance" (the window resends without it) instead of failing the whole request at decoding; a prepare whose buffer equals the head still records the baseline when the window's map, or the window itself, says a person touched the text; a released window name is never registered again by a capture that arrives late; a prepare is refused while the degraded budget could not hold its terminal record
use serde_json::json;

use super::actor::Actor;
use super::capture::JournaledFlag;
use super::capture_tests::{agent_write, capture_payload, journal_code, rev, setup};
use super::ids::{DocId, RevisionId};
use super::test_support::*;
use super::writer::{RetentionBudget, Writer};

fn doc_of(w: &Writer, rev: RevisionId) -> DocId {
    w.snapshot().state.revisions[&rev].doc
}

fn malformed(w: &Writer, doc: DocId, h: RevisionId) -> serde_json::Value {
    let mut p = serde_json::to_value(payload(w, doc, &basis(Some(h)), "abc", "abc", &[])).unwrap();
    p["body"]["lenA"] = json!("three");
    p
}

#[test]
fn a_malformed_capture_map_refuses_as_provenance_and_the_save_records_without_it() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "abc");
    let mut req: serde_json::Value = serde_json::from_str(&capture_payload(
        "k",
        "main/t1",
        rev(h),
        "abc",
        &Actor::Human,
    ))
    .unwrap();
    req["provenance"] = malformed(&w, doc_of(&w, h), h);
    let before = w.journal_len();
    let err = c.capture(&req.to_string()).unwrap_err();
    assert_eq!(
        (journal_code(&err).as_str(), &err.detail().unwrap()["field"]),
        ("INVALID_REQUEST", &json!("provenance"))
    );
    assert_eq!(w.journal_len(), before);
    req["provenance"] = json!(null);
    assert_eq!(
        c.capture(&req.to_string()).unwrap().journaled,
        JournaledFlag::Yes
    );
}

#[test]
fn a_malformed_baseline_map_refuses_the_prepare_as_provenance() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "abc");
    let req = json!({ "docKey": "k", "parent": h, "preimage": "abc!", "actor": agent(), "tool": "document.write",
        "baselineProvenance": malformed(&w, doc_of(&w, h), h), "observedParent": observed_on(Some(h)) });
    let err = c.prepare(&req.to_string()).unwrap_err();
    assert_eq!(err.detail().unwrap()["field"], "provenance");
}

fn prepare_equal(
    c: &super::controller::Controller,
    h: RevisionId,
    extra: serde_json::Value,
) -> Option<RevisionId> {
    let mut req = json!({ "docKey": "k", "parent": h, "preimage": "aa", "actor": agent(), "tool": "document.write",
        "observedParent": observed_on(Some(h)) });
    for (k, v) in extra.as_object().unwrap() {
        req[k] = v.clone();
    }
    let out = c.prepare(&req.to_string()).expect("prepare");
    c.abort(&out.txn.0.to_string(), "edited").expect("abort");
    out.baseline
}

#[test]
fn an_equal_text_baseline_is_skipped_only_when_nothing_was_touched() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "aa");
    let doc = doc_of(&w, h);
    assert_eq!(
        prepare_equal(&c, h, json!({})),
        None,
        "no map, untouched: nothing to record"
    );
    let identity = payload(&w, doc, &basis(Some(h)), "aa", "aa", &[]);
    assert_eq!(
        prepare_equal(&c, h, json!({ "baselineProvenance": identity })),
        None
    );
    let retyped = payload(
        &w,
        doc,
        &basis(Some(h)),
        "aa",
        "aa",
        &[
            Edit {
                at: 0,
                delete: 1,
                insert: 0,
            },
            Edit {
                at: 1,
                delete: 0,
                insert: 1,
            },
        ],
    );
    let b = prepare_equal(&c, h, json!({ "baselineProvenance": retyped.clone() }))
        .expect("touch history recorded");
    let s = w.snapshot().state;
    let obs = s
        .observations
        .values()
        .find(|o| o.linearized == Some(b))
        .expect("observation");
    assert_eq!(obs.provenance.as_ref(), Some(&retyped));
}

#[test]
fn an_equal_text_baseline_the_window_marks_touched_is_a_snapshot_barrier() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "aa");
    let b = prepare_equal(&c, h, json!({ "baselineTouched": true })).expect("recorded");
    let s = w.snapshot().state;
    let obs = s
        .observations
        .values()
        .find(|o| o.linearized == Some(b))
        .expect("observation");
    assert_eq!(obs.provenance, None, "snapshotOnly");
}

#[test]
fn a_released_window_is_not_registered_again_by_a_late_capture() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "abc");
    c.release_window("main/t1").unwrap();
    c.capture(&capture_payload(
        "k",
        "main/t1",
        rev(h),
        "abcd",
        &Actor::Human,
    ))
    .unwrap();
    assert!(!w.lock().window_bases.contains_key("main/t1"));
    c.capture(&capture_payload(
        "k",
        "main/t2",
        rev(h),
        "abcd",
        &Actor::Human,
    ))
    .unwrap();
    assert!(
        w.lock().window_bases.contains_key("main/t2"),
        "other names still register"
    );
}

#[test]
fn a_prepare_is_refused_while_the_degraded_budget_could_not_hold_its_terminal_record() {
    let (_dir, w, c, _) = setup();
    w.set_retention_budget(RetentionBudget {
        degraded_entries: 1,
        degraded_bytes: 1 << 20,
        window_bases: 16,
    });
    let open = json!({ "docKey": "a", "parent": null, "preimage": "", "actor": agent(), "tool": "document.write" });
    c.prepare(&open.to_string())
        .expect("first reservation fits");
    let next = json!({ "docKey": "b", "parent": null, "preimage": "", "actor": agent(), "tool": "document.write" });
    let err = c.prepare(&next.to_string()).unwrap_err();
    assert_eq!(journal_code(&err), "JOURNAL_DEGRADED");
}

#[test]
fn arming_reports_the_settled_head_and_its_text_hash_so_a_window_can_start_on_it() {
    let (_dir, _w, c, _) = setup();
    let fresh = serde_json::to_value(
        c.arm_epoch(&json!({ "docKey": "new" }).to_string())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        (&fresh["head"], &fresh["headHash"]),
        (&json!(null), &json!(null)),
        "a new document has no head"
    );
    let h = agent_write(&c, "k", None, "", "abc");
    let out =
        serde_json::to_value(c.arm_epoch(&json!({ "docKey": "k" }).to_string()).unwrap()).unwrap();
    assert_eq!(out["head"], json!(h.to_string()));
    assert_eq!(
        out["headHash"],
        json!(super::ids::BlobHash::of_text("abc").as_str())
    );
}
