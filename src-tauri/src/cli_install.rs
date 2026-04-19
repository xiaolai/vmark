//! # CLI Install/Uninstall
//!
//! Purpose: Install/uninstall the `vmark` shell command at `/usr/local/bin/vmark`.
//! Uses `osascript` to request admin privileges (same pattern as VS Code's "Install 'code' command").
//!
//! The installed script simply delegates to `open -b app.vmark`, which lets macOS
//! handle single-instance behavior natively via the bundle identifier.

use serde::Serialize;
use std::path::Path;

const CLI_PATH: &str = "/usr/local/bin/vmark";

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
#[tauri::command]
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

/// Run a shell command with administrator privileges via `osascript`.
/// Handles user cancellation and returns structured errors.
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
#[tauri::command]
pub fn cli_install() -> Result<String, String> {
    let status = cli_install_status()?;
    if status.foreign {
        return Err(CliInstallError::ForeignFile.into());
    }
    if status.installed {
        return Ok(format!("'vmark' command is already installed at {}", CLI_PATH));
    }

    // Write script to a temp file (no quoting needed — Rust handles the write)
    let tmp = std::env::temp_dir().join("vmark-cli-install.tmp");
    std::fs::write(&tmp, SCRIPT_CONTENT)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    let tmp_path = tmp.to_string_lossy();
    let parent = cli_parent_dir();
    let shell_cmd = format!(
        "mkdir -p {} && mv {} {} && chmod 755 {}",
        parent, tmp_path, CLI_PATH, CLI_PATH
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

    Ok(format!("'vmark' command installed at {}", CLI_PATH))
}

/// Uninstall the `vmark` command using `osascript` for admin privileges.
#[tauri::command]
pub fn cli_uninstall() -> Result<String, String> {
    let status = cli_install_status()?;
    if !status.installed {
        if status.foreign {
            return Err(CliInstallError::ForeignFile.into());
        }
        return Ok("'vmark' command is not installed.".to_string());
    }

    let shell_cmd = format!("rm {}", CLI_PATH);
    run_admin_shell(&shell_cmd).map_err(String::from)?;

    Ok(format!("'vmark' command removed from {}", CLI_PATH))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_content_is_valid_bash() {
        assert!(SCRIPT_CONTENT.starts_with("#!/bin/bash\n"));
        assert!(SCRIPT_CONTENT.ends_with('\n'));
        assert!(SCRIPT_CONTENT.contains("open -b app.vmark"));
    }

    #[test]
    fn cli_parent_dir_derived_from_cli_path() {
        assert_eq!(cli_parent_dir(), "/usr/local/bin");
    }

    #[test]
    fn error_display_cancelled() {
        assert_eq!(CliInstallError::Cancelled.to_string(), "Operation cancelled.");
    }

    #[test]
    fn error_display_foreign() {
        let msg = CliInstallError::ForeignFile.to_string();
        assert!(msg.contains(CLI_PATH));
        assert!(msg.contains("not installed by VMark"));
    }

    #[test]
    fn error_display_failed() {
        let msg = CliInstallError::Failed("boom".to_string()).to_string();
        assert_eq!(msg, "boom");
    }

    #[test]
    fn error_into_string() {
        let s: String = CliInstallError::Cancelled.into();
        assert_eq!(s, "Operation cancelled.");
    }

    #[test]
    fn status_not_installed_when_path_missing() {
        // /usr/local/bin/vmark likely doesn't exist in CI/test environments
        // This test is environment-dependent but safe to run
        let status = cli_install_status();
        assert!(status.is_ok());
        // We can't assert installed/foreign since the file may or may not exist
    }
}
