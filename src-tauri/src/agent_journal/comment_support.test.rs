// WI-AL3.1b — shared helpers for the comment tests: a request rig over a writer that does not fsync, frozen create and reply payloads for the user and agent routes, the state-change entry points, and direct access to the comment book for injecting a budget or generation at a boundary
//! Helpers only; the cases live in the `comment_*` test files.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::agent_journal::admission::admission_support::{doc, KEY};
use crate::agent_journal::admission::page_table::PageTable;
use crate::agent_journal::admission::request_support::{Page, Rig};
use crate::agent_journal::comment::book::{CommentBook, Thread};
use crate::agent_journal::comment::ids::ReplyId;
use crate::agent_journal::comment::ids::{CommentCaller, CommentId};
use crate::agent_journal::comment::ops::Transitioned;
use crate::agent_journal::comment::records::CommentReplied;
use crate::agent_journal::comment::rules::Action;
use crate::agent_journal::comment::wire::StateRequest;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::degraded_drain::{Backoff, DrainScheduler};
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::ids::{DocId, RevisionId, TxnId};
use crate::agent_journal::journal_file::SyncPolicy;
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V5};
use crate::agent_journal::test_support::{agent, config};
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_types::WriterConfig;
use crate::command_error::CommandError;

pub(crate) use crate::agent_journal::admission::admission_support::journal_code;

/// The text every thread is opened on, and the selection of `hello`.
pub(crate) const TEXT: &str = "# Title\n\nhello world\n";
pub(crate) const SEL: (u64, u64) = (9, 14);

fn fast_controller(dir: &std::path::Path, docs: Arc<DocRegistry>) -> Controller {
    let (cfg, _) = config(dir, SyncPolicy::None);
    let (w, _) = Writer::open(cfg).expect("open writer");
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    Controller::new(Arc::new(w), docs, Arc::new(drains))
}

/// A request rig whose writer appends without fsync, and its one page.
pub(crate) fn rig() -> (Rig, Page) {
    let dir = tempfile::tempdir().expect("tempdir");
    let c = fast_controller(dir.path(), Arc::default());
    let r = Rig {
        dir,
        c,
        faults: Arc::default(),
        pages: Arc::default(),
    };
    let page = r.page("doc-a", 1);
    (r, page)
}

/// Restart on `r`'s directory: a new writer incarnation that keeps the
/// document registry (durable in the app, in memory here), and a fresh page.
pub(crate) fn reopen(r: Rig) -> (Rig, Page) {
    let docs = Arc::clone(&r.c.docs);
    let (dir, pages) = close(r);
    let c = fast_controller(dir.path(), docs);
    let r = Rig {
        dir,
        c,
        faults: Arc::default(),
        pages,
    };
    let page = r.page("doc-b", 2);
    (r, page)
}

/// Stop `r`'s writer, keeping its directory and page table.
pub(crate) fn close(r: Rig) -> (tempfile::TempDir, Arc<PageTable>) {
    let Rig { dir, c, pages, .. } = r;
    drop(c);
    (dir, pages)
}

/// A rig over a new writer on `dir`, with a fresh page.
pub(crate) fn rig_at(dir: tempfile::TempDir, pages: Arc<PageTable>) -> (Rig, Page) {
    let c = fast_controller(dir.path(), Arc::default());
    let r = Rig {
        dir,
        c,
        faults: Arc::default(),
        pages,
    };
    let page = r.page("doc-b", 2);
    (r, page)
}

/// The writer config of `dir`, without fsync.
pub(crate) fn fast_config(dir: &std::path::Path) -> WriterConfig {
    config(dir, SyncPolicy::None).0
}

pub(crate) fn head(r: &Rig) -> Option<RevisionId> {
    r.c.writer.head(doc(&r.c))
}

/// A create of `KEY` on `text` at the current head, selecting `sel`.
pub(crate) fn create_body(r: &Rig, text: &str, sel: (u64, u64), body: &str) -> Value {
    json!({
        "docKey": KEY,
        "parent": head(r),
        "text": text,
        "selection": { "start": sel.0, "end": sel.1, "precision": "exact" },
        "body": body,
        "author": "Reviewer",
    })
}

/// `body` frozen for `page` and created through `caller`'s handle; the
/// bound reply as JSON.
pub(crate) fn create_as(
    r: &Rig,
    page: &Page,
    caller: CommentCaller,
    payload: &str,
) -> Result<Value, CommandError> {
    let out = match caller {
        CommentCaller::User => r.c.comments_user().create(&r.pages, &page.label, payload),
        CommentCaller::Agent => r.c.comments_agent().create(&r.pages, &page.label, payload),
    }?;
    Ok(serde_json::to_value(out).expect("reply"))
}

/// A user thread on `TEXT` with `body`, at the head.
pub(crate) fn create(r: &Rig, page: &Page, body: &str) -> Result<Value, CommandError> {
    let p = r.frame(page, create_body(r, TEXT, SEL, body));
    create_as(r, page, CommentCaller::User, &p)
}

/// An agent thread on `TEXT`, attributed to an MCP actor.
pub(crate) fn create_agent(r: &Rig, page: &Page, body: &str) -> Result<Value, CommandError> {
    let mut b = create_body(r, TEXT, SEL, body);
    b["actor"] = serde_json::to_value(agent()).expect("actor");
    let p = r.frame(page, b);
    create_as(r, page, CommentCaller::Agent, &p)
}

