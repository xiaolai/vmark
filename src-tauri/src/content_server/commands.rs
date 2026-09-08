//! Tauri command surface for the content server (Phase 1 WI-1.4; grill C3).
//!
//! Spawns the bundled Node content-server per workspace, discovers its port via
//! the port-file, mints browser-auth nonces over loopback, and tears down the
//! child on stop. The Node runtime + bundle are resolved from the provisioned
//! app-data dir, with a `VMARK_CONTENT_SERVER_CLI` env override for dev.
//!
//! Trust (WI-FL3.6): the workspace's trust identity travels with the start as
//! `--trusted`. It relaxes the served pages' CSP so remote `https:` images
//! render (`server/content/src/server/headers.ts`); it never decides whether
//! the workspace is served. The CSP is baked into the child at spawn, so a
//! start whose trust differs from the running server's RESTARTS it — the one
//! transition the manager expresses cleanly (`take_if_generation`, then the
//! normal spawn), and the right one: refusing would block a security
//! downgrade. Two starts racing with opposite trust values are reconciled by
//! the manager (a mismatched resident is replaced at registration, #120) and,
//! when this attempt lost the port file to the other, by one more attempt.
//!
//! The start itself lives in `start.rs` as four ordered steps (#115); this
//! file is the command surface and the pieces both share.

use crate::app_paths::app_data_dir;
use crate::command_error::CommandError;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use super::manager::RunningServer;
use super::start::{start_once, StartOutcome};
use super::ContentServerManager;

#[derive(Serialize)]
pub struct ServerHandle {
    pub url: String,
    pub port: u16,
    /// The trust the running child was spawned with — what its CSP enforces.
    /// The frontend compares it with the live workspace trust after a start
    /// and starts again if the two disagree (a flip while starting).
    pub trusted: bool,
}

impl ServerHandle {
    pub(super) fn for_server(server: &RunningServer) -> Self {
        ServerHandle {
            url: format!("http://127.0.0.1:{}", server.port),
            port: server.port,
            trusted: server.trusted,
        }
    }
}

/// Stable per-workspace key (sha256 prefix), matching workspace.rs conventions.
fn workspace_key(root: &str) -> String {
    let digest = Sha256::digest(root.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

pub(super) fn port_file_path(app: &AppHandle, root: &str) -> Result<PathBuf, CommandError> {
    let dir = app_data_dir(app)
        .map_err(CommandError::internal)?
        .join("content-server");
    std::fs::create_dir_all(&dir).map_err(|e| CommandError::io(e.to_string()))?;
    Ok(dir.join(format!("{}.port.json", workspace_key(root))))
}

/// Refuse a workspace root a server must not be rooted at (#280). Zero trust
/// at the IPC edge: an EMPTY root would have the child serve its own working
/// directory, and a RELATIVE one resolves against a process CWD the user
/// never chose — in a GUI app that is `/`.
///
/// Deliberately NOT canonicalized. Every command here keys the registry on
/// the string the frontend holds, so resolving symlinks in `start` alone
/// would make `start` and `status`/`stop` disagree about which server is
/// which; the frontend owns one spelling per workspace and passes it to all
/// three.
fn check_root(workspace_root: &str) -> Result<(), CommandError> {
    let path = Path::new(workspace_root);
    if workspace_root.is_empty() || !path.is_absolute() {
        return Err(CommandError::invalid_input(format!(
            "workspace root must be an absolute path, got {workspace_root:?}"
        )));
    }
    if !path.is_dir() {
        return Err(CommandError::not_found(format!(
            "workspace root is not an existing directory: {workspace_root:?}"
        )));
    }
    Ok(())
}

/// How many times a start is attempted before giving up on a concurrent start
/// that keeps winning the port file with the OTHER trust value (#120).
const START_ATTEMPTS: u32 = 2;

/// Start (or return the existing) content server for a workspace, spawned
/// with the workspace's current trust.
#[tauri::command]
pub async fn content_server_start(
    app: AppHandle,
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
    trusted: bool,
) -> Result<ServerHandle, CommandError> {
    check_root(&workspace_root)?;
    for _ in 0..START_ATTEMPTS {
        match start_once(&app, &mgr, &workspace_root, trusted).await? {
            StartOutcome::Ready(handle) => return Ok(handle),
            StartOutcome::RetryForTrust => continue,
        }
    }
    Err(CommandError::conflict(format!(
        "a concurrent start with the other trust value kept winning for '{workspace_root}'; start again"
    )))
}

/// Stop a workspace's content server and clean up its port-file. Idempotent;
/// the entry's supervisor sees `NotCurrent` and ends quietly (no crash
/// signal). A teardown step that failed is an ERROR, not a stop (#114): the
/// frontend treats it as "the child may be alive" and keeps the server in
/// view, where a success would have hidden an orphan.
#[tauri::command]
pub async fn content_server_stop(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<(), CommandError> {
    stop(&mgr, &workspace_root)
}

/// The stop over the manager alone, so it is testable without a Tauri app.
/// The record leaves the registry either way — a second stop is quiet — and
/// the outcome says what the teardown left behind (#123); a child that is
/// not proven gone stays owned by the manager for a retry at quit (#122).
pub(super) fn stop(mgr: &ContentServerManager, root: &str) -> Result<(), CommandError> {
    let Some(detached) = mgr.take(root) else {
        return Ok(());
    };
    let outcome = mgr.retain_orphan(root, detached.cleanup(root));
    if outcome.is_clean() {
        return Ok(());
    }
    Err(CommandError::io(format!(
        "content server for '{root}' was not fully stopped: {outcome}"
    ))
    .with_detail(serde_json::json!({
        "child": outcome.child.as_ref().map(ToString::to_string),
        "portFile": outcome.port_file,
    })))
}

/// Current server handle for a workspace, or null if not running.
#[tauri::command]
pub async fn content_server_status(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<Option<ServerHandle>, CommandError> {
    Ok(mgr
        .get(&workspace_root)
        .map(|s| ServerHandle::for_server(&s)))
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
