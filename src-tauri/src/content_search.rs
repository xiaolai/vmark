//! # Content Search
//!
//! Purpose: Workspace-wide file content search — walks a directory tree and
//! returns matching lines grouped by file. Powers the "Find in Files" feature.
//!
//! Pipeline: Frontend invoke("search_workspace_content") → this module
//!   (regex, root check, budget) → `content_search_walk` (depth-first walk via
//!   std::fs::read_dir) → `content_search_file` (one open per file) →
//!   `content_search_match` (per-line regex matching) → Vec<FileSearchResult>
//!
//! Key decisions:
//!   - Uses `std::fs::read_dir` + `regex` crate — markdown workspaces are small
//!     enough that a manual walker is adequate without heavier dependencies.
//!   - Runs inside `spawn_blocking` because it does synchronous I/O.
//!   - Results capped at MAX_MATCHES total and MAX_FILES to prevent UI flooding.
//!   - Files over MAX_FILE_SIZE are skipped to avoid memory pressure.
//!   - Line content is trimmed and capped at MAX_LINE_LEN chars.
//!   - Match range offsets are UTF-16 code-unit indices (not byte offsets) for JS compat.
//!   - Binary files are skipped via a simple NUL-byte check on the first 8KB.
//!   - Symlinks are skipped to prevent directory traversal outside workspace.
//!   - Invalid regex returns a structured error string (never panics).
//!   - Regex compilation has an explicit 1MB size limit and matching DFA size
//!     limit to prevent memory-based DoS. The `regex` crate itself guarantees
//!     linear-time matching, so catastrophic backtracking is not a concern.
//!   - A 5-second wall-clock deadline applies to every search, held by one
//!     `DeadlineBudget`. It is checked at directory and file boundaries, inside
//!     entry enumeration (strided every 256 entries), before each file read,
//!     and inside per-line scanning. On timeout the walker returns partial
//!     results and emits a `log::warn!` — matching the same silent-truncation
//!     contract as MAX_FILES / MAX_MATCHES.
//!   - `search_workspace_content_checked` returns the same results PLUS a
//!     `complete` flag that is false whenever any ELIGIBLE evidence was
//!     skipped (deadline, caps, unreadable dir/file, oversized file). The
//!     orphan-image verifier needs it: for the UI, partial results are
//!     partial results, but for "may I delete this file?", zero hits from a
//!     partial scan must NOT read as verified clean. By-design exclusions
//!     (hidden files, non-matching extensions, binaries, symlinks) do not
//!     void completeness.
//!
//! @coordinates-with stores/uiStore/contentSearchSlice.ts — frontend consumer (invokes search_workspace_content)
//! @coordinates-with workspaceStore.ts — provides rootPath and excludeFolders
//! @coordinates-with services/media/workspaceReferenceCheck.ts — checked variant
//! @coordinates-with content_search_walk.rs — the directory walk and the deadline budget
//! @coordinates-with content_search_file.rs — the per-file scan

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[path = "content_search_file.rs"]
mod file_scan;
#[path = "content_search_match.rs"]
pub(crate) mod matching; // `ALWAYS_SKIP` is shared with the file-tree walker (#1357)
#[path = "content_search_walk.rs"]
mod walk;

use matching::build_regex;
pub(crate) use matching::LineMatch;
use walk::{DeadlineBudget, SearchPlan};

/// Maximum total matches returned across all files.
const MAX_MATCHES: usize = 1000;

/// Maximum files with matches returned.
const MAX_FILES: usize = 50;

/// Maximum file size to read (1 MB). Skips large non-binary files to prevent memory pressure.
const MAX_FILE_SIZE: u64 = 1_024 * 1_024;

/// Wall-clock ceiling for a single search run. On slow filesystems or with
/// pathological user input, search returns partial results rather than hanging
/// the blocking thread pool indefinitely.
const SEARCH_TIMEOUT: Duration = Duration::from_secs(5);

/// All matches within a single file.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub path: String,
    pub relative_path: String,
    pub matches: Vec<LineMatch>,
}

/// Walk the workspace and search file contents synchronously.
#[allow(clippy::too_many_arguments)]
fn search_sync(
    root_path: &str,
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
    markdown_only: bool,
    extensions: Vec<String>,
    exclude_folders: Vec<String>,
) -> Result<Vec<FileSearchResult>, String> {
    search_sync_with_deadline(
        root_path,
        query,
        case_sensitive,
        whole_word,
        use_regex,
        markdown_only,
        extensions,
        exclude_folders,
        Instant::now() + SEARCH_TIMEOUT,
    )
    .map(|outcome| outcome.results)
}

