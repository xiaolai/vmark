//! Startup thread failure: when the journal's startup thread cannot be
//! spawned, the managed state reports `failed` with the reason instead of
//! staying `starting` for the whole session. A destroyed app window
//! releases the journal base roots its documents held.

use super::spawn_startup_with;
use crate::agent_journal::ids::DocId;
use crate::agent_journal::record::ObservedRef;
use crate::agent_journal::service::{release_window_label, start, AgentJournalState, Phase};
use tauri::test::MockRuntime;
use tauri::Manager;

fn mock_app() -> tauri::App<MockRuntime> {
    tauri::test::mock_builder()
        .manage(AgentJournalState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

#[test]
fn a_startup_thread_that_cannot_spawn_publishes_a_failed_status() {
    let app = mock_app();
    spawn_startup_with(app.handle(), |_job| {
        Err(std::io::Error::other("no threads left"))
    });
    let status = app.state::<AgentJournalState>().status();
    assert_eq!(status.phase, Phase::Failed);
    let error = status.error.expect("the reason is reported");
    assert!(error.starts_with("JOURNAL_IO:"), "{error}");
    assert!(error.contains("no threads left"), "{error}");
}

#[test]
fn a_spawned_startup_job_is_handed_to_the_spawner_and_nothing_is_published_early() {
    let app = mock_app();
    let mut handed = false;
    spawn_startup_with(app.handle(), |_job| {
        handed = true;
        Ok(())
    });
    assert!(handed);
    assert_eq!(
        app.state::<AgentJournalState>().status().phase,
        Phase::Starting
    );
}

#[test]
fn a_destroyed_app_window_releases_its_journal_bases_and_is_a_no_op_before_ready() {
    let app = mock_app();
    release_window_label(app.handle(), "doc-1"); // not ready: nothing to do
    let dir = crate::agent_journal::test_support::tmp();
    let state = app.state::<AgentJournalState>();
    state.finish(start(dir.path()));
    let writer = state.writer().expect("ready");
    writer.register_window_base("doc-1/t1@a", DocId::new(), ObservedRef::Genesis);
    writer.register_window_base("main/t1@b", DocId::new(), ObservedRef::Genesis);
    release_window_label(app.handle(), "doc-1");
    let left: Vec<String> = writer.lock().window_bases.keys().cloned().collect();
    assert_eq!(left, ["main/t1@b"]);
}
