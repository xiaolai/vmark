//! The login shell's `$PATH`, for finding and launching user-installed tools.
//!
//! macOS/Linux app bundles launched from Finder/Dock (or some Linux desktop
//! environments) inherit a minimal PATH, so VMark asks the user's interactive
//! login shell for the real one. `-li` sources both profile and rc files
//! (needed for nvm, fnm, pyenv, etc.); markers isolate PATH from startup noise.
//! On fish, `$PATH` is a list, so it is joined with `string join`.
//!
//! The answer is cached, because pandoc, the terminal and every AI call read
//! it. A failed probe is cached too, as the inherited PATH, so a broken shell
//! costs one bounded wait instead of one per reader. Two things keep that from
//! being permanent and silent:
//!
//! - An explicit Detect re-runs the probe ([`refresh_login_shell_path`]).
//! - The failure stays readable ([`login_path_fallback`]), so Settings can tell
//!   "not installed" from "VMark could not read your PATH".

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::command;

use super::capture::{capture_stdout_detailed, CaptureFailure};
use super::spawn::{build_command, parse_sentinel, windows_profile_path};
use crate::command_error::CommandError;

const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Why the login shell gave no usable PATH. The frontend words each one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProbeReason {
    /// The shell could not be started.
    Spawn,
    /// The shell exited with an error.
    Exit,
    /// The shell was still running, or still holding stdout, at the bound.
    Timeout,
    /// The shell gave no usable PATH: none printed, or too much output to read.
    NoPath,
}

impl From<CaptureFailure> for ProbeReason {
    fn from(failure: CaptureFailure) -> Self {
        match failure {
            CaptureFailure::Spawn => Self::Spawn,
            CaptureFailure::Exit => Self::Exit,
            CaptureFailure::Timeout => Self::Timeout,
            CaptureFailure::TooMuchOutput => Self::NoPath,
        }
    }
}

/// A probe that produced no PATH. `shell` is a file name, never a full path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeFailure {
    shell: String,
    reason: ProbeReason,
}

/// The state Settings reports: the shell was not readable, so `path` (inherited
/// from whatever launched VMark) is what tools are being searched on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LoginPathFallback {
    shell: String,
    reason: ProbeReason,
    path: String,
}

#[derive(Debug)]
enum Resolved {
    Probed(String),
    Fallback(LoginPathFallback),
}

impl Resolved {
    fn fall_back(failure: ProbeFailure, inherited: impl FnOnce() -> String) -> Self {
        // The file name and reason only: a PATH can name private directories.
        log::warn!(
            "[VMark] login shell PATH unavailable ({}: {:?}); using the inherited PATH",
            failure.shell,
            failure.reason
        );
        Self::Fallback(LoginPathFallback {
            shell: failure.shell,
            reason: failure.reason,
            path: inherited(),
        })
    }

    fn path(&self) -> &str {
        match self {
            Self::Probed(path) => path,
            Self::Fallback(fallback) => &fallback.path,
        }
    }
}

/// The resolved PATH. Generic over its probe so that every transition is
/// testable without running a shell or touching the process-wide instance. The
/// second lock lets one probe run at a time, first read and refresh alike, so
/// the last to start is the last to commit and an older, slower probe cannot
/// overwrite a newer answer. It is never held by a reader of a resolved PATH.
struct PathCache(Mutex<Option<Resolved>>, Mutex<()>);

impl PathCache {
    const fn new() -> Self {
        Self(Mutex::new(None), Mutex::new(()))
    }

    /// Recovers from poison: every write replaces the value whole, so a panic
    /// cannot leave it torn.
    fn slot(&self) -> MutexGuard<'_, Option<Resolved>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Recovers from poison: it guards no data, only whose turn it is.
    fn probe_turn(&self) -> MutexGuard<'_, ()> {
        self.1.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn resolved_path(&self) -> Option<String> {
        self.slot().as_ref().map(|r| r.path().to_string())
    }

    /// The cached PATH, probing only if nothing has been resolved. Concurrent
    /// first readers share one probe: each one that waited finds the answer.
    fn current(
        &self,
        probe: impl FnOnce() -> Result<String, ProbeFailure>,
        inherited: impl FnOnce() -> String,
    ) -> String {
        if let Some(path) = self.resolved_path() {
            return path;
        }
        let _turn = self.probe_turn();
        if let Some(path) = self.resolved_path() {
            return path;
        }
        let resolved = match probe() {
            Ok(path) => Resolved::Probed(path),
            Err(failure) => Resolved::fall_back(failure, inherited),
        };
        self.slot().insert(resolved).path().to_string()
    }

