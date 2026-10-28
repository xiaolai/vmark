// WI-AL2.2f — commit and abort are bound to the page that owns the transaction: a revoked registration is refused STALE_PAGE before any state change and the sweep ends the transaction uncommitted; a live foreign pair is INVALID_REQUEST; the check linearizes at the table lookup and the table lock is never held across the append; success replies are enveloped with their own arguments; restores are owned like agent writes; and every journal token the writer can refuse with is declared on the TypeScript side | AL2.2g: AMBIGUOUS_REVERT is in JOURNAL_CODES too, so every Rust code has a TypeScript twin; its detail (hunk, block with a real break reason, or null) is pinned to the literal the TypeScript round-trip reads
//! R91, R98, R99 rule 1 and R101, through the `Controller` core methods.

use crate::agent_journal::comment::ids::{CommentCaller, CommentId, ThreadState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use crate::agent_journal::admission::admission_support::{body, doc, KEY};
use crate::agent_journal::admission::answer::{Ended, Ending, RequestState};
use crate::agent_journal::admission::owned::OwnedEnd;
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{HunkId, TxnId};
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::test_support::human_save;

/// One instance of every refusal, matched exhaustively so a new variant
/// must be listed here before this compiles.
fn every_refusal() -> Vec<TxnError> {
    let txn = TxnId::new();
    let samples = vec![
        TxnError::JournalBusy { holder: txn },
        TxnError::StaleParent { head: None },
        TxnError::JournalDegraded,
        TxnError::StaleReview {
            hunk: None,
            detail: String::new(),
        },
        TxnError::ReviewBacklogFull {
            count: 0,
            limit: 0,
            retry: "",
        },
        TxnError::ReviewStateExhausted {
            hunk: HunkId(String::new()),
        },
        TxnError::AmbiguousRevert {
            hunk: HunkId(String::new()),
            block: None,
        },
        TxnError::RevertRefused {
            hunk: HunkId(String::new()),
            reason: "",
        },
        TxnError::Saturated(String::new()),
        TxnError::StalePage(String::new()),
        TxnError::StaleRegistration(String::new()),
        TxnError::InvalidRequest(String::new()),
        TxnError::InvalidProvenance(String::new()),
        TxnError::InvalidAddresses(String::new()),
        TxnError::InvalidText(String::new()),
        TxnError::CommentAnchorTooLong { bytes: 0, limit: 0 },
        TxnError::StaleComment {
            comment: CommentId::at(1),
            detail: String::new(),
        },
        TxnError::CommentStateExhausted {
            comment: CommentId::at(1),
        },
        TxnError::CommentStorageFull { bytes: 0, limit: 0 },
        TxnError::CommentLimit {
            bound: "body",
            limit: 0,
            total: 0,
        },
        TxnError::CommentNotAllowed {
            action: "resolve",
            caller: CommentCaller::Agent,
            state: ThreadState::Open,
        },
        TxnError::Io(String::new()),
        TxnError::Indeterminate(String::new()),
        TxnError::Invariant(String::new()),
        TxnError::Corrupt(String::new()),
        TxnError::FutureFormat { version: 9 },
    ];
    for e in &samples {
        match e {
            TxnError::JournalBusy { .. }
            | TxnError::StaleParent { .. }
            | TxnError::JournalDegraded
            | TxnError::StaleReview { .. }
            | TxnError::ReviewBacklogFull { .. }
            | TxnError::ReviewStateExhausted { .. }
            | TxnError::AmbiguousRevert { .. }
            | TxnError::RevertRefused { .. }
            | TxnError::Saturated(_)
            | TxnError::StalePage(_)
            | TxnError::StaleRegistration(_)
            | TxnError::InvalidRequest(_)
            | TxnError::InvalidProvenance(_)
            | TxnError::InvalidAddresses(_)
            | TxnError::InvalidText(_)
            | TxnError::CommentAnchorTooLong { .. }
            | TxnError::StaleComment { .. }
            | TxnError::CommentStateExhausted { .. }
            | TxnError::CommentStorageFull { .. }
            | TxnError::CommentLimit { .. }
            | TxnError::CommentNotAllowed { .. }
            | TxnError::Io(_)
            | TxnError::Indeterminate(_)
            | TxnError::Invariant(_)
            | TxnError::Corrupt(_)
            | TxnError::FutureFormat { .. } => {}
            // Its tokens are its states', listed in `every_state`.
            TxnError::Request(_) => {}
        }
    }
    samples
}

fn every_state() -> Vec<RequestState> {
    let by = TxnId::new();
    vec![
        RequestState::NotAdmitted(TxnError::JournalDegraded),
        RequestState::InFlight,
        RequestState::TerminalPending(Ending::Committed),
        RequestState::Terminal(Ended::Discarded { by }),
        RequestState::Abandoned,
        RequestState::StaleIncarnation,
        RequestState::StaleGeneration,
        RequestState::Conflict,
        RequestState::Unavailable,
    ]
}

fn ts_codes() -> Vec<String> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/services/agentJournal/journalRefusal.ts"
    );
    let src = std::fs::read_to_string(path).expect("journalRefusal.ts");
    let list = src
        .split_once("const JOURNAL_CODES = [")
        .and_then(|(_, rest)| rest.split_once("] as const"))
        .expect("the JOURNAL_CODES list")
        .0;
    list.split(',')
        .map(|s| s.trim().trim_matches('"').to_owned())
        .filter(|s| !s.is_empty())
        .collect()
}

