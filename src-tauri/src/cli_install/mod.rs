//! # CLI Install/Uninstall
//!
//! Purpose: Install/uninstall the `vmark` shell command at `/usr/local/bin/vmark`.
//! Uses `osascript` to request admin privileges (same pattern as VS Code's "Install 'code' command").
//!
//! The installed script simply delegates to `open -b app.vmark`, which lets macOS
//! handle single-instance behavior natively via the bundle identifier.

use serde::Serialize;
use std::path::Path;

/// Menu-action orchestration + localized result dialog (audit 20260612).
pub mod dialog;

pub const CLI_PATH: &str = "/usr/local/bin/vmark";

/// Shell script content installed to /usr/local/bin/vmark.
/// Uses bundle ID (`-b app.vmark`) instead of app name for stable targeting
/// even when the .app is renamed or localized.
const SCRIPT_CONTENT: &str = "#!/bin/bash\n\
# VMark CLI launcher — installed by VMark.app\n\
# Toggle via: VMark > Help > Install/Uninstall 'vmark' Command\n\
open -b app.vmark \"$@\"\n";

/// Structured error variants for CLI install operations.
/// Avoids brittle string matching between module boundaries.
#[derive(Debug, Clone, PartialEq)]
pub enum CliInstallError {
    Cancelled,
    ForeignFile,
    Failed(String),
}

impl std::fmt::Display for CliInstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "Operation cancelled."),
            Self::ForeignFile => write!(
                f,
                "{} already exists and was not installed by VMark. \
                 Please remove it manually.",
                CLI_PATH
            ),
            Self::Failed(msg) => write!(f, "{}", msg),
        }
    }
}

impl From<CliInstallError> for String {
    fn from(e: CliInstallError) -> String {
        e.to_string()
    }
}

/// Structured success outcome so the caller localizes the dialog text
/// instead of string-matching English Ok messages across the module
/// boundary (audit 20260612 deferred i18n).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliCommandOutcome {
    Installed,
    AlreadyInstalled,
    Removed,
    NotInstalled,
}

/// Status of the `/usr/local/bin/vmark` shell command installation.
#[derive(Serialize)]
pub struct CliStatus {
    pub installed: bool,
    pub path: String,
    /// true when the file exists but wasn't installed by VMark
    pub foreign: bool,
}

/// Check whether `/usr/local/bin/vmark` exists and was installed by VMark.
/// Uses exact content comparison (not substring match) for ownership detection.
pub fn cli_install_status() -> Result<CliStatus, String> {
    let path = Path::new(CLI_PATH);
    if !path.exists() {
        return Ok(CliStatus {
            installed: false,
            path: CLI_PATH.to_string(),
            foreign: false,
        });
    }
    let content = std::fs::read_to_string(path).unwrap_or_default();
    let ours = content == SCRIPT_CONTENT;
    Ok(CliStatus {
        installed: ours,
        path: CLI_PATH.to_string(),
        foreign: !ours,
    })
}

