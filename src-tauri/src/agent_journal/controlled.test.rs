// WI-AL1.3 — the controlled-mutation protocol as the webview drives it: baseline observation of unjournaled text, prepare with the MCP actor, two-window prepare CAS (JOURNAL_BUSY / STALE_PARENT), commit failure answering applied without durable, the degraded queue refusing JOURNAL_DEGRADED until drained, a failed aborted append keeping its reservation until a retry lands, INVALID_TEXT before anything is written
//! Exercises `controlled` over a real writer on a temp dir; the drainer is
//! driven by hand (`drain_now`) or through the scheduler with 1 ms backoff.

use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use super::controlled::{
    abort_controlled, commit_controlled, decode_prepare, prepare_controlled, txn_doc, AbortReason,
};
use super::degraded_drain::{drain, Backoff, DrainEnd, DrainScheduler};
use super::doc_registry::{DocRegistry, DOC_KEY_MAX_BYTES};
use super::refusal::refusal;
use super::test_support::*;
use crate::agent_journal::actor::{Actor, Principal};
use crate::agent_journal::ids::{ConnectionId, RevisionId, TxnId};
use crate::agent_journal::projection::{RevisionKind, TxnStatus};
use crate::agent_journal::writer::Writer;

fn mcp_actor() -> Actor {
    Actor::Mcp {
        principal: Principal::Provider {
            provider: "claude-code".into(),
        },
        connection_id: ConnectionId::new(),
        session_label: Some("refactor docs".into()),
        display_name: Some("Claude Code 2.1".into()),
    }
}

fn payload(key: &str, preimage: &str, actor: &Actor) -> Vec<u8> {
    payload_on(key, None, preimage, actor)
}

/// A prepare that states the revision the window last saw (parent CAS).
fn payload_on(key: &str, parent: Option<RevisionId>, preimage: &str, actor: &Actor) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "docKey": key,
        "parent": parent,
        "preimage": preimage,
        "actor": actor,
        "tool": "document.write",
    }))
    .unwrap()
}

fn commit_payload(postimage: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({ "postimage": postimage })).unwrap()
}

/// Resolve, decode and prepare on the current head, the way the command does.
fn prepare(
    w: &Writer,
    docs: &DocRegistry,
    key: &str,
    preimage: &str,
) -> Result<super::controlled::ControlledPrepared, crate::agent_journal::errors::TxnError> {
    // The window knows the head it writes on (strict expectedHead).
    let doc = docs.resolve(key)?;
    let req = decode_prepare(&payload_on(key, w.head(doc), preimage, &mcp_actor()))?;
    prepare_controlled(w, doc, req)
}

fn fast() -> Backoff {
    Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    }
}

#[test]
fn a_first_write_on_an_empty_document_prepares_on_genesis_and_commits_durably() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "path:/notes/a.md", "").unwrap();
    assert_eq!(p.baseline, None, "nothing unjournaled to observe");
    let c = commit_controlled(&w, p.txn, &commit_payload("# Title\n")).unwrap();
    assert!(c.applied && c.durable);
    assert_eq!(c.revision, p.revision);
    assert_eq!(w.head(p.doc), Some(p.revision));
    assert_eq!(head_text(&w, p.doc), "# Title\n");
    assert_eq!(
        w.reservation(p.doc),
        None,
        "commit releases the reservation"
    );
}

#[test]
fn unjournaled_buffer_text_is_observed_as_a_human_revision_before_the_prepare() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let actor = mcp_actor();
    let req = decode_prepare(&payload("path:/notes/a.md", "typed by hand", &actor)).unwrap();
    let doc = docs.resolve(&req.doc_key).unwrap();
    let p = prepare_controlled(&w, doc, req).unwrap();
    let baseline = p.baseline.expect("the buffer differed from the head");
    let snap = w.snapshot().state;
    let meta = &snap.revisions[&baseline];
    assert_eq!(meta.kind, RevisionKind::Observed);
    assert_eq!(
        meta.actor,
        Actor::Human,
        "the unjournaled text is the user's"
    );
    let obs = &snap.observations[&meta.txn];
    assert_eq!(obs.initiator, actor, "the agent's write caused the capture");
    // The preimage now equals the head text, and the prepare names it.
    let t = &snap.txns[&p.txn];
    assert_eq!(t.parent, Some(baseline));
    assert_eq!(t.actor, actor, "the revision's actor is the MCP context");
    assert_eq!(t.tool, "document.write");
    assert_eq!(head_text(&w, doc), "typed by hand");
}

