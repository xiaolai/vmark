// WI-AL3.3 — a controlled write's addresses: checked as a set under the writer lock before the prepare (an unknown, other-document, duplicate, resolved or deleted id is INVALID_REQUEST naming `field: addresses` and appends nothing; 64 accepted, 65 refused); an addressed or reopened comment is accepted; an assertion only (no thread state or commentGen moves), stored on the committed record, copied into its tombstone and kept across a restart, labelled schema 5, shown in the history with a deleted comment marked, and the agent's read-only comment list
//! Through the framed prepare a window sends (`Controller::prepare_framed`).

use serde_json::{json, Value};

use super::comment_support::*;
use crate::agent_journal::admission::admission_support::{body, doc, request_id, KEY};
use crate::agent_journal::admission::request_support::{txn_of, Page, Rig};
use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ThreadState};
use crate::agent_journal::comment::rules::Action;
use crate::agent_journal::gc_policy::GcPolicy;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId, TxnId};
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V4, SCHEMA_V5};
use crate::agent_journal::review::{ReviewEffects, ReviewOp};
use crate::agent_journal::schema_table::{check, label};
use crate::agent_journal::test_support::{agent, human_save};
use crate::command_error::CommandError;

const OTHER_KEY: &str = "path:/notes/other.md";

/// A prepare of `KEY` on the head's text (`TEXT`) claiming `addresses`.
fn prepare_addressing(r: &Rig, page: &Page, addresses: Value) -> Result<Value, CommandError> {
    let mut b = body(head(r), TEXT, Some(&request_id()));
    b["addresses"] = addresses;
    r.prepare(page, &r.frame(page, b))
}

/// Prepare and commit `post` claiming `addresses`: the revision it made.
fn write_addressing(r: &Rig, page: &Page, addresses: Value, post: &str) -> RevisionId {
    let reply = prepare_addressing(r, page, addresses).expect("prepare");
    r.commit(page, txn_of(&reply), post).expect("commit");
    serde_json::from_value(reply["reply"]["revision"].clone()).expect("revision")
}

fn refused(r: &Rig, page: &Page, addresses: Value) -> String {
    let len = r.journal_len();
    let e = prepare_addressing(r, page, addresses).unwrap_err();
    assert_eq!(r.journal_len(), len, "a refused prepare appends nothing");
    assert_eq!(r.c.writer.lock().reservations.len(), 0, "nor reserves");
    let field = e.detail().and_then(|d| d["field"].as_str());
    assert_eq!(field, Some("addresses"), "the refusal names the field");
    code(&e)
}

fn addresses_of(r: &Rig, rev: RevisionId) -> Vec<CommentId> {
    r.c.writer.lock().proj.revisions[&rev].addresses.clone()
}

#[test]
fn an_unknown_comment_id_is_refused() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "look").expect("create"));
    let unknown = CommentId::at(c.seq() + 1000);
    assert_eq!(refused(&r, &page, json!([unknown])), "INVALID_REQUEST");
}

#[test]
fn a_comment_of_another_document_is_refused() {
    let (r, page) = rig();
    create(&r, &page, "here").expect("create");
    let mut b = create_body(&r, TEXT, SEL, "elsewhere");
    b["docKey"] = json!(OTHER_KEY);
    b["parent"] = Value::Null;
    let p = r.frame(&page, b);
    let other = comment_of(&create_as(&r, &page, CommentCaller::User, &p).expect("create"));
    assert_eq!(refused(&r, &page, json!([other])), "INVALID_REQUEST");
}

#[test]
fn a_duplicate_id_is_refused() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "look").expect("create"));
    assert_eq!(refused(&r, &page, json!([c, c])), "INVALID_REQUEST");
}

#[test]
fn a_resolved_comment_is_refused() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "look").expect("create"));
    user(&r, Action::Resolve, c, 0).expect("resolve");
    assert_eq!(refused(&r, &page, json!([c])), "INVALID_REQUEST");
}

