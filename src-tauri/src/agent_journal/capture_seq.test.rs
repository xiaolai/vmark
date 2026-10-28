// The capture-session table is bounded: past its cap the least recently recorded session is forgotten, and every kept session still refuses a stale seq
//! `CaptureSeqs` in isolation.
//!
//! Edge cases: the table at its cap; a session re-recorded just before the
//! table overflows (kept, as the most recent); the evicted session (its
//! next capture is checked as a new session's).

use super::{CaptureId, CaptureSeqs};

fn id(session: &str, seq: u64) -> CaptureId {
    CaptureId {
        view: "v".into(),
        session: session.into(),
        seq,
    }
}

#[test]
fn the_table_holds_at_most_its_cap_forgetting_the_least_recently_recorded() {
    let mut seqs = CaptureSeqs::with_cap(3);
    for s in ["a", "b", "c"] {
        seqs.record(&id(s, 5));
    }
    seqs.record(&id("a", 6)); // "a" is now the most recent; "b" the least.
    seqs.record(&id("d", 1));
    assert_eq!(seqs.len(), 3);
    for (s, last) in [("a", 6), ("c", 5), ("d", 1)] {
        assert!(seqs.check(&id(s, last)).is_err(), "{s} keeps its last seq");
        seqs.check(&id(s, last + 1)).expect("extends");
    }
    seqs.check(&id("b", 1))
        .expect("an evicted session is checked as new");
}

#[test]
fn the_default_table_is_bounded() {
    let mut seqs = CaptureSeqs::default();
    for n in 0..=super::MAX_SESSIONS {
        seqs.record(&id(&format!("s{n}"), 1));
    }
    assert_eq!(seqs.len(), super::MAX_SESSIONS);
}
