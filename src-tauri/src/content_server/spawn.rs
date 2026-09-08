//! Resolve and spawn the content-server child process (Phase 1 WI-1.2, ADR-10).
//!
//! Two responsibilities split out of `commands.rs` to keep that file thin:
//!   1. `resolve_node` / `resolve_cli` — locate the Node runtime and the
//!      content-server `cli.js` (dev env override → bundled Tauri resource →
//!      provisioned app-data bundle). The order itself is `resolve_cli_from`,
//!      pure over the three candidates so it is testable without an
//!      `AppHandle`; the bundled candidate exists only when
//!      `bundle_manifest::BUNDLED_CLI_RESOURCE` names one (WI-FL0.8).
//!   2. `spawn_server` — spawn Node with piped stdio and forward every child
//!      line to `tauri-plugin-log` (so a packaged build's server output is
//!      captured, not lost to a detached console). The wiring is
//!      `spawn_supervised`, with the line sink injected, so it is pinned
//!      with a shell in place of Node (#134).
//!
//! The supervisor that watches the spawned child (`monitor_child`) lives in
//! `supervisor.rs`.

use crate::ai_provider::{
    build_command, capture_stdout_with_timeout, login_shell_path, which_command,
};
use crate::app_paths::app_data_dir;
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Manager};

use super::bundle_manifest::BUNDLED_CLI_RESOURCE;
use super::drain::drain_lines;

/// Which candidate in `resolve_cli`'s order produced the CLI path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliSource {
    /// `VMARK_CONTENT_SERVER_CLI` (dev / E2E).
    Env,
    /// A Tauri resource inside the app bundle (`BUNDLED_CLI_RESOURCE`).
    Bundled,
    /// The app-data bundle written by the ADR-2 runtime updater.
    Provisioned,
}

impl std::fmt::Display for CliSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            CliSource::Env => "env",
            CliSource::Bundled => "bundled",
            CliSource::Provisioned => "provisioned",
        })
    }
}

/// How long the `which node` lookup may take before it is killed.
///
/// It is a LIVENESS bound, not a performance assertion: `which` stats every
/// entry on PATH, and one entry on a hung network mount blocks that stat
/// indefinitely. `resolve_node` runs inside `start_once`, which is awaited by
/// the `content_server_start` command, so an unbounded lookup parks a tokio
/// worker for as long as the mount takes to time out. Five seconds is the same
/// bound `ai_provider::detection` uses for its login-shell capture, for the
/// same reason.
const NODE_LOOKUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Resolve the `node` executable absolute path via the login-shell PATH.
///
/// Bounded (audit 20260907 #312) through the crate's existing kill-and-reap
/// capture rather than a bare `Command::output`, which waits forever.
pub fn resolve_node() -> Result<String, String> {
    let mut command = which_command();
    command.arg("node").env("PATH", login_shell_path());
    // `None` covers spawn failure, a non-zero status and the timeout alike —
    // all three mean "no usable node came back", which is exactly the `success:
    // false` case `node_from_lookup` already words. The helper logs the timeout
    // itself, so the distinction survives in the log.
    let out =
        capture_stdout_with_timeout(command, NODE_LOOKUP_TIMEOUT, "content-server node lookup");
    node_from_lookup(out.is_some(), out.unwrap_or_default().as_bytes())
}

