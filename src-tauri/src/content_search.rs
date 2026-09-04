//! # Content Search
//!
//! Purpose: Workspace-wide file content search — walks a directory tree and
//! returns matching lines grouped by file. Powers the "Find in Files" feature.
//!
//! Pipeline: Frontend invoke("search_workspace_content") → this module
//!   → manual BFS via std::fs::read_dir → regex matching → Vec<FileSearchResult>
//!
//! Key decisions:
//!   - Uses `std::fs::read_dir` + `regex` crate — markdown workspaces are small
//!     enough that a manual BFS walker is adequate without heavier dependencies.
//!   - Runs inside `spawn_blocking` because it does synchronous I/O.
//!   - Results capped at MAX_MATCHES total and MAX_FILES to prevent UI flooding.
//!   - Files over MAX_FILE_SIZE are skipped to avoid memory pressure.
//!   - Line content is trimmed and capped at MAX_LINE_LEN chars.
//!   - Match range offsets are character indices (not byte offsets) for JS compat.
//!   - Binary files are skipped via a simple NUL-byte check on the first 8KB.
//!   - Symlinks are skipped to prevent directory traversal outside workspace.
//!   - Invalid regex returns a structured error string (never panics).
//!   - Regex compilation has an explicit 1MB size limit and matching DFA size
//!     limit to prevent memory-based DoS. The `regex` crate itself guarantees
//!     linear-time matching, so catastrophic backtracking is not a concern.
//!   - A 5-second wall-clock deadline applies to every search. Deadline checks
//!     fire at directory and file boundaries, inside entry enumeration (strided
//!     every 256 entries), before each `read_to_string`, and inside per-line
//!     scanning. On timeout the walker returns partial results and emits a
//!     `log::warn!` — matching the same silent-truncation contract as
//!     MAX_FILES / MAX_MATCHES.
//!   - `search_workspace_content_checked` returns the same results PLUS a
//!     `complete` flag that is false whenever any ELIGIBLE evidence was
//!     skipped (deadline, caps, unreadable dir/file, oversized file). The
//!     orphan-image verifier needs it: for the UI, partial results are
//!     partial results, but for "may I delete this file?", zero hits from a
//!     partial scan must NOT read as verified clean. By-design exclusions
//!     (hidden files, non-matching extensions, binaries, symlinks) do not
//!     void completeness.
//!
//! @coordinates-with contentSearchStore.ts — frontend consumer
//! @coordinates-with workspaceStore.ts — provides rootPath and excludeFolders
//! @coordinates-with services/media/workspaceReferenceCheck.ts — checked variant

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[path = "content_search_match.rs"]
pub(crate) mod matching; // `ALWAYS_SKIP` is shared with the file-tree walker (#1357)
pub(crate) use matching::LineMatch;
use matching::{build_regex, is_binary, matches_extensions, search_line, should_skip_dir};

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

    let mut results: Vec<FileSearchResult> = Vec::new();
    let mut total_matches: usize = 0;
    let mut complete = true;

    // Walk directory tree
    let mut dirs_to_visit: Vec<PathBuf> = vec![root.clone()];

    while let Some(dir) = dirs_to_visit.pop() {
        if results.len() >= MAX_FILES || total_matches >= MAX_MATCHES || Instant::now() >= deadline
        {
            complete = false; // directories remain unvisited
            break;
        }

        let Ok(entries) = fs::read_dir(&dir) else {
            complete = false; // this directory's files were never seen
            continue;
        };

        let mut subdirs: Vec<PathBuf> = Vec::new();
        let mut files: Vec<PathBuf> = Vec::new();

        // Stride for deadline checks inside inner loops — avoids calling
        // Instant::now() on every iteration while keeping the wall-clock cap
        // responsive on huge directories or very long files.
        const DEADLINE_CHECK_STRIDE: usize = 256;

        for (i, entry) in entries.flatten().enumerate() {
            if i % DEADLINE_CHECK_STRIDE == 0 && Instant::now() >= deadline {
                complete = false; // remaining entries were never enumerated
                break;
            }
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };

            // Skip symlinks to prevent directory traversal outside workspace
            if path
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
            {
                continue;
            }

            if path.is_dir() {
                if !should_skip_dir(name, &exclude_folders) {
                    subdirs.push(path);
                }
            } else if path.is_file() {
                // Skip hidden files
                if name.starts_with('.') {
                    continue;
                }
                if markdown_only && !matches_extensions(&path, &extensions) {
                    continue;
                }
                files.push(path);
            }
        }

        // Sort subdirs for deterministic ordering
        subdirs.sort();
        dirs_to_visit.extend(subdirs);

        // Search each file
        for file_path in files {
            if results.len() >= MAX_FILES
                || total_matches >= MAX_MATCHES
                || Instant::now() >= deadline
            {
                complete = false; // remaining files were never scanned
                break;
            }

            if is_binary(&file_path) {
                continue;
            }

            // Skip files larger than MAX_FILE_SIZE to prevent memory pressure
            if let Ok(meta) = fs::metadata(&file_path) {
                if meta.len() > MAX_FILE_SIZE {
                    log::debug!(
                        "[ContentSearch] Skipping large file ({} bytes): {}",
                        meta.len(),
                        file_path.display()
                    );
                    complete = false; // an eligible file went unscanned
                    continue;
                }
            }

            // Re-check the deadline before an expensive blocking read.
            if Instant::now() >= deadline {
                complete = false;
                break;
            }

            let Ok(content) = fs::read_to_string(&file_path) else {
                log::debug!("[ContentSearch] Cannot read file: {}", file_path.display());
                complete = false; // an eligible file went unscanned
                continue;
            };

            let mut file_matches: Vec<LineMatch> = Vec::new();

            for (line_idx, line) in content.lines().enumerate() {
                if total_matches >= MAX_MATCHES {
                    complete = false; // remaining lines were never scanned
                    break;
                }
                // Cheap periodic deadline check on very long files.
                if line_idx % DEADLINE_CHECK_STRIDE == 0 && Instant::now() >= deadline {
                    complete = false;
                    break;
                }

                if let Some(mut line_match) = search_line(line, (line_idx + 1) as u32, &re) {
                    // Never exceed MAX_MATCHES: a single line can carry many
                    // ranges, so truncate to the remaining budget.
                    // (the pre-line break above guarantees remaining >= 1)
                    line_match
                        .match_ranges
                        .truncate(MAX_MATCHES - total_matches);
                    total_matches += line_match.match_ranges.len();
                    file_matches.push(line_match);
                }
            }

            if !file_matches.is_empty() {
                let relative = file_path
                    .strip_prefix(&root)
                    .unwrap_or(&file_path)
                    .to_string_lossy()
                    .replace('\\', "/");

                results.push(FileSearchResult {
                    path: file_path.to_string_lossy().to_string(),
                    relative_path: relative,
                    matches: file_matches,
                });
            }
        }
    }

    // Surface a timeout via the log so it's visible in dev builds. The public
    // API intentionally returns partial results (matching the existing
    // MAX_FILES / MAX_MATCHES silent-truncation contract) — callers treat
    // "fewer than expected" uniformly regardless of cause. If the frontend
    // ever needs to distinguish timeout from cap, widen the return type.
    if Instant::now() >= deadline {
        complete = false;
        log::warn!(
            "[ContentSearch] Search for {:?} timed out after {:?} with {} files / {} matches — returning partial results",
            query, SEARCH_TIMEOUT, results.len(), total_matches
        );
    }

    Ok(SearchOutcome { results, complete })
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
    if query.trim().len() < 3 {
        return Err(rust_i18n::t!("errors.search.queryTooShort").to_string());
    }

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
    // Reject empty/very short queries (matches frontend MIN_QUERY_LENGTH = 3)
    if query.trim().len() < 3 {
        return Err(rust_i18n::t!("errors.search.queryTooShort").to_string());
    }

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
