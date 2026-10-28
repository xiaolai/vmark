// WI-AL3.1b — comment rules: every cell of the state matrix through the user and agent handles (an allowed cell moves the thread and bumps commentGen, a refused one is COMMENT_NOT_ALLOWED with nothing appended); only a resolved thread is deleted and replay removes it; an A-B-A return to the same state at a newer commentGen is STALE_COMMENT; a comment id the journal has never minted, or one of another document, is INVALID_REQUEST (INVALID_COMMENT at the bridge), not STALE_COMMENT, with nothing appended; an actor on the user route, none on the agent route, or a caller field is INVALID_REQUEST; the MAX-3 exhaustion sequence; and a thread whose creation revision was collected still reopens
//! R36, R37 and R45 through the comment handles of a live controller.

use serde_json::json;

use crate::agent_journal::admission::admission_support::doc;
use crate::agent_journal::admission::request_support::{Page, Rig};
use crate::agent_journal::comment::comment_support::*;
use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ThreadState};
use crate::agent_journal::comment::ops::Transitioned;
use crate::agent_journal::comment::rules::{allowed, Action};
use crate::agent_journal::gc_policy::GcPolicy;
use crate::agent_journal::test_support::{agent, human_save};
use crate::agent_journal::writer::Writer;

/// A fresh thread brought to `state` by the user; its id and commentGen.
fn at(r: &Rig, page: &Page, state: ThreadState) -> (CommentId, u64) {
    let c = comment_of(&create(r, page, "matrix").expect("create"));
    let step = |a, g| user(r, a, c, g).map(|_| ()).expect("setup step");
    match state {
        ThreadState::Open => (c, 0),
        ThreadState::Addressed => (step(Action::MarkAddressed, 0), (c, 1)).1,
        ThreadState::Resolved => (step(Action::Resolve, 0), (c, 1)).1,
        ThreadState::Reopened => {
            step(Action::Resolve, 0);
            step(Action::Reopen, 1);
            (c, 2)
        }
    }
}

/// `action` by `caller` on `c` at `g`: a reply goes through the framed
/// handle, everything else through `act`.
fn attempt(
    r: &Rig,
    page: &Page,
    caller: CommentCaller,
    action: Action,
    c: CommentId,
    g: u64,
) -> Result<(), String> {
    let out = if action == Action::Reply {
        let p = r.frame(page, reply_body(c, g, "cell"));
        reply_as(r, page, caller, &p).map(|_| ())
    } else {
        act(r, caller, action, c, g).map(|_| ())
    };
    out.map_err(|e| code(&e))
}

/// Whether `caller` has an entry point for `action` at all.
fn offered(caller: CommentCaller, action: Action) -> bool {
    caller == CommentCaller::User || matches!(action, Action::Reply | Action::MarkAddressed)
}

use ThreadState::{Addressed, Open, Reopened, Resolved};
pub(crate) const USER: CommentCaller = CommentCaller::User;
pub(crate) const AGENT: CommentCaller = CommentCaller::Agent;

