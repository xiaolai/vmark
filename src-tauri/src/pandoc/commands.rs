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
pub(crate) const ALLOWED_EXTENSIONS: &[&str] = &["docx", "epub", "tex", "odt", "rtf", "txt"];

/// Maximum time to wait for Pandoc to finish (2 minutes).
const PANDOC_TIMEOUT: Duration = Duration::from_secs(120);

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
pub(crate) fn build_pandoc_args(
    output_path: &str,
    source_dir: Option<&str>,
) -> Vec<String> {
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
                return Err(
                    rust_i18n::t!("errors.pandoc.notADirectory", dir = dir).to_string(),
                );
            }
            Some(canonical.to_string_lossy().into_owned())
        }
        None => None,
    };

    // Resolve Pandoc path once (avoid TOCTOU with detect)
    let pandoc_exe = resolve_pandoc_path()
        .ok_or_else(|| rust_i18n::t!("errors.pandoc.notFound").to_string())?;

    // Run blocking I/O on a dedicated thread with timeout
    let result = tokio::task::spawn_blocking(move || {
        run_pandoc(&pandoc_exe, &markdown, &output_path, validated_source_dir.as_deref())
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

    let args_owned = build_pandoc_args(output_path, source_dir);
    let args: Vec<&str> = args_owned.iter().map(|s| s.as_str()).collect();

    let mut child = build_command(pandoc_exe, &args)
        .env("PATH", login_shell_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| rust_i18n::t!("errors.pandoc.startFailed", detail = e.to_string()).to_string())?;

    // Write markdown to stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(markdown.as_bytes())
            .map_err(|e| rust_i18n::t!("errors.pandoc.stdinFailed", detail = e.to_string()).to_string())?;
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
                    rust_i18n::t!("errors.pandoc.exitedWithCode", code = status.to_string())
                        .to_string()
                } else {
                    stderr.trim().to_string()
                };
                return Err(msg);
            }
            Ok(None) => {
                if start.elapsed() > PANDOC_TIMEOUT {
                    let _ = child.kill();
                    return Err(rust_i18n::t!("errors.pandoc.timeout").to_string());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                return Err(
                    rust_i18n::t!("errors.pandoc.waitFailed", detail = e.to_string()).to_string(),
                );
            }
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- ALLOWED_EXTENSIONS constant ----

    // Constant-membership tests removed — the behavioral tests on
    // validate_extension() + the length assertion below cover these with better signal.

    #[test]
    fn allowed_extensions_rejects_dangerous() {
        for ext in &["exe", "sh", "bat", "html", "pdf", "js", "py"] {
            assert!(!ALLOWED_EXTENSIONS.contains(ext), "{} should not be allowed", ext);
        }
    }

    #[test]
    fn allowed_extensions_rejects_pdf() {
        assert!(!ALLOWED_EXTENSIONS.contains(&"pdf"));
    }

    #[test]
    fn allowed_extensions_rejects_js() {
        assert!(!ALLOWED_EXTENSIONS.contains(&"js"));
    }

    #[test]
    fn allowed_extensions_has_exactly_six_entries() {
        assert_eq!(ALLOWED_EXTENSIONS.len(), 6);
    }

    // ---- validate_extension ----

    #[test]
    fn validate_extension_accepts_docx() {
        assert!(validate_extension("/tmp/output.docx").is_ok());
    }

    #[test]
    fn validate_extension_accepts_epub() {
        assert!(validate_extension("/tmp/book.epub").is_ok());
    }

    #[test]
    fn validate_extension_accepts_tex() {
        assert!(validate_extension("/home/user/paper.tex").is_ok());
    }

    #[test]
    fn validate_extension_accepts_odt() {
        assert!(validate_extension("document.odt").is_ok());
    }

    #[test]
    fn validate_extension_accepts_rtf() {
        assert!(validate_extension("notes.rtf").is_ok());
    }

    #[test]
    fn validate_extension_accepts_txt() {
        assert!(validate_extension("readme.txt").is_ok());
    }

    #[test]
    fn validate_extension_is_case_insensitive() {
        assert!(validate_extension("file.DOCX").is_ok());
        assert!(validate_extension("file.Docx").is_ok());
        assert!(validate_extension("file.DocX").is_ok());
        assert!(validate_extension("file.EPUB").is_ok());
        assert!(validate_extension("file.TXT").is_ok());
    }

    #[test]
    fn validate_extension_rejects_exe() {
        let err = validate_extension("malware.exe").unwrap_err();
        assert!(err.contains("Unsupported format"));
        assert!(err.contains(".exe"));
    }

    #[test]
    fn validate_extension_rejects_sh() {
        assert!(validate_extension("script.sh").is_err());
    }

    #[test]
    fn validate_extension_rejects_html() {
        assert!(validate_extension("page.html").is_err());
    }

    #[test]
    fn validate_extension_rejects_pdf() {
        assert!(validate_extension("document.pdf").is_err());
    }

    #[test]
    fn validate_extension_rejects_js() {
        assert!(validate_extension("app.js").is_err());
    }

    #[test]
    fn validate_extension_rejects_py() {
        assert!(validate_extension("script.py").is_err());
    }

    #[test]
    fn validate_extension_rejects_bat() {
        assert!(validate_extension("run.bat").is_err());
    }

    #[test]
    fn validate_extension_rejects_no_extension() {
        let err = validate_extension("/tmp/output").unwrap_err();
        assert!(err.contains("Unsupported format"));
        // Empty extension shows as '.'
        assert!(err.contains("'.'"));
    }

    #[test]
    fn validate_extension_uses_last_extension_for_double_dot() {
        // "file.tar.gz" — only the last extension ("gz") is checked
        assert!(validate_extension("archive.tar.gz").is_err());
    }

    #[test]
    fn validate_extension_handles_dot_only_filename() {
        // ".docx" — on Unix this is a hidden file named "docx" with no extension
        // std::path::Path::new(".docx").extension() returns None
        assert!(validate_extension(".docx").is_err());
    }

    #[test]
    fn validate_extension_handles_path_with_spaces() {
        assert!(validate_extension("/tmp/my documents/output file.docx").is_ok());
    }

    #[test]
    fn validate_extension_error_lists_supported_formats() {
        let err = validate_extension("bad.xyz").unwrap_err();
        assert!(err.contains("docx"));
        assert!(err.contains("epub"));
        assert!(err.contains("tex"));
        assert!(err.contains("odt"));
        assert!(err.contains("rtf"));
        assert!(err.contains("txt"));
    }

    // ---- build_pandoc_args ----

    #[test]
    fn build_pandoc_args_base_without_source_dir() {
        let args = build_pandoc_args("/tmp/out.docx", None);
        assert_eq!(args, vec!["-f", "markdown", "-o", "/tmp/out.docx", "--standalone"]);
    }

    #[test]
    fn build_pandoc_args_with_source_dir() {
        let args = build_pandoc_args("/tmp/out.epub", Some("/home/user/docs"));
        assert_eq!(
            args,
            vec![
                "-f",
                "markdown",
                "-o",
                "/tmp/out.epub",
                "--standalone",
                "--resource-path=/home/user/docs",
            ]
        );
    }

    #[test]
    fn build_pandoc_args_source_dir_with_spaces() {
        let args = build_pandoc_args("out.docx", Some("/home/user/my docs"));
        let last = args.last().unwrap();
        assert_eq!(last, "--resource-path=/home/user/my docs");
    }

    #[test]
    fn build_pandoc_args_always_uses_standalone() {
        let args = build_pandoc_args("out.tex", None);
        assert!(args.contains(&"--standalone".to_string()));
    }

    #[test]
    fn build_pandoc_args_always_specifies_markdown_format() {
        let args = build_pandoc_args("out.txt", None);
        let f_idx = args.iter().position(|a| a == "-f").unwrap();
        assert_eq!(args[f_idx + 1], "markdown");
    }

    #[test]
    fn build_pandoc_args_output_path_follows_o_flag() {
        let args = build_pandoc_args("/custom/path.rtf", None);
        let o_idx = args.iter().position(|a| a == "-o").unwrap();
        assert_eq!(args[o_idx + 1], "/custom/path.rtf");
    }

    // ---- resolve_pandoc_path ----

    #[test]
    fn resolve_pandoc_path_returns_option() {
        // This test verifies the function returns Some or None without panicking.
        // On CI without pandoc, this returns None. On dev machines with pandoc, Some.
        let result = resolve_pandoc_path();
        match &result {
            Some(path) => {
                // If found, the path should be non-empty and point to a real file
                assert!(!path.is_empty());
                assert!(
                    std::path::Path::new(path).exists(),
                    "Resolved path '{}' should exist on disk",
                    path
                );
            }
            None => {
                // Pandoc not installed — this is valid in CI
            }
        }
    }

    // ---- PANDOC_TIMEOUT constant ----

    #[test]
    fn pandoc_timeout_is_two_minutes() {
        assert_eq!(PANDOC_TIMEOUT, Duration::from_secs(120));
    }
}
