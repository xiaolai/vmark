// WI-AL1.4 — a save carries the window's certified provenance: a payload naming the armed epoch and the observed base maps live hunks through the save instead of a snapshotOnly barrier; a payload that does not certify the save is refused as INVALID_REQUEST with detail.field "provenance" and nothing appended (the window resends without it); editing epochs armed and closed over the command side; a closed tab releases its window base; a drained capture registers its window base unless the window was released; the degraded queue and the window-base table have hard budgets and refuse past them
use serde_json::json;

use super::actor::Actor;
use super::capture::JournaledFlag;
use super::capture_tests::{agent_write, capture_payload, eventually, journal_code, rev, setup};
use super::ids::{DocId, RevisionId};
use super::provenance::ProvenancePayload;
use super::record::ObservedRef;
use super::test_support::*;
use super::writer::{RetentionBudget, Writer};

fn capture_with(
    key: &str,
    window: &str,
    observed: Option<ObservedRef>,
    post: &str,
    p: Option<&ProvenancePayload>,
) -> String {
    let mut v: serde_json::Value =
        serde_json::from_str(&capture_payload(key, window, observed, post, &Actor::Human)).unwrap();
    v["provenance"] = json!(p);
    v.to_string()
}

fn doc_of(w: &Writer, rev: RevisionId) -> DocId {
    w.snapshot().state.revisions[&rev].doc
}

fn window_base(w: &Writer, window: &str) -> Option<ObservedRef> {
    w.lock().window_bases.get(window).map(|(_, b)| b.clone())
}

fn arm(c: &super::controller::Controller, key: &str) -> String {
    let out = c
        .arm_epoch(&json!({ "docKey": key }).to_string())
        .expect("arm");
    serde_json::to_value(out).unwrap()["epoch"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn a_save_with_a_certified_map_records_it_on_the_observation() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "abc");
    let doc = doc_of(&w, h);
    arm(&c, "k");
    let p = payload(
        &w,
        doc,
        &basis(Some(h)),
        "abc",
        "abcd",
        &[Edit {
            at: 3,
            delete: 0,
            insert: 1,
        }],
    );
    let out = c
        .capture(&capture_with("k", "main/t1", rev(h), "abcd", Some(&p)))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::Yes);
    let s = w.snapshot().state;
    assert_eq!(
        s.observations[&out.observation.unwrap()]
            .provenance
            .as_ref(),
        Some(&p)
    );
}

#[test]
fn a_map_that_does_not_certify_the_save_is_refused_with_field_provenance_and_nothing_appended() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "abc");
    let doc = doc_of(&w, h);
    arm(&c, "k");
    let lying = payload(
        &w,
        doc,
        &basis(Some(h)),
        "abc",
        "abcd",
        &[Edit {
            at: 3,
            delete: 0,
            insert: 1,
        }],
    );
    let before = w.journal_len();
    let err = c
        .capture(&capture_with("k", "main/t1", rev(h), "abcX", Some(&lying)))
        .unwrap_err();
    assert_eq!(journal_code(&err), "INVALID_REQUEST");
    assert_eq!(err.detail().unwrap()["field"], "provenance");
    assert_eq!(w.journal_len(), before, "nothing appended");
    assert_eq!(
        window_base(&w, "main/t1"),
        None,
        "the window base did not move"
    );
    // Resent without the map, the save is recorded (a snapshotOnly barrier).
    let out = c
        .capture(&capture_with("k", "main/t1", rev(h), "abcX", None))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::Yes);
}

#[test]
fn a_payload_naming_no_armed_epoch_is_refused_as_provenance() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "abc");
    let doc = doc_of(&w, h);
    let p = payload(
        &w,
        doc,
        &basis(Some(h)),
        "abc",
        "abcd",
        &[Edit {
            at: 3,
            delete: 0,
            insert: 1,
        }],
    );
    w.close_epoch(doc, w.epoch(doc).unwrap()).unwrap();
    let err = c
        .capture(&capture_with("k", "main/t1", rev(h), "abcd", Some(&p)))
        .unwrap_err();
    assert_eq!(err.detail().unwrap()["field"], "provenance");
}

#[test]
fn a_prepare_whose_baseline_map_does_not_certify_is_refused_with_field_provenance() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "abc");
    let doc = doc_of(&w, h);
    let wrong = payload(
        &w,
        doc,
        &basis(Some(h)),
        "abc",
        "abcd",
        &[Edit {
            at: 3,
            delete: 0,
            insert: 1,
        }],
    );
    let req = json!({ "docKey": "k", "parent": h, "preimage": "abc?", "actor": agent(), "tool": "document.write", "baselineProvenance": wrong,
        "observedParent": observed_on(Some(h)) });
    let err = c.prepare(&req.to_string()).unwrap_err();
    assert_eq!(
        (journal_code(&err).as_str(), &err.detail().unwrap()["field"]),
        ("INVALID_REQUEST", &json!("provenance"))
    );
}

