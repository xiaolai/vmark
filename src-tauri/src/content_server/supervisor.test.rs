//! Tests for `supervisor.rs` — the per-child monitor loop and its one event
//! (#136). Loaded via `#[path] mod tests;` so `super::*` is the module.
//!
//! The loop is `supervise`, generic over the poll and the exit hook, so every
//! decision is pinned here with a scripted poll and a 1ms interval — no
//! thread, no live child, no 2-second wait. The emit is then pinned against
//! the mock runtime with a real (exited) child, which also proves the thread
//! ends: `MockRuntime` does not exist on Windows (Cargo.toml scopes tauri's
//! `test` feature), so those callers are gated the way `fs_scope.test.rs` is.

use super::*;
use serde_json::json;
use std::collections::VecDeque;

/// Drive the loop over a scripted sequence of poll answers; the script must
/// end the loop before it runs out.
fn run(states: Vec<ChildState>) -> (usize, Vec<Option<i32>>) {
    let mut queue: VecDeque<ChildState> = states.into();
    let mut polls = 0usize;
    let mut exits = Vec::new();
    supervise(
        Duration::from_millis(1),
        || {
            polls += 1;
            queue
                .pop_front()
                .expect("the loop must stop before the script runs out")
        },
        |code| exits.push(code),
    );
    (polls, exits)
}

#[test]
fn a_running_child_is_polled_again_and_an_intentional_stop_ends_the_loop_silently() {
    let (polls, exits) = run(vec![
        ChildState::Running,
        ChildState::Running,
        ChildState::NotCurrent,
    ]);
    assert_eq!(polls, 3);
    assert!(
        exits.is_empty(),
        "a stop or a replaced generation is not a crash"
    );
}

#[test]
fn an_unexpected_exit_fires_the_hook_exactly_once_and_ends_the_loop() {
    let (polls, exits) = run(vec![ChildState::Running, ChildState::Exited(Some(3))]);
    assert_eq!(polls, 2, "no poll after the exit was reported");
    assert_eq!(exits, vec![Some(3)]);
}

#[test]
fn a_signal_exit_carries_no_code() {
    let (polls, exits) = run(vec![ChildState::Exited(None)]);
    assert_eq!(polls, 1);
    assert_eq!(exits, vec![None]);
}

#[test]
fn the_event_wire_shape_is_what_use_content_server_reads() {
    // `src/hooks/useContentServer.ts`: `{ workspaceRoot: string; code: number | null }`.
    let crashed = ExitedEvent {
        workspace_root: "/ws".into(),
        code: Some(3),
    };
    assert_eq!(
        serde_json::to_value(&crashed).unwrap(),
        json!({ "workspaceRoot": "/ws", "code": 3 })
    );
    let signalled = ExitedEvent {
        workspace_root: "/ws".into(),
        code: None,
    };
    assert_eq!(
        serde_json::to_value(&signalled).unwrap(),
        json!({ "workspaceRoot": "/ws", "code": null })
    );
    assert_eq!(EXITED_EVENT, "content-server:exited");
}

// -- what an exit does, with the emitter injected (#136) ---------------------

#[test]
fn an_exit_is_emitted_once_with_the_wire_payload() {
    let mut sent = Vec::new();
    report_exit("/ws", Some(3), |name, event| {
        sent.push((name.to_string(), serde_json::to_value(&event).unwrap()));
        Ok::<(), String>(())
    });
    assert_eq!(
        sent,
        vec![(
            "content-server:exited".to_string(),
            json!({ "workspaceRoot": "/ws", "code": 3 })
        )]
    );
}

#[test]
fn an_emit_that_fails_is_logged_and_swallowed_not_unwound() {
    // The branch the verifier named on #136. Its only effect is a log
    // line; the property that matters is that the failure ENDS here: the
    // monitor thread is joined by nobody, so a panic — an `expect` creeping
    // onto the emit — would be a silent loss of the crash signal AND the
    // thread. The emitter still receives the one event.
    let mut attempts = 0;
    report_exit("/ws", None, |name, event| {
        attempts += 1;
        assert_eq!(name, EXITED_EVENT);
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            json!({ "workspaceRoot": "/ws", "code": null })
        );
        Err("runtime gone")
    });
    assert_eq!(attempts, 1, "one exit, one attempt — no retry loop");
}

