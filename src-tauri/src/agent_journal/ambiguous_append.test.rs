// An append that leaves its frame possibly durable (a failed fsync, or a failed rollback after a partial write) answers `Indeterminate`, `uncertain: true` on the wire, on every record path, not only admission; a failure proven to have changed nothing stays `Io`
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;

/// A direct (non-admission) record append on a fresh document.
fn direct_append(w: &Writer) -> TxnError {
    w.prepare(prepare_req(DocId::new(), None, "", ReviewOp::Review))
        .unwrap_err()
}

fn uncertain(e: &TxnError) -> serde_json::Value {
    serde_json::to_value(refusal(e)).unwrap()["detail"]["uncertain"].clone()
}

#[test]
fn a_failed_fsync_of_a_record_is_indeterminate() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    faults.fail_next_fsyncs(1);
    let e = direct_append(&w);
    assert!(matches!(e, TxnError::Indeterminate(_)), "{e:?}");
    assert_eq!(uncertain(&e), true);
}

#[test]
fn a_failed_rollback_of_a_torn_record_is_indeterminate() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    faults.tear_next_append_after(7);
    faults.fail_next_truncates(1);
    let e = direct_append(&w);
    assert!(matches!(e, TxnError::Indeterminate(_)), "{e:?}");
    assert_eq!(uncertain(&e), true);
}

#[test]
fn a_failure_rolled_back_or_refused_before_writing_stays_io() {
    let dir = tmp();
    let (w, faults) = open(dir.path());
    faults.tear_next_append_after(7);
    assert!(matches!(direct_append(&w), TxnError::Io(_)));
    faults.fail_next_appends(1);
    let e = direct_append(&w);
    assert!(matches!(e, TxnError::Io(_)), "{e:?}");
    assert_ne!(uncertain(&e), true);
}
