// WI-AL2.1c — the certificate admission split: a malformed certificate is INVALID_REQUEST with nothing appended, a pre-apply certificate that does not map the parent is admitted uncertified and counted, a post-apply failure commits the applied text as a durable barrier with no uncommitted record, a fallback's effects equal a barrier commit's, and the strict parent CAS, the reservation and the minted basis hold with a certificate, and the status reports the fallback counter
//! Uncertified fallbacks (R43, R53, R62). Edge cases: two distinct
//! revisions with identical text; a touched baseline equal to the head.

use super::support::*;
use super::FallbackReason;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::projection::TxnStatus;
use crate::agent_journal::provenance::BreakReason;
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::*;

fn z_at_4() -> serde_json::Value {
    cert(
        "abXc",
        "abXcZ",
        &[Edit {
            at: 4,
            delete: 0,
            insert: 1,
        }],
    )
}

#[test]
fn a_malformed_certificate_is_an_invalid_request_and_appends_nothing() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (_, _, head) = one_hunk(&w, &docs);
    let mut bad = z_at_4();
    bad["document"] = "smuggled".into();
    let len = w.journal_len();
    let err = prepare(
        &w,
        &docs,
        Req {
            certificate: Some(bad),
            ..Req::new(Some(head), "abXc")
        },
    )
    .unwrap_err();
    assert_eq!(err.code(), "INVALID_REQUEST", "{err}");
    assert_eq!(w.journal_len(), len);
    assert_eq!(w.uncertified_fallbacks(), 0);
}

#[test]
fn a_pre_apply_certificate_that_does_not_map_the_parent_is_admitted_uncertified() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, older, head) = one_hunk(&w, &docs);
    // The right hash, the wrong map: built on a five-unit text.
    let wrong = with_pre_hash(
        cert(
            "abXcQ",
            "abXcQZ",
            &[Edit {
                at: 5,
                delete: 0,
                insert: 1,
            }],
        ),
        "abXc",
    );
    let p = prepare(
        &w,
        &docs,
        Req {
            certificate: Some(wrong),
            ..Req::new(Some(head), "abXc")
        },
    )
    .unwrap();
    assert!(!p.certified);
    assert_eq!(p.fallback_reason, Some(FallbackReason::NotTheParent));
    assert_eq!(w.uncertified_fallbacks(), 1);
    assert!(!commit(&w, p.txn, "abXcZ", None).unwrap().certified);
    assert_eq!(
        span(&w, doc, &older).block,
        block(BreakReason::WholeDocumentWrite, "agent")
    );
}

#[test]
fn a_post_apply_failure_commits_the_applied_text_as_a_durable_barrier() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, older, head) = one_hunk(&w, &docs);
    let p = prepare(&w, &docs, Req::new(Some(head), "abXc")).unwrap();
    // The window applied "abXcZ"; its certificate claims "abXcW".
    let bad = cert(
        "abXc",
        "abXcW",
        &[Edit {
            at: 4,
            delete: 0,
            insert: 1,
        }],
    );
    let generation = w.generation();
    let out = commit(&w, p.txn, "abXcZ", Some(bad)).unwrap();
    assert!(out.applied && out.durable && !out.certified, "{out:?}");
    assert_eq!(out.fallback_reason, Some(FallbackReason::NotThePostimage));
    assert_eq!(head_text(&w, doc), "abXcZ");
    assert_eq!(
        w.snapshot().state.txns[&p.txn].status,
        TxnStatus::Committed,
        "committed, never uncommitted"
    );
    assert_eq!(w.generation(), generation + 1, "exactly one record");
    assert_eq!(
        span(&w, doc, &older).block,
        block(BreakReason::WholeDocumentWrite, "agent")
    );
    assert_eq!(w.uncertified_fallbacks(), 1);
}

