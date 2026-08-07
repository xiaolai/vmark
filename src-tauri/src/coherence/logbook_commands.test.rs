// Logbook view assembly — the derived counts the UI and the M2 reading depend on.

use crate::coherence::logbook::{FlagJudgment, LogEntry};

fn row(input: u32, resolutions: usize, judgment: Option<&str>) -> LogEntry {
    LogEntry {
        txf: "019f75b7-74f9-79f3-a00f-c426a7f6a462".into(),
        input,
        first_activity: "2026-07-20T10:00:00Z".into(),
        resolutions,
        last_resolution: None,
        checks: vec![],
        judgment: judgment.map(|j| FlagJudgment {
            time: "2026-07-20T11:00:00Z".into(),
            judgment: j.into(),
            note: String::new(),
        }),
    }
}

#[test]
fn reopened_edges_counts_only_edges_resolved_more_than_once() {
    // The M4 signal. An edge resolved ONCE is a normal one-off; resolved 3x means
    // it kept reopening and was paid for again — that repetition, not the number
    // of distinct edges, is what made the real burden 13/17/11 per session.
    let rows = [row(0, 1, None), row(1, 3, None), row(2, 0, None)];
    let reopened = rows.iter().filter(|r| r.resolutions > 1).count();
    assert_eq!(reopened, 1, "only the 3x edge counts as reopened");
}

#[test]
fn the_m2_reading_separates_judged_from_unjudged() {
    // An unreviewed backlog must never be able to fake a relevance rate.
    let rows = [
        row(0, 1, Some("relevant")),
        row(1, 1, Some("noise")),
        row(2, 1, None),
    ];
    let m2 = crate::coherence::logbook::m2_summary(&rows);
    assert_eq!(m2.relevant, 1);
    assert_eq!(m2.noise, 1);
    assert_eq!(m2.unjudged, 1);
    assert_eq!(
        m2.relevant + m2.noise + m2.unsure,
        2,
        "the judged denominator excludes the unjudged row"
    );
}