#[test]
fn a_buffer_equal_to_the_head_adds_no_baseline() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    commit_controlled(&w, p.txn, &commit_payload("one")).unwrap();
    let before = w.generation();
    let p2 = prepare(&w, &docs, "k", "one").unwrap();
    assert_eq!(p2.baseline, None);
    assert_eq!(w.generation(), before + 1, "only the prepared record");
}

#[test]
fn the_generation_crosses_to_javascript_as_a_decimal_string() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let p = prepare(&w, &DocRegistry::default(), "k", "").unwrap();
    let wire = serde_json::to_value(p).unwrap();
    assert_eq!(
        wire["generation"],
        serde_json::json!(p.generation.to_string())
    );
    assert!(wire["txn"].is_string() && wire["doc"].is_string());
}

#[test]
fn two_windows_preparing_the_same_document_exactly_one_wins() {
    for _round in 0..20 {
        let dir = tmp();
        let (w, _) = open_fast(dir.path());
        let w = Arc::new(w);
        let docs = Arc::new(DocRegistry::default());
        let p = prepare(&w, &docs, "path:/shared.md", "").unwrap();
        commit_controlled(&w, p.txn, &commit_payload("base")).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let (w, docs, barrier) = (w.clone(), docs.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    prepare(&w, &docs, "path:/shared.md", "base")
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let won: Vec<_> = results.iter().filter_map(|r| r.as_ref().ok()).collect();
        assert_eq!(won.len(), 1, "{results:?}");
        let lost = results.iter().find_map(|r| r.as_ref().err()).unwrap();
        assert!(
            matches!(lost.code(), "JOURNAL_BUSY" | "STALE_PARENT"),
            "{lost:?}"
        );
        commit_controlled(&w, won[0].txn, &commit_payload("base!")).unwrap();
        // The loser's view is now stale: its buffer is observed only if the
        // window really holds that text, so a retry on "base!" succeeds.
        let retry = prepare(&w, &docs, "path:/shared.md", "base!").unwrap();
        assert_eq!(retry.baseline, None);
    }
}

#[test]
fn a_window_whose_last_seen_revision_is_not_the_head_is_stale_parent() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let actor = mcp_actor();
    let first = prepare(&w, &docs, "path:/shared.md", "").unwrap();
    let r1 = commit_controlled(&w, first.txn, &commit_payload("v1"))
        .unwrap()
        .revision;
    // Window A writes on r1; window B still believes r1 is the head.
    let a = decode_prepare(&payload_on("path:/shared.md", Some(r1), "v1", &actor)).unwrap();
    let a = prepare_controlled(&w, first.doc, a).unwrap();
    let r2 = commit_controlled(&w, a.txn, &commit_payload("v2"))
        .unwrap()
        .revision;
    let generation = w.generation();
    let b = decode_prepare(&payload_on("path:/shared.md", Some(r1), "v1", &actor)).unwrap();
    let err = prepare_controlled(&w, first.doc, b).unwrap_err();
    assert_eq!(err.code(), "STALE_PARENT");
    assert_eq!(
        err,
        crate::agent_journal::errors::TxnError::StaleParent { head: Some(r2) }
    );
    assert_eq!(w.generation(), generation, "nothing appended, no baseline");
    // A parent the document never had is stale too.
    let ghost = decode_prepare(&payload_on(
        "path:/shared.md",
        Some(RevisionId::new()),
        "v2",
        &actor,
    ));
    assert_eq!(
        prepare_controlled(&w, first.doc, ghost.unwrap())
            .unwrap_err()
            .code(),
        "STALE_PARENT"
    );
}

