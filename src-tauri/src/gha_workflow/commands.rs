//! Tauri command surface for the GHA workflow viewer.
//!
//! Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md WI-5.4.

use super::actionlint::{run_actionlint, LintResult};

/// Run actionlint on a YAML string. Returns a typed `LintResult` so the
/// frontend can distinguish binary-missing (silent fallback) from
/// binary-failed (surfaced error).
///
/// The frontend can pass `extra_path` from `get_login_shell_path` so
/// macOS GUI launches still find Homebrew-installed actionlint.
#[tauri::command]
pub async fn gha_lint(yaml: String, extra_path: Option<String>) -> Result<LintResult, String> {
    // Run on the blocking pool so it doesn't starve tokio.
    tokio::task::spawn_blocking(move || run_actionlint(&yaml, extra_path.as_deref()))
        .await
        .map_err(|e| format!("Lint task join failed: {}", e))
}
