//! #178 — the status is a projection of one phase, and `running` never
//! comes without a port.
use super::*;

#[test]
fn the_starting_phase_is_reported_as_starting_not_as_running_without_a_port() {
    let status: McpServerStatus = BridgePhase::Starting.into();
    assert!(!status.running);
    assert_eq!(status.port, None);
    assert!(status.starting);
}

#[test]
fn running_always_carries_its_port_and_stopped_carries_nothing() {
    let running: McpServerStatus = BridgePhase::Running(4321).into();
    assert!(running.running && !running.starting);
    assert_eq!(running.port, Some(4321));
    let stopped: McpServerStatus = BridgePhase::Stopped.into();
    assert!(!stopped.running && !stopped.starting);
    assert_eq!(stopped.port, None);
}

#[test]
fn the_wire_shape_keeps_the_fields_the_webview_reads() {
    // `useMcpServer.ts` reads `running` and `port`; `starting` is additive.
    let wire = serde_json::to_value(McpServerStatus::from(BridgePhase::Running(9))).unwrap();
    assert_eq!(wire["running"], true);
    assert_eq!(wire["port"], 9);
    assert_eq!(wire["starting"], false);
}

// ===== The accept loop's exit hook (audit #369/#393) ========================
//
// An UNEXPECTED exit — persistent accept failures, or (since the exit hook
// became a drop guard) a panic in admission — used to clear the lifecycle and
// delete the port file and stop there. Every authenticated client's socket
// stayed open, every pending request stayed unanswered, and the frontend was
// told nothing: `mcp_server_status` reported `Stopped` while clients could
// still drive document mutations.
//
// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// feature), so these are gated like every other mock-runtime test here.
#[cfg(not(target_os = "windows"))]
mod loop_exit {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::Listener;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(McpBridgeState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    /// Count `mcp-server:stopped` deliveries. Rust listeners run inside the
    /// emit, so a wait that sees nothing means nothing was emitted.
    fn watch_stopped(app: &tauri::AppHandle<tauri::test::MockRuntime>) -> Arc<AtomicUsize> {
        let seen = Arc::new(AtomicUsize::new(0));
        let sink = Arc::clone(&seen);
        app.listen_any("mcp-server:stopped", move |_| {
            sink.fetch_add(1, Ordering::SeqCst);
        });
        seen
    }

    /// The handler SPAWNS its teardown, so assertions wait for it. Bounded:
    /// a teardown that never happens fails the assertion that follows rather
    /// than hanging the suite.
    async fn settle_until(done: impl Fn() -> bool) {
        for _ in 0..200 {
            if done() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    #[tokio::test]
    async fn an_unexpected_exit_clears_the_phase_and_tells_the_frontend() {
        let app = mock_app();
        let lifecycle = app.state::<McpBridgeState>();
        let claim = lifecycle.lifecycle().begin_start().expect("claim");
        let generation = claim.generation();
        claim.commit(4321);
        assert_eq!(lifecycle.lifecycle().snapshot(), BridgePhase::Running(4321));

        let stopped = watch_stopped(app.handle());
        loop_exit_handler(app.handle(), generation)();
        settle_until(|| stopped.load(Ordering::SeqCst) > 0).await;

        assert_eq!(
            app.state::<McpBridgeState>().lifecycle().snapshot(),
            BridgePhase::Stopped
        );
        assert_eq!(
            stopped.load(Ordering::SeqCst),
            1,
            "the frontend is told exactly once; it used to be told nothing at all"
        );
    }

    #[tokio::test]
    async fn a_stale_loops_exit_announces_nothing_and_leaves_the_new_bridge_alone() {
        // The EXPECTED path also arrives here: `mcp_bridge_stop` marks the
        // bridge stopped (bumping the generation) and then signals the loop,
        // so the loop's own exit is stale by the time it runs and must not
        // emit a second `stopped` — nor tear down a start that has taken over.
        let app = mock_app();
        let state = app.state::<McpBridgeState>();
        let stale = state
            .lifecycle()
            .begin_start()
            .expect("first start")
            .generation();
        state.lifecycle().mark_stopped();
        state
            .lifecycle()
            .begin_start()
            .expect("second start")
            .commit(9999);

        let stopped = watch_stopped(app.handle());
        loop_exit_handler(app.handle(), stale)();
        // Nothing to wait FOR, so wait long enough that a teardown would have
        // landed: this asserts an absence.
        settle_until(|| false).await;

        assert_eq!(
            app.state::<McpBridgeState>().lifecycle().snapshot(),
            BridgePhase::Running(9999),
            "a stale loop's exit must not tear down the bridge that replaced it"
        );
        assert_eq!(stopped.load(Ordering::SeqCst), 0);
    }
}

// ===== The COMMANDS, on a mock app (#396) ==================================
//
// Until now this file covered the `BridgePhase` projection and the accept
// loop's exit hook, and nothing drove the three commands that orchestrate the
// lifecycle — so a start that ignored an in-flight claim, or a stop that
// reported `Stopped` without clearing the phase, would have passed every test
// here. These are the orchestration branches that need no listener socket.
//
// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// feature), so they are gated like every other mock-runtime test here.
#[cfg(not(target_os = "windows"))]
mod commands {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tauri::Listener;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(McpBridgeState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    fn watch(app: &tauri::AppHandle<tauri::test::MockRuntime>, event: &str) -> Arc<AtomicUsize> {
        let seen = Arc::new(AtomicUsize::new(0));
        let sink = Arc::clone(&seen);
        app.listen_any(event.to_string(), move |_| {
            sink.fetch_add(1, Ordering::SeqCst);
        });
        seen
    }

    /// A start that finds the bridge already claimed reports the phase the
    /// FIRST one reached — it must not claim again, and must not report a port
    /// nothing listens on. This is `mcp_bridge_start`'s first branch, taken
    /// before it binds anything; the command itself takes a concrete
    /// `AppHandle` (`mcp_bridge::start_bridge` does), which is why the branch
    /// is a value.
    #[test]
    fn a_start_that_finds_a_claim_reports_that_phase_without_claiming_again() {
        let lifecycle = BridgeLifecycle::default();
        let held = claim_or_current(&lifecycle).expect("the first start claims");

        // The `Starting` window: claimed, not yet bound.
        let Err(phase) = claim_or_current(&lifecycle) else {
            panic!("a second start cannot claim");
        };
        assert_eq!(phase, BridgePhase::Starting);
        let status: McpServerStatus = phase.into();
        assert!(!status.running && status.starting);
        assert_eq!(
            status.port, None,
            "a port nothing listens on is never named"
        );

        held.commit(4321);
        let Err(phase) = claim_or_current(&lifecycle) else {
            panic!("a running bridge cannot be claimed");
        };
        assert_eq!(phase, BridgePhase::Running(4321));
        let status: McpServerStatus = phase.into();
        assert!(status.running && !status.starting);
        assert_eq!(status.port, Some(4321));
    }

    /// `mcp_bridge_stop` clears the phase, tells the frontend once, and is
    /// idempotent — the UI can offer Stop over a bridge that has already gone.
    #[tokio::test]
    async fn a_stop_clears_the_phase_announces_once_and_repeats_harmlessly() {
        let app = mock_app();
        let state = app.state::<McpBridgeState>();
        state.lifecycle().begin_start().expect("claim").commit(4321);
        let stopped = watch(app.handle(), "mcp-server:stopped");

        let status = mcp_bridge_stop(app.handle().clone()).await.expect("stop");
        assert!(!status.running && !status.starting);
        assert_eq!(status.port, None);
        assert_eq!(
            app.state::<McpBridgeState>().lifecycle().snapshot(),
            BridgePhase::Stopped
        );
        assert_eq!(stopped.load(Ordering::SeqCst), 1);

        mcp_bridge_stop(app.handle().clone())
            .await
            .expect("a second stop is a no-op, not an error");
        assert_eq!(
            app.state::<McpBridgeState>().lifecycle().snapshot(),
            BridgePhase::Stopped
        );
    }

    /// A stop SUPERSEDES the in-flight start (#179): the generation moves, so
    /// the start's own claim can no longer publish a port into the stopped
    /// bridge when it is dropped.
    #[tokio::test]
    async fn a_stop_supersedes_an_in_flight_start() {
        let app = mock_app();
        let state = app.state::<McpBridgeState>();
        let claim = state.lifecycle().begin_start().expect("claim");

        mcp_bridge_stop(app.handle().clone()).await.expect("stop");
        assert_eq!(state.lifecycle().snapshot(), BridgePhase::Stopped);

        // The superseded start finishes and publishes its port. It must not
        // resurrect the bridge the user just stopped.
        claim.commit(4321);
        assert_eq!(
            state.lifecycle().snapshot(),
            BridgePhase::Stopped,
            "a start the stop superseded must not publish into the stopped bridge"
        );
    }

    /// `mcp_server_status` is a projection of the LIVE lifecycle, not a copy
    /// taken when the command was registered.
    #[tokio::test]
    async fn the_status_command_reads_the_live_phase() {
        let app = mock_app();
        let state = app.state::<McpBridgeState>();
        assert!(
            !mcp_server_status(app.state::<McpBridgeState>())
                .expect("status")
                .running,
            "an app that has never started the bridge reports it stopped"
        );
        state.lifecycle().begin_start().expect("claim").commit(7000);
        let status = mcp_server_status(app.state::<McpBridgeState>()).expect("status");
        assert!(status.running);
        assert_eq!(status.port, Some(7000));
    }
}