#[test]
fn edits_typed_since_the_last_agent_write_are_observed_on_that_revision() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let actor = mcp_actor();
    let first = prepare(&w, &docs, "k", "").unwrap();
    let r1 = commit_controlled(&w, first.txn, &commit_payload("v1"))
        .unwrap()
        .revision;
    let req = decode_prepare(&payload_on("k", Some(r1), "v1 + typing", &actor)).unwrap();
    let p = prepare_controlled(&w, first.doc, req).unwrap();
    let baseline = p.baseline.expect("typing is unjournaled");
    let snap = w.snapshot().state;
    assert_eq!(snap.revisions[&baseline].parent, Some(r1));
    assert_eq!(snap.revisions[&baseline].kind, RevisionKind::Observed);
    assert_eq!(snap.txns[&p.txn].parent, Some(baseline));
}

#[test]
fn a_prepare_while_another_transaction_holds_the_document_is_journal_busy() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let held = prepare(&w, &docs, "k", "").unwrap();
    let generation = w.generation();
    let err = prepare(&w, &docs, "k", "other text").unwrap_err();
    assert_eq!(err.code(), "JOURNAL_BUSY");
    assert_eq!(
        w.generation(),
        generation,
        "no baseline appended while busy"
    );
    abort_controlled(&w, held.txn, AbortReason::Edited).unwrap();
}

#[test]
fn an_aborted_transaction_mutates_nothing_and_releases_the_document() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    let d = abort_controlled(&w, p.txn, AbortReason::Composing).unwrap();
    assert!(d.durable);
    assert_eq!(w.head(p.doc), None, "head unchanged");
    assert_eq!(w.reservation(p.doc), None);
    let snap = w.snapshot().state;
    assert_eq!(snap.txns[&p.txn].status, TxnStatus::Aborted);
    assert!(
        prepare(&w, &docs, "k", "").is_ok(),
        "the document is free again"
    );
}

#[test]
fn every_abort_reason_is_recorded_under_its_wire_name() {
    for (reason, wire) in [
        (AbortReason::Edited, "edited"),
        (AbortReason::Closed, "closed"),
        (AbortReason::Composing, "composing"),
        (AbortReason::Selection, "selection"),
        (AbortReason::ApplyRefused, "applyRefused"),
        (AbortReason::TimedOut, "timedOut"),
    ] {
        let parsed: AbortReason = serde_json::from_value(serde_json::json!(wire)).unwrap();
        assert_eq!(parsed, reason);
        let want = if reason == AbortReason::TimedOut {
            wire.to_owned()
        } else {
            format!("reverify:{wire}")
        };
        assert_eq!(reason.record_text(), want);
    }
    assert!(serde_json::from_value::<AbortReason>(serde_json::json!("whatever")).is_err());
}

/// `timedOut` (a prepare answered after the window gave up on it) is stored
/// as the same free-text `reason` every older reason uses, in a v2 record, so
/// a build that reads only schema v2 replays it, and the newer-build stop
/// does not fire.
#[test]
fn a_timed_out_abort_is_a_v2_record_an_older_build_replays() {
    let dir = tmp();
    let (doc, txn) = {
        let (w, _) = open(dir.path());
        let docs = DocRegistry::default();
        let p = prepare(&w, &docs, "k", "").unwrap();
        assert!(
            abort_controlled(&w, p.txn, AbortReason::TimedOut)
                .unwrap()
                .durable
        );
        (p.doc, p.txn)
    };
    let path = dir
        .path()
        .join(crate::agent_journal::journal_file::JOURNAL_FILE);
    let scan = crate::agent_journal::frame::scan(&std::fs::read(&path).unwrap()).unwrap();
    let aborted: Vec<serde_json::Value> = scan
        .frames
        .iter()
        .map(|f| serde_json::from_slice::<serde_json::Value>(&f.payload).unwrap())
        .filter(|v| v["record"]["kind"] == "aborted")
        .collect();
    assert_eq!(aborted.len(), 1);
    assert_eq!(aborted[0]["record"]["reason"], "timedOut");
    assert_eq!(
        aborted[0]["schemaVersion"],
        crate::agent_journal::record::SCHEMA_V2
    );
    let (older, _) = Writer::open_with_max_schema(
        config(
            dir.path(),
            crate::agent_journal::journal_file::SyncPolicy::Full,
        )
        .0,
        crate::agent_journal::record::SCHEMA_V2,
    )
    .expect("a v2-only build opens the journal");
    assert_eq!(older.snapshot().state.txns[&txn].status, TxnStatus::Aborted);
    assert_eq!(older.reservation(doc), None);
}

