// WI-AL3.2 — the comment list: each thread's text and replies, its anchor resolved (resolved, ambiguous, orphaned) against the window's text with the offset hint only on the creation revision, reopen after GC shown as creation revision no longer retained, open threads pinning their revision (ADR-AL13) and the replayed texts equal to the live ones
//! The list is read through the user handle (`UserComments::list`).

use serde_json::{json, Value};

use super::comment_support::*;
use crate::agent_journal::admission::admission_support::{doc, KEY};
use crate::agent_journal::admission::request_support::{Page, Rig};
use crate::agent_journal::comment::ids::{CommentCaller, CommentId};
use crate::agent_journal::comment::rules::Action;
use crate::agent_journal::gc_policy::GcPolicy;
use crate::agent_journal::ids::RevisionId;
use crate::agent_journal::pins::PinReason;
use crate::agent_journal::test_support::human_save;

/// A text whose passage repeats, so only the offset hint can decide it.
fn repeated() -> String {
    "a".repeat(100)
}

const PICK: (u64, u64) = (40, 41);

fn list(r: &Rig, text: &str) -> Value {
    let payload = json!({ "docKey": KEY, "text": text }).to_string();
    let out = r.c.comments_user().list(&payload).expect("list");
    serde_json::to_value(out).expect("json")
}

fn only(listed: &Value) -> &Value {
    let threads = listed["threads"].as_array().expect("threads");
    assert_eq!(threads.len(), 1, "one thread: {listed}");
    &threads[0]
}

fn create_on(r: &Rig, page: &Page, text: &str, sel: (u64, u64)) -> CommentId {
    let p = r.frame(page, create_body(r, text, sel, "look"));
    comment_of(&create_as(r, page, CommentCaller::User, &p).expect("create"))
}

fn pinned_by_comment(r: &Rig, rev: RevisionId, c: CommentId) -> bool {
    r.c.writer
        .pins()
        .revisions
        .get(&rev)
        .is_some_and(|why| why.contains(&PinReason::Comment(c)))
}

#[test]
fn a_thread_lists_its_text_state_replies_and_resolved_anchor() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "<b>why?</b>").expect("create"));
    reply(&r, &page, c, 0, "because").expect("reply");
    let listed = list(&r, TEXT);
    assert_eq!(
        listed["generation"].as_str().map(str::is_empty),
        Some(false)
    );
    let t = only(&listed);
    assert_eq!(t["comment"], json!(c.to_string()));
    assert_eq!(t["state"], json!("open"));
    assert_eq!(t["commentGen"], json!("1"));
    assert_eq!(t["quote"], json!("hello"));
    assert_eq!(t["body"], json!("<b>why?</b>"));
    assert_eq!(t["author"], json!("Reviewer"));
    assert_eq!(t["caller"], json!("user"));
    assert_eq!(t["creationRetained"], json!(true));
    assert_eq!(t["replies"][0]["body"], json!("because"));
    assert_eq!(t["replies"][0]["caller"], json!("user"));
    assert_eq!(t["anchor"]["status"], json!("resolved"));
    assert_eq!(t["anchor"]["start"], json!(SEL.0));
    assert_eq!(t["anchor"]["end"], json!(SEL.1));
}

#[test]
fn an_unknown_key_lists_nothing_and_mints_no_document() {
    let (r, _page) = rig();
    let listed = list(&r, TEXT);
    assert_eq!(listed["doc"], Value::Null);
    assert_eq!(listed["threads"], json!([]));
    assert_eq!(r.c.docs.find(KEY).expect("find"), None);
}

#[test]
fn an_anchor_is_ambiguous_or_orphaned_in_the_window_text() {
    let (r, page) = rig();
    create(&r, &page, "look").expect("create");
    let twice = format!("{TEXT}{TEXT}");
    let t = only(&list(&r, &twice)).clone();
    assert_eq!(t["anchor"]["status"], json!("ambiguous"));
    assert_eq!(t["anchor"]["candidates"].as_array().map(Vec::len), Some(2));
    let t = only(&list(&r, "nothing to see\n")).clone();
    assert_eq!(t["anchor"], json!({ "status": "orphaned" }));
}

#[test]
fn the_offset_hint_decides_only_on_the_creation_revision() {
    let (r, page) = rig();
    let text = repeated();
    create_on(&r, &page, &text, PICK);
    let t = only(&list(&r, &text)).clone();
    assert_eq!(t["anchor"]["status"], json!("resolved"), "{t}");
    assert_eq!(t["anchor"]["byHint"], json!(true));
    assert_eq!(t["anchor"]["start"], json!(PICK.0));
    // The same text in a later revision is not the creation revision.
    let d = doc(&r.c);
    human_save(&r.c.writer, d, "other\n");
    human_save(&r.c.writer, d, &text);
    let t = only(&list(&r, &text)).clone();
    assert_eq!(t["anchor"]["status"], json!("ambiguous"), "{t}");
}

#[test]
fn open_addressed_and_reopened_threads_pin_their_revision_and_resolved_ones_do_not() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "look").expect("create"));
    let at = thread(&r, c).revision;
    human_save(&r.c.writer, doc(&r.c), "moved on\n");
    assert!(pinned_by_comment(&r, at, c), "open pins");
    user(&r, Action::MarkAddressed, c, 0).expect("address");
    assert!(pinned_by_comment(&r, at, c), "addressed pins");
    user(&r, Action::Resolve, c, 1).expect("resolve");
    assert!(!pinned_by_comment(&r, at, c), "resolved does not pin");
    user(&r, Action::Reopen, c, 2).expect("reopen");
    assert!(pinned_by_comment(&r, at, c), "reopened pins");
    assert_eq!(PinReason::Comment(c).name(), "comment");
}

#[test]
fn reopen_after_gc_lists_the_creation_revision_as_no_longer_retained() {
    let (r, page) = rig();
    let text = repeated();
    let c = create_on(&r, &page, &text, PICK);
    let at = thread(&r, c).revision;
    user(&r, Action::Resolve, c, 0).expect("resolve");
    let d = doc(&r.c);
    human_save(&r.c.writer, d, "other\n");
    human_save(&r.c.writer, d, &text);
    r.c.writer
        .collect(&GcPolicy {
            max_revisions: 1,
            ..GcPolicy::default()
        })
        .expect("collect");
    let (r, _page) = reopen(r);
    assert!(
        r.c.writer.lock().proj.revisions[&at].collected,
        "the creation revision was collected"
    );
    user(&r, Action::Reopen, c, 1).expect("reopen after GC");
    let t = only(&list(&r, &text)).clone();
    assert_eq!(t["state"], json!("reopened"));
    assert_eq!(t["creationRetained"], json!(false));
    // No hint: the repeated passage cannot be decided.
    assert_eq!(t["anchor"]["status"], json!("ambiguous"), "{t}");
    assert!(
        !pinned_by_comment(&r, at, c),
        "a collected revision is not pinned"
    );
}

#[test]
fn deleted_threads_leave_the_list_and_replayed_texts_equal_live_ones() {
    let (r, _page) = carrier_journal();
    let live = r.c.writer.lock().proj.comments.texts.clone();
    assert_eq!(live.len(), 1, "the deleted thread's text is gone");
    let listed = list(&r, TEXT);
    assert_eq!(listed["threads"].as_array().map(Vec::len), Some(1));
    assert_eq!(listed["threads"][0]["replies"][0]["body"], json!("a reply"));
    let (r, _page) = reopen(r);
    assert_eq!(r.c.writer.lock().proj.comments.texts, live);
}
