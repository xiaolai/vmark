//! #263 — the run's lifecycle after admission, on a mock runtime.
//!
//! `run_workflow` itself takes a Wry `AppHandle` and a `State`; everything
//! after `admit_run` is `spawn_run`, driven here with futures that complete,
//! fail, panic, or wait for the test to release them.

// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// `test` feature off it); gated like every mock-runtime suite in this crate.
#![cfg(not(target_os = "windows"))]

use super::spawn_run;
use crate::workflow::state::{CancelDecision, WorkflowRunnerState};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Manager;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(WorkflowRunnerState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// Claim the flag and publish `id`, as `run_workflow` does before it spawns.
fn admitted<'s>(state: &'s WorkflowRunnerState, id: &str) -> super::AdmissionGuard<'s> {
    state
        .claim_and_publish(id)
        .expect("idle: the claim is won")
        .expect("a fresh id")
}

fn assert_released(state: &WorkflowRunnerState) {
    assert!(
        !state.running.load(Ordering::SeqCst),
        "the flag is released"
    );
    assert!(
        state.current_execution.lock().unwrap().is_none(),
        "the id is cleared with it"
    );
}

#[tokio::test]
async fn a_run_that_completes_releases_the_flag_and_the_id() {
    let app = mock_app();
    let state = app.state::<WorkflowRunnerState>();
    let admission = admitted(&state, "exec-ok");
    let handle = spawn_run(
        app.handle().clone(),
        "exec-test".to_string(),
        admission,
        async { Ok("exec-ok".to_string()) },
    );
    handle.await.expect("the task joins");
    assert_released(&state);
}

#[tokio::test]
async fn a_run_that_fails_releases_too() {
    let app = mock_app();
    let state = app.state::<WorkflowRunnerState>();
    let admission = admitted(&state, "exec-err");
    let handle = spawn_run(
        app.handle().clone(),
        "exec-test".to_string(),
        admission,
        async { Err("step 2 failed".to_string()) },
    );
    handle.await.expect("an Err is logged, not a panic");
    assert_released(&state);
}

#[tokio::test]
async fn a_run_that_panics_is_absorbed_and_still_releases() {
    // The reason the guard exists: without it a panic inside the runner left
    // `running == true` forever and no workflow could start again.
    let app = mock_app();
    let state = app.state::<WorkflowRunnerState>();
    let admission = admitted(&state, "exec-panic");
    let handle = spawn_run(
        app.handle().clone(),
        "exec-test".to_string(),
        admission,
        async {
            panic!("simulated runner panic");
        },
    );
    handle
        .await
        .expect("spawn_logged absorbs the panic; the join is Ok");
    assert_released(&state);
    assert!(
        state.claim_and_publish("exec-next").is_some(),
        "the next start can claim the flag"
    );
}

#[tokio::test]
async fn while_a_run_is_live_the_flag_is_held_and_its_cancel_matches() {
    let app = mock_app();
    let state = app.state::<WorkflowRunnerState>();
    let admission = admitted(&state, "exec-live");
    let (release_tx, release_rx) = tokio::sync::oneshot::channel::<()>();
    let handle = spawn_run(
        app.handle().clone(),
        "exec-test".to_string(),
        admission,
        async move {
            let _ = release_rx.await;
            Ok("exec-live".to_string())
        },
    );
    // Give the task a chance to be polled; the flag was committed before
    // the spawn, so this is about the run being LIVE, not about ordering.
    tokio::time::sleep(Duration::from_millis(20)).await;

    assert!(state.running.load(Ordering::SeqCst), "held by the run");
    assert!(
        state.claim_and_publish("exec-second").is_none(),
        "a second start is refused while the run is live"
    );
    assert_eq!(
        state.request_cancel("exec-live"),
        CancelDecision::Cancel,
        "a cancel for the live id matches"
    );
    assert_eq!(
        state.request_cancel("exec-other"),
        CancelDecision::NotRunning,
        "a cancel for any other id does not"
    );

    release_tx.send(()).expect("the run is waiting");
    tokio::time::timeout(Duration::from_secs(5), handle)
        .await
        .expect("the run ends once released")
        .expect("joins");
    assert_released(&state);
    assert!(
        state.claim_and_publish("exec-after").is_some(),
        "and the next start is admitted"
    );
}

