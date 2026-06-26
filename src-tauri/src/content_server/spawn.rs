//! Spawn + supervise the content-server child process (Phase 1 WI-1.2, ADR-10).
//!
//! Three responsibilities split out of `commands.rs` to keep that file thin:
//!   1. `resolve_node` / `resolve_cli` — locate the Node runtime and the
//!      content-server `cli.js` (dev env override → bundled Tauri resource →
//!      provisioned app-data bundle).
//!   2. `spawn_server` — spawn Node with piped stdio and forward every child
//!      line to `tauri-plugin-log` (so a packaged build's server output is
//!      captured, not lost to a detached console).
//!   3. `monitor_child` — a lightweight supervisor that detects an unexpected
//!      child exit, logs it, and emits `content-server:exited` so the frontend
//!      can surface the crash and apply its bounded restart policy.

use crate::ai_provider::{build_command, login_shell_path, which_command};
use crate::app_paths::app_data_dir;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use super::{ChildState, ContentServerManager};

/// How often the supervisor polls the child for liveness.
const MONITOR_INTERVAL: Duration = Duration::from_secs(2);

/// Resolve the `node` executable absolute path via the login-shell PATH.
pub fn resolve_node() -> Result<String, String> {
    let out = which_command()
        .arg("node")
        .env("PATH", login_shell_path())
        .output()
        .map_err(|e| format!("failed to locate node: {e}"))?;
    if !out.status.success() {
        return Err("node not found on PATH".into());
    }
    let path = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if path.is_empty() {
        return Err("node not found on PATH".into());
    }
    Ok(path)
}

/// Resolve the content-server `cli.js`:
///   1. `VMARK_CONTENT_SERVER_CLI` env override (dev / E2E).
///   2. Bundled Tauri resource (`content-server-dist/cli.js`) — the first-ship
///      path so packaged builds run the KB engine without a network download.
///   3. Provisioned app-data bundle (ADR-2 runtime upgrades).
pub fn resolve_cli(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dev) = std::env::var("VMARK_CONTENT_SERVER_CLI") {
        return Ok(PathBuf::from(dev));
    }
    // Bundled resource: shipped inside the app bundle at package time.
    if let Ok(res) = app
        .path()
        .resolve("content-server-dist/cli.js", tauri::path::BaseDirectory::Resource)
    {
        if res.exists() {
            return Ok(res);
        }
    }
    // Provisioned bundle: written by the runtime updater (ADR-2).
    let dir = app_data_dir(app)?;
    let cli = dir
        .join("content-server")
        .join("base-kb")
        .join("dist")
        .join("cli.js");
    if cli.exists() {
        Ok(cli)
    } else {
        Err("content-server runtime not provisioned".into())
    }
}

/// Spawn the Node content server with piped stdio; forward each line to `log`.
pub fn spawn_server(node: &str, args: &[&str], root: &str) -> std::io::Result<Child> {
    let mut child = build_command(node, args)
        .env("PATH", login_shell_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(out) = child.stdout.take() {
        pipe_to_log(out, root.to_string(), false);
    }
    if let Some(err) = child.stderr.take() {
        pipe_to_log(err, root.to_string(), true);
    }
    Ok(child)
}

/// Drain a child stream line-by-line into `tauri-plugin-log`. stderr → warn,
/// stdout → info. The thread ends when the stream closes (child exit).
fn pipe_to_log<R: Read + Send + 'static>(reader: R, root: String, is_err: bool) {
    thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line in buf.lines().map_while(Result::ok) {
            if is_err {
                log::warn!("[content-server {root}] {line}");
            } else {
                log::info!("[content-server {root}] {line}");
            }
        }
    });
}

#[derive(Clone, Serialize)]
struct ExitedEvent {
    #[serde(rename = "workspaceRoot")]
    workspace_root: String,
    code: Option<i32>,
}

/// Supervise the child for (root, generation). Polls every `MONITOR_INTERVAL`;
/// on an unexpected exit it logs a warning and emits `content-server:exited`
/// once. An intentional stop (entry removed / generation bumped) ends the loop
/// silently. The frontend owns the bounded restart policy (WI-1.2).
pub fn monitor_child(app: AppHandle, root: String, generation: u64) {
    thread::spawn(move || loop {
        thread::sleep(MONITOR_INTERVAL);
        let mgr = app.state::<ContentServerManager>();
        match mgr.poll_current_child(&root, generation) {
            ChildState::Running => continue,
            ChildState::NotCurrent => break,
            ChildState::Exited(code) => {
                log::warn!("[content-server {root}] exited unexpectedly (code {code:?})");
                let _ = app.emit(
                    "content-server:exited",
                    ExitedEvent {
                        workspace_root: root.clone(),
                        code,
                    },
                );
                break;
            }
        }
    });
}