#[test]
fn a_deleted_comment_is_refused() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "look").expect("create"));
    user(&r, Action::Resolve, c, 0).expect("resolve");
    user(&r, Action::Delete, c, 1).expect("delete");
    assert_eq!(refused(&r, &page, json!([c])), "INVALID_REQUEST");
}

#[test]
fn one_bad_id_refuses_the_whole_set() {
    let (r, page) = rig();
    let good = comment_of(&create(&r, &page, "good").expect("create"));
    let bad = comment_of(&create(&r, &page, "bad").expect("create"));
    user(&r, Action::Resolve, bad, 0).expect("resolve");
    assert_eq!(refused(&r, &page, json!([good, bad])), "INVALID_REQUEST");
}

#[test]
fn an_addressed_and_a_reopened_comment_are_accepted() {
    let (r, page) = rig();
    let addressed = comment_of(&create(&r, &page, "one").expect("create"));
    let reopened = comment_of(&create(&r, &page, "two").expect("create"));
    user(&r, Action::MarkAddressed, addressed, 0).expect("mark addressed");
    user(&r, Action::Resolve, reopened, 0).expect("resolve");
    user(&r, Action::Reopen, reopened, 1).expect("reopen");
    assert_eq!(thread(&r, addressed).state, ThreadState::Addressed);
    assert_eq!(thread(&r, reopened).state, ThreadState::Reopened);
    let rev = write_addressing(&r, &page, json!([addressed, reopened]), "both\n");
    assert_eq!(addresses_of(&r, rev), [addressed, reopened]);
}

#[test]
fn sixty_four_addresses_are_accepted_and_sixty_five_refused() {
    let (r, page) = rig();
    let ids: Vec<CommentId> = (0..65)
        .map(|i| comment_of(&create(&r, &page, &format!("c{i}")).expect("create")))
        .collect();
    assert_eq!(refused(&r, &page, json!(ids)), "INVALID_REQUEST");
    let rev = write_addressing(&r, &page, json!(ids[..64]), "64 addressed\n");
    assert_eq!(addresses_of(&r, rev), ids[..64]);
}

#[test]
fn addresses_are_an_assertion_only_and_move_no_comment() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "look").expect("create"));
    let before = thread(&r, c);
    let comment_gen = r.c.writer.lock().proj.comments.threads[&c].comment_gen;
    let rev = write_addressing(&r, &page, json!([c]), "fixed\n");
    let after = thread(&r, c);
    assert_eq!(after.state, before.state);
    assert_eq!(after.comment_gen, comment_gen);
    assert_eq!(after, before, "the thread is untouched");
    assert_eq!(addresses_of(&r, rev), [c], "stored on the committed record");
}

#[test]
fn an_empty_set_is_no_claim() {
    let (r, page) = rig();
    let rev = write_addressing(&r, &page, json!([]), "plain\n");
    assert!(addresses_of(&r, rev).is_empty());
}

#[test]
fn a_collected_revision_tombstone_keeps_its_addresses_after_restart() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "look").expect("create"));
    let rev = write_addressing(&r, &page, json!([c]), "fixed\n");
    let d = doc(&r.c);
    human_save(&r.c.writer, d, "later\n");
    human_save(&r.c.writer, d, "latest\n");
    r.c.writer
        .collect(&GcPolicy {
            max_revisions: 1,
            ..GcPolicy::default()
        })
        .expect("collect");
    let (r, _page) = reopen(r);
    let g = r.c.writer.lock();
    let m = &g.proj.revisions[&rev];
    assert!(m.collected, "the addressed revision was collected");
    assert_eq!(m.addresses, [c], "the tombstone kept its addresses");
}

