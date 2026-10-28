// WI-AL2.2f — a request is answered only to the page lifetime that froze it: a retry after the document key was rebound gets the stored reply; another live page sending the same bytes is a conflict and learns nothing; a revoked page's payload is staleGeneration from anywhere; a page whose own late Started revoked it cannot commit; and no payload frozen under a generation is ever admitted under a later one, across Starteds, purges, re-registrations and label recreation
//! R52.4, R74, R79, R90 and R97, through `Controller::prepare_framed`,
//! `Controller::abandon` and `Controller::commit_owned`.

use serde_json::Value;

use crate::agent_journal::admission::admission_support::KEY;
use crate::agent_journal::admission::owned::OwnedEnd;
use crate::agent_journal::admission::request_support::*;
use crate::agent_journal::ids::RevisionId;
use crate::agent_journal::projection::TxnStatus;

#[test]
fn rebind_then_retry_returns_the_stored_response() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let p = r.p_head(&a, "text");
    let first = r.prepare(&a, &p).expect("prepare");
    r.c.docs.bind(KEY, "path:/notes/moved.md").expect("Save As");
    let len = r.journal_len();
    let again = r.prepare(&a, &p).expect("the retry is not resolved anew");
    assert_eq!(again, first);
    assert_eq!(r.journal_len(), len, "nothing appended");
    assert_eq!(r.sizes(), (0, 0, 1, 1, 1));
}

#[test]
fn duplicate_from_another_page_is_conflict() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.page("doc-b", 2);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    let len = r.journal_len();
    let e = r.prepare_as(&b.label, &p).expect_err("A's bytes from B");
    assert_eq!(
        answer(&e),
        ("INVALID_REQUEST".into(), "conflict".into(), Some(true))
    );
    assert_eq!(
        (r.status(txn), r.journal_len()),
        (Some(TxnStatus::Prepared), len)
    );
    assert_eq!(r.sizes(), (0, 0, 1, 1, 1));
    r.prepare(&a, &p).expect("A's own duplicate is the replay");
}

#[test]
fn abandon_from_another_page_is_conflict() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.page("doc-b", 2);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    let e = r.abandon(&b.label, &p).expect_err("A's bytes from B");
    assert_eq!(state(&e), "conflict");
    assert_eq!(
        r.status(txn),
        Some(TxnStatus::Prepared),
        "A's transaction untouched"
    );
    assert_eq!(r.sizes(), (0, 0, 1, 1, 1));
}

#[test]
fn revoked_owner_payload_from_another_page_is_stale_generation() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.page("doc-b", 2);
    let p = r.p_head(&a, "text");
    let txn = txn_of(&r.prepare(&a, &p).expect("prepare"));
    r.pages.started(&a.label);
    for label in [&b.label, &a.label] {
        assert_eq!(
            state(&r.prepare_as(label, &p).unwrap_err()),
            "staleGeneration"
        );
        assert_eq!(state(&r.abandon(label, &p).unwrap_err()), "staleGeneration");
    }
    assert_eq!(
        r.status(txn),
        Some(TxnStatus::Prepared),
        "only the sweep ends it"
    );
}

#[test]
fn live_owner_payload_from_another_page_is_conflict() {
    // Every kind of id A holds: receipted, fenced, running, never seen.
    let r = rig();
    let a = r.page("doc-a", 1);
    let b = r.page("doc-b", 2);
    let receipted = r.p_head(&a, "text");
    r.prepare(&a, &receipted).expect("prepare");
    let fenced = r.p(&a, Some(RevisionId::new()), "text");
    r.prepare(&a, &fenced).expect_err("refused, so fenced");
    let unknown = r.p_head(&a, "text");
    let running = r.p_head(&a, "text");
    let (h, go) = hold_original(&r, &a, &running);
    let before = (r.sizes(), r.journal_len());
    for p in [&receipted, &fenced, &unknown, &running] {
        let e = r.prepare_as(&b.label, p).expect_err("from B");
        assert_eq!(state(&e), "conflict");
        assert!(detail(&e)["request"].get("status").is_none());
        assert_eq!(state(&r.abandon(&b.label, p).unwrap_err()), "conflict");
    }
    assert_eq!((r.sizes(), r.journal_len()), before, "nothing changed");
    go.send(()).unwrap();
    assert_eq!(
        state(&h.join().unwrap().unwrap_err()),
        "notAdmitted",
        "the document is held"
    );
}

