// WI-AL1.6 — the startup retention pass (ADR-AL13): startup runs the collector under the default caps and the status reports it; a pass over a small cap collects and summarizes; a refused pass (a degraded journal) is reported as an error, never a panic or silence
use super::test_support::*;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::service::{start, AgentJournalState};
use crate::agent_journal::service_gc::startup_gc;
use crate::agent_journal::writer_gc::GcPolicy;

fn small(max_revisions: usize) -> GcPolicy {
    GcPolicy {
        max_revisions,
        ..GcPolicy::default()
    }
}

#[test]
fn startup_runs_the_collector_and_the_status_reports_it() {
    let app = tmp();
    let started = start(app.path()).expect("start");
    assert_eq!(started.gc.error, None);
    assert_eq!(
        started.gc.collected, 0,
        "an empty journal has nothing to collect"
    );
    let state = AgentJournalState::default();
    state.finish(Ok(started));
    let gc = state
        .status()
        .gc
        .expect("the status carries the startup pass");
    assert_eq!(gc.collected, 0);
    let json = serde_json::to_value(state.status()).expect("serialize");
    assert!(
        json["gc"]["warnings"].is_array(),
        "warnings cross to the webview: {json}"
    );
}

#[test]
fn a_pass_over_a_small_cap_collects_and_summarizes() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    for i in 0..10 {
        human_save(&w, doc, &format!("第{i}版"));
    }
    let gc = startup_gc(&w, &small(4));
    assert_eq!(gc.error, None);
    assert_eq!(gc.collected, 6);
    assert!(gc.deferred.is_none());
}

#[test]
fn a_pass_near_the_cap_carries_the_warning() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    for i in 0..9 {
        human_save(&w, doc, &format!("v{i}"));
    }
    let gc = startup_gc(&w, &small(10));
    assert_eq!(gc.collected, 0);
    assert!(!gc.warnings.is_empty(), "9 of 10 is past 80%");
}

#[test]
fn a_refused_pass_is_reported_as_an_error() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    // An fsync failure is ambiguous: it poisons the writer.
    faults.fail_next_fsyncs(1);
    let _ = w.prepare(prepare_req(doc, w.head(doc), "a", ReviewOp::None));
    let gc = startup_gc(&w, &GcPolicy::default());
    assert!(
        gc.error
            .as_deref()
            .is_some_and(|e| e.starts_with("JOURNAL_DEGRADED")),
        "a degraded journal cannot collect: {:?}",
        gc.error
    );
    assert_eq!(gc.collected, 0);
}
