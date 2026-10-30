//! # CLI Install/Uninstall
//!
//! Purpose: Install/uninstall the `vmark` shell command at `/usr/local/bin/vmark`.
//! Uses `osascript` to request admin privileges (same pattern as VS Code's "Install 'code' command").
//!
//! The installed script simply delegates to `open -b app.vmark`, which lets macOS
//! handle single-instance behavior natively via the bundle identifier.
//!
//! Key decisions:
//!   - The administrator shell is given ONE command that carries the script's
//!     content inside it, creates the target, and verifies it (`script.rs`).
//!     No file the user can write is ever read by root.
//!   - Everything except the `osascript` call takes its target and its
//!     privileged runner as arguments (`install_at`), so the whole flow is
//!     tested against a temp directory with `/bin/sh` standing in for root.
//!
//! @coordinates-with cli_install/script.rs — the privileged commands, as text
//! @coordinates-with cli_install/dialog.rs — the menu action and result dialog

use serde::Serialize;
use std::path::Path;

use script::{
    apple_script, install_command, shell_exit_status, uninstall_command, EXIT_MISMATCH,
    EXIT_TARGET_EXISTS,
};

/// Menu-action orchestration + localized result dialog.
pub mod dialog;
mod script;

pub const CLI_PATH: &str = "/usr/local/bin/vmark";

/// Shell script content installed to /usr/local/bin/vmark.
/// Uses bundle ID (`-b app.vmark`) instead of app name for stable targeting
/// even when the .app is renamed or localized.
/// The comment names the menu item that removes it: choosing the item again
/// uninstalls.
const SCRIPT_CONTENT: &str = "#!/bin/bash\n\
# VMark CLI launcher — installed by VMark.app\n\
# Remove via: VMark > Help > Shell Command: Install 'vmark' in PATH… (choose it again)\n\
open -b app.vmark \"$@\"\n";

/// Scripts earlier versions installed. They are still VMark's, so a toggle
/// from a newer version removes them instead of refusing a "foreign" file.
const PREVIOUS_SCRIPT_CONTENTS: &[&str] = &["#!/bin/bash\n\
# VMark CLI launcher — installed by VMark.app\n\
# Toggle via: VMark > Help > Install/Uninstall 'vmark' Command\n\
open -b app.vmark \"$@\"\n"];

/// Whether `content` is a script VMark installed, this version or an earlier one.
fn is_our_script(content: &str) -> bool {
    content == SCRIPT_CONTENT || PREVIOUS_SCRIPT_CONTENTS.contains(&content)
}

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
/// boundary.
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
    Ok(status_at(Path::new(CLI_PATH)))
}

/// [`cli_install_status`] for any target path.
fn status_at(target: &Path) -> CliStatus {
    let path = target.to_string_lossy().into_owned();
    if !target.exists() {
        return CliStatus {
            installed: false,
            path,
            foreign: false,
        };
    }
    let ours = std::fs::read_to_string(target).is_ok_and(|content| is_our_script(&content));
    CliStatus {
        installed: ours,
        path,
        foreign: !ours,
    }
}

/// Run a shell command with administrator privileges via `osascript`.
/// Handles user cancellation and returns structured errors.
///
/// SECURITY INVARIANT (not expressible in code): `shell_cmd` must be
/// app-constructed. The only callers are `cli_install` / `cli_uninstall`
/// (both zero-argument — no frontend/user input reaches them), which get it
/// from `script.rs`: compile-time constants, each wrapped in
/// `shell_single_quote`. Never pass user-controlled input to this function.
fn run_admin_shell(shell_cmd: &str) -> Result<(), CliInstallError> {
    let output = crate::ai_provider::build_command("/usr/bin/osascript", &[])
        .arg("-e")
        .arg(apple_script(shell_cmd, true))
        .output()
        .map_err(|e| CliInstallError::Failed(format!("Failed to run osascript: {}", e)))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(classify_failure(&String::from_utf8_lossy(&output.stderr)))
    }
}

/// Turn the stderr of a failed `osascript` run into the error to report: the
/// user closing the password dialog, one of the install command's own
/// refusals (by its exit status), or whatever else went wrong, verbatim.
fn classify_failure(stderr: &str) -> CliInstallError {
    if stderr.contains("User canceled") || stderr.contains("-128") {
        return CliInstallError::Cancelled;
    }
    match shell_exit_status(stderr) {
        Some(EXIT_TARGET_EXISTS) => CliInstallError::ForeignFile,
        Some(EXIT_MISMATCH) => {
            CliInstallError::Failed(rust_i18n::t!("errors.cli.mismatch").to_string())
        }
        _ => CliInstallError::Failed(stderr.trim().to_string()),
    }
}

/// Install the `vmark` command using `osascript` for admin privileges.
pub fn cli_install() -> Result<CliCommandOutcome, String> {
    install_at(Path::new(CLI_PATH), &run_admin_shell)
}

/// [`cli_install`] with the target and the privileged runner injected.
///
/// The privileged shell writes the script from a literal inside the command,
/// refuses a target that already exists, and removes what it wrote if it does
/// not verify (`script::install_command`). The result is then checked once
/// more from here, outside that shell.
fn install_at(
    target: &Path,
    run_admin: &dyn Fn(&str) -> Result<(), CliInstallError>,
) -> Result<CliCommandOutcome, String> {
    let status = status_at(target);
    if status.foreign {
        return Err(CliInstallError::ForeignFile.into());
    }
    if status.installed {
        return Ok(CliCommandOutcome::AlreadyInstalled);
    }
    let (Some(parent), Some(path)) = (target.parent().and_then(Path::to_str), target.to_str())
    else {
        return Err(format!("{} is not a usable install path", target.display()));
    };

    run_admin(&install_command(SCRIPT_CONTENT, parent, path)).map_err(String::from)?;
    verify_installed(target, run_admin)
}

/// Confirm that `target` is a regular file holding exactly the script. If it
/// is anything else, it is REMOVED before the failure is reported — an
/// unverified file must not stay on the user's PATH. Removal is tried
/// unprivileged first (enough whenever something other than root could have
/// replaced the file), then through the privileged runner.
fn verify_installed(
    target: &Path,
    run_admin: &dyn Fn(&str) -> Result<(), CliInstallError>,
) -> Result<CliCommandOutcome, String> {
    let Ok(metadata) = std::fs::symlink_metadata(target) else {
        return Err(rust_i18n::t!("errors.cli.noFile").to_string());
    };
    let matches = metadata.file_type().is_file()
        && std::fs::read_to_string(target).is_ok_and(|actual| actual == SCRIPT_CONTENT);
    if matches {
        return Ok(CliCommandOutcome::Installed);
    }

    log::error!(
        "[cli_install] {:?} is not the script that was installed; removing it",
        target
    );
    let removed = std::fs::remove_file(target).is_ok()
        || target
            .to_str()
            .is_some_and(|path| run_admin(&uninstall_command(path)).is_ok());
    if removed && std::fs::symlink_metadata(target).is_err() {
        Err(rust_i18n::t!("errors.cli.mismatch").to_string())
    } else {
        Err(rust_i18n::t!("errors.cli.mismatchNotRemoved", path = target.display()).to_string())
    }
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

    run_admin_shell(&uninstall_command(CLI_PATH)).map_err(String::from)?;

    Ok(CliCommandOutcome::Removed)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "install_flow.test.rs"]
mod install_flow_tests;