    /// Probe again and keep the better answer: a success always replaces, and a
    /// failure never overwrites a PATH that once worked.
    fn refresh(
        &self,
        probe: impl FnOnce() -> Result<String, ProbeFailure>,
        inherited: impl FnOnce() -> String,
    ) {
        let _turn = self.probe_turn();
        let outcome = probe();
        let mut slot = self.slot();
        *slot = match outcome {
            Ok(path) => Some(Resolved::Probed(path)),
            Err(failure) if matches!(*slot, Some(Resolved::Probed(_))) => {
                log::warn!(
                    "[VMark] login shell PATH retry failed ({}: {:?}); keeping the last good PATH",
                    failure.shell,
                    failure.reason
                );
                return;
            }
            Err(failure) => Some(Resolved::fall_back(failure, inherited)),
        };
    }

    fn fallback(&self) -> Option<LoginPathFallback> {
        match self.slot().as_ref()? {
            Resolved::Fallback(fallback) => Some(fallback.clone()),
            Resolved::Probed(_) => None,
        }
    }
}

/// Process-wide because its readers are plain helpers that take no `AppHandle`
/// to reach managed state through (such as `pandoc` detection).
static LOGIN_PATH: PathCache = PathCache::new();

fn inherited_path() -> String {
    std::env::var("PATH").unwrap_or_default()
}

/// The display name of a shell: its file name, never its full path.
fn shell_label(shell: &str) -> String {
    std::path::Path::new(shell)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Run `<shell> -lic <cmd>` with a 5 s bound via the shared process-capture
/// helper, which documents the pipe-drain and timeout semantics. Shared by the
/// PATH probe and `query_login_shell_zdotdir`.
pub(super) fn run_login_shell_capture(shell: &str, cmd: &str) -> Result<String, CaptureFailure> {
    capture_stdout_detailed(
        build_command(shell, &["-lic", cmd]),
        PROBE_TIMEOUT,
        "login shell capture",
    )
}

/// Ask `shell` for its PATH. An empty answer counts as a failure: it would find
/// nothing, so it must not replace a PATH that works.
fn probe_unix_shell(shell: &str) -> Result<String, ProbeFailure> {
    const START: &str = "__VMARK_PATH_START__";
    const END: &str = "__VMARK_PATH_END__";

    let cmd = if shell.ends_with("/fish") {
        format!("echo {START}(string join : $PATH){END}")
    } else {
        format!("echo {START}${{PATH}}{END}")
    };
    let failed = |reason| ProbeFailure {
        shell: shell_label(shell),
        reason,
    };
    let raw = run_login_shell_capture(shell, &cmd).map_err(|f| failed(f.into()))?;
    parse_sentinel(&raw, START, END)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| failed(ProbeReason::NoPath))
}

/// The reason to report for Windows, whose probe tries two shells: the last
/// one's capture failure, or `None` when it ran without printing a PATH.
fn windows_reason(last_failure: Option<CaptureFailure>) -> ProbeReason {
    last_failure.map_or(ProbeReason::NoPath, ProbeReason::from)
}

/// The probe for this platform. On Windows, tools installed via npm/pnpm/scoop
/// may add paths in the PowerShell `$PROFILE` that are not in the base PATH.
fn probe_login_path() -> Result<String, ProbeFailure> {
    if cfg!(target_os = "windows") {
        return windows_profile_path().map_err(|last_failure| ProbeFailure {
            shell: "PowerShell".to_string(),
            reason: windows_reason(last_failure),
        });
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    probe_unix_shell(&shell)
}

/// The user's full login-shell `$PATH`, or the inherited one if the shell could
/// not be read. Cached until an explicit Detect refreshes it.
pub(crate) fn login_shell_path() -> String {
    LOGIN_PATH.current(probe_login_path, inherited_path)
}

/// Read the login shell's PATH again. Blocks on the shell for up to its bound,
/// so call it off the IPC thread.
pub(super) fn refresh_login_shell_path() {
    LOGIN_PATH.refresh(probe_login_path, inherited_path);
}

/// The fallback in effect, or `None` when the login shell's PATH was read (or
/// has not been read yet). Never waits on a probe.
#[command]
pub async fn login_path_fallback() -> Result<Option<LoginPathFallback>, CommandError> {
    Ok(LOGIN_PATH.fallback())
}

#[cfg(test)]
#[path = "login_path.test.rs"]
mod tests;
