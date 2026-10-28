// WI-AL3.1b — comment bounds at the boundary: a body of 16 KiB is accepted and one byte more refused (create and reply, UTF-8 bytes); the 200th reply and the 1000th comment are accepted and the next refused; the thread, document and global byte limits hold exactly at the limit; a refusal appends nothing; and the largest resolve and delete frames fit the terminal reserve constants; a heading of MAX_SEGMENT_BYTES UTF-8 bytes above the selection is accepted and one byte more refused headingSegment
//! R37 and R45 (usage) and R107 rule 6, through the comment handles and
//! `CommentBook::plan`.

use serde_json::{json, Value};

use crate::agent_journal::admission::admission_support::doc;
use crate::agent_journal::admission::request_support::Rig;
use crate::agent_journal::comment::book::CommentBook;
use crate::agent_journal::comment::bounds::{
    charge, reserve, Limits, GLOBAL_BYTES, KIB, MAX_DELETE_FRAME, MAX_RESOLVE_FRAME, MIB,
};
use crate::agent_journal::comment::comment_support::*;
use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ThreadState};
use crate::agent_journal::comment::records::{CommentDeleted, CommentRecord, CommentState};
use crate::agent_journal::comment::rules::{allowed, Action};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, TxnId};
use crate::agent_journal::record::{Envelope, Record, SCHEMA_V5};
use crate::agent_journal::{codec, frame};
use crate::coherence::anchors::MAX_SEGMENT_BYTES;
use crate::command_error::CommandError;

#[test]
fn a_16384_byte_body_is_accepted_and_16385_is_refused() {
    let (r, page) = rig();
    let first = create(&r, &page, &"x".repeat(16_384)).expect("16384 bytes");
    let c = comment_of(&first);
    let len = r.journal_len();
    let e = create(&r, &page, &"x".repeat(16_385)).unwrap_err();
    assert_eq!(code(&e), "COMMENT_LIMIT");
    assert_eq!(r.journal_len(), len, "a refused create appends nothing");
    // Bytes, not characters: 8192 two-byte characters fit; one more does not.
    reply(&r, &page, c, 0, &"é".repeat(8192)).expect("16384 UTF-8 bytes");
    let e = reply(&r, &page, c, 1, &format!("{}x", "é".repeat(8192))).unwrap_err();
    assert_eq!(code(&e), "COMMENT_LIMIT");
    assert!(create(&r, &page, "").is_err(), "an empty body is refused");
}

#[test]
fn the_200th_reply_is_accepted_and_the_201st_is_refused() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "thread").expect("create"));
    for n in 0..200 {
        reply(&r, &page, c, n, "ok").unwrap_or_else(|e| panic!("reply {}: {e:?}", n + 1));
    }
    assert_eq!(thread(&r, c).replies, 200);
    let len = r.journal_len();
    let e = reply(&r, &page, c, 200, "the 201st").unwrap_err();
    assert_eq!(code(&e), "COMMENT_LIMIT");
    let detail = e.detail().cloned().expect("detail");
    assert_eq!(
        (&detail["limit"], &detail["total"]),
        (&json!(200), &json!(201)),
        "{detail}"
    );
    assert_eq!(r.journal_len(), len);
    let t = thread(&r, c);
    assert_eq!(
        (t.replies, t.comment_gen),
        (200, 200),
        "the refusal changed nothing"
    );
}

#[test]
fn the_1000th_comment_is_accepted_and_the_1001st_is_refused() {
    let (r, page) = rig();
    for n in 0..1_000 {
        create(&r, &page, "c").unwrap_or_else(|e| panic!("comment {}: {e:?}", n + 1));
    }
    let d = doc(&r.c);
    assert_eq!(r.c.writer.lock().proj.comments.docs[&d].comments, 1_000);
    let len = r.journal_len();
    let e = create(&r, &page, "the 1001st").unwrap_err();
    assert_eq!(code(&e), "COMMENT_LIMIT");
    let detail = e.detail().cloned().expect("detail");
    assert_eq!(
        (&detail["limit"], &detail["total"]),
        (&json!(1_000), &json!(1_001)),
        "{detail}"
    );
    assert_eq!(r.journal_len(), len);
    // A deleted thread frees its slot.
    let c =
        *r.c.writer
            .lock()
            .proj
            .comments
            .threads
            .keys()
            .next()
            .expect("a thread");
    let u = r.c.comments_user();
    u.resolve(&state_req(c, 0)).expect("resolve");
    u.delete(&state_req(c, 1)).expect("delete");
    create(&r, &page, "in the freed slot").expect("the slot is free again");
    assert!(create(&r, &page, "over again").is_err());
}

/// A fresh thread on `# heading` over `hello`, selected below it; the
/// journal length before the create.
fn create_under(heading: &str) -> (Rig, u64, Result<Value, CommandError>) {
    let (r, page) = rig();
    let len = r.journal_len();
    let text = format!("# {heading}\n\nhello world\n");
    let start = (2 + heading.encode_utf16().count() + 2) as u64;
    let p = r.frame(
        &page,
        create_body(&r, &text, (start, start + 5), "under a long heading"),
    );
    let out = create_as(&r, &page, CommentCaller::User, &p);
    (r, len, out)
}

