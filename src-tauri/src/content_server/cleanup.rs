//! Teardown of a content-server child that has LEFT the registry.
//!
//! Purpose: the manager decides under its mutex and detaches records; the
//! killing, reaping and port-file removal happen here, after the lock is
//! released. Holding the registry lock across `Child::wait` let one slow reap
//! block status, stop, start and every supervisor poll for every workspace
//! (audit 20260907 #121). Failures are LOGGED, never discarded (#114): a child
//! that could not be killed is a process the user cannot see, and a port file
//! that could not be removed is a stale destination the next start reads.
//!
//! Every teardown — a registration loser, shutdown, a poll failure, a failed
//! start, an explicit stop — is this ONE path (#123). Each hands back a
//! `CleanupOutcome`: the best-effort paths log and move on; the explicit stop
//! refuses to report success over it.
//!
//! A refused kill is never followed by a blocking wait (#122). On a child this
//! process spawned and has not reaped, `Child::kill` is `libc::kill(pid,
//! SIGKILL)` on Unix and `TerminateProcess` on Windows, and std answers `Ok`
//! itself once the child has exited — so a refusal means the signal was NOT
//! delivered (EPERM for a child that changed its uid; a handle the OS no
//! longer honours). `Child::wait` after that is `waitpid(pid, 0)` /
//! `WaitForSingleObject(INFINITE)`: it returns when the child exits, which
//! nothing has now asked it to do. A refusal is therefore followed by
//! `try_wait`, which answers at once: exited means reap it (the refusal was
//! moot); running means report it AND hand the handle back, so the manager
//! keeps ownership of a process it could not stop
//! (`ContentServerManager::retain_orphan`) and tries once more at quit.
//!
//! The handle is dropped ONLY when the OS has proved the pid is no longer
//! this process's child (#122): `waitpid` answering `ECHILD` means the child
//! was reaped elsewhere, and its pid may already belong to another process
//! — a kill through the handle could then reach that one. Any other reap
//! failure leaves the process ours and its state unknown, and the handle is
//! kept for the retry at quit like a refused kill's; on Windows an open
//! handle pins the process object, so a retry through it can reach nothing
//! but this child.
//!
//! @coordinates-with manager.rs — produces `Detached` records; keeps orphans
//! @coordinates-with commands.rs — surfaces the outcome from `content_server_stop`
//! @coordinates-with start.rs — cleans up a failed start's child and port file
//! @module content_server/cleanup

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus};

/// A record removed from the manager: whatever still needs terminating.
pub struct Detached {
    pub child: Option<Child>,
    pub port_file: Option<PathBuf>,
}

/// Why a child is not confirmed dead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChildFailure {
    /// The kill was refused and the child is still running: nothing has told
    /// it to stop. Its handle travels in `CleanupOutcome::orphan`.
    StillRunning { pid: u32, reason: String },
    /// The child could not be reaped and its state is unknown, but the OS
    /// did not say it is no longer ours: the handle still names this child
    /// and travels in `CleanupOutcome::orphan` for the retry at quit.
    NotReaped { pid: u32, detail: String },
    /// `waitpid` answered `ECHILD`: the child was reaped elsewhere and is no
    /// longer this process's. Its exit status is lost, and its pid may
    /// already belong to another process, so the handle is dropped — a kill
    /// through it could reach that one.
    Lost(String),
}

impl ChildFailure {
    /// Whether the handle still names this child and is worth keeping for
    /// the retry at quit (`CleanupOutcome::orphan`).
    pub fn retains_handle(&self) -> bool {
        !matches!(self, ChildFailure::Lost(_))
    }
}

impl fmt::Display for ChildFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChildFailure::StillRunning { pid, reason } => {
                write!(
                    f,
                    "child is still running (pid {pid}; kill refused: {reason})"
                )
            }
            ChildFailure::NotReaped { pid, detail } => {
                write!(f, "child could not be reaped (pid {pid}): {detail}")
            }
            ChildFailure::Lost(e) => write!(
                f,
                "child could not be reaped and is no longer this process's: {e}"
            ),
        }
    }
}

/// What a teardown could NOT do. Every step is attempted regardless — one
/// refusal must not hide the other — and each failure is logged where it
/// happens, so a caller that drops this value has still reported it. The
/// value exists for the caller that must not swallow it: the frontend treats
/// a failed explicit stop as "the child may be alive", never as stopped.
#[derive(Debug, Default)]
pub struct CleanupOutcome {
    /// The child is not confirmed dead.
    pub child: Option<ChildFailure>,
    /// The port file is still on disk; the next start reads a stale destination.
    pub port_file: Option<String>,
    /// The handle of a child whose failure `retains_handle` — ownership the
    /// caller hands to the manager (`retain_orphan`) rather than dropping.
    pub orphan: Option<Child>,
}

impl CleanupOutcome {
    /// Nothing was left behind: no failure to report AND no handle still held.
    ///
    /// The orphan clause is not redundant (#270). Every value this module
    /// PRODUCES satisfies `orphan.is_some() ⇒ child.is_some()`, but the fields
    /// are `pub` — and `content_server_stop` reports success on `is_clean`, so
    /// a value assembled elsewhere could hand the frontend a "stopped" for a
    /// process this app still owns. Reading the handle too makes the invariant
    /// enforced rather than merely true.
    pub fn is_clean(&self) -> bool {
        self.child.is_none() && self.port_file.is_none() && self.orphan.is_none()
    }