/// R36's matrix, written out by hand so the test does not ask the code
/// under test what it should do: (from, caller, action, the state an
/// allowed action leaves). A delete leaves `resolved`, marked deleted.
#[rustfmt::skip]
pub(crate) const MATRIX: [(ThreadState, CommentCaller, Action, Option<ThreadState>); 40] = [
    (Open, USER, Action::Reply, Some(Open)),
    (Open, USER, Action::MarkAddressed, Some(Addressed)),
    (Open, USER, Action::Resolve, Some(Resolved)),
    (Open, USER, Action::Reopen, None),
    (Open, USER, Action::Delete, None),
    (Addressed, USER, Action::Reply, Some(Addressed)),
    (Addressed, USER, Action::MarkAddressed, None),
    (Addressed, USER, Action::Resolve, Some(Resolved)),
    (Addressed, USER, Action::Reopen, None),
    (Addressed, USER, Action::Delete, None),
    (Resolved, USER, Action::Reply, Some(Resolved)),
    (Resolved, USER, Action::MarkAddressed, None),
    (Resolved, USER, Action::Resolve, None),
    (Resolved, USER, Action::Reopen, Some(Reopened)),
    (Resolved, USER, Action::Delete, Some(Resolved)),
    (Reopened, USER, Action::Reply, Some(Reopened)),
    (Reopened, USER, Action::MarkAddressed, Some(Addressed)),
    (Reopened, USER, Action::Resolve, Some(Resolved)),
    (Reopened, USER, Action::Reopen, None),
    (Reopened, USER, Action::Delete, None),
    (Open, AGENT, Action::Reply, Some(Open)),
    (Open, AGENT, Action::MarkAddressed, Some(Addressed)),
    (Open, AGENT, Action::Resolve, None),
    (Open, AGENT, Action::Reopen, None),
    (Open, AGENT, Action::Delete, None),
    (Addressed, AGENT, Action::Reply, Some(Addressed)),
    (Addressed, AGENT, Action::MarkAddressed, None),
    (Addressed, AGENT, Action::Resolve, None),
    (Addressed, AGENT, Action::Reopen, None),
    (Addressed, AGENT, Action::Delete, None),
    (Resolved, AGENT, Action::Reply, None),
    (Resolved, AGENT, Action::MarkAddressed, None),
    (Resolved, AGENT, Action::Resolve, None),
    (Resolved, AGENT, Action::Reopen, None),
    (Resolved, AGENT, Action::Delete, None),
    (Reopened, AGENT, Action::Reply, Some(Reopened)),
    (Reopened, AGENT, Action::MarkAddressed, Some(Addressed)),
    (Reopened, AGENT, Action::Resolve, None),
    (Reopened, AGENT, Action::Reopen, None),
    (Reopened, AGENT, Action::Delete, None),
];

#[test]
fn the_written_matrix_covers_every_cell_once() {
    let mut seen = std::collections::BTreeSet::new();
    for (from, caller, action, _) in MATRIX {
        assert!(
            seen.insert(format!("{from:?} {caller:?} {action:?}")),
            "{from:?} {caller:?} {action:?} twice"
        );
    }
    assert_eq!(
        seen.len(),
        ThreadState::ALL.len() * CommentCaller::ALL.len() * Action::ALL.len()
    );
}

#[test]
fn every_cell_of_the_state_matrix_holds_through_the_handles() {
    let (r, page) = rig();
    let mut cells = 0;
    for (from, caller, action, want) in MATRIX {
        let what = format!("{caller:?} {} from {from:?}", action.name());
        if !offered(caller, action) {
            // The agent route has no resolve, reopen or delete at all;
            // replay (`allowed`) must refuse an agent record of one too.
            assert_eq!(want, None, "{what}");
            assert_eq!(allowed(action, caller, from), None, "{what}");
            continue;
        }
        let (c, g) = at(&r, &page, from);
        let len = r.journal_len();
        match (want, attempt(&r, &page, caller, action, c, g)) {
            (Some(to), Ok(())) if action == Action::Delete => {
                assert_eq!(to, Resolved, "{what}");
                assert!(thread(&r, c).deleted, "{what}");
            }
            (Some(to), Ok(())) => {
                let t = thread(&r, c);
                assert_eq!((t.state, t.comment_gen), (to, g + 1), "{what}");
            }
            (None, Err(code)) => {
                assert_eq!(code, "COMMENT_NOT_ALLOWED", "{what}");
                assert_eq!(r.journal_len(), len, "{what}: a refusal appends nothing");
                assert_eq!(thread(&r, c).comment_gen, g, "{what}");
            }
            (want, got) => panic!("{what}: the matrix says {want:?}, the handle gave {got:?}"),
        }
        cells += 1;
    }
    assert_eq!(cells, 4 * (5 + 2), "every offered cell was exercised");
    // Replay holds every recorded edge to the same table.
    let live = r.c.writer.lock().proj.comments.clone();
    let (dir, _pages) = close(r);
    let (w, _) = Writer::open(fast_config(dir.path())).expect("replay");
    assert_eq!(
        w.lock().proj.comments,
        live,
        "replay rebuilds the live book"
    );
}

