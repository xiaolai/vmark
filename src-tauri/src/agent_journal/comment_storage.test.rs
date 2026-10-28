// WI-AL3.1b — comment storage limits: physical usage stops at 128 MiB with COMMENT_STORAGE_FULL and a refusal appends nothing; with the logical budget full, create, reply and markAddressed are refused while resolve and delete still succeed; the terminal reserve is counted from creation, so a markAddressed that would fit only without it is refused, and a reopen without room to re-reserve a resolve is refused; a deleted thread leaves the logical budget at once and the physical one at the next startup compaction; and a deleted comment id is never reused after a restart, its old create retrying as staleIncarnation
//! R45, R107 rules 2 and 5, through the comment handles,
//! `CommentBook::plan` and `Writer::collect_startup`.

use crate::agent_journal::admission::admission_support::doc;
use crate::agent_journal::admission::request_support::{state, Rig};
use crate::agent_journal::comment::book::CommentBook;
use crate::agent_journal::comment::bounds::{charge, Limits, GLOBAL_BYTES, MIB, THREAD_BYTES};
use crate::agent_journal::comment::comment_support::*;
use crate::agent_journal::comment::ids::CommentCaller;
use crate::agent_journal::comment::ids::{CommentId, ThreadState};
use crate::agent_journal::comment::records::CommentRecord;
use crate::agent_journal::comment::rules::Action;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::gc_policy::GcPolicy;
use crate::agent_journal::writer::Writer;

/// Fill the logical budget: every undeleted thread together at 64 MiB.
fn fill_logical(r: &Rig) {
    inject(r, |b| {
        b.logical = GLOBAL_BYTES;
        b.physical = b.physical.max(GLOBAL_BYTES);
    });
}

#[test]
fn physical_bytes_stop_at_128_mib_with_comment_storage_full() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "first").expect("create"));
    let d = doc(&r.c);
    // The next reply, planned against the book at the physical limit.
    let (book, revisions, seq) = {
        let g = r.c.writer.lock();
        (
            g.proj.comments.clone(),
            g.proj.revisions.clone(),
            g.proj.generation + 1,
        )
    };
    let env = reply_env(d, c, seq, 0);
    let rec = CommentRecord::of(&env.record).expect("comment record");
    let n = charge(&env);
    let plan = |b: &CommentBook| b.plan(&env, rec, &revisions, Some(&Limits::REAL));
    let mut b = book.clone();
    b.physical = 128 * MIB - n;
    assert!(plan(&b).is_ok(), "physical usage exactly at 128 MiB");
    b.physical += 1;
    assert!(matches!(plan(&b), Err(TxnError::CommentStorageFull { .. })));

    // Through the writer: full physical storage refuses a create and a
    // reply, appending nothing; a resolve and a delete still succeed.
    inject(&r, |b| b.physical = 128 * MIB);
    let len = r.journal_len();
    assert_eq!(
        code(&create(&r, &page, "more").unwrap_err()),
        "COMMENT_STORAGE_FULL"
    );
    assert_eq!(
        code(&reply(&r, &page, c, 0, "more").unwrap_err()),
        "COMMENT_STORAGE_FULL"
    );
    assert_eq!(r.journal_len(), len);
    assert!(user(&r, Action::Resolve, c, 0).is_ok());
    assert!(user(&r, Action::Delete, c, 1).is_ok());
}

#[test]
fn resolve_and_delete_succeed_with_the_logical_budget_full() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "keep").expect("create"));
    let d = comment_of(&create_agent(&r, &page, "by an agent").expect("agent create"));
    fill_logical(&r);
    let len = r.journal_len();
    assert_eq!(
        code(&create(&r, &page, "more").unwrap_err()),
        "COMMENT_LIMIT"
    );
    assert_eq!(
        code(&reply(&r, &page, c, 0, "more").unwrap_err()),
        "COMMENT_LIMIT"
    );
    let e = act(&r, CommentCaller::Agent, Action::MarkAddressed, d, 0).unwrap_err();
    assert_eq!(code(&e), "COMMENT_LIMIT");
    assert_eq!(r.journal_len(), len, "no non-terminal record fits");
    let u = r.c.comments_user();
    assert!(u.resolve(&state_req(c, 0)).is_ok());
    assert!(u.delete(&state_req(c, 1)).is_ok());
    assert!(u.resolve(&state_req(d, 0)).is_ok());
    let before = r.c.writer.lock().proj.comments.logical;
    assert!(u.delete(&state_req(d, 1)).is_ok());
    let after = r.c.writer.lock().proj.comments.logical;
    assert!(
        after < before,
        "a deleted thread leaves the logical budget at once"
    );
}

