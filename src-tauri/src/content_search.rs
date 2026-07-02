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
//!
//! @coordinates-with contentSearchStore.ts — frontend consumer
//! @coordinates-with workspaceStore.ts — provides rootPath and excludeFolders

use regex::{Regex, RegexBuilder};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Maximum total matches returned across all files.
const MAX_MATCHES: usize = 1000;

/// Maximum files with matches returned.
const MAX_FILES: usize = 50;

/// Maximum length of a single line snippet (chars).
const MAX_LINE_LEN: usize = 200;

/// Bytes to check for binary detection.
const BINARY_CHECK_LEN: usize = 8192;

/// Maximum file size to read (1 MB). Skips large non-binary files to prevent memory pressure.
const MAX_FILE_SIZE: u64 = 1_024 * 1_024;

/// Maximum compiled regex size (1 MB) to prevent regex compilation DoS.
const MAX_REGEX_SIZE: usize = 1_024 * 1_024;

/// Wall-clock ceiling for a single search run. On slow filesystems or with
/// pathological user input, search returns partial results rather than hanging
/// the blocking thread pool indefinitely.
const SEARCH_TIMEOUT: Duration = Duration::from_secs(5);

/// Directories always skipped (in addition to user-configured excludeFolders).
const ALWAYS_SKIP: &[&str] = &[
    ".git",
    "node_modules",
    ".obsidian",
    ".svn",
    "__pycache__",
    ".DS_Store",
    ".vscode",
    ".idea",
    "target",
    ".next",
    "dist",
    ".superpowers",
];

/// A single match within a line.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MatchRange {
    pub start: u32,
    pub end: u32,
}

/// A matching line within a file.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    pub line_number: u32,
    pub line_content: String,
    pub match_ranges: Vec<MatchRange>,
}

/// All matches within a single file.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub path: String,
    pub relative_path: String,
    pub matches: Vec<LineMatch>,
}

/// Build a regex from the user's query, respecting search options.
fn build_regex(
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
) -> Result<Regex, String> {
    let pattern = if use_regex {
        if whole_word {
            format!(r"\b(?:{})\b", query)
        } else {
            query.to_string()
        }
    } else {
        let escaped = regex::escape(query);
        if whole_word {
            format!(r"\b{}\b", escaped)
        } else {
            escaped
        }
    };

    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .size_limit(MAX_REGEX_SIZE)
        // DFA memory cap limits the compiled automaton's runtime working set
        // and narrows the surface for pathological patterns like (a+)+b.
        .dfa_size_limit(MAX_REGEX_SIZE)
        .build()
        .map_err(|e| format!("Invalid regex: {}", e))
}

/// Check if a file appears to be binary by scanning first bytes for NUL.
fn is_binary(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return true;
    };
    use std::io::Read;
    let mut buf = [0u8; BINARY_CHECK_LEN];
    let Ok(n) = (&file).read(&mut buf) else {
        return true;
    };
    buf[..n].contains(&0)
}

/// Check if a directory name should be skipped.
fn should_skip_dir(name: &str, exclude_folders: &[String]) -> bool {
    ALWAYS_SKIP.contains(&name) || exclude_folders.iter().any(|s| s == name)
}

/// Check if a file matches the allowed extensions.
fn matches_extensions(path: &Path, extensions: &[String]) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let lower = ext.to_lowercase();
    extensions.iter().any(|e| {
        // Extensions may come with or without leading dot
        let e_clean = e.strip_prefix('.').unwrap_or(e);
        e_clean.to_lowercase() == lower
    })
}

/// Convert a byte offset within a string to a UTF-16 code-unit index.
/// JS `String.slice()` counts UTF-16 units, so astral chars (emoji) count
/// as 2 — `chars().count()` would shift every offset after them.
fn byte_offset_to_utf16_index(s: &str, byte_offset: usize) -> usize {
    s[..byte_offset].chars().map(char::len_utf16).sum()
}