/// POSIX-safe single-quote wrap. Escapes embedded single quotes via the
/// `'\''` close-escape-open idiom, then wraps in single quotes. The result
/// is safe to interpolate into a `/bin/sh` command line because single-
/// quoted strings disable every metacharacter except `'`.
///
/// Load-bearing: `tmp_path` in `cli_install` is derived from `TMPDIR`,
/// which a terminal-launched VMark inherits from the user's shell. Without
/// quoting, a `TMPDIR` containing `;`, `$()`, backticks, or whitespace
/// would inject arbitrary commands into the `osascript with administrator
/// privileges` call — local privilege escalation to root.
fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Run a shell command with administrator privileges via `osascript`.
/// Handles user cancellation and returns structured errors.
///
/// SECURITY INVARIANT (not expressible in code): `shell_cmd` must be
/// app-constructed. The only callers are `cli_install` / `cli_uninstall`
/// (both zero-argument — no frontend/user input reaches them), which build
/// the command from compile-time constants plus paths wrapped in
/// `shell_single_quote`. The only externally-influenced operand is the temp
/// path derived from `TMPDIR` via `std::env::temp_dir()`, and it is
/// single-quoted before interpolation. The `replace` calls below escape only
/// for AppleScript string embedding — they are NOT a shell-injection
/// defense. Never pass user-controlled input to this function.
fn run_admin_shell(shell_cmd: &str) -> Result<(), CliInstallError> {
    let apple_script = format!(
        "do shell script \"{}\" with administrator privileges",
        shell_cmd.replace('\\', "\\\\").replace('"', "\\\"")
    );

    let output = std::process::Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&apple_script)
        .output()
        .map_err(|e| CliInstallError::Failed(format!("Failed to run osascript: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("-128") {
            return Err(CliInstallError::Cancelled);
        }
        return Err(CliInstallError::Failed(stderr.trim().to_string()));
    }

    Ok(())
}

/// Derive the parent directory from CLI_PATH (single source of truth).
fn cli_parent_dir() -> &'static str {
    // CLI_PATH is a compile-time constant; parent is always /usr/local/bin
    Path::new(CLI_PATH)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("/usr/local/bin")
}

/// Install the `vmark` command using `osascript` for admin privileges.
///
/// Writes script to a temp file first, then uses a single privileged shell command
/// to create the target directory, move the file, and set permissions. This avoids
/// shell quoting issues entirely — the temp file is written by Rust, not by shell.
pub fn cli_install() -> Result<CliCommandOutcome, String> {
    let status = cli_install_status()?;
    if status.foreign {
        return Err(CliInstallError::ForeignFile.into());
    }
    if status.installed {
        return Ok(CliCommandOutcome::AlreadyInstalled);
    }

    // Write script to a temp file (no quoting needed — Rust handles the write)
    let tmp = std::env::temp_dir().join("vmark-cli-install.tmp");
    std::fs::write(&tmp, SCRIPT_CONTENT)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // POSIX-quote every path interpolated into the privileged shell call.
    // `parent` and `CLI_PATH` are compile-time constants today (/usr/local/bin
    // and /usr/local/bin/vmark) and don't contain metacharacters, but quoting
    // them as well future-proofs the code if either is ever made configurable.
    let tmp_path_q = shell_single_quote(&tmp.to_string_lossy());
    let parent_q = shell_single_quote(cli_parent_dir());
    let cli_path_q = shell_single_quote(CLI_PATH);
    let shell_cmd = format!(
        "mkdir -p {} && mv {} {} && chmod 755 {}",
        parent_q, tmp_path_q, cli_path_q, cli_path_q
    );

    if let Err(e) = run_admin_shell(&shell_cmd) {
        // Clean up temp file on failure
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }

    // Verify: check file exists, is a regular file, and has expected content
    let path = Path::new(CLI_PATH);
    if !path.is_file() {
        return Err(rust_i18n::t!("errors.cli.noFile").to_string());
    }
    let actual = std::fs::read_to_string(path).unwrap_or_default();
    if actual != SCRIPT_CONTENT {
        return Err(rust_i18n::t!("errors.cli.mismatch").to_string());
    }

    Ok(CliCommandOutcome::Installed)
}

/// Uninstall the `vmark` command using `osascript` for admin privileges.
pub fn cli_uninstall() -> Result<CliCommandOutcome, String> {
    let status = cli_install_status()?;
    if !status.installed {
        if status.foreign {
            return Err(CliInstallError::ForeignFile.into());
        }
        return Ok(CliCommandOutcome::NotInstalled);
    }

    let shell_cmd = format!("rm {}", shell_single_quote(CLI_PATH));
    run_admin_shell(&shell_cmd).map_err(String::from)?;

    Ok(CliCommandOutcome::Removed)
}

#[cfg(test)]
mod tests;
