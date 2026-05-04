//! Tauri command surface for the GHA workflow viewer.
//!
//! Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md
//! WI-5.4 (gha_lint), WI-6.3 (gha_fetch_action_yml).

use super::action_fetch::{default_ttl_secs, fetch_metadata, FetchResult};
use super::actionlint::{run_actionlint, LintResult};
use tauri::AppHandle;

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

/// Fetch an action's `action.yml` (or `.yaml`) and parse it into typed
/// metadata. Cache hit returns immediately; cache miss falls through
/// to a network fetch from raw.githubusercontent.com.
///
/// Always returns `Ok(FetchResult)` — the typed enum carries the
/// success/failure variant. Outer `Err` is reserved for fatal Tauri
/// runtime errors that the frontend can't usefully recover from.
#[tauri::command]
pub async fn gha_fetch_action_yml(
    app: AppHandle,
    uses: String,
) -> Result<FetchResult, String> {
    Ok(fetch_metadata(&app, &uses, default_ttl_secs()).await)
}