/// Results plus an honesty bit. `complete` is false whenever any ELIGIBLE
/// file's content did not get scanned — deadline expiry, the MAX_FILES /
/// MAX_MATCHES caps, an unreadable directory or file, or an oversized file.
/// By-design exclusions (hidden, extension-filtered, binary, symlink) do not
/// count: they are the search's contract, not missing evidence.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub results: Vec<FileSearchResult>,
    pub complete: bool,
}

/// Internal search implementation with a caller-supplied deadline. Public
/// only to the crate so tests can exercise timeout semantics deterministically.
#[allow(clippy::too_many_arguments)]
fn search_sync_with_deadline(
    root_path: &str,
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
    markdown_only: bool,
    extensions: Vec<String>,
    exclude_folders: Vec<String>,
    deadline: Instant,
) -> Result<SearchOutcome, String> {
    let re = build_regex(query, case_sensitive, whole_word, use_regex)?;
    let root = PathBuf::from(root_path);

    // Fail fast if root is unreadable (not silently return empty)
    if !root.is_dir() {
        return Err(format!("Workspace root is not a directory: {}", root_path));
    }
    fs::read_dir(&root).map_err(|e| format!("Cannot read workspace root: {}", e))?;

    let budget = DeadlineBudget::until(deadline);
    let mut tally = walk::walk(&SearchPlan {
        re: &re,
        root: &root,
        markdown_only,
        extensions: &extensions,
        exclude_folders: &exclude_folders,
        budget,
    });

    // Surface a timeout via the log so it's visible in dev builds. The public
    // API intentionally returns partial results (matching the existing
    // MAX_FILES / MAX_MATCHES silent-truncation contract) — callers treat
    // "fewer than expected" uniformly regardless of cause. If the frontend
    // ever needs to distinguish timeout from cap, widen the return type.
    if budget.spent() {
        tally.complete = false;
        log::warn!(
            "[ContentSearch] Search for {:?} timed out after {:?} with {} files / {} matches — returning partial results",
            query, SEARCH_TIMEOUT, tally.results.len(), tally.total_matches
        );
    }

    Ok(SearchOutcome {
        results: tally.results,
        complete: tally.complete,
    })
}

/// The shortest query, in characters, either command searches: two, so a
/// two-character CJK word searches (#1598); the caps and deadline bound the
/// cost of a short one. Mirrors `utils/contentSearchQuery.ts`.
pub(crate) const MIN_QUERY_CHARS: usize = 2;

/// Refuses an empty or too-short query. Counted in characters of the trimmed
/// query, never UTF-8 bytes (one CJK character is three).
fn check_query_length(query: &str) -> Result<(), String> {
    if query.trim().chars().count() < MIN_QUERY_CHARS {
        return Err(
            rust_i18n::t!("errors.search.queryTooShort", min = MIN_QUERY_CHARS).to_string(),
        );
    }
    Ok(())
}

/// Tauri command: search workspace file contents AND report whether every
/// eligible file was actually scanned. The orphan-image verifier depends on
/// the flag — zero hits from a partial scan must not clear a file for
/// deletion. The UI command below keeps its silent-truncation contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn search_workspace_content_checked(
    root_path: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
    markdown_only: bool,
    extensions: Vec<String>,
    exclude_folders: Vec<String>,
) -> Result<SearchOutcome, String> {
    check_query_length(&query)?;

    tokio::task::spawn_blocking(move || {
        search_sync_with_deadline(
            &root_path,
            &query,
            case_sensitive,
            whole_word,
            use_regex,
            markdown_only,
            extensions,
            exclude_folders,
            Instant::now() + SEARCH_TIMEOUT,
        )
    })
    .await
    .map_err(|e| format!("Search task failed: {}", e))?
}

/// Tauri command: search workspace file contents.
///
/// Runs in a blocking thread to avoid stalling the async runtime.
// The parameter list is the frontend `invoke()` IPC contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn search_workspace_content(
    root_path: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
    markdown_only: bool,
    extensions: Vec<String>,
    exclude_folders: Vec<String>,
) -> Result<Vec<FileSearchResult>, String> {
    check_query_length(&query)?;

    tokio::task::spawn_blocking(move || {
        search_sync(
            &root_path,
            &query,
            case_sensitive,
            whole_word,
            use_regex,
            markdown_only,
            extensions,
            exclude_folders,
        )
    })
    .await
    .map_err(|e| format!("Search task failed: {}", e))?
}

#[cfg(test)]
#[path = "content_search.test.rs"]
mod tests;

#[cfg(test)]
#[path = "content_search_fixture.test.rs"]
mod fixture_tests;