#[test]
fn a_deleted_comment_id_is_never_reused_after_restart() {
    let (r, page) = rig();
    let payload = r.frame(&page, create_body(&r, TEXT, SEL, "short-lived"));
    let old = comment_of(&create_as(&r, &page, CommentCaller::User, &payload).expect("create"));
    let u = r.c.comments_user();
    u.resolve(&state_req(old, 0)).expect("resolve");
    u.delete(&state_req(old, 1)).expect("delete");
    let physical = r.c.writer.lock().proj.comments.physical;
    assert!(
        physical > 0,
        "a deleted thread stays physical until compaction"
    );

    // Restart: the startup pass drops the deleted thread's records.
    let (dir, pages) = close(r);
    {
        let (w, _) = Writer::open(fast_config(dir.path())).expect("reopen");
        w.collect_startup(&GcPolicy::default())
            .expect("startup collect");
        let g = w.lock();
        assert!(!g.proj.comments.threads.contains_key(&old));
        assert_eq!(g.proj.comments.physical, 0);
        assert!(
            g.proj.requests.is_empty(),
            "the create's receipt went with it"
        );
    }
    {
        let (w, _) = Writer::open(fast_config(dir.path())).expect("replay the rewrite");
        assert!(!w.lock().proj.comments.threads.contains_key(&old));
    }
    let (r, page2) = rig_at(dir, pages);
    let len = r.journal_len();
    let e = create_as(&r, &page, CommentCaller::User, &payload).unwrap_err();
    assert_eq!(state(&e), "staleIncarnation");
    assert_eq!(r.journal_len(), len);
    let new = comment_of(&create(&r, &page2, "after the restart").expect("create"));
    assert_ne!(new, old);
    assert!(new.seq() > old.seq(), "ids follow the journal's sequence");
}

/// The terminal reserve, written out: one resolve (342) and one delete
/// (310) while a thread is not resolved; the delete alone once it is.
const OPEN_RESERVE: u64 = 342 + 310;
const RESOLVED_RESERVE: u64 = 310;

/// Set `comment`'s charged bytes, carrying the thread's document and the
/// global totals by the same difference.
fn set_charges(r: &Rig, comment: CommentId, charges: u64) {
    inject(r, |b| {
        let t = b.threads.get_mut(&comment).expect("thread");
        let (old, doc) = (t.charges, t.doc);
        t.charges = charges;
        let shift = |x: u64| x - old + charges;
        b.logical = shift(b.logical);
        b.physical = shift(b.physical);
        let usage = b.docs.get_mut(&doc).expect("doc usage");
        usage.bytes = shift(usage.bytes);
    });
}

#[test]
fn a_mark_addressed_that_fits_only_without_the_reserve_is_refused() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "near the thread cap").expect("create"));
    // With the reserve counted the thread sits exactly at its 256 KiB cap,
    // so any further record passes it; a state record (about 300 bytes)
    // would fit in the 652 bytes the reserve holds if it were not counted.
    set_charges(&r, c, THREAD_BYTES - OPEN_RESERVE);
    let len = r.journal_len();
    let e = user(&r, Action::MarkAddressed, c, 0).expect_err("over the thread cap");
    assert_eq!(code(&e), "COMMENT_LIMIT");
    assert_eq!(e.detail().expect("detail")["bound"], "threadBytes");
    assert_eq!(r.journal_len(), len, "a refusal appends nothing");
    // The reserve is what the terminal actions spend.
    let u = r.c.comments_user();
    u.resolve(&state_req(c, 0))
        .expect("resolve spends the reserve");
    u.delete(&state_req(c, 1)).expect("delete spends the rest");
}