#[tokio::test]
async fn the_id_published_before_the_spawn_is_the_one_the_run_holds() {
    // #267's ordering, seen from the spawn: the id was published before the
    // task existed, so nothing between publication and the first poll can
    // observe a run with no id.
    let app = mock_app();
    let state = app.state::<WorkflowRunnerState>();
    let admission = admitted(&state, "exec-early");
    assert_eq!(
        state.current_execution.lock().unwrap().as_deref(),
        Some("exec-early")
    );
    let handle = spawn_run(
        app.handle().clone(),
        "exec-test".to_string(),
        admission,
        async { Ok("exec-early".to_string()) },
    );
    handle.await.expect("joins");
    assert_released(&state);
}

/// #548 — a run that ends WITHOUT the runner's own terminal event still gets
/// one.
///
/// `run_workflow` returns an execution id the panel subscribes to and then
/// waits for `workflow:complete`, which the RUNNER emits at the end of its
/// own body. A panic never reaches that line: `spawn_logged` absorbed it, the
/// flag was released, and the panel waited forever with a log line as the only
/// trace. The guard fires only on the paths that produce no event of their own
/// — a panic, and the runtime dropping the task — so a run that RETURNS still
/// emits exactly one, with the true status.
#[tokio::test]
async fn a_panicking_run_still_reports_completion_to_the_frontend() {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use tauri::Listener;

    let app = mock_app();
    let state = app.state::<WorkflowRunnerState>();
    let admission = admitted(&state, "exec-panic");

    let seen = Arc::new(AtomicUsize::new(0));
    let sink = Arc::clone(&seen);
    app.handle().listen_any("workflow:complete", move |event| {
        assert!(
            event.payload().contains("exec-panic"),
            "the terminal event names the run: {}",
            event.payload()
        );
        assert!(event.payload().contains("failed"), "{}", event.payload());
        sink.fetch_add(1, Ordering::SeqCst);
    });

    let handle = spawn_run(
        app.handle().clone(),
        "exec-panic".to_string(),
        admission,
        async { panic!("the runner blew up before its own emit") },
    );
    handle
        .await
        .expect("spawn_logged absorbs the panic; the join is Ok");

    assert_eq!(
        seen.load(Ordering::SeqCst),
        1,
        "exactly one terminal event, where there used to be none"
    );
    assert_released(&state);
}

/// The other half, and the one a duplicate would break: a run that RETURNS
/// emits nothing here, because the runner already emitted its own — with the
/// true `completed`/`failed`/`cancelled` status this guard cannot know.
#[tokio::test]
async fn a_run_that_returns_emits_no_second_terminal_event() {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use tauri::Listener;

    let app = mock_app();
    let state = app.state::<WorkflowRunnerState>();
    let seen = Arc::new(AtomicUsize::new(0));
    let sink = Arc::clone(&seen);
    app.handle().listen_any("workflow:complete", move |_| {
        sink.fetch_add(1, Ordering::SeqCst);
    });

    for (id, outcome) in [
        ("exec-ok", Ok("exec-ok".to_string())),
        ("exec-err", Err("a step failed".to_string())),
    ] {
        let admission = admitted(&state, id);
        spawn_run(
            app.handle().clone(),
            id.to_string(),
            admission,
            async move { outcome },
        )
        .await
        .expect("joins");
    }

    assert_eq!(
        seen.load(Ordering::SeqCst),
        0,
        "the runner owns the event on every path it returns from — a second \
         one here could overwrite `cancelled` with `failed`"
    );
}
