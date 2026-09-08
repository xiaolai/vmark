//! Bringing the bridge up: bind, publish, refresh, spawn (#167).
//!
//! Four steps whose ORDER is the contract, and none of it was reachable from
//! a test while `start_bridge` took a Wry `AppHandle` and reached the real
//! port file and the user's real AI-client configs. It is generic over the
//! runtime now, and the two side effects that leave this process — writing
//! the port file and re-reading the client credentials — are parameters. The
//! bind and the accept loop stay real: they are loopback and cheap, and a
//! test that faked them would pin nothing.
//!
//! Key decisions:
//!   - The port is PUBLISHED only after the listener is bound, because the
//!     file is what the sidecar dials; a number nothing listens on is worse
//!     than no file. It is published BEFORE the refresh so a failed write
//!     refuses the start without first parsing tens of megabytes of client
//!     config — and the awaits that follow it are covered by a rollback guard
//!     rather than by reordering (audit #383): a start that unwinds or is
//!     dropped after publishing drops its listener, so the file it left behind
//!     names a closed port. `PublishedPort` deletes it unless the start
//!     reaches the spawn.
//!   - The client-token refresh is AWAITED before the accept loop is spawned,
//!     so no connection is ever judged against a registry that has not been
//!     built yet. It parses up to four config files (`~/.claude.json` can
//!     reach tens of MB), so it runs on the blocking pool rather than
//!     stalling this async worker. A PANIC in it publishes an EMPTY registry
//!     (audit #384): the documented degraded mode is "that client is not
//!     identified", and keeping a snapshot this start failed to rebuild would
//!     instead go on authenticating whatever the last one held.
//!   - The loop refuses to admit a socket once the bridge is marked
//!     `Stopped` (audit #394). `stop_bridge` signals the loop and then drains,
//!     but the loop is a separate task: it can accept one more socket AFTER
//!     the connection-generation bump, and that socket captures the bumped
//!     generation, passes the registration re-check, and joins a bridge the
//!     user has already stopped. `mcp_server::shutdown` marks the phase before
//!     it signals, so reading the phase here closes the window without having
//!     to await the loop. `Starting` is deliberately admitted — the phase only
//!     becomes `Running` once `mcp_bridge_start` returns, and the port file is
//!     out by then.
//!   - A failed publish refuses the start, and the listener is dropped with
//!     it — no bridge is left running behind a failed command (`#180` is the
//!     other half of that story, in `lifecycle.rs`).
//!   - The shutdown sender is installed before the loop is spawned, so a stop
//!     always has something to signal. Start and stop cannot interleave in
//!     the first place — `BridgeLifecycle::serialize` holds one lock across
//!     each whole operation (#179) — and `start.test.rs` drives the pair.
//!
//! @coordinates-with server.rs — `stop_bridge`, the other half
//! @coordinates-with mcp_server.rs — the commands that drive both
//! @module mcp_bridge::start

use super::accept_loop::accept_loop;
use super::bind::bind_listener;
use super::connection::admit_connection;
use super::lifecycle::BridgePhase;
use super::managed::bridge;
use super::state::generate_auth_token;
use super::token_file::write_port_file;
use crate::command_error::CommandError;
use tauri::AppHandle;
use tokio::sync::oneshot;

/// Start the MCP bridge WebSocket server.
/// Returns the actual port the server is listening on.
///
/// `on_exit` is called when the server loop terminates (shutdown signal or
/// unexpected exit) so the caller can reset the lifecycle state.
///
/// Typed (#164): every failure here is an `io` `CommandError` the command
/// returns as-is, so the frontend branches on a code, never on prose.
pub async fn start_bridge(
    app: AppHandle,
    on_exit: impl FnOnce() + Send + 'static,
) -> Result<u16, CommandError> {
    let publish_to = app.clone();
    start_bridge_with(
        app,
        on_exit,
        move |port, token| write_port_file(&publish_to, port, token),
        crate::mcp_config::client_tokens::refresh,
    )
    .await
}