#[test]
fn a_commit_whose_append_fails_is_applied_but_not_durable_and_degrades_the_document() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    faults.fail_next_appends(1);
    let c = commit_controlled(&w, p.txn, &commit_payload("agent text")).unwrap();
    assert!(c.applied, "content changed: never a plain error");
    assert!(
        !c.durable,
        "the committed record waits in the degraded queue"
    );
    assert!(w.is_degraded(p.doc));
    let refused = prepare(&w, &docs, "k", "agent text").unwrap_err();
    assert_eq!(refused.code(), "JOURNAL_DEGRADED");
    // Drained without a restart: the queued commit lands, the next write goes.
    assert_eq!(drain(&w, p.doc, fast(), |_| {}), DrainEnd::Drained);
    assert!(!w.is_degraded(p.doc));
    assert_eq!(head_text(&w, p.doc), "agent text");
    assert!(prepare(&w, &docs, "k", "agent text").is_ok());
}

#[test]
fn a_failed_aborted_append_keeps_the_reservation_then_a_retry_releases_it_without_restart() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    faults.fail_next_appends(1);
    let d = abort_controlled(&w, p.txn, AbortReason::Selection).unwrap();
    assert!(
        !d.durable,
        "the refusal still goes out; the record is queued"
    );
    assert!(
        w.reservation(p.doc).is_some(),
        "reservation kept while queued"
    );
    assert_eq!(
        prepare(&w, &docs, "k", "").unwrap_err().code(),
        "JOURNAL_DEGRADED"
    );
    // Four more failures, then success: the drainer backs off and retries.
    faults.fail_next_appends(4);
    let mut sleeps = Vec::new();
    assert_eq!(
        drain(&w, p.doc, fast(), |d| sleeps.push(d)),
        DrainEnd::Drained
    );
    assert_eq!(
        sleeps,
        vec![
            Duration::from_millis(1),
            Duration::from_millis(2),
            Duration::from_millis(4),
            Duration::from_millis(4)
        ],
        "exponential backoff, capped"
    );
    assert_eq!(w.reservation(p.doc), None, "released without a restart");
    assert_eq!(w.snapshot().state.txns[&p.txn].status, TxnStatus::Aborted);
    assert!(prepare(&w, &docs, "k", "").is_ok());
}