#[test]
fn only_a_resolved_thread_is_deleted_and_replay_keeps_it_gone() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "to delete").expect("create"));
    let e = user(&r, Action::Delete, c, 0).expect_err("an open thread");
    assert_eq!(code(&e), "COMMENT_NOT_ALLOWED");
    user(&r, Action::Resolve, c, 0).expect("resolve");
    match user(&r, Action::Delete, c, 1).expect("delete") {
        Transitioned::Deleted(d) => assert_eq!(d.comment, c),
        Transitioned::State(s) => panic!("a delete answered with a state: {s:?}"),
    }
    let e = user(&r, Action::Reopen, c, 1).expect_err("a deleted thread");
    assert_eq!(
        code(&e),
        "STALE_COMMENT",
        "a deleted thread takes no action"
    );
    let p = r.frame(&page, reply_body(c, 1, "late"));
    assert_eq!(
        code(&reply_as(&r, &page, CommentCaller::User, &p).unwrap_err()),
        "STALE_COMMENT"
    );
    let (dir, _) = close(r);
    let (w, _) = Writer::open(fast_config(dir.path())).expect("replay");
    let g = w.lock();
    assert!(
        g.proj.comments.threads[&c].deleted,
        "replay sees the delete"
    );
    assert_eq!(
        g.proj.comments.logical, 0,
        "a deleted thread holds no logical budget"
    );
}

#[test]
fn an_aba_return_to_the_same_state_is_stale_comment() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "aba").expect("create"));
    user(&r, Action::Resolve, c, 0).expect("resolve");
    user(&r, Action::Reopen, c, 1).expect("reopen");
    user(&r, Action::Resolve, c, 2).expect("resolve again");
    assert_eq!(thread(&r, c).state, ThreadState::Resolved);
    let len = r.journal_len();
    // A window that saw the first `resolved` (commentGen 1) deletes.
    let e = user(&r, Action::Delete, c, 1).expect_err("stale");
    assert_eq!(code(&e), "STALE_COMMENT");
    // A retry after a successful state change is stale, never a second record.
    let e = user(&r, Action::Reopen, c, 2).expect_err("stale");
    assert_eq!(code(&e), "STALE_COMMENT");
    let e = user(&r, Action::Reopen, c, u64::MAX).expect_err("from the future");
    assert_eq!(code(&e), "STALE_COMMENT");
    assert_eq!(r.journal_len(), len);
    assert!(user(&r, Action::Delete, c, 3).is_ok());
}

#[test]
fn an_unknown_or_other_document_comment_is_invalid_request() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "mine").expect("create"));
    r.c.docs.resolve("doc-other").expect("another document");
    let len = r.journal_len();
    let unknown = CommentId::at(u64::MAX - 1);
    let e = user(&r, Action::Resolve, unknown, 0).expect_err("never minted");
    assert_eq!(code(&e), "INVALID_REQUEST", "unknown: {e:?}");
    let mut req = state_req(c, 0);
    req.doc_key = "doc-other".into();
    let e =
        r.c.comments_user()
            .resolve(&req)
            .expect_err("another document");
    assert_eq!(code(&e), "INVALID_REQUEST", "other document: {e:?}");
    let p = r.frame(&page, reply_body(unknown, 0, "to nothing"));
    assert_eq!(
        code(&reply_as(&r, &page, CommentCaller::Agent, &p).unwrap_err()),
        "INVALID_REQUEST"
    );
    assert_eq!(r.journal_len(), len, "a refusal appends nothing");
    assert_eq!(thread(&r, c).comment_gen, 0);
}