#[test]
fn the_stale_page_code_is_declared_on_both_sides() {
    let ts = ts_codes();
    let mut codes: Vec<&str> = every_refusal().iter().map(TxnError::code).collect();
    codes.extend(every_state().iter().map(RequestState::code));
    assert!(codes.contains(&"STALE_PAGE") && codes.contains(&"STALE_REQUEST"));
    for code in codes {
        assert!(
            ts.iter().any(|c| c == code),
            "{code} is not in JOURNAL_CODES"
        );
    }
}

#[test]
fn ambiguous_revert_detail_is_what_the_client_reads() {
    use crate::agent_journal::provenance::{Block, BreakReason};
    use crate::agent_journal::refusal::refusal;
    // The same detail literals are read back by journalCodeParity.test.ts.
    let block = Block::new(BreakReason::SnapshotOnly, "window-main").expect("block");
    for (block, wire) in [
        (
            Some(block),
            json!({ "reason": "snapshotOnly", "origin": "window-main" }),
        ),
        (None, Value::Null),
    ] {
        let e = TxnError::AmbiguousRevert {
            hunk: HunkId("h-1".into()),
            block,
        };
        let v = serde_json::to_value(refusal(&e)).expect("serializes");
        assert_eq!(
            v["detail"],
            json!({ "journalCode": "AMBIGUOUS_REVERT", "hunk": "h-1", "block": wire })
        );
    }
}

#[test]
fn revert_refused_detail_is_what_the_client_reads() {
    use crate::agent_journal::refusal::refusal;
    // The same detail literals are read back by journalCodeParity.test.ts.
    for reason in ["conflicted", "reapply"] {
        let e = TxnError::RevertRefused {
            hunk: HunkId("h-1".into()),
            reason,
        };
        let v = serde_json::to_value(refusal(&e)).expect("serializes");
        assert_eq!(
            v["detail"],
            json!({ "journalCode": "REVERT_REFUSED", "hunk": "h-1", "reason": reason })
        );
    }
}

/// `page`'s label with another page's pair.
fn posing(page: &Page, as_: &Page) -> Page {
    Page {
        label: page.label.clone(),
        ..as_.clone()
    }
}

/// A page prepared on a fresh rig: the rig, the page and its transaction.
fn prepared() -> (Rig, Page, TxnId) {
    let r = rig();
    let a = r.page("doc-a", 1);
    let txn = txn_of(&r.prepare(&a, &r.p_head(&a, "text")).expect("prepare"));
    (r, a, txn)
}

#[test]
fn commit_after_revocation_is_refused_before_the_sweep_runs() {
    let (r, a, txn) = prepared();
    r.pages.started(&a.label);
    let before = r.journal_len();
    let e = r.commit(&a, txn, "text!").expect_err("a revoked page");
    assert_eq!(journal_code(&e), "STALE_PAGE");
    // Ownership is checked before the payload is read: a revoked page's
    // undecodable commit cannot end the transaction as unrecordable.
    let (id, gen) = (&a.identity, &a.generation);
    let e =
        r.c.commit_owned(&r.pages, &a.label, &txn.0.to_string(), "{", id, gen)
            .expect_err("undecodable");
    assert_eq!(journal_code(&e), "STALE_PAGE");
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared), "nothing ended");
    assert_eq!(r.journal_len(), before, "nothing appended");
    assert_eq!(
        r.sizes(),
        (0, 0, 1, 1, 1),
        "owner and reservation kept for the sweep"
    );

    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
    assert_eq!(r.sizes(), (0, 0, 0, 1, 0));
    assert_eq!(r.c.sweep(&r.pages), vec![], "a second sweep finds nothing");
}