#[test]
fn the_drain_scheduler_retries_in_the_background_until_the_queue_is_empty() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    faults.fail_next_appends(3);
    assert!(
        !commit_controlled(&w, p.txn, &commit_payload("x"))
            .unwrap()
            .durable
    );
    let scheduler = DrainScheduler::new(fast());
    scheduler.ensure(w.clone(), p.doc);
    scheduler.ensure(w.clone(), p.doc); // idempotent: one drainer per document
    let deadline = Instant::now() + Duration::from_secs(5);
    while w.is_degraded(p.doc) {
        assert!(Instant::now() < deadline, "drainer never emptied the queue");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(head_text(&w, p.doc), "x");
    while scheduler.is_active(p.doc) {
        assert!(Instant::now() < deadline, "drainer never exited");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn a_poisoned_writer_stops_the_drainer_instead_of_spinning() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    // A torn append whose truncate-back also fails poisons the journal.
    faults.tear_next_append_after(3);
    faults.fail_next_truncates(1);
    let c = commit_controlled(&w, p.txn, &commit_payload("x")).unwrap();
    assert!(c.applied && !c.durable);
    assert!(w.health().is_err(), "the writer is poisoned");
    assert!(matches!(
        drain(&w, p.doc, fast(), |_| panic!(
            "must not retry a poisoned writer"
        )),
        DrainEnd::WriterStopped(_)
    ));
    assert_eq!(
        prepare(&w, &docs, "k2", "").unwrap_err().code(),
        "JOURNAL_DEGRADED",
        "a poisoned writer refuses every controlled mutation"
    );
}

#[test]
fn a_lone_surrogate_in_the_preimage_is_invalid_text_and_nothing_is_written() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    for bad in [r#""\ud800""#, r#""\udc00""#, r#""a\ud83d""#] {
        let raw = format!(
            r#"{{"docKey":"k","preimage":{bad},"actor":{},"tool":"document.write"}}"#,
            serde_json::to_string(&mcp_actor()).unwrap()
        );
        let err = decode_prepare(raw.as_bytes()).unwrap_err();
        assert_eq!(err.code(), "INVALID_TEXT", "{bad}");
    }
    // U+FFFD itself and a valid pair are ordinary text.
    for good in ["\u{FFFD}", "😀 emoji", "中文"] {
        let req = decode_prepare(&payload("k", good, &mcp_actor())).unwrap();
        assert_eq!(req.preimage, good);
    }
    assert_eq!(w.generation(), 0);
}

#[test]
fn only_an_mcp_actor_may_prepare_a_controlled_write() {
    let raw = serde_json::to_vec(&serde_json::json!({
        "docKey": "k", "preimage": "", "actor": Actor::Human, "tool": "document.write",
    }))
    .unwrap();
    assert_eq!(decode_prepare(&raw).unwrap_err().code(), "INVALID_REQUEST");
    let unknown = br#"{"docKey":"k","preimage":"","actor":{"type":"legacy"},"tool":"t","extra":1}"#;
    assert_eq!(
        decode_prepare(unknown).unwrap_err().code(),
        "INVALID_REQUEST"
    );
}

#[test]
fn an_oversized_session_label_is_refused_not_truncated() {
    let actor = Actor::Mcp {
        principal: Principal::Anonymous,
        connection_id: ConnectionId::new(),
        session_label: Some("界".repeat(43)), // 129 UTF-8 bytes
        display_name: None,
    };
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let req = decode_prepare(&payload("k", "", &actor)).unwrap();
    let doc = DocRegistry::default().resolve("k").unwrap();
    assert_eq!(
        prepare_controlled(&w, doc, req).unwrap_err().code(),
        "INVALID_REQUEST"
    );
    assert_eq!(w.generation(), 0);
}

#[test]
fn the_tool_name_is_bounded_and_not_empty() {
    for tool in ["", &"t".repeat(65)] {
        let raw = serde_json::to_vec(&serde_json::json!({
            "docKey": "k", "preimage": "", "actor": mcp_actor(), "tool": tool,
        }))
        .unwrap();
        assert_eq!(decode_prepare(&raw).unwrap_err().code(), "INVALID_REQUEST");
    }
}

#[test]
fn document_keys_map_to_one_id_per_session_and_are_bounded() {
    let docs = DocRegistry::default();
    let a = docs.resolve("path:/a.md").unwrap();
    assert_eq!(
        docs.resolve("path:/a.md").unwrap(),
        a,
        "same key, same document"
    );
    assert_ne!(docs.resolve("path:/b.md").unwrap(), a);
    assert_ne!(docs.resolve("tab:main/t1").unwrap(), a);
    assert_eq!(docs.resolve("").unwrap_err().code(), "INVALID_REQUEST");
    let long = "k".repeat(DOC_KEY_MAX_BYTES + 1);
    assert_eq!(docs.resolve(&long).unwrap_err().code(), "INVALID_REQUEST");
    assert!(docs.resolve(&"k".repeat(DOC_KEY_MAX_BYTES)).is_ok());
    assert!(docs.resolve("path:/文档/笔记.md").is_ok(), "CJK paths");
}

