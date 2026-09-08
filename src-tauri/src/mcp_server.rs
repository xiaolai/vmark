//! MCP Server Process Management
//!
//! Manages the MCP bridge WebSocket server.
//!
//! Architecture:
//! - The BRIDGE is a WebSocket server that AI sidecars connect to
//! - The SIDECAR is spawned by AI clients (Claude Code, Codex, etc.), NOT by VMark
//! - VMark only starts the bridge; AI clients spawn their own sidecars
//!
//! There is no local sidecar any more (audit 20260907 #175): the static that
//! held one was never assigned, the command this header once promised did
//! not exist, and the `local_sidecar` status field it fed was therefore
//! always `false`. What remains is the bridge lifecycle alone.
//!
//! The bridge's running flag, bound port and start generation live in
//! `McpBridgeState::lifecycle()` (`mcp_bridge/lifecycle.rs`), reached from the
//! managed state like everything else the bridge mutates (WI-20; audit
//! 20260907 #177). A start and a stop hold its serialization lock end to end,
//! so a stop can no longer run between a start's bind and its bookkeeping
//! (#179), and publishing the bound port cannot fail once the listener is up
//! (#180). The status the frontend sees is a projection of one
//! `BridgePhase` (#178): `running` is true only with a port, and the window
//! between a start's claim and its bind is `starting`, not a "running"
//! bridge with no port.

use crate::command_error::CommandError;
use crate::mcp_bridge::{self, BridgeLifecycle, BridgePhase, McpBridgeState, StartClaim};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager, State};

/// The sidecar `--health-check` probe, split out at the file-size limit: it
/// spawns a child and drains its pipes, which shares nothing with the bridge
/// lifecycle above beyond living behind the same Settings panel.
#[path = "mcp_server_health.rs"]
pub(crate) mod health;

/// MCP server status for the frontend: a projection of [`BridgePhase`].
/// `running` is true only while a listener is up, so it always comes with a
/// port; `starting` names the window between a start's claim and its bind,
/// which used to be reported as `running: true, port: None` — two things
/// that cannot both hold (#178). The webview's interface reads `running` and
/// `port` and may ignore `starting`; the pair it reads is now consistent.
#[derive(Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    #[serde(default)]
    pub starting: bool,
}

impl From<BridgePhase> for McpServerStatus {
    fn from(phase: BridgePhase) -> Self {
        let (running, port, starting) = match phase {
            BridgePhase::Stopped => (false, None, false),
            BridgePhase::Starting => (false, None, true),
            BridgePhase::Running(port) => (true, Some(port), false),
        };
        Self {
            running,
            port,
            starting,
        }
    }
}

/// Start only the MCP bridge WebSocket server (no sidecar).
/// This is the recommended way to enable MCP - AI clients spawn their own sidecars.
/// The bridge binds an OS-assigned port (D9 — the command takes none; the
/// `mcpServer.port` setting that used to be forwarded here was ignored and is
/// gone). The bound port is written to the app data directory (mcp-port) for
/// sidecar discovery and reported in the returned status.
#[command]
pub async fn mcp_bridge_start(app: AppHandle) -> Result<McpServerStatus, CommandError> {
    let bridge = app.state::<McpBridgeState>();
    let lifecycle = bridge.lifecycle();
    let _serial = lifecycle.serialize().await;

    // Claim the not-running -> running transition. A concurrent start is
    // serialized behind `_serial`, so the second one sees the claim and
    // reports the phase the first one reached — its port, never a number
    // nothing listens on.
    //
    // The claim is an RAII guard (#392): every way out of this function that
    // is not `commit` releases it — the `?`, a panic in `start_bridge`, the
    // command future being dropped. The hand-rolled `abort_start()` covered
    // only the `Err` arm, so a panic left the phase at `Starting` for the life
    // of the process and every later start returned that phase instead of
    // starting anything.
    let claim = match claim_or_current(lifecycle) {
        Ok(claim) => claim,
        Err(phase) => return Ok(phase.into()),
    };

    let port =
        mcp_bridge::start_bridge(app.clone(), loop_exit_handler(&app, claim.generation())).await?;

    claim.commit(port);
    announce_started(&app, port);
    Ok(BridgePhase::Running(port).into())
}

/// Claim the start, or report the phase the bridge is ALREADY in.
///
/// The branch, as a value, so it is pinned without a runtime (#396):
/// `mcp_bridge_start` takes a concrete `AppHandle` — `mcp_bridge::start_bridge`
/// does — so the command itself cannot be driven on a mock app, and this is
/// the decision that happens before it. `Err` carries a phase, never an
/// error: a second start is not a failure, it is a question already answered.
fn claim_or_current(lifecycle: &BridgeLifecycle) -> Result<StartClaim<'_>, BridgePhase> {
    lifecycle.begin_start().ok_or_else(|| lifecycle.snapshot())
}