#[test]
fn abort_after_revocation_is_refused_and_the_sweep_ends_it() {
    let (r, a, txn) = prepared();
    r.pages.destroy(&a.label);
    let before = r.journal_len();
    let e = r.abort(&a, txn).expect_err("a destroyed page");
    assert_eq!(journal_code(&e), "STALE_PAGE");
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared));
    assert_eq!(r.journal_len(), before);

    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
    assert_eq!(r.sizes(), (0, 0, 0, 1, 0));
}

#[test]
fn commit_with_a_live_foreign_pair_is_invalid_request() {
    let (r, a, txn) = prepared();
    let sibling = r.register("doc-a", 2);
    let other = r.page("doc-b", 3);
    let before = r.journal_len();
    for pair in [posing(&a, &sibling), posing(&a, &other), other.clone()] {
        let e = r.commit(&pair, txn, "text!").expect_err("not the owner");
        assert_eq!(journal_code(&e), "INVALID_REQUEST", "{pair:?}");
        let e = r.abort(&pair, txn).expect_err("not the owner");
        assert_eq!(journal_code(&e), "INVALID_REQUEST", "{pair:?}");
    }
    assert_eq!(
        (r.status(txn), r.journal_len()),
        (Some(TxnStatus::Prepared), before)
    );
    assert_eq!(r.c.sweep(&r.pages), vec![], "the owner is live");
    r.commit(&a, txn, "text!").expect("the owner commits");
    assert_eq!(r.status(txn), Some(TxnStatus::Committed));
    assert_eq!(r.sizes(), (0, 0, 0, 1, 0));
}

#[test]
fn duplicate_prepare_reply_is_enveloped_from_the_receipt() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let first = r.prepare(&a, &p).expect("prepare");
    let len = r.journal_len();
    let again = r.prepare(&a, &p).expect("an identical retry");
    assert_eq!(again, first, "byte for byte");
    assert_eq!(r.journal_len(), len, "nothing appended");
    let sent: Value = serde_json::from_str(&p).unwrap();
    assert_eq!(first["bind"]["requestId"], sent["requestId"]);
    assert!(first["bind"]["digest"]
        .as_str()
        .is_some_and(|d| !d.is_empty()));
    assert_eq!(first.as_object().unwrap().len(), 2, "{{bind, reply}} only");
}

#[test]
fn commit_and_abort_replies_echo_their_arguments() {
    let (r, a, txn) = prepared();
    let out = r.commit(&a, txn, "text!").expect("commit");
    let bind = json!({ "txn": txn, "pageIdentity": a.identity, "webviewGeneration": a.generation });
    assert_eq!(out["bind"], bind);
    assert_eq!(out["reply"]["applied"], json!(true));

    let next = txn_of(&r.prepare(&a, &r.p_head(&a, "text!")).expect("prepare"));
    let out = r.abort(&a, next).expect("abort");
    let bind =
        json!({ "txn": next, "pageIdentity": a.identity, "webviewGeneration": a.generation });
    assert_eq!(out, json!({ "bind": bind, "reply": { "durable": true } }));
}

#[test]
fn commit_linearizes_at_the_table_lookup() {
    // Revoked between the pre-check and the commit's own critical section
    // (the sixth lock: txn_doc twice, the pre-check, the restored lookup,
    // the effects): refused, nothing changed.
    let (r, a, txn) = prepared();
    let (pages, label) = (r.pages.clone(), a.label.clone());
    r.faults
        .before_nth_lock(6, Some(Box::new(move || pages.started(&label))));
    let before = r.journal_len();
    let e = r
        .commit(&a, txn, "text!")
        .expect_err("revoked before the lookup");
    assert_eq!(journal_code(&e), "STALE_PAGE");
    assert_eq!(
        (r.status(txn), r.journal_len()),
        (Some(TxnStatus::Prepared), before)
    );
    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Recorded)]);

    // Revoked inside the critical section, after the lookup: committed.
    let b = r.page("doc-a", 2);
    let txn = txn_of(&r.prepare(&b, &r.p_head(&b, "text")).expect("prepare"));
    let (pages, label, fired) = (
        r.pages.clone(),
        b.label.clone(),
        Arc::new(AtomicBool::new(false)),
    );
    let once = fired.clone();
    r.faults.set_append_hook(Some(Arc::new(move |_| {
        if !once.swap(true, Ordering::SeqCst) {
            pages.started(&label);
        }
    })));
    r.commit(&b, txn, "text!")
        .expect("revoked after the linearization point");
    r.faults.set_append_hook(None);
    assert!(fired.load(Ordering::SeqCst));
    assert_eq!(r.status(txn), Some(TxnStatus::Committed));
}