/// Fold what `which node` reported into a path or a reason. Pure over the two
/// things the lookup produces, so every branch — a non-zero status, empty or
/// whitespace-only output, several candidates, output that is not UTF-8 — is
/// pinned by `spawn.test.rs` without a machine that happens to lack node
/// (#311). `which` prints one candidate per line; the first is what a shell
/// would run.
pub(super) fn node_from_lookup(success: bool, stdout: &[u8]) -> Result<String, String> {
    if !success {
        return Err("node not found on PATH".into());
    }
    let path = String::from_utf8_lossy(stdout)
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
///   2. Bundled Tauri resource — only when `BUNDLED_CLI_RESOURCE` names one;
///      it is `None` today because no build step produces the artefact.
///   3. Provisioned app-data bundle (ADR-2 runtime upgrades).
pub fn resolve_cli(app: &AppHandle) -> Result<PathBuf, String> {
    resolve_cli_with_source(app).map(|(path, _)| path)
}

/// `resolve_cli`, also reporting which candidate won (for the runtime probe).
pub fn resolve_cli_with_source(app: &AppHandle) -> Result<(PathBuf, CliSource), String> {
    let env = std::env::var("VMARK_CONTENT_SERVER_CLI").ok();
    // Bundled resource: shipped inside the app bundle at package time. A
    // resolution FAILURE is kept, not `.ok()`-ed away: a configured resource
    // the path resolver cannot place is a packaging fault, and reporting it as
    // "not provisioned" would send the user to install a runtime that is
    // supposed to be in the bundle (#133).
    let bundled = BUNDLED_CLI_RESOURCE.map(|rel| {
        app.path()
            .resolve(rel, tauri::path::BaseDirectory::Resource)
            .map_err(|e| {
                format!("bundled content-server resource {rel:?} could not be resolved: {e}")
            })
    });
    // Provisioned bundle: written by the runtime updater (ADR-2). Resolved
    // lazily by `resolve_cli_from` so an unavailable app-data dir only matters
    // once the earlier candidates have failed.
    let provisioned = app_data_dir(app).map(|dir| {
        dir.join("content-server")
            .join("base-kb")
            .join("dist")
            .join("cli.js")
    });
    resolve_cli_from(env.as_deref(), bundled, provisioned)
}

/// The resolution order, pure over its three candidates.
///
/// An env override must point at an existing file: a dangling
/// `VMARK_CONTENT_SERVER_CLI` used to be returned as-is and failed later as
/// "exited before reporting a port", which named neither the variable nor the
/// path. A blank value counts as unset. `bundled` is `None` when no resource
/// is configured, `Some(Err)` when one is configured but could not be
/// resolved — surfaced as that error once the env override has passed.
pub fn resolve_cli_from(
    env: Option<&str>,
    bundled: Option<Result<PathBuf, String>>,
    provisioned: Result<PathBuf, String>,
) -> Result<(PathBuf, CliSource), String> {
    if let Some(dev) = env.map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(dev);
        if path.is_file() {
            return Ok((path, CliSource::Env));
        }
        return Err(format!(
            "VMARK_CONTENT_SERVER_CLI is set but no file exists at {}",
            path.display()
        ));
    }
    if let Some(res) = bundled {
        let res = res?;
        if res.is_file() {
            return Ok((res, CliSource::Bundled));
        }
    }
    let cli = provisioned?;
    if cli.is_file() {
        Ok((cli, CliSource::Provisioned))
    } else {
        Err("content-server runtime not provisioned".into())
    }
}

/// Which child pipe a line arrived on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Stream {
    Stdout,
    Stderr,
}

/// The line sink both drain threads share: called with every line of either
/// stream until the child exits.
type LineSink = Arc<dyn Fn(Stream, &str) + Send + Sync>;

/// Spawn the Node content server with piped stdio; forward each line to
/// `log` — stderr → warn, stdout → info.
pub fn spawn_server(node: &str, args: &[&str], root: &str) -> std::io::Result<Child> {
    let mut cmd = build_command(node, args);
    cmd.env("PATH", login_shell_path());
    let root = root.to_string();
    spawn_supervised(cmd, move |stream, line| match stream {
        Stream::Stderr => log::warn!("[content-server {root}] {line}"),
        Stream::Stdout => log::info!("[content-server {root}] {line}"),
    })
}

/// `spawn_server` with the line sink injected: spawn `cmd` with both pipes
/// captured, and drain each on its own thread into `on_line` until the
/// stream closes (the child exited). Pinned by `spawn.test.rs` with a shell
/// in place of Node (#134); production hands in the `log` forwarder above.
/// A drain thread that could not be created is a FAILED SPAWN, not a lost log
/// line (#314). `thread::spawn` panics when the OS refuses a thread, and the
/// unwind then dropped `child` — and `std::process::Child` does not kill on
/// drop, so the server it had just started ran on with nobody owning it.
/// `thread::Builder` reports the refusal instead, and the child is killed and
/// reaped before the error goes back.
pub(super) fn spawn_supervised(
    mut cmd: Command,
    on_line: impl Fn(Stream, &str) + Send + Sync + 'static,
) -> std::io::Result<Child> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let on_line: LineSink = Arc::new(on_line);
    let drained = child
        .stdout
        .take()
        .map(|out| drain_on_thread(out, Stream::Stdout, Arc::clone(&on_line)))
        .unwrap_or(Ok(()))
        .and_then(|()| {
            child
                .stderr
                .take()
                .map(|err| drain_on_thread(err, Stream::Stderr, on_line))
                .unwrap_or(Ok(()))
        });
    match drained {
        Ok(()) => Ok(child),
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(e)
        }
    }
}

/// Drain one child stream on its own thread. The thread ends when the stream
/// closes (child exit), and the shared sink is dropped once both have. A
/// thread the OS refuses is reported, never a panic (#314).
fn drain_on_thread<R: Read + Send + 'static>(
    reader: R,
    stream: Stream,
    on_line: LineSink,
) -> std::io::Result<()> {
    thread::Builder::new()
        .name(format!("content-server-{stream:?}").to_ascii_lowercase())
        .spawn(move || drain_lines(reader, |line| on_line(stream, line)))
        .map(|_| ())
}

#[cfg(test)]
#[path = "spawn.test.rs"]
mod tests;
