// WI-AL2.2f — abandoning a request: an executable transaction is aborted and its document released, a human save held behind it linearized; a running attempt loses its entry and answers abandoned; an unknown id is fenced under the payload's own generation; the abandon is bound to the exact payload bytes and the page that froze them; an undecodable payload is refused before any lookup and claims no uncertainty; and an unhealthy writer answers unavailable, the transaction ending uncommitted at reopen
//! R60 rule 3 (52.3), R64 §7, R66, R85 and R93, through
//! `Controller::abandon`.

use serde_json::json;

use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::projection::TxnStatus;

#[test]
fn abandon_aborts_releases_and_admits_the_next_write() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    assert_eq!(
        r.abandon(&a.label, &p).expect("abandon"),
        json!({ "state": "aborted" })
    );
    assert_eq!(r.status(txn), Some(TxnStatus::Aborted));
    assert_eq!(r.sizes(), (0, 0, 0, 1, 0), "owner and reservation released");

    let again = r.abandon(&a.label, &p).expect("a repeated abandon");
    assert_eq!(again, json!({ "state": "terminal", "status": "aborted" }));
    let e = r
        .prepare(&a, &p)
        .expect_err("a retry of the abandoned request");
    assert_eq!(
        answer(&e),
        ("STALE_REQUEST".into(), "terminal".into(), Some(false))
    );
    r.prepare(&a, &r.p_head(&a, "text"))
        .expect("the next write admits");
}

#[test]
fn abandon_linearizes_a_save_held_behind_the_aborted_transaction() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let _txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    held_save(&r);
    assert_eq!(
        r.abandon(&a.label, &p).expect("abandon")["state"],
        "aborted"
    );
    assert_eq!(pending(&r), 0, "the abort released the save");
}

#[test]
fn a_delayed_original_after_abandon_is_abandoned() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let (h, go) = hold_original(&r, &a, &p);
    let before = r.journal_len();
    assert_eq!(
        r.abandon(&a.label, &p).expect("abandon"),
        json!({ "state": "fenced" })
    );
    go.send(()).unwrap();
    let e = h.join().unwrap().expect_err("the delayed original");
    assert_eq!(
        answer(&e),
        ("STALE_REQUEST".into(), "abandoned".into(), Some(false))
    );
    assert_eq!(r.journal_len(), before, "nothing appended");
    assert_eq!(r.sizes(), (0, 1, 0, 0, 0));
}

#[test]
fn abandon_while_poisoned_is_uncertain_and_reopen_is_uncommitted() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.c.writer.lock().journal.poison();
    let e = r.abandon(&a.label, &p).expect_err("an unhealthy writer");
    assert_eq!(
        answer(&e),
        ("JOURNAL_DEGRADED".into(), "unavailable".into(), Some(true))
    );
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared), "nothing ended");
    let r = r.reopen();
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
}

#[test]
fn abandon_cannot_pair_foreign_digest_with_own_generation() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.register("doc-a", 2);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    // b names a's request id under its own pair: another digest.
    let forged = with(
        &with(&p, "pageIdentity", json!(b.identity)),
        "webviewGeneration",
        json!(b.generation),
    );
    let e = r.abandon(&b.label, &forged).expect_err("a foreign digest");
    assert_eq!(
        answer(&e),
        ("INVALID_REQUEST".into(), "conflict".into(), Some(true))
    );
    assert_eq!(
        r.status(txn),
        Some(TxnStatus::Prepared),
        "a's transaction untouched"
    );
    assert_eq!(r.sizes(), (0, 0, 1, 1, 1));
}

#[test]
fn abandon_ignores_identity_fields_outside_the_payload() {
    // The core takes the payload alone: the pair it checks is the one the
    // payload names, in every branch. Swapping it for a live sibling's is a
    // conflict; the payload's own pair is answered.
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.register("doc-a", 2);
    let swap = |p: &str| with(p, "pageIdentity", json!(b.identity));

    let receipted = r.p_head(&a, "text");
    r.prepare(&a, &receipted).expect("prepare");
    let fenced = r.p(
        &a,
        Some(crate::agent_journal::ids::RevisionId::new()),
        "text",
    );
    r.prepare(&a, &fenced).expect_err("refused, so fenced");
    let unknown = r.p_head(&a, "text");
    for (p, want) in [
        (&receipted, "aborted"),
        (&fenced, "fenced"),
        (&unknown, "fenced"),
    ] {
        assert_eq!(
            state(&r.abandon(&a.label, &swap(p)).unwrap_err()),
            "conflict"
        );
        assert_eq!(r.abandon(&a.label, p).expect("own pair")["state"], want);
    }
    let running = r.p_head(&a, "text");
    let (h, go) = hold_original(&r, &a, &running);
    assert_eq!(
        state(&r.abandon(&a.label, &swap(&running)).unwrap_err()),
        "conflict"
    );
    assert_eq!(
        r.abandon(&a.label, &running).expect("own pair")["state"],
        "fenced"
    );
    go.send(()).unwrap();
    assert_eq!(state(&h.join().unwrap().unwrap_err()), "abandoned");
}