#[test]
fn the_table_lock_is_not_held_across_the_append() {
    let (r, a, txn) = prepared();
    let (pages, seen) = (r.pages.clone(), Arc::new(AtomicBool::new(false)));
    let ok = seen.clone();
    r.faults.set_append_hook(Some(Arc::new(move |_| {
        let (tx, rx) = mpsc::channel();
        let pages = pages.clone();
        thread::spawn(move || tx.send(pages.live_generations()).ok());
        if rx.recv_timeout(Duration::from_secs(2)).is_ok() {
            ok.store(true, Ordering::SeqCst);
        }
    })));
    r.commit(&a, txn, "text!").expect("commit");
    r.faults.set_append_hook(None);
    assert!(
        seen.load(Ordering::SeqCst),
        "the table was readable during the append"
    );
}

/// A framed restore of `KEY` to `first`, on top of `head`.
fn restore_p(
    r: &Rig,
    page: &Page,
    head: crate::agent_journal::ids::RevisionId,
    first: crate::agent_journal::ids::RevisionId,
) -> String {
    let body = json!({
        "docKey": KEY,
        "parent": head,
        "preimage": "second\n",
        "source": { "from": "revision", "revision": first },
    });
    r.frame(page, body)
}

fn restore(r: &Rig, page: &Page, p: &str) -> Result<Value, crate::command_error::CommandError> {
    let out = r.c.restore_prepare_framed(&r.pages, &page.label, p)?;
    Ok(serde_json::to_value(out).expect("reply"))
}

/// A rig whose `KEY` holds "first" then "second", and a page on it.
fn restorable() -> (Rig, Page, String) {
    let r = rig();
    let a = r.page("doc-a", 1);
    let d = doc(&r.c);
    let first = human_save(&r.c.writer, d, "first ünïcode 文字\n");
    let head = human_save(&r.c.writer, d, "second\n");
    let p = restore_p(&r, &a, head, first);
    (r, a, p)
}

#[test]
fn a_restore_commit_is_bound_like_an_agent_commit() {
    let (r, a, p) = restorable();
    let out = restore(&r, &a, &p).expect("restore");
    let txn: TxnId = serde_json::from_value(out["reply"]["txn"].clone()).unwrap();
    let text = out["reply"]["text"].as_str().unwrap().to_owned();
    let sibling = r.register("doc-a", 2);
    let e = r
        .commit(&posing(&a, &sibling), txn, &text)
        .expect_err("not the owner");
    assert_eq!(journal_code(&e), "INVALID_REQUEST");
    let reply = r.commit(&a, txn, &text).expect("the owner commits");
    assert_eq!(reply["bind"]["txn"], json!(txn));
    assert_eq!(r.status(txn), Some(TxnStatus::Committed));

    let (r, a, p) = restorable();
    let out = restore(&r, &a, &p).expect("restore");
    let txn: TxnId = serde_json::from_value(out["reply"]["txn"].clone()).unwrap();
    r.pages.started(&a.label);
    let e = r
        .commit(&a, txn, out["reply"]["text"].as_str().unwrap())
        .expect_err("revoked");
    assert_eq!(journal_code(&e), "STALE_PAGE");
    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Recorded)]);
}

#[test]
fn a_restore_prepare_duplicate_returns_its_receipt() {
    let (r, a, p) = restorable();
    let first = restore(&r, &a, &p).expect("restore");
    let len = r.journal_len();
    let again = restore(&r, &a, &p).expect("an identical retry");
    assert_eq!(again, first);
    assert_eq!(first["reply"]["text"], json!("first ünïcode 文字\n"));
    assert_eq!(r.journal_len(), len, "nothing appended");
    // The same id sent as an agent prepare is another payload.
    let sent: Value = serde_json::from_str(&p).unwrap();
    let id = sent["requestId"].as_str().unwrap();
    let agent = r.frame(&a, body(None, "second\n", Some(id)));
    let e = r.prepare(&a, &agent).expect_err("other bytes");
    assert_eq!(state(&e), "conflict");
}