#[test]
fn refusals_cross_the_command_boundary_with_their_journal_code() {
    use crate::agent_journal::errors::TxnError;
    use crate::command_error::ErrorCode;
    let head = RevisionId::new();
    let cases = [
        (
            TxnError::JournalBusy {
                holder: TxnId::new(),
            },
            ErrorCode::Conflict,
        ),
        (
            TxnError::StaleParent { head: Some(head) },
            ErrorCode::Conflict,
        ),
        (TxnError::JournalDegraded, ErrorCode::Conflict),
        (TxnError::InvalidText("x".into()), ErrorCode::InvalidInput),
        (
            TxnError::InvalidRequest("x".into()),
            ErrorCode::InvalidInput,
        ),
        (TxnError::Io("x".into()), ErrorCode::Io),
        (TxnError::Corrupt("x".into()), ErrorCode::Internal),
        (TxnError::Invariant("x".into()), ErrorCode::Internal),
        (
            TxnError::FutureFormat { version: 9 },
            ErrorCode::Unsupported,
        ),
    ];
    for (err, code) in cases {
        let ce = refusal(&err);
        assert_eq!(ce.code(), code, "{err:?}");
        let detail = ce.detail().expect("detail");
        assert_eq!(detail["journalCode"], err.code(), "{err:?}");
    }
    let stale = refusal(&TxnError::StaleParent { head: Some(head) });
    assert_eq!(stale.detail().unwrap()["head"], serde_json::json!(head));
    let genesis = refusal(&TxnError::StaleParent { head: None });
    assert_eq!(genesis.detail().unwrap()["head"], serde_json::Value::Null);
    let unavailable = super::refusal::unavailable();
    assert_eq!(
        unavailable.detail().unwrap()["journalCode"],
        "JOURNAL_UNAVAILABLE"
    );
}

#[test]
fn txn_doc_names_the_document_of_a_known_transaction_only() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let p = prepare(&w, &DocRegistry::default(), "k", "").unwrap();
    assert_eq!(txn_doc(&w, p.txn), Some(p.doc));
    assert_eq!(txn_doc(&w, TxnId::new()), None);
}

#[test]
fn commit_or_abort_of_an_unknown_transaction_is_invalid_and_writes_nothing() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let ghost = TxnId::new();
    assert_eq!(
        commit_controlled(&w, ghost, &commit_payload("x"))
            .unwrap_err()
            .code(),
        "INVALID_REQUEST"
    );
    assert_eq!(
        abort_controlled(&w, ghost, AbortReason::Closed)
            .unwrap_err()
            .code(),
        "INVALID_REQUEST"
    );
    assert_eq!(w.generation(), 0);
}

/// The records appended after the first `from` of the journal, an
/// admission frame read as its items.
fn appended_since(w: &Writer, from: usize) -> Vec<crate::agent_journal::record::Record> {
    use crate::agent_journal::record::Record;
    w.debug_records()
        .into_iter()
        .skip(from)
        .flat_map(|e| match e.record {
            Record::Admission { items } => items.into_iter().map(|i| i.record).collect(),
            r => vec![r],
        })
        .collect()
}

