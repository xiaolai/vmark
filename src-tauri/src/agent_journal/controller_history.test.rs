// WI-AL1.6 — the history panel's commands: a restore prepared from wire
// JSON (overwritten buffer as the baseline, the source text handed back)
// commits through the controlled write; a document's uncommitted entries
// are listed, restored (resolves) or discarded, and either terminal record
// drops the entry's pin and its row; another document's entry is refused.
use std::sync::Arc;
use std::time::Duration;

use super::controller::Controller;
use super::degraded_drain::{Backoff, DrainScheduler};
use super::doc_registry::DocRegistry;
use super::faults::Faults;
use super::gc_policy::GcPolicy;
use super::test_support::*;
use crate::agent_journal::ids::TxnId;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::writer::Writer;

fn controller() -> (tempfile::TempDir, Controller, Arc<Writer>) {
    let (dir, c, w, _) = controller_with_faults();
    (dir, c, w)
}

fn controller_with_faults() -> (tempfile::TempDir, Controller, Arc<Writer>, Arc<Faults>) {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    let c = Controller::new(w.clone(), Arc::default(), Arc::new(drains));
    (dir, c, w, faults)
}

fn write(c: &Controller, key: &str, parent: Option<&str>, pre: &str, post: &str) -> String {
    let p = serde_json::json!({
        "docKey": key, "parent": parent, "preimage": pre, "actor": agent(), "tool": "document.write",
    });
    let p = serde_json::to_value(c.prepare(&p.to_string()).expect("prepare")).unwrap();
    let txn = p["txn"].as_str().unwrap().to_owned();
    let out = c
        .commit(&txn, &serde_json::json!({ "postimage": post }).to_string())
        .expect("commit");
    serde_json::to_value(out).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// A write of `key` left uncommitted (prepared, never committed).
fn uncommitted(c: &Controller, w: &Writer, key: &str, pre: &str) -> TxnId {
    let parent = c.docs.resolve(key).ok().and_then(|d| w.head(d));
    let p = serde_json::json!({
        "docKey": key, "parent": parent, "preimage": pre, "actor": agent(), "tool": "document.write",
    });
    let txn = c.prepare(&p.to_string()).expect("prepare").txn;
    w.record_uncommitted(txn).expect("uncommitted");
    txn
}

fn listed(c: &Controller, key: &str) -> Vec<serde_json::Value> {
    let out = c
        .uncommitted(&serde_json::json!({ "docKey": key }).to_string())
        .expect("list");
    serde_json::to_value(out)
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn a_restore_round_trips_through_wire_json() {
    let (_dir, c, w) = controller();
    let first = write(&c, "path:/a.md", None, "", "first");
    let second = write(&c, "path:/a.md", Some(&first), "first", "second");
    let req = serde_json::json!({
        "docKey": "path:/a.md",
        "parent": second,
        "preimage": "second, unsaved",
        "source": { "from": "revision", "revision": first },
    });
    let p = serde_json::to_value(c.restore_prepare(&req.to_string()).expect("prepare")).unwrap();
    assert_eq!(p["text"], "first");
    assert!(
        p["baseline"].is_string(),
        "the overwritten buffer is recorded first"
    );
    assert!(p["generation"].is_string());
    let txn = p["txn"].as_str().unwrap();
    let out = c.commit(txn, r#"{"postimage":"first"}"#).expect("commit");
    assert!(out.applied && out.durable);
    let doc = out.doc;
    assert_eq!(head_text(&w, doc), "first");
}

#[test]
fn uncommitted_entries_are_listed_with_a_bounded_preview() {
    let (_dir, c, w) = controller();
    let long = "長".repeat(200);
    let t = uncommitted(&c, &w, "path:/a.md", &long);
    uncommitted(&c, &w, "path:/b.md", "other");
    let rows = listed(&c, "path:/a.md");
    assert_eq!(rows.len(), 1, "only this document's entries");
    assert_eq!(rows[0]["txn"], t.0.to_string());
    assert_eq!(rows[0]["preview"].as_str().unwrap().chars().count(), 120);
    assert_eq!(rows[0]["complete"], false);
    assert!(rows[0]["seq"].is_string());
    assert!(listed(&c, "path:/empty.md").is_empty());
}

#[test]
fn discarding_an_uncommitted_entry_appends_discarded_and_drops_its_pin() {
    let (_dir, c, w) = controller();
    let t = uncommitted(&c, &w, "path:/a.md", "before");
    assert!(w.pins().txns.contains(&t), "an uncommitted entry is pinned");
    let req = serde_json::json!({ "docKey": "path:/a.md", "txn": t.0.to_string() });
    assert!(c.discard(&req.to_string()).expect("discard").durable);
    assert!(matches!(
        w.snapshot().state.txns[&t].status,
        TxnStatus::Discarded { .. }
    ));
    assert!(!w.pins().txns.contains(&t), "the pin is dropped");
    assert!(listed(&c, "path:/a.md").is_empty());
    assert!(
        c.discard(&req.to_string()).is_err(),
        "a second discard is refused"
    );
}

#[test]
fn restoring_an_uncommitted_entry_resolves_it_and_drops_its_pin() {
    let (_dir, c, w) = controller();
    let t = uncommitted(&c, &w, "path:/a.md", "");
    let rev = write(&c, "path:/a.md", None, "", "now");
    assert!(w.pins().txns.contains(&t), "an uncommitted entry is pinned");
    let req = serde_json::json!({
        "docKey": "path:/a.md", "parent": rev, "preimage": "now",
        "source": { "from": "uncommittedPreimage", "txn": t.0.to_string() },
    });
    let p = c.restore_prepare(&req.to_string()).expect("prepare");
    assert_eq!((p.text.as_str(), p.resolves), ("", Some(t)));
    c.commit(&p.txn.0.to_string(), r#"{"postimage":""}"#)
        .expect("commit");
    assert_eq!(
        w.snapshot().state.txns[&t].status,
        TxnStatus::Resolved { by: p.txn }
    );
    assert!(!w.pins().txns.contains(&t), "the pin is dropped");
    assert!(listed(&c, "path:/a.md").is_empty());
}

#[test]
fn another_documents_entry_is_refused() {
    let (_dir, c, w) = controller();
    let t = uncommitted(&c, &w, "path:/a.md", "before");
    let req = serde_json::json!({ "docKey": "path:/b.md", "txn": t.0.to_string() });
    let err = c
        .discard(&req.to_string())
        .expect_err("not this document's");
    assert!(err.message().contains("INVALID_REQUEST"), "{err:?}");
    assert_eq!(w.snapshot().state.txns[&t].status, TxnStatus::Uncommitted);
}

#[test]
fn reading_or_acting_on_an_unknown_key_mints_no_document() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs: Arc<DocRegistry> = Arc::default();
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    let c = Controller::new(Arc::new(w), docs.clone(), Arc::new(drains));
    assert!(listed(&c, "path:/never.md").is_empty());
    let req = serde_json::json!({
        "docKey": "path:/other.md",
        "txn": uuid::Uuid::new_v4().to_string(),
    });
    let err = c.discard(&req.to_string()).expect_err("no such document");
    assert!(err.message().contains("INVALID_REQUEST"), "{err:?}");
    for key in ["path:/never.md", "path:/other.md"] {
        assert!(
            docs.find(key).unwrap().is_none(),
            "{key}: a read or a refused act never mints a document id"
        );
    }
}

/// The list is one snapshot: a discard and a collection that land while it
/// is being built cannot remove a preimage it already selected.
#[test]
fn the_list_reads_every_preimage_in_the_snapshot_it_selected() {
    let (_dir, c, w, faults) = controller_with_faults();
    let t = uncommitted(&c, &w, "path:/a.md", "the preimage");
    let mut head = w
        .head(c.docs.resolve("path:/a.md").unwrap())
        .map(|r| r.to_string());
    for (pre, post) in [("the preimage", "one"), ("one", "two"), ("two", "three")] {
        head = Some(write(&c, "path:/a.md", head.as_deref(), pre, post));
    }
    let w2 = w.clone();
    faults.before_nth_lock(
        2,
        Some(Box::new(move || {
            w2.discard(t).expect("discard");
            let keep_one = GcPolicy {
                max_revisions: 1,
                ..GcPolicy::default()
            };
            w2.collect(&keep_one).expect("collect");
        })),
    );
    let out = listed(&c, "path:/a.md");
    faults.before_nth_lock(0, None);
    assert_eq!(out.len(), 1, "{out:?}");
    assert_eq!(out[0]["preview"], "the preimage");
}