// -- the thread, the emit, and single emission, against the mock runtime -----

#[cfg(not(target_os = "windows"))]
fn mock_app_with_manager() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(ContentServerManager::new())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// A child that exits 0 immediately (see `manager.test.rs` for the Windows
/// spelling).
#[cfg(not(target_os = "windows"))]
fn spawn_exiting() -> std::process::Child {
    std::process::Command::new("true")
        .spawn()
        .expect("spawn exiting child")
}

#[cfg(not(target_os = "windows"))]
fn spawn_sleeping() -> std::process::Child {
    std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .expect("spawn sleeping child")
}

/// `join` with a bound: a monitor thread that never ends must fail the test,
/// not hang it.
#[cfg(not(target_os = "windows"))]
fn ended_within(handle: thread::JoinHandle<()>, limit: Duration) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let _ = handle.join();
        let _ = tx.send(());
    });
    rx.recv_timeout(limit).is_ok()
}

#[cfg(not(target_os = "windows"))]
#[test]
fn an_unexpected_exit_is_emitted_to_listeners_once_and_the_thread_ends() {
    use tauri::{Listener, Manager};
    let app = mock_app_with_manager();
    let mgr = app.state::<ContentServerManager>();
    let mut child = spawn_exiting();
    let _ = child.wait();
    let generation = mgr.register_running("/ws", 4000, "t".into(), Some(child), None);

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    app.listen(EXITED_EVENT, move |event| {
        let _ = tx.send(event.payload().to_string());
    });
    let monitor = monitor_child_every(
        app.handle().clone(),
        "/ws".to_string(),
        generation,
        Duration::from_millis(5),
    )
    .expect("the supervisor thread starts");

    let payload = rx
        .recv_timeout(Duration::from_secs(2))
        .expect("the exit is emitted");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&payload).unwrap(),
        json!({ "workspaceRoot": "/ws", "code": 0 })
    );
    assert!(
        ended_within(monitor, Duration::from_secs(2)),
        "the monitor thread ends after reporting"
    );
    assert!(
        rx.recv_timeout(Duration::from_millis(100)).is_err(),
        "one exit, one event"
    );
    assert!(
        mgr.get("/ws").is_none(),
        "the crash deregistered the server"
    );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn an_intentional_stop_ends_the_thread_without_an_event() {
    use tauri::{Listener, Manager};
    let app = mock_app_with_manager();
    let mgr = app.state::<ContentServerManager>();
    let generation = mgr.register_running("/ws", 4000, "t".into(), Some(spawn_sleeping()), None);

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    app.listen(EXITED_EVENT, move |event| {
        let _ = tx.send(event.payload().to_string());
    });
    let monitor = monitor_child_every(
        app.handle().clone(),
        "/ws".to_string(),
        generation,
        Duration::from_millis(5),
    )
    .expect("the supervisor thread starts");

    // A stop: the record leaves the registry and its child is torn down.
    let detached = mgr.take("/ws").expect("registered");
    assert!(detached.cleanup("/ws").is_clean());

    assert!(
        ended_within(monitor, Duration::from_secs(2)),
        "NotCurrent ends the loop"
    );
    assert!(
        rx.recv_timeout(Duration::from_millis(100)).is_err(),
        "a stop is not a crash: no event"
    );
}

// ===== #333 — the first poll happens before the first sleep ================

#[test]
fn a_child_that_died_immediately_is_reported_without_waiting_out_an_interval() {
    // The interval is long enough that a sleep-first loop could not have
    // finished: an assertion on the CLOCK, since the ordering is the property
    // and a poll count cannot tell the two orderings apart.
    let mut polls = 0usize;
    let mut exits = Vec::new();
    let started = std::time::Instant::now();
    supervise(
        Duration::from_secs(30),
        || {
            polls += 1;
            ChildState::Exited(Some(1))
        },
        |code| exits.push(code),
    );
    assert_eq!(polls, 1);
    assert_eq!(exits, vec![Some(1)]);
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "the supervisor slept before its first poll: {:?}",
        started.elapsed()
    );
}