#[test]
fn epochs_arm_and_close_over_the_command_side_with_cas() {
    let (_dir, _w, c, _) = setup();
    assert_eq!(arm(&c, "k"), "1");
    let again = c
        .arm_epoch(&json!({ "docKey": "k" }).to_string())
        .unwrap_err();
    assert_eq!(
        journal_code(&again),
        "INVALID_REQUEST",
        "one open epoch per document"
    );
    let wrong = c
        .close_epoch(&json!({ "docKey": "k", "epoch": "2" }).to_string())
        .unwrap_err();
    assert_eq!(journal_code(&wrong), "INVALID_REQUEST");
    c.close_epoch(&json!({ "docKey": "k", "epoch": "1" }).to_string())
        .expect("close");
    assert_eq!(arm(&c, "k"), "2");
    let bad = c
        .close_epoch(&json!({ "docKey": "k", "epoch": "01" }).to_string())
        .unwrap_err();
    assert_eq!(
        journal_code(&bad),
        "INVALID_REQUEST",
        "decimal strings only"
    );
}

#[test]
fn releasing_a_window_drops_its_base_and_is_idempotent() {
    let (_dir, w, c, _) = setup();
    let h = agent_write(&c, "k", None, "", "abc");
    c.capture(&capture_payload(
        "k",
        "main/t1",
        rev(h),
        "abcd",
        &Actor::Human,
    ))
    .unwrap();
    assert!(window_base(&w, "main/t1").is_some());
    c.release_window("main/t1").unwrap();
    assert_eq!(window_base(&w, "main/t1"), None);
    c.release_window("main/t1").unwrap();
    assert!(
        c.release_window("").is_err(),
        "an empty window name is refused"
    );
}

#[test]
fn a_drained_capture_registers_its_window_base() {
    let (_dir, w, c, faults) = setup();
    let h = agent_write(&c, "k", None, "", "base");
    faults.fail_next_appends(1);
    let out = c
        .capture(&capture_payload(
            "k",
            "main/t1",
            rev(h),
            "base saved",
            &Actor::Human,
        ))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::No);
    let obs = out.observation.unwrap();
    eventually(|| window_base(&w, "main/t1") == Some(ObservedRef::Pending { observation: obs }));
}

#[test]
fn a_window_released_while_its_capture_is_queued_is_not_resurrected_by_the_drain() {
    let (_dir, w, c, faults) = setup();
    let h = agent_write(&c, "k", None, "", "base");
    let doc = doc_of(&w, h);
    faults.fail_next_appends(1_000);
    let out = c
        .capture(&capture_payload(
            "k",
            "main/t1",
            rev(h),
            "base saved",
            &Actor::Human,
        ))
        .unwrap();
    assert_eq!(out.journaled, JournaledFlag::No);
    c.release_window("main/t1").unwrap();
    faults.fail_next_appends(0);
    eventually(|| !w.is_degraded(doc));
    assert_eq!(window_base(&w, "main/t1"), None);
}

#[test]
fn the_degraded_queue_refuses_a_capture_past_its_budget_and_queues_nothing() {
    let (_dir, w, c, faults) = setup();
    w.set_retention_budget(RetentionBudget {
        degraded_entries: 2,
        degraded_bytes: 1 << 20,
        window_bases: 16,
    });
    let h = agent_write(&c, "k", None, "", "base");
    let doc = doc_of(&w, h);
    faults.fail_next_appends(1_000);
    for i in 0..2 {
        let out = c
            .capture(&capture_payload(
                "k",
                "main/t1",
                None,
                &format!("v{i}"),
                &Actor::Human,
            ))
            .unwrap();
        assert_eq!(out.journaled, JournaledFlag::No);
    }
    let err = c
        .capture(&capture_payload("k", "main/t1", None, "v2", &Actor::Human))
        .unwrap_err();
    assert_eq!(journal_code(&err), "JOURNAL_DEGRADED");
    assert_eq!(
        w.lock().degraded[&doc].len(),
        2,
        "nothing queued past the budget"
    );
}

#[test]
fn the_degraded_queue_refuses_a_capture_past_its_byte_budget() {
    let (_dir, w, c, faults) = setup();
    w.set_retention_budget(RetentionBudget {
        degraded_entries: 100,
        degraded_bytes: 64,
        window_bases: 16,
    });
    let h = agent_write(&c, "k", None, "", "base");
    // The text never reaches the pack, so the queue must carry it (a text
    // already stored needs no queue bytes).
    faults.fail_next_blob_writes(1_000);
    faults.fail_next_appends(1_000);
    let big = "x".repeat(65);
    let err = c
        .capture(&capture_payload(
            "k",
            "main/t1",
            rev(h),
            &big,
            &Actor::Human,
        ))
        .unwrap_err();
    assert_eq!(journal_code(&err), "JOURNAL_DEGRADED");
    assert!(!w.is_degraded(doc_of(&w, h)));
}

#[test]
fn the_window_base_table_refuses_new_names_past_its_budget() {
    let (_dir, w, c, _) = setup();
    w.set_retention_budget(RetentionBudget {
        degraded_entries: 8,
        degraded_bytes: 1 << 20,
        window_bases: 2,
    });
    let h = agent_write(&c, "k", None, "", "base");
    for name in ["main/a", "main/b", "main/c"] {
        c.capture(&capture_payload(
            "k",
            name,
            rev(h),
            &format!("{name}!"),
            &Actor::Human,
        ))
        .unwrap();
    }
    assert!(window_base(&w, "main/a").is_some() && window_base(&w, "main/b").is_some());
    assert_eq!(
        window_base(&w, "main/c"),
        None,
        "past the budget: not registered"
    );
    // An existing name is still replaced.
    c.capture(&capture_payload(
        "k",
        "main/a",
        None,
        "again",
        &Actor::Human,
    ))
    .unwrap();
    assert_ne!(
        window_base(&w, "main/a"),
        Some(ObservedRef::Revision { revision: h })
    );
}