/// Search line content and return match ranges, trimming if necessary.
/// All returned offsets are UTF-16 code-unit indices (not byte offsets) so
/// they work correctly with JS `String.slice()`.
fn search_line(line: &str, line_number: u32, re: &Regex) -> Option<LineMatch> {
    let trimmed = line.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    // Collect all matches on this line (byte offsets)
    let raw_ranges: Vec<(usize, usize)> = re
        .find_iter(trimmed)
        .map(|m| (m.start(), m.end()))
        .collect();

    if raw_ranges.is_empty() {
        return None;
    }

    // Truncate line content if too long, adjusting ranges
    let (content, match_ranges) = if trimmed.chars().count() > MAX_LINE_LEN {
        // Find a reasonable window around the first match
        let first_start = raw_ranges[0].0;
        let byte_budget = MAX_LINE_LEN;

        // Try to start ~30 chars before the first match
        let context_before = 30;
        let start_char = trimmed[..first_start]
            .chars()
            .count()
            .saturating_sub(context_before);
        let start_byte = trimmed
            .char_indices()
            .nth(start_char)
            .map(|(i, _)| i)
            .unwrap_or(0);

        let snippet: String = trimmed[start_byte..].chars().take(byte_budget).collect();
        let snippet_end_byte = start_byte + snippet.len();

        // Keep every match that overlaps the window, clamped to it — a match
        // longer than the window must not vanish (empty match_ranges).
        let ranges = raw_ranges
            .iter()
            .filter(|(s, e)| *e > start_byte && *s < snippet_end_byte)
            .map(|(s, e)| {
                let s = (*s).max(start_byte);
                let e = (*e).min(snippet_end_byte);
                // Convert byte offsets within snippet to UTF-16 indices
                let relative_start =
                    byte_offset_to_utf16_index(&trimmed[start_byte..], s - start_byte);
                let relative_end =
                    byte_offset_to_utf16_index(&trimmed[start_byte..], e - start_byte);
                MatchRange {
                    start: relative_start as u32,
                    end: relative_end as u32,
                }
            })
            .collect::<Vec<_>>();

        let prefix = if start_byte > 0 { "…" } else { "" };
        let suffix = if snippet_end_byte < trimmed.len() {
            "…"
        } else {
            ""
        };

        let display = format!("{}{}{}", prefix, snippet, suffix);
        let offset = prefix.encode_utf16().count(); // UTF-16 units, not bytes
        let adjusted_ranges = ranges
            .into_iter()
            .map(|r| MatchRange {
                start: r.start + offset as u32,
                end: r.end + offset as u32,
            })
            .collect();

        (display, adjusted_ranges)
    } else {
        // Convert byte offsets to UTF-16 indices for JS compatibility
        let ranges = raw_ranges
            .iter()
            .map(|(s, e)| MatchRange {
                start: byte_offset_to_utf16_index(trimmed, *s) as u32,
                end: byte_offset_to_utf16_index(trimmed, *e) as u32,
            })
            .collect();
        (trimmed.to_string(), ranges)
    };

    Some(LineMatch {
        line_number,
        line_content: content,
        match_ranges,
    })
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
) -> Result<Vec<FileSearchResult>, String> {
    let re = build_regex(query, case_sensitive, whole_word, use_regex)?;
    let root = PathBuf::from(root_path);

    // Fail fast if root is unreadable (not silently return empty)
    if !root.is_dir() {
        return Err(format!("Workspace root is not a directory: {}", root_path));
    }
    fs::read_dir(&root).map_err(|e| format!("Cannot read workspace root: {}", e))?;

    let mut results: Vec<FileSearchResult> = Vec::new();
    let mut total_matches: usize = 0;

    // Walk directory tree
    let mut dirs_to_visit: Vec<PathBuf> = vec![root.clone()];

    while let Some(dir) = dirs_to_visit.pop() {
        if results.len() >= MAX_FILES || total_matches >= MAX_MATCHES || Instant::now() >= deadline
        {
            break;
        }

        let Ok(entries) = fs::read_dir(&dir) else {
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
                    continue;
                }
            }

            // Re-check the deadline before an expensive blocking read.
            if Instant::now() >= deadline {
                break;
            }

            let Ok(content) = fs::read_to_string(&file_path) else {
                log::debug!("[ContentSearch] Cannot read file: {}", file_path.display());
                continue;
            };

            let mut file_matches: Vec<LineMatch> = Vec::new();

            for (line_idx, line) in content.lines().enumerate() {
                if total_matches >= MAX_MATCHES {
                    break;
                }
                // Cheap periodic deadline check on very long files.
                if line_idx % DEADLINE_CHECK_STRIDE == 0 && Instant::now() >= deadline {
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
        log::warn!(
            "[ContentSearch] Search for {:?} timed out after {:?} with {} files / {} matches — returning partial results",
            query, SEARCH_TIMEOUT, results.len(), total_matches
        );
    }

    Ok(results)
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