#[test]
fn the_history_marks_an_addressed_comment_that_was_deleted() {
    let (r, page) = rig();
    let kept = comment_of(&create(&r, &page, "kept").expect("create"));
    let gone = comment_of(&create(&r, &page, "gone").expect("create"));
    let rev = write_addressing(&r, &page, json!([kept, gone]), "fixed\n");
    user(&r, Action::Resolve, gone, 0).expect("resolve");
    user(&r, Action::Delete, gone, 1).expect("delete");
    let history =
        r.c.history(&json!({ "docKey": KEY }).to_string())
            .expect("history");
    let row = history
        .rows
        .iter()
        .find(|h| h.revision == rev)
        .expect("row");
    let got = serde_json::to_value(&row.addresses).expect("json");
    assert_eq!(
        got,
        json!([
            { "comment": kept, "deleted": false },
            { "comment": gone, "deleted": true },
        ])
    );
}

fn committed(addresses: Vec<CommentId>) -> Record {
    Record::Committed {
        postimage: BlobHash::of_text("x"),
        resolves: None,
        provenance: None,
        effects: ReviewEffects::default(),
        addresses,
    }
}

fn tombstone(addresses: Vec<CommentId>) -> Record {
    Record::Tombstone {
        doc: DocId::new(),
        revision: RevisionId::new(),
        parent: None,
        actor: agent(),
        preimage: None,
        postimage: BlobHash::of_text("x"),
        review_op: ReviewOp::Review,
        hunks: vec![],
        transitions: vec![],
        attached_to: None,
        addresses,
    }
}

fn env(version: u32, record: Record) -> Envelope {
    Envelope {
        schema_version: version,
        seq: 1,
        txn: TxnId::new(),
        at: 0,
        record,
        receipt: None,
    }
}

#[test]
fn addresses_are_a_schema_5_field_and_corrupt_under_an_older_label() {
    for record in [
        committed(vec![CommentId::at(1)]),
        tombstone(vec![CommentId::at(1)]),
    ] {
        assert_eq!(label(&record), SCHEMA_V5);
        check(&env(SCHEMA_V5, record.clone())).expect("v5");
        let e = check(&env(SCHEMA_V4, record)).unwrap_err();
        assert_eq!(e.code(), "JOURNAL_CORRUPT", "{e}");
    }
    for record in [committed(vec![]), tombstone(vec![])] {
        assert!(label(&record) < SCHEMA_V5, "no addresses, no v5 label");
        let v = serde_json::to_value(&record).expect("json");
        assert!(v.get("addresses").is_none(), "an empty set is not written");
    }
}

#[test]
fn a_stored_set_with_a_duplicate_or_over_the_bound_is_corrupt() {
    use crate::agent_journal::comment::addresses::MAX_ADDRESSES;
    use crate::agent_journal::comment::binding;
    let ids = |n: u64| (1..=n).map(CommentId::at).collect::<Vec<_>>();
    let max = MAX_ADDRESSES as u64;
    for record in [committed(ids(max)), tombstone(ids(max))] {
        binding::check(&env(SCHEMA_V5, record)).expect("the bound itself is accepted");
    }
    let dup = || vec![CommentId::at(2), CommentId::at(2)];
    let bad = [
        committed(dup()),
        tombstone(dup()),
        committed(ids(max + 1)),
        tombstone(ids(max + 1)),
    ];
    for record in bad {
        let e = binding::check(&env(SCHEMA_V5, record)).unwrap_err();
        assert_eq!(e.code(), "JOURNAL_CORRUPT", "{e}");
    }
}

#[test]
fn the_agent_lists_the_same_threads_the_user_does() {
    let (r, page) = rig();
    create(&r, &page, "from the user").expect("create");
    create_agent(&r, &page, "from the agent").expect("create");
    let payload = json!({ "docKey": KEY, "text": TEXT }).to_string();
    let user = serde_json::to_value(r.c.comments_user().list(&payload).expect("user list"));
    let agent = serde_json::to_value(r.c.comments_agent().list(&payload).expect("agent list"));
    assert_eq!(agent.expect("json"), user.expect("json"));
}