/// The thread a bound create reply names.
pub(crate) fn comment_of(reply: &Value) -> CommentId {
    serde_json::from_value(reply["reply"]["comment"].clone()).expect("comment")
}

pub(crate) fn reply_body(comment: CommentId, expected: u64, body: &str) -> Value {
    json!({
        "docKey": KEY,
        "comment": comment,
        "body": body,
        "author": "Reviewer",
        "expectedCommentGen": expected.to_string(),
    })
}

pub(crate) fn reply_as(
    r: &Rig,
    page: &Page,
    caller: CommentCaller,
    payload: &str,
) -> Result<Value, CommandError> {
    let out = match caller {
        CommentCaller::User => r.c.comments_user().reply(&r.pages, &page.label, payload),
        CommentCaller::Agent => r.c.comments_agent().reply(&r.pages, &page.label, payload),
    }?;
    Ok(serde_json::to_value(out).expect("reply"))
}

/// A user reply to `comment` at `expected`.
pub(crate) fn reply(
    r: &Rig,
    page: &Page,
    comment: CommentId,
    expected: u64,
    body: &str,
) -> Result<Value, CommandError> {
    let p = r.frame(page, reply_body(comment, expected, body));
    reply_as(r, page, CommentCaller::User, &p)
}

/// `action` (not a reply) on `comment` at `expected`, through `caller`'s
/// handle; an agent handle offers only `markAddressed`.
pub(crate) fn act(
    r: &Rig,
    caller: CommentCaller,
    action: Action,
    comment: CommentId,
    expected: u64,
) -> Result<Transitioned, CommandError> {
    let req = state_req(comment, expected);
    let (u, a) = (r.c.comments_user(), r.c.comments_agent());
    match (caller, action) {
        (CommentCaller::User, Action::MarkAddressed) => u.mark_addressed(&req),
        (CommentCaller::User, Action::Resolve) => u.resolve(&req),
        (CommentCaller::User, Action::Reopen) => u.reopen(&req),
        (CommentCaller::User, Action::Delete) => u.delete(&req),
        (CommentCaller::Agent, Action::MarkAddressed) => a.mark_addressed(&req),
        (_, action) => panic!("no {} entry point for {caller:?}", action.name()),
    }
}

/// A state change or deletion of `comment` at `expected`.
pub(crate) fn state_req(comment: CommentId, expected: u64) -> StateRequest {
    StateRequest {
        doc_key: KEY.into(),
        comment,
        expected_comment_gen: expected,
    }
}

/// `action` by the user.
pub(crate) fn user(
    r: &Rig,
    action: Action,
    comment: CommentId,
    expected: u64,
) -> Result<Transitioned, CommandError> {
    act(r, CommentCaller::User, action, comment, expected)
}

pub(crate) fn thread(r: &Rig, comment: CommentId) -> Thread {
    r.c.writer.lock().proj.comments.threads[&comment].clone()
}

/// Change the live comment book under the writer lock (a cap or a
/// generation at a boundary, without writing the records that reach it).
pub(crate) fn inject(r: &Rig, f: impl FnOnce(&mut CommentBook)) {
    f(&mut r.c.writer.lock().proj.comments);
}

pub(crate) fn code(e: &CommandError) -> String {
    journal_code(e)
}

/// A reply envelope to `comment` of `doc` at `expected`, as the writer
/// would append it next.
pub(crate) fn reply_env(doc: DocId, comment: CommentId, seq: u64, expected: u64) -> Envelope {
    Envelope {
        schema_version: SCHEMA_V5,
        seq,
        txn: TxnId::new(),
        at: 1_700_000_000_000,
        record: Record::CommentReplied(CommentReplied {
            doc,
            comment,
            reply: ReplyId::at(seq),
            body: "boundary".into(),
            author: "Reviewer".into(),
            caller: CommentCaller::User,
            expected_comment_gen: expected,
        }),
        receipt: None,
    }
}

/// A journal holding one of each schema-5 carrier, written through the
/// handles: a create on unsaved text (an `admission` whose last item is
/// the `commentCreated`), a create on the head (top level), a reply, a
/// resolve and a delete.
pub(crate) fn carrier_journal() -> (Rig, Page) {
    let (r, page) = rig();
    let first = comment_of(&create(&r, &page, "on unsaved text").expect("staged create"));
    let c = comment_of(&create(&r, &page, "on the head").expect("direct create"));
    reply(&r, &page, c, 0, "a reply").expect("reply");
    user(&r, Action::Resolve, first, 0).expect("resolve");
    user(&r, Action::Delete, first, 1).expect("delete");
    (r, page)
}

/// The schema-5 records of `r`'s journal, as raw JSON, in journal order.
pub(crate) fn v5_records(r: &Rig) -> Vec<Value> {
    let raw = r.c.writer.lock().journal.read_all().expect("journal");
    raw.iter()
        .map(|p| serde_json::from_slice::<Value>(p).expect("record"))
        .filter(|v| v["schemaVersion"] == json!(SCHEMA_V5))
        .collect()
}

/// `v` labelled `version`, an admission's items with it.
pub(crate) fn relabel(v: &Value, version: u32) -> Value {
    let mut v = v.clone();
    v["schemaVersion"] = version.into();
    // `pointer_mut`, not indexing: indexing a missing key inserts `null`,
    // and a non-admission record would then fail on an unknown `items`
    // field before its label is ever checked.
    if let Some(items) = v.pointer_mut("/record/items").and_then(Value::as_array_mut) {
        for item in items {
            item["schemaVersion"] = version.into();
        }
    }
    v
}