    /// Take the still-running child's handle, leaving its report in place.
    pub fn take_orphan(&mut self) -> Option<Child> {
        self.orphan.take()
    }
}

impl fmt::Display for CleanupOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (&self.child, &self.port_file) {
            (None, None) => f.write_str("clean"),
            (Some(child), None) => write!(f, "{child}"),
            (None, Some(pf)) => write!(f, "port file could not be removed: {pf}"),
            (Some(child), Some(pf)) => {
                write!(f, "{child}; port file could not be removed: {pf}")
            }
        }
    }
}

impl Detached {
    /// A child with no port file of its own — a registration loser, whose
    /// port file belongs to the winner.
    pub fn child_only(child: Child) -> Self {
        Self {
            child: Some(child),
            port_file: None,
        }
    }

    /// A port file with no child — a start whose child the manager already
    /// killed, or a stale file left by a previous run.
    pub fn port_file_only(port_file: PathBuf) -> Self {
        Self {
            child: None,
            port_file: Some(port_file),
        }
    }

    /// Kill + reap the child, then remove the port file. Each step logs its
    /// own failure and the next still runs, so one refusal cannot hide the
    /// other; the outcome names whatever was left behind, and carries the
    /// handle of a child that is not proven gone.
    pub fn cleanup(self, root: &str) -> CleanupOutcome {
        let (child, orphan) = match self.child {
            None => (None, None),
            Some(mut child) => {
                let result = terminate(root, &mut child);
                keep_or_drop(child, result)
            }
        };
        CleanupOutcome {
            child,
            port_file: self
                .port_file
                .and_then(|pf| remove_port_file(root, &pf).err()),
            orphan,
        }
    }
}

/// What becomes of the handle after `terminate`: kept as the orphan for
/// every failure that leaves the process ours, dropped only for a `Lost`
/// one. Generic so the rule is pinned without a child that can be made to
/// fail.
fn keep_or_drop<C>(
    child: C,
    result: Result<(), ChildFailure>,
) -> (Option<ChildFailure>, Option<C>) {
    match result {
        Ok(()) => (None, None),
        Err(failure) if failure.retains_handle() => (Some(failure), Some(child)),
        Err(failure) => (Some(failure), None),
    }
}

/// The calls `terminate` makes on a child, so its decision — when to wait
/// and when not to — is pinned by a test with a child that refuses; a real
/// same-uid child never does (see the module doc).
pub(super) trait Terminable {
    fn id(&self) -> u32;
    fn kill(&mut self) -> io::Result<()>;
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>>;
    fn wait(&mut self) -> io::Result<ExitStatus>;
}

impl Terminable for Child {
    fn id(&self) -> u32 {
        Child::id(self)
    }
    fn kill(&mut self) -> io::Result<()> {
        Child::kill(self)
    }
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        Child::try_wait(self)
    }
    fn wait(&mut self) -> io::Result<ExitStatus> {
        Child::wait(self)
    }
}

/// Kill and reap `child`. A delivered kill — or one std answers `Ok` for
/// because the child had already exited — is followed by the reap, which is
/// prompt. A REFUSED kill is followed by a non-blocking poll instead: a wait
/// would last as long as a child nobody has stopped chooses to run (#122).
/// What is reported is whether the process was REAPED, and — when it was
/// not — whether the handle still names it.
pub(super) fn terminate<C: Terminable>(root: &str, child: &mut C) -> Result<(), ChildFailure> {
    let pid = child.id();
    let reaped = match child.kill() {
        Ok(()) => child.wait().map_err(|e| not_reaped(pid, e.to_string(), &e)),
        Err(refusal) => match child.try_wait() {
            Ok(Some(status)) => Ok(status),
            Ok(None) => Err(ChildFailure::StillRunning {
                pid,
                reason: refusal.to_string(),
            }),
            Err(e) => Err(not_reaped(pid, format!("{e} (kill: {refusal})"), &e)),
        },
    };
    match reaped {
        Ok(status) => {
            log::debug!("[content-server {root}] child reaped ({status})");
            Ok(())
        }
        Err(failure) => {
            log::warn!("[content-server {root}] {failure}");
            Err(failure)
        }
    }
}

/// A reap that failed with `error`: `Lost` when the OS proved the pid is no
/// longer this process's child, `NotReaped` — handle kept — otherwise.
fn not_reaped(pid: u32, detail: String, error: &io::Error) -> ChildFailure {
    if no_longer_our_child(error) {
        ChildFailure::Lost(detail)
    } else {
        ChildFailure::NotReaped { pid, detail }
    }
}

/// `waitpid` answering `ECHILD` is the one proof that a pid has left this
/// process (#122). Nothing else is: on Windows an open handle pins the
/// process object, so the pid under it cannot be recycled and a retry
/// through it can only ever reach this child.
#[cfg(unix)]
fn no_longer_our_child(error: &io::Error) -> bool {
    error.raw_os_error() == Some(libc::ECHILD)
}

#[cfg(not(unix))]
fn no_longer_our_child(_error: &io::Error) -> bool {
    false
}

/// Remove a port file; an already-absent file is the expected steady state.
fn remove_port_file(root: &str, path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => {
            log::warn!(
                "[content-server {root}] could not remove port file {}: {e}",
                path.display()
            );
            Err(format!("{}: {e}", path.display()))
        }
    }
}

#[cfg(test)]
#[path = "cleanup.test.rs"]
mod tests;