#[test]
fn a_forged_actor_or_caller_is_invalid_request() {
    let (r, page) = rig();
    let len = r.journal_len();
    let mut with_actor = create_body(&r, TEXT, SEL, "forged");
    with_actor["actor"] = serde_json::to_value(agent()).expect("actor");
    let p = r.frame(&page, with_actor);
    assert_eq!(
        code(&create_as(&r, &page, CommentCaller::User, &p).unwrap_err()),
        "INVALID_REQUEST"
    );
    let p = r.frame(&page, create_body(&r, TEXT, SEL, "anonymous agent"));
    assert_eq!(
        code(&create_as(&r, &page, CommentCaller::Agent, &p).unwrap_err()),
        "INVALID_REQUEST"
    );
    for caller in CommentCaller::ALL {
        let mut b = create_body(&r, TEXT, SEL, "self-attributed");
        b["caller"] = json!("user");
        let p = r.frame(&page, b);
        assert_eq!(
            code(&create_as(&r, &page, caller, &p).unwrap_err()),
            "INVALID_REQUEST"
        );
    }
    assert_eq!(r.journal_len(), len, "a refused create appends nothing");
    let c = comment_of(&create_agent(&r, &page, "attributed").expect("agent create"));
    assert_eq!(r.c.writer.lock().proj.comments.threads.len(), 1);
    let mut b = reply_body(c, 0, "self-attributed");
    b["caller"] = json!("user");
    let p = r.frame(&page, b);
    assert_eq!(
        code(&reply_as(&r, &page, CommentCaller::Agent, &p).unwrap_err()),
        "INVALID_REQUEST"
    );
}

#[test]
fn a_thread_three_short_of_max_replies_resolves_and_deletes_but_no_more() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "near the end").expect("create"));
    let max = u64::MAX;
    inject(&r, |b| {
        b.threads.get_mut(&c).expect("thread").comment_gen = max - 3
    });
    let p = r.frame(&page, reply_body(c, max - 3, "last reply"));
    reply_as(&r, &page, CommentCaller::User, &p).expect("a reply at MAX-3");
    assert_eq!(thread(&r, c).comment_gen, max - 2);
    let len = r.journal_len();
    for caller in CommentCaller::ALL {
        let e = act(&r, caller, Action::MarkAddressed, c, max - 2).expect_err("exhausted");
        assert_eq!(code(&e), "COMMENT_STATE_EXHAUSTED", "{caller:?}");
    }
    let p = r.frame(&page, reply_body(c, max - 2, "one too many"));
    assert_eq!(
        code(&reply_as(&r, &page, CommentCaller::User, &p).unwrap_err()),
        "COMMENT_STATE_EXHAUSTED"
    );
    assert_eq!(r.journal_len(), len);
    user(&r, Action::Resolve, c, max - 2).expect("resolve at MAX-2");
    assert_eq!(thread(&r, c).comment_gen, max - 1);
    let e = user(&r, Action::Reopen, c, max - 1).expect_err("exhausted");
    assert_eq!(code(&e), "COMMENT_STATE_EXHAUSTED");
    user(&r, Action::Delete, c, max - 1).expect("delete is never exhausted");
    assert!(thread(&r, c).deleted);
}

#[test]
fn a_thread_reopens_after_its_creation_revision_is_collected() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "outlives its revision").expect("create"));
    let created_on = thread(&r, c).revision;
    // Only a resolved thread lets its creation revision go (ADR-AL13).
    user(&r, Action::Resolve, c, 0).expect("resolve");
    let d = doc(&r.c);
    for text in ["one\n", "two\n", "three\n"] {
        human_save(&r.c.writer, d, text);
    }
    let report =
        r.c.writer
            .collect(&GcPolicy {
                max_revisions: 1,
                ..GcPolicy::default()
            })
            .expect("collect");
    assert!(report.collected.contains(&created_on), "{report:?}");
    user(&r, Action::Reopen, c, 1).expect("reopen");
    let live = r.c.writer.lock().proj.comments.clone();
    let (r, _) = reopen(r);
    assert_eq!(
        r.c.writer.lock().proj.comments,
        live,
        "replay after collection"
    );
    assert_eq!(thread(&r, c).state, ThreadState::Reopened);
    user(&r, Action::MarkAddressed, c, 2).expect("still actionable after restart");
}
