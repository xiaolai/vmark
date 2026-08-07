// Coherence logbook — the projection that makes M2 (staleness relevance) and
// M4 (resolution burden) judgeable. Dogfood-driven: the churn count and the
// τ-downgrade surfacing both exist because real data showed they were missing.

use super::*;
use crate::coherence::types::WriterId;
use serde_json::json;

fn writer() -> WriterId {
    WriterId(uuid::Uuid::from_u128(1))
}

fn at(kind: &str, time: &str, body: serde_json::Value) -> Envelope {
    let mut e = Envelope::create(kind, writer(), body);
    e.time = time.to_string();
    e
}

fn edge(txf: &str, input: u32) -> serde_json::Value {
    json!({ "edge": { "txf": txf, "input": input } })
}

const T: &str = "019f75b7-74f9-79f3-a00f-c426a7f6a462";

#[test]
fn an_edges_whole_story_projects_from_existing_ledger_entries() {
    // The logbook is a VIEW, not new storage: everything below is already durable
    // in the ledger, so history predating the logbook still projects.
    let entries = vec![
        at(
            "check-result",
            "2026-07-20T10:00:00Z",
            json!({ "edge": { "txf": T, "input": 0 },
                    "verdict": "no-contradiction", "confidence": 0.95 }),
        ),
        at("ratification", "2026-07-20T11:00:00Z", edge(T, 0)),
    ];
    let rows = project_logbook(&entries);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].txf, T);
    assert_eq!(rows[0].first_activity, "2026-07-20T10:00:00Z");
    assert_eq!(rows[0].checks.len(), 1);
    assert_eq!(rows[0].checks[0].verdict, "no-contradiction");
    assert_eq!(rows[0].resolutions, 1);
    assert_eq!(rows[0].last_resolution.as_deref(), Some("ratification"));
}

#[test]
fn repeated_resolutions_are_counted_as_churn() {
    // THE M4 finding. Real data showed the same edges ratified 3x each: the
    // per-session burden is REPETITION, not breadth. A flat entry list hides
    // that; the count makes "this edge cost you 3 ratifications" visible.
    let entries = vec![
        at("ratification", "2026-07-18T14:00:00Z", edge(T, 0)),
        at("ratification", "2026-07-18T15:00:00Z", edge(T, 0)),
        at("ratification", "2026-07-18T22:00:00Z", edge(T, 0)),
    ];
    let rows = project_logbook(&entries);
    assert_eq!(rows[0].resolutions, 3, "the re-coherence tax is visible");
}

#[test]
fn a_tau_downgraded_check_shows_what_the_model_actually_concluded() {
    // Without this a τ downgrade is indistinguishable from a real non-answer —
    // the exact confusion that made 5 of 21 checks look like checker failures.
    let entries = vec![at(
        "check-result",
        "2026-07-20T10:00:00Z",
        json!({ "edge": { "txf": T, "input": 0 },
                "verdict": "unknown", "confidence": 0.86,
                "downgraded": { "verdict": "no-contradiction",
                                "reason": "below-tau", "tau": 0.9, "evidence": [] } }),
    )];
    let rows = project_logbook(&entries);
    let c = &rows[0].checks[0];
    assert_eq!(c.verdict, "unknown", "the recorded verdict is unchanged");
    assert_eq!(c.downgraded_verdict.as_deref(), Some("no-contradiction"));
    assert_eq!(c.downgrade_reason.as_deref(), Some("below-tau"));
}

#[test]
fn a_real_non_answer_has_no_downgrade_to_show() {
    let entries = vec![at(
        "check-result",
        "2026-07-20T10:00:00Z",
        json!({ "edge": { "txf": T, "input": 0 },
                "verdict": "unknown", "confidence": 0.0 }),
    )];
    let rows = project_logbook(&entries);
    assert!(rows[0].checks[0].downgraded_verdict.is_none());
}

#[test]
fn the_newest_judgment_wins_and_history_is_kept() {
    // Judgments are revisable: a later one supersedes, both stay in the ledger.
    let entries = vec![
        at(
            "flag-judgment",
            "2026-07-20T10:00:00Z",
            json!({ "edge": { "txf": T, "input": 0 }, "judgment": "noise", "note": "first" }),
        ),
        at(
            "flag-judgment",
            "2026-07-20T12:00:00Z",
            json!({ "edge": { "txf": T, "input": 0 }, "judgment": "relevant", "note": "second" }),
        ),
    ];
    let rows = project_logbook(&entries);
    let j = rows[0].judgment.as_ref().expect("judged");
    assert_eq!(j.judgment, "relevant");
    assert_eq!(j.note, "second");
}

#[test]
fn entries_without_an_edge_are_ignored() {
    // Captures, claims and diagnostics share the ledger; only edge-scoped facts
    // belong in an edge log.
    let entries = vec![
        at("diagnostic", "2026-07-20T10:00:00Z", json!({ "code": "x" })),
        at("claim", "2026-07-20T10:01:00Z", json!({ "statement": "s" })),
    ];
    assert!(project_logbook(&entries).is_empty());
}

#[test]
fn m2_summary_counts_judged_edges_and_keeps_unjudged_separate() {
    // The denominator is JUDGED edges. Folding unjudged rows into "noise" (or
    // into the total) would let an unreviewed backlog fake a relevance rate.
    let rows = vec![
        LogEntry {
            txf: T.into(),
            input: 0,
            first_activity: "t".into(),
            resolutions: 0,
            last_resolution: None,
            checks: vec![],
            judgment: Some(FlagJudgment {
                time: "t".into(),
                judgment: "relevant".into(),
                note: String::new(),
            }),
        },
        LogEntry {
            txf: T.into(),
            input: 1,
            first_activity: "t".into(),
            resolutions: 0,
            last_resolution: None,
            checks: vec![],
            judgment: None,
        },
    ];
    let s = m2_summary(&rows);
    assert_eq!(s.relevant, 1);
    assert_eq!(s.unjudged, 1);
    assert_eq!(s.noise, 0);
}

#[test]
fn an_unknown_judgment_value_is_refused() {
    // Coercing a mis-typed judgment would quietly corrupt the M2 metric.
    let dir = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer()).unwrap();
    let err = append_flag_judgment(
        &mut kernel,
        &uuid::Uuid::from_u128(9),
        0,
        "kinda-useful",
        "",
    )
    .unwrap_err();
    assert!(err.contains("unknown judgment"), "got: {err}");
}

#[test]
fn judging_an_edge_that_does_not_exist_is_refused() {
    // A phantom row would inflate the M2 denominator.
    let dir = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer()).unwrap();
    let err = append_flag_judgment(&mut kernel, &uuid::Uuid::from_u128(9), 0, "relevant", "")
        .unwrap_err();
    assert!(err.contains("no such edge"), "got: {err}");
}

#[test]
fn an_oversized_note_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(dir.path(), writer()).unwrap();
    let big = "x".repeat(5 * 1024);
    let err = append_flag_judgment(&mut kernel, &uuid::Uuid::from_u128(9), 0, "relevant", &big)
        .unwrap_err();
    assert!(err.contains("over the"), "got: {err}");
}
