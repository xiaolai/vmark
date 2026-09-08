//! One start of a workspace's content server, as four ordered steps.
//!
//! Purpose: split from `commands.rs` at the file-size gate, and because the
//! start is the one lifecycle with a race in every step: reuse-or-displace
//! (a resident server with the other trust value is stopped BY GENERATION,
//! #116), spawn, wait for the port (a concurrent start's child can win the
//! shared port file, #120), register (the manager reconciles trust, #120).
//! Every exit hands whatever it holds to `cleanup::Detached` — the one
//! teardown path (#123) — which logs what it could not do (#114) and leaves a
//! child it could not stop with the manager (#122); a failed start is already
//! an error, so the outcome is not surfaced twice.
//!
//! @coordinates-with commands.rs — the command that loops over attempts
//! @coordinates-with manager.rs — `take_if_generation`, `register_or_existing`
//! @module content_server/start

use crate::command_error::CommandError;
use std::path::PathBuf;
use std::process::Child;
use tauri::AppHandle;

use super::cleanup::Detached;
use super::commands::{port_file_path, ServerHandle};
use super::manager::{RegisterOutcome, RunningServer};
use super::port_wait::{await_port_of, PortWait};
use super::spawn::{resolve_cli, resolve_node, spawn_server};
use super::supervisor::monitor_child;
use super::{ChildState, ContentServerManager};

/// What a start does about a server already running for the workspace.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum StartDecision {
    Reuse,
    /// The running child enforces the other trust value; replace it.
    RestartForTrust,
}

pub(super) fn start_decision(existing: &RunningServer, trusted: bool) -> StartDecision {
    if existing.trusted == trusted {
        StartDecision::Reuse
    } else {
        StartDecision::RestartForTrust
    }
}

/// The child's argument vector; `--trusted` only for a trusted workspace.
pub(super) fn server_args<'a>(
    cli: &'a str,
    root: &'a str,
    token: &'a str,
    port_file: &'a str,
    trusted: bool,
) -> Vec<&'a str> {
    let mut args = vec![
        cli,
        "--root",
        root,
        "--token",
        token,
        "--port-file",
        port_file,
    ];
    if trusted {
        args.push("--trusted");
    }
    args
}

pub(super) enum StartOutcome {
    Ready(ServerHandle),
    /// Another start with the other trust value won this one's port file;
    /// start again so the server that ends up running is the one asked for.
    RetryForTrust,
}

/// A spawned child that has not yet reported its port.
struct Spawned {
    child: Child,
    token: String,
    port_file: PathBuf,
}

impl Spawned {
    fn into_detached(self) -> Detached {
        Detached {
            child: Some(self.child),
            port_file: Some(self.port_file),
        }
    }
}

/// One attempt: reuse or displace, spawn, wait for the port, register, and
/// hand the registered child to its supervisor.
pub(super) async fn start_once(
    app: &AppHandle,
    mgr: &ContentServerManager,
    root: &str,
    trusted: bool,
) -> Result<StartOutcome, CommandError> {
    if let Some(existing) = reuse_or_displace(mgr, root, trusted) {
        return Ok(StartOutcome::Ready(existing));
    }
    let mut spawned = spawn_for(app, root, trusted)?;
    let port = match await_port(&mut spawned).await {
        PortWait::Port(port) => port,
        PortWait::Exited => {
            mgr.retain_orphan(root, spawned.into_detached().cleanup(root));
            return Err(CommandError::internal(
                "content server exited before reporting a port",
            ));
        }
        PortWait::PollFailed(detail) => {
            mgr.retain_orphan(root, spawned.into_detached().cleanup(root));
            return Err(CommandError::io(format!(
                "content server could not be polled while it was starting: {detail}"
            )));
        }
        PortWait::TimedOut => return lost_the_port_file(mgr, root, trusted, spawned),
    };

    // Atomic register; on a lost concurrent-start race or a shutdown that
    // began mid-spawn, the manager kills + reaps the child we spawned (so it
    // is not orphaned) — we only clean up the port-file we own.
    let Spawned {
        child,
        token,
        port_file,
    } = spawned;
    match mgr.register_or_existing(root, port, token, child, port_file.clone(), trusted) {
        RegisterOutcome::Existing(existing) => {
            Detached::port_file_only(port_file).cleanup(root);
            Ok(StartOutcome::Ready(ServerHandle::for_server(&existing)))
        }
        RegisterOutcome::ShuttingDown => {
            Detached::port_file_only(port_file).cleanup(root);
            // The app is going away, so the request is moot rather than wrong.
            Err(CommandError::cancelled(
                "app is shutting down; not starting a content server",
            ))
        }
        RegisterOutcome::Registered => {
            // Read the registry BACK rather than describe the child just
            // handed over (#291). Registration releases the lock before this
            // line, so a concurrent start with the OTHER trust value can
            // already have replaced and killed our child — and a handle built
            // from our own `port` would then name a dead server while the
            // supervisor below watched the replacement's generation. The
            // frontend compares the handle's trust with the live value and
            // starts again when they disagree, which is exactly this case.
            let Some(current) = mgr.get(root) else {
                // Stopped between registering and reading back: nothing is
                // running for this root, and a handle would name a port that
                // is not.
                return Err(CommandError::cancelled(
                    "the content server was stopped while it was starting",
                ));
            };
            // Supervise the registered child: detect an unexpected exit, log
            // it, and emit `content-server:exited` for the frontend's restart
            // policy.
            monitor_child(app.clone(), root.to_string(), current.generation);
            Ok(StartOutcome::Ready(ServerHandle::for_server(&current)))
        }
    }
}

