//! Pandoc export commands.
//!
//! Purpose: Detect Pandoc installation and export markdown via Pandoc CLI.
//! Uses stdin piping to avoid temp files. Runs blocking I/O on a dedicated
//! thread with a timeout to avoid stalling the async runtime.
//!
//! @coordinates-with pandoc/run.rs — run_pandoc() blocking subprocess execution
//! @coordinates-with ai_provider/spawn.rs — build_command() for cross-platform spawn
//! @coordinates-with ai_provider/detection.rs — login_shell_path(), which_command() for PATH resolution

use std::time::Duration;
use tauri::command;

use crate::ai_provider::{
    build_command, capture_stdout_with_timeout, login_shell_path, which_command,
};

/// Allowed output extensions (strict allowlist).
pub(crate) const ALLOWED_EXTENSIONS: &[&str] = &["docx", "epub", "tex", "odt", "rtf", "txt"];

/// Maximum time to wait for Pandoc to finish (2 minutes).
const PANDOC_TIMEOUT: Duration = Duration::from_secs(120);

/// Maximum time to wait for `pandoc --version` during detection. Detection is
/// a lightweight probe; a wedged binary must not hang the command forever.
const PANDOC_DETECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Validate that a file extension is in the allowed set.
///
/// Extracts the extension from the given path, lowercases it, and checks
/// against `ALLOWED_EXTENSIONS`. Returns `Ok(())` on success or an error
/// message describing the unsupported format.
pub(crate) fn validate_extension(output_path: &str) -> Result<(), String> {
    let ext = std::path::Path::new(output_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(format!(
            "Unsupported format '.{}'. Supported: {}",
            ext,
            ALLOWED_EXTENSIONS.join(", ")
        ))
    }
}

/// Build the Pandoc CLI argument list as owned strings.
///
/// Returns the base args (`-f markdown -o <path> --standalone`) plus an
/// optional `--resource-path=<dir>` when `source_dir` is provided.
pub(crate) fn build_pandoc_args(output_path: &str, source_dir: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "-f".to_string(),
        "markdown".to_string(),
        "-o".to_string(),
        output_path.to_string(),
        "--standalone".to_string(),
    ];

    if let Some(dir) = source_dir {
        args.push(format!("--resource-path={}", dir));
    }

    args
}

/// Pandoc detection result: availability, absolute path, and version string.
#[derive(serde::Serialize)]
pub struct PandocInfo {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Detect whether Pandoc is installed and return its absolute path + version.
///
/// `async` + `spawn_blocking` because detection spawns subprocesses
/// (`which pandoc`, `pandoc --version`) — a sync command would run them on
/// the main thread and beachball the UI.
#[command]
pub async fn detect_pandoc() -> PandocInfo {
    tokio::task::spawn_blocking(detect_pandoc_blocking)
        .await
        .unwrap_or_else(|e| {
            log::warn!("[pandoc] detection task failed: {e}");
            PandocInfo {
                available: false,
                path: None,
                version: None,
            }
        })
}

/// Blocking body of `detect_pandoc` (runs on the blocking thread pool).
fn detect_pandoc_blocking() -> PandocInfo {
    let path = match resolve_pandoc_path() {
        Some(p) => p,
        None => {
            return PandocInfo {
                available: false,
                path: None,
                version: None,
            }
        }
    };

    let mut version_cmd = build_command(&path, &["--version"]);
    version_cmd.env("PATH", login_shell_path());
    let version =
        capture_stdout_with_timeout(version_cmd, PANDOC_DETECT_TIMEOUT, "pandoc --version")
            .and_then(|raw| {
                // First line is "pandoc 3.1.2" or similar
                raw.lines()
                    .next()
                    .and_then(|line| line.strip_prefix("pandoc "))
                    .map(|v| v.trim().to_string())
            });

    PandocInfo {
        available: true,
        path: Some(path),
        version,
    }
}

/// Export markdown content via Pandoc.
///
/// Pipes markdown through stdin to avoid temp files.
/// Output format is inferred from the output file extension by Pandoc.
/// Runs on a blocking thread with a timeout to avoid stalling the async runtime.
#[command]
pub async fn export_via_pandoc(
    markdown: String,
    output_path: String,
    source_dir: Option<String>,
) -> Result<(), String> {
    // Validate extension against strict allowlist
    validate_extension(&output_path)?;

    // Reject path traversal in output path
    if output_path.contains("..") {
        return Err(rust_i18n::t!("errors.pandoc.pathTraversal").to_string());
    }

    // Validate source_dir if provided (reject traversal, verify it exists and is a directory)
    let validated_source_dir = match &source_dir {
        Some(dir) => {
            if dir.is_empty() {
                return Err(rust_i18n::t!("errors.pandoc.emptySourceDir").to_string());
            }
            if dir.contains("..") {
                return Err(rust_i18n::t!("errors.pandoc.sourcePathTraversal").to_string());
            }
            let path = std::path::Path::new(dir);
            let canonical = path.canonicalize().map_err(|e| {
                rust_i18n::t!(
                    "errors.pandoc.invalidSourceDir",
                    dir = dir,
                    detail = e.to_string()
                )
                .to_string()
            })?;
            if !canonical.is_dir() {
                return Err(rust_i18n::t!("errors.pandoc.notADirectory", dir = dir).to_string());
            }
            Some(canonical.to_string_lossy().into_owned())
        }
        None => None,
    };

    // Resolve Pandoc path once (avoid TOCTOU with detect)
    let pandoc_exe =
        resolve_pandoc_path().ok_or_else(|| rust_i18n::t!("errors.pandoc.notFound").to_string())?;

    // Run blocking I/O on a dedicated thread with timeout
    let result = tokio::task::spawn_blocking(move || {
        super::run::run_pandoc(
            &pandoc_exe,
            &markdown,
            &output_path,
            validated_source_dir.as_deref(),
            PANDOC_TIMEOUT,
        )
    })
    .await
    .map_err(|e| rust_i18n::t!("errors.pandoc.taskPanicked", detail = e.to_string()).to_string())?;

    result
}

/// Resolve the absolute path to the Pandoc executable.
pub(crate) fn resolve_pandoc_path() -> Option<String> {
    let output = which_command()
        .arg("pandoc")
        .env("PATH", login_shell_path())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let path = raw.lines().next().unwrap_or("").trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
