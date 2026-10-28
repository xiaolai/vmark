// WI-AL2.2d — the framed revert prepare through the controller: an applied revert replies kind prepared in its bind envelope and commits through the owning page; a conflicted revert replies kind decided with no transaction; a refused revert (R31) leaves the projection, generation, record count and every byte on disk exactly as they were; a one-item staged revert may take the journal's last legal generation, and only the write after it is refused
//! R31 and R34 at the controller boundary, through `revert_prepare_framed`.

use std::path::Path;

use serde_json::{json, Value};

use crate::agent_journal::admission::admission_support::{doc, KEY};
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::ids::{DocId, HunkId};
use crate::agent_journal::review::HunkState;
use crate::agent_journal::test_review_helpers::{state, two_hunks};
use crate::agent_journal::test_support::{head_text, observe, observed_on, snapshot_save};
use crate::agent_journal::writer::Writer;
use crate::command_error::CommandError;

use super::revert_support::conflicted_pending;

/// A framed revert of `hunk` over `buffer`, on the live head and `reviewGen`.
fn revert_p(r: &Rig, page: &Page, buffer: &str, hunk: &HunkId) -> String {
    let w = &r.c.writer;
    let d = doc(&r.c);
    let body = json!({
        "docKey": KEY,
        "parent": w.head(d),
        "observedParent": observed_on(w.head(d)),
        "preimage": buffer,
        "hunkId": hunk,
        "expectedReviewGen": state(w, d, hunk).1.to_string(),
    });
    r.frame(page, body)
}

fn revert(r: &Rig, page: &Page, p: &str) -> Result<Value, CommandError> {
    let out = r.c.revert_prepare_framed(&r.pages, &page.label, p)?;
    Ok(serde_json::to_value(out).expect("reply"))
}

/// Every byte under `dir`: the journal and its blobs. The `.lock` sidecar
/// holds no data and is skipped: on Windows the writer's lock on it is
/// mandatory, so reading it while the writer is open fails.
fn dir_bytes(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).expect("read dir") {
        let path = entry.expect("entry").path();
        if path.extension().is_some_and(|e| e == "lock") {
            continue;
        }
        if path.is_dir() {
            out.extend(dir_bytes(&path));
        } else {
            out.push((
                path.display().to_string(),
                std::fs::read(&path).expect("read"),
            ));
        }
    }
    out.sort();
    out
}

fn mark(w: &Writer) -> (Value, u64, usize) {
    let proj = format!("{:?}", w.lock().proj);
    (json!(proj), w.generation(), w.debug_records().len())
}

fn seeded() -> (Rig, Page, DocId) {
    let r = rig();
    let a = r.page("doc-a", 1);
    let d = doc(&r.c);
    (r, a, d)
}

#[test]
fn an_applied_revert_replies_prepared_in_its_envelope_and_commits() {
    let (r, a, d) = seeded();
    let (h, _) = two_hunks(&r.c.writer, d);
    let p = revert_p(&r, &a, "xx", &h);
    let out = revert(&r, &a, &p).expect("revert prepare");
    let id: Value = serde_json::from_str::<Value>(&p).unwrap()["requestId"].clone();
    assert_eq!(out["bind"]["requestId"], id, "{out}");
    assert_eq!(out["reply"]["kind"], "prepared", "{out}");
    let prepared = &out["reply"]["response"];
    assert_eq!(prepared["hunk"], json!(h));
    assert_eq!(
        (prepared["from"].clone(), prepared["insert"].clone()),
        (json!(0), json!("y"))
    );
    let txn = serde_json::from_value(prepared["txn"].clone()).expect("txn");
    let committed = r.commit(&a, txn, "yx").expect("commit");
    assert_eq!(committed["reply"]["durable"], true, "{committed}");
    assert_eq!(head_text(&r.c.writer, d), "yx");
    assert_eq!(state(&r.c.writer, d, &h).0, HunkState::Reverted);
}

#[test]
fn a_conflicted_revert_replies_decided_with_no_transaction() {
    let (r, a, d) = seeded();
    let (h, _) = conflicted_pending(&r.c.writer, d);
    let p = revert_p(&r, &a, "zx", &h);
    let out = revert(&r, &a, &p).expect("decided");
    assert_eq!(out["reply"]["kind"], "decided", "{out}");
    let decided = &out["reply"]["response"];
    assert_eq!(decided["hunk"], json!(h));
    assert_eq!(decided["action"], "conflicted", "{out}");
    assert!(decided.get("txn").is_none());
    assert!(r.c.writer.reservation(d).is_none(), "no transaction opened");
    assert_eq!(state(&r.c.writer, d, &h).0, HunkState::Conflicted);
}

#[test]
fn a_refused_revert_changes_nothing_on_disk_or_in_the_projection() {
    let (r, a, d) = seeded();
    let (h, _) = two_hunks(&r.c.writer, d);
    snapshot_save(&r.c.writer, d, "xxz");
    // A capture still pending when the revert arrives: the refusal must
    // not admit it either.
    observe(&r.c.writer, d, "xxzq", None);
    let p = revert_p(&r, &a, "xxzq", &h);
    let before = (mark(&r.c.writer), dir_bytes(r.dir.path()));
    let e = revert(&r, &a, &p).expect_err("ambiguous");
    assert_eq!(journal_code(&e), "AMBIGUOUS_REVERT", "{e:?}");
    assert_eq!((mark(&r.c.writer), dir_bytes(r.dir.path())), before);
}

#[test]
fn a_staged_revert_takes_the_last_legal_generation_and_the_next_write_is_refused() {
    let (r, a, d) = seeded();
    let (h, _) = two_hunks(&r.c.writer, d);
    r.c.writer.lock().proj.generation = u64::MAX - 2;
    let out = revert(&r, &a, &revert_p(&r, &a, "xx", &h)).expect("u64::MAX - 1 is legal");
    assert_eq!(
        out["reply"]["response"]["generation"],
        json!((u64::MAX - 1).to_string()),
        "{out}"
    );
    let before = mark(&r.c.writer);
    let e =
        r.c.writer
            .arm_epoch(DocId::new())
            .expect_err("u64::MAX is reserved");
    assert!(e.to_string().contains("generation exhausted"), "{e}");
    assert_eq!(mark(&r.c.writer), before, "nothing written");
}
