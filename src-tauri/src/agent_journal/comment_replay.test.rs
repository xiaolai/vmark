// WI-AL3.1b — forged comment journals are corrupt on replay: a thread or reply id not minted from its own seq, a delete by the agent, a creation whose text hash is not its revision's text, and an admission carrying a commentCreated before its last item each refuse to open with JOURNAL_CORRUPT, naming the broken rule
//! R107 rules 1, 3 and 5: every forgery is a real journal written through
//! the handles with one field changed (and the receipt that echoes it, so
//! only the rule under test is broken), then reopened.

use serde_json::{json, Value};

use crate::agent_journal::admission::request_support::Rig;
use crate::agent_journal::comment::comment_support::*;
use crate::agent_journal::comment::rules::Action;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::BlobHash;
use crate::agent_journal::writer::Writer;

/// Every record of `r`'s journal as JSON.
fn records(r: &Rig) -> Vec<Value> {
    let raw = r.c.writer.lock().journal.read_all().expect("journal");
    raw.iter()
        .map(|p| serde_json::from_slice(p).expect("record"))
        .collect()
}

/// Rewrite `r`'s journal as `forged`, then reopen it; the replay error.
fn reopen_forged(r: Rig, forged: &[Value]) -> TxnError {
    let payloads: Vec<Vec<u8>> = forged
        .iter()
        .map(|v| serde_json::to_vec(v).expect("encode"))
        .collect();
    r.c.writer
        .lock()
        .journal
        .rewrite(&payloads)
        .expect("rewrite");
    let (dir, _) = close(r);
    match Writer::open(fast_config(dir.path())) {
        Ok(_) => panic!("a forged journal opened"),
        Err(e) => e,
    }
}

/// The journal reopens unchanged: the forgery, not the rewrite, is refused.
fn reopens_as_written(r: &Rig) {
    let dir = tempfile::tempdir().expect("tempdir");
    let payloads: Vec<Vec<u8>> = records(r)
        .iter()
        .map(|v| serde_json::to_vec(v).expect("encode"))
        .collect();
    let (w, _) = Writer::open(fast_config(dir.path())).expect("open");
    w.lock().journal.rewrite(&payloads).expect("rewrite");
    drop(w);
    Writer::open(fast_config(dir.path())).expect("the unforged journal opens");
}

fn assert_corrupt(e: &TxnError, rule: &str) {
    assert_eq!(e.code(), "JOURNAL_CORRUPT", "{e}");
    assert!(e.to_string().contains(rule), "names `{rule}`: {e}");
}

/// The index of the one record of `kind`.
fn only(all: &[Value], kind: &str) -> usize {
    let at: Vec<usize> = (0..all.len())
        .filter(|&i| all[i]["record"]["kind"] == kind)
        .collect();
    assert_eq!(at.len(), 1, "one {kind}: {all:?}");
    at[0]
}

fn seq(v: &Value) -> u64 {
    v["seq"].as_str().expect("seq").parse().expect("seq")
}

/// A journal with one top-level create and one reply to it.
fn created_and_replied() -> (Rig, Vec<Value>) {
    let (r, page) = rig();
    // The first create stages an admission; the second is top-level.
    create(&r, &page, "staged").expect("staged create");
    let c = comment_of(&create(&r, &page, "top level").expect("create"));
    reply(&r, &page, c, 0, "a reply").expect("reply");
    reopens_as_written(&r);
    let all = records(&r);
    (r, all)
}

#[test]
fn a_thread_id_not_minted_from_its_seq_is_corrupt() {
    let (r, mut all) = created_and_replied();
    let i = only(&all, "commentCreated");
    let forged = json!(format!("c{}", seq(&all[i]) + 7));
    all[i]["record"]["comment"] = forged.clone();
    all[i]["receipt"]["outcome"]["response"]["comment"] = forged.clone();
    let j = only(&all, "commentReplied");
    all[j]["record"]["comment"] = forged.clone();
    all[j]["receipt"]["outcome"]["response"]["comment"] = forged;
    assert_corrupt(&reopen_forged(r, &all), "is not minted at its seq");
}

#[test]
fn a_reply_id_not_minted_from_its_seq_is_corrupt() {
    let (r, mut all) = created_and_replied();
    let j = only(&all, "commentReplied");
    let forged = json!(format!("r{}", seq(&all[j]) + 7));
    all[j]["record"]["reply"] = forged.clone();
    all[j]["receipt"]["outcome"]["response"]["reply"] = forged;
    assert_corrupt(&reopen_forged(r, &all), "is not minted at its seq");
}

#[test]
fn a_creation_whose_text_hash_is_not_its_revisions_text_is_corrupt() {
    let (r, mut all) = created_and_replied();
    let i = only(&all, "commentCreated");
    let other = json!(BlobHash::of_text("another text"));
    all[i]["record"]["textHash"] = other.clone();
    all[i]["receipt"]["outcome"]["response"]["textHash"] = other;
    assert_corrupt(
        &reopen_forged(r, &all),
        "names a revision whose text it was not created on",
    );
}

#[test]
fn a_delete_by_the_agent_is_corrupt() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "to delete").expect("create"));
    user(&r, Action::Resolve, c, 0).expect("resolve");
    user(&r, Action::Delete, c, 1).expect("delete");
    reopens_as_written(&r);
    let mut all = records(&r);
    let k = only(&all, "commentDeleted");
    assert_eq!(all[k]["record"]["caller"], "user");
    all[k]["record"]["caller"] = json!("agent");
    assert_corrupt(&reopen_forged(r, &all), "only the user deletes a thread");
}

#[test]
fn an_admission_with_a_comment_created_before_its_last_item_is_corrupt() {
    let (r, page) = rig();
    create(&r, &page, "on unsaved text").expect("staged create");
    reopens_as_written(&r);
    let mut all = records(&r);
    let a = only(&all, "admission");
    let items = all[a]["record"]["items"].as_array_mut().expect("items");
    let last = items.pop().expect("the commentCreated");
    assert_eq!(last["record"]["kind"], "commentCreated");
    // A second create, receipt-free, in the last item's place; the real
    // one moves up a seq with its receipt and stays last. Seqs stay
    // contiguous, ids stay minted from them and the receipt still binds,
    // so the only broken rule is the first create not ending the frame.
    let s = seq(&last);
    let mut early = last.clone();
    early
        .as_object_mut()
        .expect("item")
        .remove("receipt")
        .expect("the create carries the receipt");
    let mut real = last;
    let next = (s + 1).to_string();
    real["seq"] = json!(next);
    real["record"]["comment"] = json!(format!("c{next}"));
    let response = &mut real["receipt"]["outcome"]["response"];
    response["comment"] = json!(format!("c{next}"));
    response["generation"] = json!(next);
    items.push(early);
    items.push(real);
    assert_corrupt(
        &reopen_forged(r, &all),
        "carries a commentCreated before its last item",
    );
}