/// [`start_bridge`] with its two out-of-process effects injected (#167).
///
/// `publish` writes the `port:token` file the sidecar discovers the bridge
/// through; `refresh` re-reads the AI clients' own MCP configs so a
/// connection can be attributed to the client VMark issued its credential to.
/// Production passes the real ones; `start.test.rs` passes recorders, because
/// the real pair writes into the user's app-data directory and reads the
/// developer's `~/.claude.json`.
pub(super) async fn start_bridge_with<R: tauri::Runtime>(
    app: AppHandle<R>,
    on_exit: impl FnOnce() + Send + 'static,
    publish: impl FnOnce(u16, &str) -> Result<(), String>,
    refresh: impl FnOnce() + Send + 'static,
) -> Result<u16, CommandError> {
    let (listener, actual_port) = bind_listener().await?;

    // Generate the auth token and publish `port:token` for sidecar discovery.
    // On failure the `?` drops `listener`, releasing the port: a start that
    // could not be advertised leaves nothing behind.
    let auth_token = generate_auth_token();
    publish(actual_port, &auth_token).map_err(CommandError::io)?;
    // From here the file exists and the listener does not outlive this
    // function unless the loop takes it, so every remaining exit that is not
    // the spawn has to take the file with it (#383).
    let published = PublishedPort(Some(app.clone()));

    // Never fatal: an unreadable third-party config is skipped with a log line
    // by `refresh` itself, and its client simply connects unidentified. A
    // JoinError is different — the task PANICKED, so the registry was not
    // rebuilt at all — and the fail-closed answer is an empty one: identify
    // nobody rather than go on judging credentials against a snapshot this
    // start never refreshed (#384).
    if let Err(e) = tokio::task::spawn_blocking(refresh).await {
        log::error!(
            "[MCP Bridge] client-token refresh panicked ({e}); starting with NO client \
             identities — sidecars will connect unidentified until the next refresh"
        );
        crate::mcp_config::client_tokens::publish(Vec::new());
    }

    log::info!(
        "[MCP Bridge] WebSocket server listening on 127.0.0.1:{} (auth required)",
        actual_port
    );

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    *bridge(&app).shutdown_slot().await = Some(shutdown_tx);

    let app_handle = app.clone();

    // The loop itself lives in `accept_loop.rs`, where it is tested against a
    // real listener (#167). Admission (the connection-slot reservation) is
    // decided inside it, synchronously, before anything is spawned or cloned
    // — see `admit_connection`.
    //
    // The `JoinHandle` is deliberately dropped: `on_exit` is run by a drop
    // guard INSIDE `accept_loop`, so it fires on a panic and on the runtime
    // dropping the task, not only when the loop returns (audit #385). Holding
    // the handle would let us await the loop's end, but it would not make the
    // cleanup any more certain — and nothing here has an end to await.
    crate::task::spawn_logged(
        "mcp-bridge-accept-loop",
        accept_loop(
            listener,
            shutdown_rx,
            move |stream, addr| {
                // #394 — see the header. Dropping `stream` closes the socket.
                if bridge(&app_handle).lifecycle().snapshot() == BridgePhase::Stopped {
                    log::warn!("[MCP Bridge] Refusing {addr}: the bridge is stopped");
                    return;
                }
                admit_connection(stream, addr, &app_handle, &auth_token);
            },
            on_exit,
        ),
    );

    // The loop owns the listener now, so the port file describes something
    // live and must survive this function.
    published.commit();
    Ok(actual_port)
}

/// Deletes the published `port:token` file unless the start reaches its spawn.
///
/// The file is what a sidecar dials, and it outlives the function that wrote
/// it — while the listener does not. Between the publish and the spawn this
/// start still awaits twice, and any exit through those that is not a `?`
/// (an unwind, the command future being dropped) used to leave a
/// valid-looking file naming a closed port, which a sidecar then retried
/// against until the user restarted VMark.
struct PublishedPort<R: tauri::Runtime>(Option<AppHandle<R>>);

impl<R: tauri::Runtime> PublishedPort<R> {
    fn commit(mut self) {
        self.0 = None;
    }
}

impl<R: tauri::Runtime> Drop for PublishedPort<R> {
    fn drop(&mut self) {
        if let Some(app) = self.0.take() {
            log::warn!(
                "[MCP Bridge] start did not reach its accept loop after publishing the port \
                 file — removing it rather than advertising a closed port"
            );
            super::token_file::remove_port_file(&app);
        }
    }
}

#[cfg(test)]
#[path = "start.test.rs"]
mod tests;
