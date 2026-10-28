// WI-AL1.2 — the journal fails loud on disk full and permission denied, and a crash after the directory sync of a compaction leaves the new journal whole
//! Storage failures the operating system reports (no space left, permission
//! denied) refuse the write with `JOURNAL_IO`, leave the head where it was,
//! tell every window (`HealthChanged`) and do not poison a journal whose
//! failed bytes were rolled back. Startup over a journal the process may not
//! write refuses with `JOURNAL_IO` and a failed status. A crash after the
//! last compaction step (the directory sync) leaves the new file whole.
use std::io::ErrorKind;
use std::sync::Arc;

#[cfg(unix)]
use super::service::{start, AgentJournalState, Phase, JOURNAL_DIR};
use super::test_support::*;
use crate::agent_journal::faults::{CompactionStep, Faults};
use crate::agent_journal::ids::DocId;
use crate::agent_journal::journal_file::{JournalFile, SyncPolicy, JOURNAL_FILE};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::writer::JournalEvent;

const ONE: Edit = Edit {
    at: 0,
    delete: 0,
    insert: 1,
};

#[test]
fn disk_full_and_permission_denied_refuse_the_write_loudly_and_recover() {
    for kind in [ErrorKind::StorageFull, ErrorKind::PermissionDenied] {
        let dir = tmp();
        let doc = DocId::new();
        let head = {
            let (w, faults) = open(dir.path());
            let (_, first) = agent_change(&w, doc, "", "a", ONE);
            let events = w.subscribe();
            faults.fail_next_write_with(kind);
            let err = w
                .prepare(prepare_req(doc, Some(first), "a", ReviewOp::Review))
                .expect_err("the write is refused");
            assert_eq!(err.code(), "JOURNAL_IO", "{kind:?}: {err}");
            assert_eq!(w.head(doc), Some(first), "{kind:?}: head unchanged");
            assert_eq!(
                events.try_recv().ok(),
                Some(JournalEvent::HealthChanged),
                "{kind:?}: every window hears of the failure"
            );
            assert!(w.health().is_ok(), "{kind:?}: rolled back, not poisoned");
            let edit = Edit {
                at: 1,
                delete: 0,
                insert: 1,
            };
            let (_, second) = agent_change(&w, doc, "a", "ab", edit);
            second
        };
        let (reopened, _) = open(dir.path());
        assert_eq!(
            reopened.head(doc),
            Some(head),
            "{kind:?}: restart keeps the retry"
        );
        assert_eq!(head_text(&reopened, doc), "ab", "{kind:?}");
    }
}

#[cfg(unix)]
#[test]
fn startup_over_a_journal_it_may_not_write_fails_loudly() {
    use std::os::unix::fs::PermissionsExt;
    let app_data = tmp();
    drop(start(app_data.path()).expect("first start"));
    let journal = app_data.path().join(JOURNAL_DIR).join(JOURNAL_FILE);
    std::fs::set_permissions(&journal, std::fs::Permissions::from_mode(0o400)).unwrap();
    if std::fs::OpenOptions::new()
        .write(true)
        .open(&journal)
        .is_ok()
    {
        // A superuser ignores the mode bits; the refusal cannot be staged.
        eprintln!("skipped: the file system does not enforce permissions here");
        return;
    }
    let state = AgentJournalState::default();
    let result = start(app_data.path());
    let err = result.as_ref().err().cloned().expect("startup refused");
    assert!(err.message().starts_with("JOURNAL_IO"), "{err}");
    state.finish(result);
    assert_eq!(state.status().phase, Phase::Failed);
    assert!(state.writer().is_none());
}

#[test]
fn a_crash_after_the_directory_sync_of_a_compaction_leaves_the_new_journal_whole() {
    let dir = tmp();
    let faults = Arc::new(Faults::default());
    let path = dir.path().join(JOURNAL_FILE);
    let mut f = JournalFile::open(&path, SyncPolicy::Full, faults.clone())
        .unwrap()
        .file;
    for p in [b"one".to_vec(), b"two".to_vec()] {
        f.append(&p).unwrap();
    }
    faults.crash_compaction_after(CompactionStep::DirSynced);
    let new = vec![b"compacted".to_vec()];
    assert!(f.rewrite(&new).is_err(), "injected crash");
    drop(f); // the crash ends the process, releasing its lock
    let got = JournalFile::open(&path, SyncPolicy::Full, Arc::default())
        .unwrap()
        .payloads;
    assert_eq!(got, new);
}