#[test]
fn a_heading_segment_of_max_bytes_is_accepted_and_one_byte_more_is_refused() {
    let cjk_fit = format!(
        "{}{}",
        "中".repeat(MAX_SEGMENT_BYTES / 3),
        "x".repeat(MAX_SEGMENT_BYTES % 3)
    );
    for heading in ["x".repeat(MAX_SEGMENT_BYTES), cjk_fit] {
        assert_eq!(heading.len(), MAX_SEGMENT_BYTES);
        let (_r, _, out) = create_under(&heading);
        out.unwrap_or_else(|e| panic!("{} bytes: {e:?}", heading.len()));
    }
    // Bytes, not characters: 171 CJK characters are 513 bytes.
    let cjk_over = "中".repeat(MAX_SEGMENT_BYTES / 3 + 1);
    for heading in ["x".repeat(MAX_SEGMENT_BYTES + 1), cjk_over] {
        assert!(heading.chars().count() <= MAX_SEGMENT_BYTES + 1);
        let (r, len, out) = create_under(&heading);
        let e = out.unwrap_err();
        assert_eq!(code(&e), "COMMENT_LIMIT");
        let detail = e.detail().cloned().expect("detail");
        assert_eq!(
            (&detail["bound"], &detail["limit"], &detail["total"]),
            (
                &json!("headingSegment"),
                &json!(MAX_SEGMENT_BYTES),
                &json!(heading.len())
            ),
            "{detail}"
        );
        assert_eq!(r.journal_len(), len, "a refused create appends nothing");
        assert!(r.c.writer.lock().proj.comments.threads.is_empty());
    }
}

/// Move `comment`'s charges so its logical usage is `target`, carrying
/// the document and global totals with it.
fn set_thread_logical(book: &mut CommentBook, comment: CommentId, target: u64) {
    let t = book.threads.get_mut(&comment).expect("thread");
    let old = t.logical();
    t.charges = target - reserve(t.state, false);
    let d = t.doc;
    let shift = |x: u64| x - old + target;
    book.logical = shift(book.logical);
    book.physical = shift(book.physical);
    let usage = book.docs.get_mut(&d).expect("doc usage");
    usage.bytes = shift(usage.bytes);
}

#[test]
fn thread_document_and_global_byte_limits_hold_at_the_boundary() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "budget").expect("create"));
    let d = doc(&r.c);
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
    let bound = |res: Result<_, TxnError>| match res {
        Err(TxnError::CommentLimit { bound, .. }) => bound,
        other => panic!("not a comment limit: {other:?}"),
    };

    let mut b = book.clone();
    set_thread_logical(&mut b, c, 256 * KIB - n);
    assert!(plan(&b).is_ok(), "a thread exactly at 256 KiB");
    set_thread_logical(&mut b, c, 256 * KIB - n + 1);
    assert!(plan(&b).is_err());
    assert_eq!(bound(plan(&b)), "threadBytes");

    let mut b = book.clone();
    let others = 4 * MIB - n - b.threads[&c].logical();
    b.docs.get_mut(&d).unwrap().bytes += others;
    b.logical += others;
    assert!(plan(&b).is_ok(), "a document exactly at 4 MiB");
    b.docs.get_mut(&d).unwrap().bytes += 1;
    b.logical += 1;
    assert!(plan(&b).is_err());
    assert_eq!(bound(plan(&b)), "documentBytes");

    let mut b = book.clone();
    b.logical = 64 * MIB - n;
    b.physical = b.logical;
    assert!(plan(&b).is_ok(), "every thread exactly at 64 MiB");
    b.logical += 1;
    b.physical += 1;
    assert!(plan(&b).is_err());
    assert_eq!(bound(plan(&b)), "globalBytes");

    // Through the writer: at the global limit a reply is refused, appends
    // nothing, and the thread is unchanged.
    inject(&r, |b| {
        b.logical = GLOBAL_BYTES;
        b.physical = GLOBAL_BYTES;
    });
    let len = r.journal_len();
    let e = reply(&r, &page, c, 0, "over").unwrap_err();
    assert_eq!(code(&e), "COMMENT_LIMIT");
    assert_eq!(r.journal_len(), len);
    assert_eq!(thread(&r, c).comment_gen, 0);
}

/// The framed size of `record` at the largest seq and timestamp.
fn max_frame(record: Record) -> u64 {
    let env = Envelope {
        schema_version: SCHEMA_V5,
        seq: u64::MAX - 1,
        txn: TxnId::new(),
        at: u64::MAX,
        record,
        receipt: None,
    };
    let framed = frame::encode(&codec::encode(&env)).len() as u64;
    assert_eq!(framed, charge(&env), "a record is charged its framed size");
    framed
}

#[test]
fn the_largest_terminal_frames_fit_the_reserve_constants() {
    let (doc, comment) = (DocId::new(), CommentId::at(u64::MAX));
    let mut resolve = 0;
    let mut delete = 0;
    for caller in CommentCaller::ALL {
        for from in ThreadState::ALL {
            if let Some(to) = allowed(Action::Resolve, caller, from) {
                resolve = resolve.max(max_frame(Record::CommentState(CommentState {
                    doc,
                    comment,
                    from,
                    to,
                    caller,
                    expected_comment_gen: u64::MAX,
                })));
            }
        }
        delete = delete.max(max_frame(Record::CommentDeleted(CommentDeleted {
            doc,
            comment,
            caller,
            expected_comment_gen: u64::MAX,
        })));
    }
    assert_eq!((MAX_RESOLVE_FRAME, MAX_DELETE_FRAME), (resolve, delete));
}