#[test]
fn counted_document_without_script_cannot_authorize_successor() {
    let r = rig();
    // B's document starts and never registers; C's starts and does.
    r.pages.started("win");
    let before = r.page("other", 9);
    r.pages.started("win");
    let c = r.register("win", 3);
    let gen = |p: &Page| p.generation.parse::<u64>().unwrap();
    assert!(
        gen(&c) > gen(&before),
        "C's generation is minted after C's Started"
    );
    assert_eq!(
        r.pages.registrations("win"),
        1,
        "nothing B-shaped to inherit"
    );
    let txn = txn_of(&r.prepare(&c, &r.p_head(&c, "text")).expect("prepare"));
    r.commit(&c, txn, "text!").expect("C commits");

    // Codex's order: C registers under the previous document's epoch, is
    // admitted, and only then does its own Started arrive.
    let d = r.register("win", 4);
    let txn = txn_of(&r.prepare(&d, &r.p_head(&d, "text!")).expect("prepare"));
    r.pages.started("win");
    let len = r.journal_len();
    let e = r
        .commit(&d, txn, "text!!")
        .expect_err("revoked by its own Started");
    assert_eq!(journal_code(&e), "STALE_PAGE");
    assert_eq!(r.journal_len(), len, "no committed record");
    assert_eq!(r.c.sweep(&r.pages), vec![(txn, OwnedEnd::Recorded)]);
    assert_eq!(r.status(txn), Some(TxnStatus::Uncommitted));
}

#[test]
fn fallback_after_own_started_can_return_a_new_generation_but_cannot_rebind_old_requests() {
    let r = rig();
    let g1 = r.page("doc-a", 1);
    let p1 = r.p_head(&g1, "text");
    r.pages.started("doc-a");
    let g2 = r.register("doc-a", 1);
    assert_eq!(g2.identity, g1.identity);
    assert_ne!(g2.generation, g1.generation);
    assert_eq!(state(&r.prepare(&g1, &p1).unwrap_err()), "staleGeneration");
    assert_eq!(
        state(&r.abandon(&g1.label, &p1).unwrap_err()),
        "staleGeneration"
    );
    r.prepare(&g2, &r.p_head(&g2, "text"))
        .expect("a new P2 under G2");
    assert_eq!(
        state(&r.prepare(&g2, &p1).unwrap_err()),
        "staleGeneration",
        "the same bytes again"
    );
}

#[test]
fn old_payload_stays_stale_across_two_starteds_cleanup_and_label_recreation() {
    let r = rig();
    let a = r.page("doc-a", 1);
    let refused = r.p(&a, Some(RevisionId::new()), "text");
    assert_eq!(state(&r.prepare(&a, &refused).unwrap_err()), "notAdmitted");
    let p1 = r.p_head(&a, "text");
    r.pages.started("doc-a");
    let stale = |step: &str| {
        for p in [&p1, &refused] {
            let e = r.prepare(&a, p).expect_err(step);
            assert_eq!(state(&e), "staleGeneration", "{step}");
        }
    };
    stale("after the first Started");
    r.pages.started("doc-a");
    stale("after a second Started");
    r.c.sweep(&r.pages);
    assert_eq!(r.sizes().1, 0, "G1's fences purged");
    stale("after the purge");
    r.register("doc-a", 1);
    stale("after a re-executed register");
    r.pages.destroy("doc-a");
    stale("after the label is destroyed");
    r.pages.started("doc-a");
    stale("after the label is recreated");
    r.register("doc-a", 1);
    stale("after a register into the recreated label");
    let receipts = r.sizes().3;
    assert_eq!(receipts, 0, "neither payload was ever admitted");
    let sent: Value = serde_json::from_str(&refused).unwrap();
    assert!(sent["requestId"].is_string());
}