#[test]
fn abandon_with_one_byte_different_payload_is_conflict() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    let e = r
        .abandon(&a.label, &with(&p, "preimage", json!("texT")))
        .expect_err("receipted");
    assert_eq!(state(&e), "conflict");
    assert_eq!(r.status(txn), Some(TxnStatus::Prepared));

    let q = r.p_head(&a, "text");
    let (h, go) = hold_original(&r, &a, &q);
    let e = r
        .abandon(&a.label, &with(&q, "preimage", json!("texT")))
        .expect_err("in flight");
    assert_eq!(state(&e), "conflict");
    go.send(()).unwrap();
    // The document is reserved by `p`, so `q` is refused, but not abandoned.
    let e = h.join().unwrap().expect_err("q runs to its own answer");
    assert_eq!(state(&e), "notAdmitted");
}

#[test]
fn abandon_of_an_unknown_id_fences_under_the_payload_generation() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.register("doc-a", 2);
    let ua = r.p_head(&a, "text");
    let ub = r.p_head(&b, "text");
    assert_eq!(
        r.abandon(&a.label, &ua).expect("abandon")["state"],
        "fenced"
    );
    assert_eq!(
        r.abandon(&b.label, &ub).expect("abandon")["state"],
        "fenced"
    );
    assert_eq!(state(&r.prepare(&a, &ua).unwrap_err()), "abandoned");
    assert_eq!(r.sizes(), (0, 2, 0, 0, 0));

    // a's generation replaced: its fence goes with it at the next insert,
    // b's stays.
    r.pages
        .register(
            Some(&r.c.writer),
            &a.label,
            &ident(3),
            Some((&a.identity, &a.generation)),
        )
        .expect("replace a");
    r.prepare(&b, &r.p_head(&b, "text")).expect("b admits");
    assert_eq!(r.sizes(), (0, 1, 1, 1, 1));
    assert_eq!(state(&r.prepare(&b, &ub).unwrap_err()), "abandoned");
}

#[test]
fn abandon_with_an_undecodable_payload_refuses_before_lookup() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    r.prepare(&a, &p).expect("prepare");
    let mut no_id: serde_json::Value = serde_json::from_str(&p).unwrap();
    no_id.as_object_mut().unwrap().remove("requestId");
    let cases = [
        "not json".to_owned(),
        "[]".to_owned(),
        no_id.to_string(),
        with(&p, "requestId", json!("not-a-uuid")),
        with(&p, "pageIdentity", json!("zz")),
    ];
    for bad in cases {
        let e = r.abandon(&a.label, &bad).expect_err("undecodable");
        assert_eq!(journal_code(&e), "INVALID_REQUEST", "{bad}");
        assert!(
            e.detail().and_then(|d| d.get("request")).is_none(),
            "no lookup was made: {bad}"
        );
        assert!(
            e.detail().and_then(|d| d.get("uncertain")).is_none(),
            "a malformed abandon claims nothing about a transaction: {bad}"
        );
    }
    assert_eq!(r.sizes(), (0, 0, 1, 1, 1));
}

#[test]
fn abandon_behind_a_failed_append_is_queued_and_drained() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.faults.fail_next_appends(1);
    assert_eq!(
        r.abandon(&a.label, &p).expect("abandon"),
        json!({ "state": "abortQueued" })
    );
    assert_eq!(r.sizes().2, 0, "the owner goes with the queued record");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while r.status(txn) != Some(TxnStatus::Aborted) || r.sizes().4 != 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "the queued abort never drained"
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    r.prepare(&a, &r.p_head(&a, "text"))
        .expect("the next write admits");
}

#[test]
fn abandon_whose_abort_poisons_the_writer_is_queued_and_uncommitted_at_reopen() {
    // The fsync fails after the abort's bytes were written: the writer is
    // poisoned by this very append and keeps the record queued.
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.faults.fail_next_fsyncs(1);
    assert_eq!(
        r.abandon(&a.label, &p).expect("abandon"),
        json!({ "state": "abortQueued" })
    );
    // The queued terminal is reported, though it is volatile: the poisoned
    // writer never appends it, and the reopen records `uncommitted`.
    let again = r
        .abandon(&a.label, &p)
        .expect("a repeat against the poisoned writer");
    assert_eq!(
        again,
        json!({ "state": "terminalPending", "terminal": "aborted" })
    );
    let r = r.reopen();
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
}