#[test]
fn the_loser_of_two_racing_prepares_appends_nothing_at_any_interleaving() {
    use crate::agent_journal::ids::BlobHash;
    use crate::agent_journal::record::Record;
    // A competing prepare with another dirty buffer, injected before each
    // writer-lock acquisition of the first one in turn (k = 1: before it
    // starts). Whichever loses must add no baseline, pending capture,
    // linearization or generation.
    for k in 1..=16 {
        let dir = tmp();
        let (w, faults) = open_fast(dir.path());
        let docs = DocRegistry::default();
        let actor = mcp_actor();
        let first = prepare(&w, &docs, "k", "").unwrap();
        let r0 = commit_controlled(&w, first.txn, &commit_payload("v0"))
            .unwrap()
            .revision;
        // A human capture still pending: the winner linearizes it.
        observe(&w, first.doc, "v0 saved", None);
        let (from, generation) = (w.debug_records().len(), w.generation());
        let racer = |buffer: &str| {
            let req = decode_prepare(&payload_on("k", Some(r0), buffer, &actor)).unwrap();
            prepare_controlled(&w, first.doc, req)
        };
        let (a, b, inside) = interleave(&faults, k, || racer("buffer A"), || racer("buffer B"));
        let (won, buffer, lost) = match (a, b) {
            (Ok(p), Err(e)) => (p, "buffer A", e),
            (Err(e), Ok(p)) => (p, "buffer B", e),
            (a, b) => panic!("k={k}: exactly one prepare wins: {a:?} / {b:?}"),
        };
        assert!(
            matches!(lost.code(), "JOURNAL_BUSY" | "STALE_PARENT"),
            "k={k}: {lost:?}"
        );
        let records = appended_since(&w, from);
        let pending: Vec<&BlobHash> = records
            .iter()
            .filter_map(|r| match r {
                Record::PendingObservation { postimage, .. } => Some(postimage),
                _ => None,
            })
            .collect();
        assert_eq!(
            pending,
            vec![&BlobHash::of_text(buffer)],
            "k={k} (competitor inside: {inside}): only the winner's baseline"
        );
        assert_eq!(
            w.generation() - generation,
            4,
            "k={k}: the pending capture's and the baseline's linearizations, the baseline, the prepare: {records:?}"
        );
        assert_eq!(w.reservation(first.doc).map(|r| r.txn), Some(won.txn));
        assert_eq!(head_text(&w, first.doc), buffer);
    }
}

/// A drainer thread that cannot start leaves no queue waiting for a later
/// command: the scheduler drains it once on the caller's thread instead.
#[test]
fn a_drainer_that_cannot_spawn_drains_the_queue_on_the_callers_thread() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    faults.fail_next_appends(1);
    assert!(
        !commit_controlled(&w, p.txn, &commit_payload("x"))
            .unwrap()
            .durable
    );
    assert!(w.is_degraded(p.doc));
    let scheduler =
        DrainScheduler::with_spawn(fast(), |_| Err(std::io::Error::other("no threads")));
    scheduler.ensure(w.clone(), p.doc);
    assert!(!w.is_degraded(p.doc), "the queue drained without a thread");
    assert_eq!(head_text(&w, p.doc), "x");
    assert!(
        !scheduler.is_active(p.doc),
        "a later ensure may spawn again"
    );
}

/// Whether the spawn seam below refuses to start a thread.
static SPAWN_REFUSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

fn toggled_spawn(job: Box<dyn FnOnce() + Send>) -> std::io::Result<()> {
    if SPAWN_REFUSED.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(std::io::Error::other("no threads"));
    }
    std::thread::spawn(job);
    Ok(())
}

/// The inline fallback's one attempt fails too: the queue is not left to a
/// later command on the same document. It stays armed, and the next
/// drainer the scheduler starts (here for another document) drains it.
#[test]
fn a_failed_inline_drain_stays_armed_and_the_next_drainer_takes_it() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let docs = DocRegistry::default();
    let p = prepare(&w, &docs, "k", "").unwrap();
    // The commit's append and the inline retry's append both fail.
    faults.fail_next_appends(2);
    assert!(
        !commit_controlled(&w, p.txn, &commit_payload("x"))
            .unwrap()
            .durable
    );
    let scheduler = DrainScheduler::with_spawn(fast(), toggled_spawn);
    scheduler.ensure(w.clone(), p.doc);
    assert!(w.is_degraded(p.doc), "the inline attempt failed");
    assert!(scheduler.is_armed(p.doc), "the queue stays armed for retry");
    // Threads are available again; any later ensure re-arms the drain.
    SPAWN_REFUSED.store(false, std::sync::atomic::Ordering::SeqCst);
    let other = prepare(&w, &docs, "other", "").unwrap();
    scheduler.ensure(w.clone(), other.doc);
    let deadline = Instant::now() + Duration::from_secs(5);
    while w.is_degraded(p.doc) {
        assert!(Instant::now() < deadline, "the armed queue never drained");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(head_text(&w, p.doc), "x");
    assert!(!scheduler.is_armed(p.doc));
}
