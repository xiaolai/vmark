//! Pandoc export commands.
//!
//! Purpose: Detect Pandoc installation and export markdown via Pandoc CLI.
//! Uses stdin piping to avoid temp files. Runs blocking I/O on a dedicated
//! thread with a timeout to avoid stalling the async runtime.
//!
//! @coordinates-with ai_provider/cli.rs — build_command() for cross-platform spawn
//! @coordinates-with ai_provider/detection.rs — login_shell_path(), which_command() for PATH resolution

use std::process::Stdio;
use std::time::Duration;
use tauri::command;

use crate::ai_provider::{build_command, login_shell_path, which_command};

/// Allowed output extensions (strict allowlist).
const ALLOWED_EXTENSIONS: &[&str] = &["docx", "epub", "tex", "odt", "rtf", "txt"];

/// Maximum time to wait for Pandoc to finish (2 minutes).
const PANDOC_TIMEOUT: Duration = Duration::from_secs(120);

/// Result of Pandoc detection.
#[derive(serde::Serialize)]
pub struct PandocInfo {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Detect whether Pandoc is installed and return its absolute path + version.
#[command]
pub fn detect_pandoc() -> PandocInfo {
    let path = match resolve_pandoc_path() {
        Some(p) => p,
        None => return PandocInfo { available: false, path: None, version: None },
    };

    let version = match build_command(&path, &["--version"])
        .env("PATH", login_shell_path())
        .output()
    {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout);
            // First line is "pandoc 3.1.2" or similar
            raw.lines()
                .next()
                .and_then(|line| line.strip_prefix("pandoc "))
                .map(|v| v.trim().to_string())
        }
        _ => None,
    };

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
    let ext = std::path::Path::new(&output_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Unsupported format '.{}'. Supported: {}",
            ext,
            ALLOWED_EXTENSIONS.join(", ")
        ));
    }

    // Resolve Pandoc path once (avoid TOCTOU with detect)
    let pandoc_exe = resolve_pandoc_path().ok_or("Pandoc not found on PATH")?;

    // Run blocking I/O on a dedicated thread with timeout
    let result = tokio::task::spawn_blocking(move || {
        run_pandoc(&pandoc_exe, &markdown, &output_path, source_dir.as_deref())
    })
    .await
    .map_err(|e| format!("Pandoc task panicked: {}", e))?;

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
    if path.is_empty() { None } else { Some(path) }
}

/// Execute Pandoc synchronously (called from spawn_blocking).
///
/// Reads stderr in a separate thread to avoid pipe-buffer deadlocks,
/// then polls the child with a timeout.
fn run_pandoc(
    pandoc_exe: &str,
    markdown: &str,
    output_path: &str,
    source_dir: Option<&str>,
) -> Result<(), String> {
    use std::io::Write;

    let mut args: Vec<&str> = vec!["-f", "markdown", "-o", output_path, "--standalone"];

    // Set resource path for resolving relative image/asset paths
    let resource_flag;
    if let Some(dir) = source_dir {
        resource_flag = format!("--resource-path={}", dir);
        args.push(&resource_flag);
    }

    let mut child = build_command(pandoc_exe, &args)
        .env("PATH", login_shell_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Pandoc: {}", e))?;

    // Write markdown to stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(markdown.as_bytes())
            .map_err(|e| format!("Failed to write to Pandoc stdin: {}", e))?;
        // stdin is dropped here, closing the pipe
    }

    // Drain stderr in a background thread to prevent pipe-buffer deadlock.
    // If Pandoc writes more than the OS pipe buffer (~64 KB) to stderr while
    // we're polling try_wait(), the child would block on the write and never
    // exit — causing a false timeout. Reading stderr concurrently avoids this.
    let stderr_handle = child.stderr.take().map(|stderr| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = Vec::new();
            let mut reader = stderr;
            let _ = reader.read_to_end(&mut buf);
            buf
        })
    });

    // Wait with timeout
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stderr_buf = stderr_handle
                    .and_then(|h| h.join().ok())
                    .unwrap_or_default();

                if status.success() {
                    return Ok(());
                }

                let stderr = String::from_utf8_lossy(&stderr_buf);
                let msg = if stderr.trim().is_empty() {
                    format!("Pandoc exited with code {}", status)
                } else {
                    stderr.trim().to_string()
                };
                return Err(msg);
            }
            Ok(None) => {
                if start.elapsed() > PANDOC_TIMEOUT {
                    let _ = child.kill();
                    return Err("Pandoc timed out (exceeded 2 minutes)".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("Failed to wait for Pandoc: {}", e)),
        }
    }
}