#[test]
fn a_reopen_without_room_to_re_reserve_a_resolve_is_refused() {
    let (r, page) = rig();
    let tight = comment_of(&create(&r, &page, "tight").expect("create"));
    let roomy = comment_of(&create(&r, &page, "roomy").expect("create"));
    let u = r.c.comments_user();
    for c in [tight, roomy] {
        u.resolve(&state_req(c, 0)).expect("resolve");
        assert_eq!(thread(&r, c).state, ThreadState::Resolved);
    }
    // Resolved, each holds only the delete reserve. `tight` sits at its cap;
    // `roomy` has 1,000 bytes to spare, room for a reopen record and the
    // 342-byte resolve reserve it takes back.
    set_charges(&r, tight, THREAD_BYTES - RESOLVED_RESERVE);
    set_charges(&r, roomy, THREAD_BYTES - RESOLVED_RESERVE - 1_000);
    let len = r.journal_len();
    let e = u
        .reopen(&state_req(tight, 1))
        .expect_err("no room for the resolve reserve");
    assert_eq!(code(&e), "COMMENT_LIMIT");
    assert_eq!(r.journal_len(), len, "a refusal appends nothing");
    assert_eq!(thread(&r, tight).state, ThreadState::Resolved);
    u.reopen(&state_req(roomy, 1)).expect("reopen with room");
    let t = thread(&r, roomy);
    assert_eq!(t.state, ThreadState::Reopened);
    assert!(t.logical() <= THREAD_BYTES);
    u.delete(&state_req(tight, 1))
        .expect("the tight thread can still end");
}

#[test]
fn an_online_collection_keeps_a_deleted_threads_records_and_receipts() {
    let (r, page) = rig();
    let payload = r.frame(&page, create_body(&r, TEXT, SEL, "deleted, then collected"));
    let first = create_as(&r, &page, CommentCaller::User, &payload).expect("create");
    let gone = comment_of(&first);
    let u = r.c.comments_user();
    u.resolve(&state_req(gone, 0)).expect("resolve");
    u.delete(&state_req(gone, 1)).expect("delete");
    let before = r.c.writer.lock().proj.clone();
    let len = r.journal_len();

    // Only startup prunes: online, a retry may still be read, so the
    // records and the receipt stay.
    r.c.writer
        .collect(&GcPolicy::default())
        .expect("online collect");
    {
        let g = r.c.writer.lock();
        assert!(g.proj.comments.threads[&gone].deleted, "kept, deleted");
        assert_eq!(g.proj.comments.physical, before.comments.physical);
        assert_eq!(g.proj.requests, before.requests, "the receipt stays");
    }
    assert_eq!(r.journal_len(), len, "nothing is rewritten");
    assert_eq!(
        create_as(&r, &page, CommentCaller::User, &payload).expect("retry"),
        first,
        "the retry is answered from the kept receipt"
    );
    let (dir, _) = close(r);
    let (w, _) = Writer::open(fast_config(dir.path())).expect("replay");
    assert!(w.lock().proj.comments.threads[&gone].deleted);
}

#[test]
fn pruning_more_physical_bytes_than_the_book_counts_is_corrupt() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "to prune").expect("create"));
    let u = r.c.comments_user();
    u.resolve(&state_req(c, 0)).expect("resolve");
    u.delete(&state_req(c, 1)).expect("delete");
    let mut book = r.c.writer.lock().proj.comments.clone();
    let gone = book.deleted();
    assert!(gone.contains(&c));
    // A total below what its own threads hold is an accounting the journal
    // cannot have produced: refuse it rather than wrap or panic.
    book.physical = book.threads[&c].physical() - 1;
    let untouched = book.clone();
    let e = book.prune(&gone).expect_err("an underflowing prune");
    assert_eq!(e.code(), "JOURNAL_CORRUPT", "{e}");
    assert_eq!(book, untouched, "a refused prune changes nothing");
    let mut book = r.c.writer.lock().proj.comments.clone();
    book.prune(&gone).expect("the real book prunes");
    assert_eq!(book.physical, 0);
    assert!(book.threads.is_empty());
}
