// WI-AL1.2 — startup of the app's journal: opened under <appData>/agent-journal (owner-only), the legacy checkpoint log migrated on every start without rewriting it, and a status that tells starting, ready and failed apart
use std::sync::Arc;

use super::legacy_import::LEGACY_CHECKPOINT_FILE;
use super::service::{start, AgentJournalState, Phase, JOURNAL_DIR};
use super::test_support::*;
use crate::agent_journal::ids::DocId;

const FIXTURE: &str =
    include_str!("../../../src/test/fixtures/agentJournal/legacyCheckpoints.jsonl");

#[test]
fn the_journal_lives_in_its_own_directory_under_app_data() {
    let app_data = tmp();
    let started = start(app_data.path()).expect("start");
    let dir = app_data.path().join(JOURNAL_DIR);
    assert!(dir.join("journal.alj").exists());
    assert!(dir.join("blobs.pack").exists());
    assert_eq!(started.writer.generation(), 0);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700, "document text never readable by other users");
    }
}

/// The journal directory's name is fsynced into app data when created,
/// and a restart, finding it, syncs nothing there.
#[test]
fn creating_the_journal_directory_syncs_app_data() {
    use crate::agent_journal::journal_file::DIR_SYNCS;
    let app_data = tmp();
    DIR_SYNCS.with(|d| d.borrow_mut().clear());
    drop(start(app_data.path()).expect("start"));
    let synced = DIR_SYNCS.with(|d| d.take());
    assert!(
        synced.contains(&app_data.path().to_path_buf()),
        "{synced:?}"
    );
    drop(start(app_data.path()).expect("restart"));
    let synced = DIR_SYNCS.with(|d| d.take());
    assert!(
        !synced.contains(&app_data.path().to_path_buf()),
        "{synced:?}"
    );
}

#[test]
fn startup_migrates_the_legacy_log_and_a_restart_appends_nothing() {
    let app_data = tmp();
    let legacy = app_data.path().join(LEGACY_CHECKPOINT_FILE);
    std::fs::write(&legacy, FIXTURE).unwrap();
    let first = start(app_data.path()).expect("start");
    let report = first.legacy.clone().expect("legacy import ran");
    assert_eq!((report.appended, report.verified), (3, true));
    drop(first);
    let second = start(app_data.path()).expect("restart");
    assert_eq!(second.legacy.clone().unwrap().appended, 0);
    assert_eq!(second.writer.snapshot().state.legacy.len(), 3);
    assert!(
        !legacy.exists(),
        "the verified original was retired by the first start"
    );
}

#[test]
fn a_failed_legacy_import_still_starts_the_journal_and_reports_it() {
    let app_data = tmp();
    // A directory where the log should be: reading it fails, loudly.
    std::fs::create_dir(app_data.path().join(LEGACY_CHECKPOINT_FILE)).unwrap();
    let started = start(app_data.path()).expect("journal still opens");
    let err = started.legacy.clone().unwrap_err();
    assert!(err.starts_with("JOURNAL_IO"), "{err}");
}

#[test]
fn a_journal_directory_that_cannot_be_created_fails_startup() {
    let app_data = tmp();
    std::fs::write(app_data.path().join(JOURNAL_DIR), "a file, not a directory").unwrap();
    let err = start(app_data.path()).err().expect("startup refused");
    assert!(err.message().starts_with("JOURNAL_IO"), "{err}");
}

#[test]
fn the_status_moves_from_starting_to_ready_with_the_generation_as_a_string() {
    let state = AgentJournalState::default();
    let before = state.status();
    assert_eq!(before.phase, Phase::Starting);
    assert!(state.writer().is_none());
    let app_data = tmp();
    state.finish(start(app_data.path()));
    let writer = state.writer().expect("ready");
    agent_change(
        &writer,
        DocId::new(),
        "",
        "a",
        Edit {
            at: 0,
            delete: 0,
            insert: 1,
        },
    );
    let status = state.status();
    assert_eq!(status.phase, Phase::Ready);
    assert_eq!(
        status.generation.as_deref(),
        Some("3"),
        "epoch armed (the provenance needs one) + prepared + committed"
    );
    assert!(!status.degraded && !status.read_only);
    assert_eq!(serde_json::to_value(&status).unwrap()["phase"], "ready");
}

#[test]
fn a_failed_start_is_visible_in_the_status_and_finish_is_once_only() {
    let state = AgentJournalState::default();
    state.finish(Err("JOURNAL_IO: denied".to_string().into()));
    let status = state.status();
    assert_eq!(status.phase, Phase::Failed);
    assert_eq!(status.error.as_deref(), Some("JOURNAL_IO: denied"));
    assert!(state.writer().is_none());
    let app_data = tmp();
    state.finish(start(app_data.path()));
    assert_eq!(
        state.status().phase,
        Phase::Failed,
        "the first outcome stands"
    );
}

#[test]
fn every_window_shares_one_writer() {
    let state = AgentJournalState::default();
    let app_data = tmp();
    state.finish(start(app_data.path()));
    let (a, b) = (state.writer().unwrap(), state.writer().unwrap());
    assert!(Arc::ptr_eq(&a, &b));
}