/// The running server to hand back, or `None` when a spawn is needed. A
/// resident server enforcing the other trust value is stopped first — by the
/// generation just observed, so a server that replaced it in the meantime is
/// left alone rather than killed by a decision made about its predecessor
/// (#116).
fn reuse_or_displace(
    mgr: &ContentServerManager,
    root: &str,
    trusted: bool,
) -> Option<ServerHandle> {
    let existing = mgr.get(root)?;
    match start_decision(&existing, trusted) {
        // A registration is not proof of life (#318). The supervisor polls
        // every two seconds, so a child that crashed since its last tick is
        // still on the books; reusing it hands the caller a port nothing is
        // listening on, and the export/panel then fails against a `Ready`
        // handle. The poll IS the check: an exit deregisters the record and
        // cleans up inside it, and this start falls through to a spawn.
        StartDecision::Reuse => match mgr.poll_current_child(root, existing.generation) {
            ChildState::Running => Some(ServerHandle::for_server(&existing)),
            ChildState::Exited(_) | ChildState::NotCurrent => None,
        },
        StartDecision::RestartForTrust => {
            log::info!(
                "[content-server {root}] trust changed to {trusted}; restarting so the CSP follows"
            );
            if let Some(detached) = mgr.take_if_generation(root, existing.generation) {
                mgr.retain_orphan(root, detached.cleanup(root));
            }
            None
        }
    }
}

/// Resolve the runtime, mint this child's token and spawn. A missing Node or
/// CLI is `not-found`: it is absent from the machine and installing it is the
/// fix — not an internal VMark failure.
///
/// Nothing is deleted here. This used to clear the port file first, "so a
/// stale file from a previous run is not read as this child's port" — which
/// `await_port`'s token check already prevents, and which made this the one
/// place an attempt deleted a record it did not own: a CONCURRENT start's
/// child writes the same path, and clearing it erased that child's readiness
/// record before its own poll could read it (#277, #323). A genuinely stale
/// file is skipped by the token check and overwritten when this child binds.
fn spawn_for(app: &AppHandle, root: &str, trusted: bool) -> Result<Spawned, CommandError> {
    let node = resolve_node().map_err(CommandError::not_found)?;
    let cli = resolve_cli(app).map_err(CommandError::not_found)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let port_file = port_file_path(app, root)?;

    let cli_str = cli.to_string_lossy().to_string();
    let pf_str = port_file.to_string_lossy().to_string();
    let args = server_args(
        cli_str.as_str(),
        root,
        token.as_str(),
        pf_str.as_str(),
        trusted,
    );
    let child = spawn_server(&node, &args, root).map_err(spawn_failure)?;
    Ok(Spawned {
        child,
        token,
        port_file,
    })
}

/// The class of a failed spawn, from the OS's own (#321). Every one of them
/// used to be `internal` — a VMark bug — including the two a user can act on:
/// a `node` that vanished between the resolve and the spawn, and one they are
/// not allowed to execute.
fn spawn_failure(e: std::io::Error) -> CommandError {
    let message = format!("failed to spawn content server: {e}");
    match e.kind() {
        std::io::ErrorKind::NotFound => CommandError::not_found(message),
        std::io::ErrorKind::PermissionDenied => CommandError::permission_denied(message),
        // Anything else is the machine refusing (descriptors, memory, a
        // filesystem error), not a fault in this code.
        _ => CommandError::io(message),
    }
}

/// Poll the port-file for a record carrying THIS child's token — the whole
/// rule, and why it matters, in `port_wait.rs`.
async fn await_port(spawned: &mut Spawned) -> PortWait {
    await_port_of(&spawned.port_file, &spawned.token, &mut spawned.child).await
}

/// The poll budget ran out. A concurrent start for the same workspace may have
/// won the race — its child wrote the port-file with a different token, which
/// our token check skipped. Reuse that server when it enforces the trust asked
/// for; when it enforces the other one it is the wrong server, and this start
/// goes again rather than handing it back (#120). Nobody else running is a
/// timeout, not an internal fault.
fn lost_the_port_file(
    mgr: &ContentServerManager,
    root: &str,
    trusted: bool,
    spawned: Spawned,
) -> Result<StartOutcome, CommandError> {
    let Spawned { child, .. } = spawned;
    mgr.retain_orphan(root, Detached::child_only(child).cleanup(root));
    if let Some(existing) = mgr.get(root) {
        return Ok(match start_decision(&existing, trusted) {
            StartDecision::Reuse => StartOutcome::Ready(ServerHandle::for_server(&existing)),
            StartDecision::RestartForTrust => StartOutcome::RetryForTrust,
        });
    }
    // The port file is deliberately left alone (#323). This attempt timed
    // out, so its child never wrote a record carrying its token: whatever is
    // at that path belongs to a concurrent start, and removing it erased the
    // readiness record that start was still polling for.
    Err(CommandError::timeout(
        "content server did not report a port in time",
    ))
}

#[cfg(test)]
#[path = "start.test.rs"]
mod tests;