#[test]
fn a_fallback_commits_the_effects_of_a_barrier_commit() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (doc, older, head) = one_hunk(&w, &docs);
    let p = prepare(
        &w,
        &docs,
        Req {
            certificate: Some(z_at_4()),
            ..Req::new(Some(head), "abXc")
        },
    )
    .unwrap();
    assert!(p.certified);
    // The applied text is not the certificate's postimage.
    let expected = barrier_commit_req(&w, doc, "abXcY", vec![], &ReviewOp::Review).effects;
    let out = commit(&w, p.txn, "abXcY", None).unwrap();
    assert_eq!(out.fallback_reason, Some(FallbackReason::NotThePostimage));
    let hunks = &w.snapshot().state.docs[&doc].hunks;
    assert_eq!(hunks.len(), 1, "a barrier adds no hunk");
    assert_eq!(expected.new_hunks, vec![]);
    assert_eq!(expected.spans.len(), 1);
    assert_eq!(hunks[&older].span, expected.spans[0]);
}

#[test]
fn a_certificate_against_a_stale_revision_with_identical_text_fails_the_parent_cas() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    let stale = human_save(&w, doc, "abXc");
    human_save(&w, doc, "abc");
    let head = human_save(&w, doc, "abXc");
    assert_ne!(stale, head);
    let len = w.journal_len();
    let err = prepare(
        &w,
        &docs,
        Req {
            certificate: Some(z_at_4()),
            ..Req::new(Some(stale), "abXc")
        },
    )
    .unwrap_err();
    assert_eq!(err.code(), "STALE_PARENT", "same hash, still stale");
    assert_eq!(w.journal_len(), len);
}

#[test]
fn of_two_certified_prepares_one_reserves_and_the_other_is_busy() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (_, _, head) = one_hunk(&w, &docs);
    let req = || Req {
        certificate: Some(z_at_4()),
        ..Req::new(Some(head), "abXc")
    };
    let first = prepare(&w, &docs, req()).unwrap();
    assert!(first.certified);
    let len = w.journal_len();
    let err = prepare(&w, &docs, req()).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_BUSY");
    assert_eq!(w.journal_len(), len);
    assert!(commit(&w, first.txn, "abXcZ", None).unwrap().certified);
}

#[test]
fn a_touched_equal_text_baseline_is_the_persisted_basis() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let (_, _, head) = one_hunk(&w, &docs);
    let p = prepare(
        &w,
        &docs,
        Req {
            touched: true,
            certificate: Some(z_at_4()),
            ..Req::new(Some(head), "abXc")
        },
    )
    .unwrap();
    let minted = p.baseline.expect("a touched buffer is recorded");
    assert!(p.certified);
    let snap = w.snapshot().state;
    let persisted = snap.txns[&p.txn].certificate.as_ref().expect("persisted");
    assert_eq!(persisted.basis(), minted.to_string(), "not the head");
    assert_ne!(persisted.basis(), head.to_string());
}

#[test]
fn the_status_reports_the_uncertified_fallback_counter() {
    use crate::agent_journal::service::{start, AgentJournalState};
    let state = AgentJournalState::default();
    let starting = serde_json::to_value(state.status()).unwrap();
    assert_eq!(starting["uncertifiedFallbacks"], 0, "{starting}");
    let app_data = tmp();
    state.finish(start(app_data.path()));
    let w = state.writer().expect("ready");
    let docs = DocRegistry::default();
    let (_, _, head) = one_hunk(&w, &docs);
    let p = prepare(&w, &docs, Req::new(Some(head), "abXc")).unwrap();
    let bad = cert(
        "abXc",
        "abXcW",
        &[Edit {
            at: 4,
            delete: 0,
            insert: 1,
        }],
    );
    commit(&w, p.txn, "abXcZ", Some(bad)).unwrap();
    let ready = serde_json::to_value(state.status()).unwrap();
    assert_eq!(ready["uncertifiedFallbacks"], 1, "{ready}");
}