/// What the accept loop runs when it ends: the SAME teardown a stop performs
/// — but only while this loop is still the current generation (audit
/// 20260612), so a stale loop dying late cannot clobber a newer start's state
/// or delete its port file.
///
/// It used to clear the lifecycle and delete the port file and stop there
/// (audit #369/#393). That is enough for the EXPECTED exit — a stop has
/// already drained everything, and this handler finds a stale generation and
/// does nothing — but the unexpected one is why the loop reports its exit at
/// all: persistent accept failures, or (since the exit hook became a drop
/// guard) a panic in admission. Those left every authenticated client's socket
/// open and every pending request unanswered, behind a bridge that reported
/// itself `Stopped`, and told the frontend nothing at all. The clients could
/// still drive document mutations.
///
/// The teardown runs on a spawned task because the hook is synchronous and
/// `stop_bridge` is not, and it takes the SERIALIZATION lock first so the
/// generation check cannot straddle a start: if a fresh start has taken over
/// by the time this runs, the generation no longer matches and nothing is
/// torn down.
fn loop_exit_handler<R: tauri::Runtime>(
    app: &AppHandle<R>,
    generation: u64,
) -> impl FnOnce() + Send + 'static {
    let app = app.clone();
    move || {
        tauri::async_runtime::spawn(async move {
            let state = app.state::<McpBridgeState>();
            let lifecycle = state.lifecycle();
            let _serial = lifecycle.serialize().await;
            if !lifecycle.on_loop_exit(generation) {
                log::debug!("[MCP] Stale bridge loop exited (gen {generation}) — state untouched");
                return;
            }
            log::warn!("[MCP] Bridge server loop exited unexpectedly — tearing the bridge down");
            mcp_bridge::stop_bridge(&app).await;
            let _ = app.emit("mcp-server:stopped", ());
        });
    }
}

/// Tell the webviews, and the log, that the bridge is up on `port`.
fn announce_started(app: &AppHandle, port: u16) {
    let _ = app.emit("mcp-server:started", port);
    log::info!("[MCP] Bridge started on port {port} (waiting for AI client sidecars)");
}

/// Stop the MCP bridge WebSocket server. Infallible today — its only
/// fallible step was the local-sidecar lock (#175) — but typed (#181) like
/// every migrated command, so a failure added later reaches the frontend as
/// a `CommandError`, not as prose.
#[command]
pub async fn mcp_bridge_stop<R: tauri::Runtime>(
    app: AppHandle<R>,
) -> Result<McpServerStatus, CommandError> {
    shutdown(&app).await;
    let _ = app.emit("mcp-server:stopped", ());
    Ok(BridgePhase::Stopped.into())
}

/// The one teardown sequence (#182/#183), shared by the command and by the
/// app-exit `cleanup`. Generic over the runtime so `mcp_server.test.rs` can
/// drive it on a mock app (#396), the same reason `stop_bridge` is. Behind the same serialization a start holds, so a
/// start mid-bind finishes and is then stopped rather than leaking; then
/// supersede any in-flight loop — its `on_exit` sees a stale generation and
/// cannot clobber state a later start writes (audit 20260612) — mark the
/// bridge stopped, and tear it down.
async fn shutdown<R: tauri::Runtime>(app: &AppHandle<R>) {
    let bridge = app.state::<McpBridgeState>();
    let lifecycle = bridge.lifecycle();
    let _serial = lifecycle.serialize().await;
    lifecycle.mark_stopped();
    mcp_bridge::stop_bridge(app).await;
}

/// Get the current MCP server status.
#[command]
pub fn mcp_server_status(
    bridge: State<'_, McpBridgeState>,
) -> Result<McpServerStatus, CommandError> {
    Ok(bridge.lifecycle().snapshot().into())
}

/// Get the number of connected MCP clients. Infallible, typed (#188).
#[command]
pub async fn mcp_bridge_client_count(
    bridge: State<'_, McpBridgeState>,
) -> Result<usize, CommandError> {
    Ok(mcp_bridge::client_count(&bridge).await)
}

/// Get list of connected MCP clients with their identities. Infallible,
/// typed (#189).
#[command]
pub async fn mcp_bridge_connected_clients(
    bridge: State<'_, McpBridgeState>,
) -> Result<Vec<mcp_bridge::ConnectedClientInfo>, CommandError> {
    Ok(mcp_bridge::connected_clients(&bridge).await)
}

/// Stop the bridge on app exit. Synchronous (`block_on`) because exit goes
/// through `std::process::exit`, which waits for nothing — the teardown has
/// to complete before this returns.
pub fn cleanup<R: tauri::Runtime>(app: &AppHandle<R>) {
    let app_clone = app.clone();
    tauri::async_runtime::block_on(async move { shutdown(&app_clone).await });
}

#[cfg(test)]
#[path = "mcp_server.test.rs"]
mod tests;
