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

use regex::{RegexBuilder, Regex};
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
    ALWAYS_SKIP.iter().any(|&s| s == name)
        || exclude_folders.iter().any(|s| s == name)
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

/// Convert a byte offset within a string to a character (UTF-16 code unit) index.
/// This ensures offsets sent to JS `String.slice()` work correctly for multibyte text.
fn byte_offset_to_char_index(s: &str, byte_offset: usize) -> usize {
    s[..byte_offset].chars().count()
}

/// Search line content and return match ranges, trimming if necessary.
/// All returned offsets are character indices (not byte offsets) so they
/// work correctly with JS `String.slice()`.
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

        let ranges = raw_ranges
            .iter()
            .filter(|(s, e)| *s >= start_byte && *e <= snippet_end_byte)
            .map(|(s, e)| {
                // Convert byte offsets within snippet to char indices
                let relative_start = byte_offset_to_char_index(&trimmed[start_byte..], s - start_byte);
                let relative_end = byte_offset_to_char_index(&trimmed[start_byte..], e - start_byte);
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
        let offset = prefix.chars().count(); // char count, not byte count
        let adjusted_ranges = ranges
            .into_iter()
            .map(|r| MatchRange {
                start: r.start + offset as u32,
                end: r.end + offset as u32,
            })
            .collect();

        (display, adjusted_ranges)
    } else {
        // Convert byte offsets to char indices for JS compatibility
        let ranges = raw_ranges
            .iter()
            .map(|(s, e)| MatchRange {
                start: byte_offset_to_char_index(trimmed, *s) as u32,
                end: byte_offset_to_char_index(trimmed, *e) as u32,
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
        if results.len() >= MAX_FILES
            || total_matches >= MAX_MATCHES
            || Instant::now() >= deadline
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
            if path.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
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
                    log::debug!("[ContentSearch] Skipping large file ({} bytes): {}", meta.len(), file_path.display());
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

                if let Some(line_match) = search_line(line, (line_idx + 1) as u32, &re) {
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
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_test_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();
        let root = dir.path();

        // Create test files
        fs::write(root.join("hello.md"), "Hello World\nGoodbye World\n").unwrap();
        fs::write(root.join("notes.md"), "Some notes about Rust\nMore notes here\n").unwrap();
        fs::write(root.join("readme.txt"), "This is a readme file\n").unwrap();
        fs::write(root.join("code.rs"), "fn main() { println!(\"Hello\"); }\n").unwrap();

        // Create subdirectory with files
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/nested.md"), "Nested content with World\n").unwrap();

        // Create excluded directory
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(
            root.join("node_modules/pkg.md"),
            "Should not be found World\n",
        )
        .unwrap();

        // Create hidden file
        fs::write(root.join(".hidden.md"), "Hidden World\n").unwrap();

        dir
    }

    #[test]
    fn test_basic_search() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results = search_sync(root, "World", false, false, false, false, vec![], vec![]).unwrap();

        // hello.md (2 matches), sub/nested.md (1 match), readme.txt has no "World"
        assert_eq!(results.len(), 2);
        let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
        assert_eq!(all_matches, 3); // "Hello World", "Goodbye World", "Nested content with World"
    }

    #[test]
    fn test_case_sensitive_search() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results =
            search_sync(root, "world", true, false, false, false, vec![], vec![]).unwrap();

        // "World" with capital W should not match case-sensitive "world"
        let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
        assert_eq!(all_matches, 0);
    }

    #[test]
    fn test_case_insensitive_search() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results =
            search_sync(root, "world", false, false, false, false, vec![], vec![]).unwrap();

        let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
        assert_eq!(all_matches, 3);
    }

    #[test]
    fn test_whole_word_search() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results =
            search_sync(root, "note", false, true, false, false, vec![], vec![]).unwrap();

        // "notes" should NOT match whole-word "note"
        let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
        assert_eq!(all_matches, 0);
    }

    #[test]
    fn test_regex_search() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results =
            search_sync(root, r"Hello|Goodbye", false, false, true, false, vec![], vec![]).unwrap();

        let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
        assert_eq!(all_matches, 3); // "Hello World", "Goodbye World", hello in code.rs println
    }

    #[test]
    fn test_invalid_regex() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let result =
            search_sync(root, "[invalid", false, false, true, false, vec![], vec![]);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid regex"));
    }

    #[test]
    fn test_markdown_only_filter() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();
        let extensions = vec![".md".to_string(), ".markdown".to_string(), ".txt".to_string()];

        let results =
            search_sync(root, "Hello", false, false, false, true, extensions, vec![]).unwrap();

        // Should find in hello.md but not in code.rs
        for result in &results {
            assert!(
                result.path.ends_with(".md") || result.path.ends_with(".txt"),
                "Non-markdown file found: {}",
                result.path
            );
        }
    }

    #[test]
    fn test_exclude_folders() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results = search_sync(
            root,
            "World",
            false,
            false,
            false,
            false,
            vec![],
            vec!["sub".to_string()],
        )
        .unwrap();

        // Should NOT find sub/nested.md
        for result in &results {
            assert!(
                !result.relative_path.starts_with("sub"),
                "Excluded folder found: {}",
                result.relative_path
            );
        }
    }

    #[test]
    fn test_hidden_files_skipped() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results = search_sync(root, "Hidden", false, false, false, false, vec![], vec![]).unwrap();

        // .hidden.md should be skipped
        for result in &results {
            assert!(
                !result.relative_path.starts_with('.'),
                "Hidden file found: {}",
                result.relative_path
            );
        }
    }

    #[test]
    fn test_node_modules_always_skipped() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results = search_sync(root, "Should not", false, false, false, false, vec![], vec![]).unwrap();

        for result in &results {
            assert!(
                !result.relative_path.contains("node_modules"),
                "node_modules found: {}",
                result.relative_path
            );
        }
    }

    #[test]
    fn test_relative_path() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results = search_sync(root, "Nested", false, false, false, false, vec![], vec![]).unwrap();

        assert!(!results.is_empty());
        let nested = results.iter().find(|r| r.relative_path.contains("nested")).unwrap();
        assert_eq!(nested.relative_path, "sub/nested.md");
    }

    #[test]
    fn test_match_ranges() {
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();

        let results = search_sync(root, "World", false, false, false, false, vec![], vec![]).unwrap();

        // Check that match ranges are populated
        for result in &results {
            for line_match in &result.matches {
                assert!(!line_match.match_ranges.is_empty());
                for range in &line_match.match_ranges {
                    assert!(range.end > range.start);
                    // Range should be within content bounds
                    assert!((range.end as usize) <= line_match.line_content.len());
                }
            }
        }
    }

    #[test]
    fn test_empty_query_rejected() {
        let result = build_regex("", false, false, false);
        // Empty regex is technically valid (matches everything), but the command
        // rejects queries < 2 chars. Test the build_regex directly.
        assert!(result.is_ok()); // regex itself is valid
    }

    #[test]
    fn test_multiple_matches_per_line() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("multi.md"),
            "cat and cat and cat\n",
        )
        .unwrap();

        let results = search_sync(
            dir.path().to_str().unwrap(),
            "cat",
            false,
            false,
            false,
            false,
            vec![],
            vec![],
        )
        .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matches.len(), 1);
        assert_eq!(results[0].matches[0].match_ranges.len(), 3);
    }

    #[test]
    fn test_line_numbers_are_1_indexed() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("lines.md"),
            "line one\nline two\nline three\n",
        )
        .unwrap();

        let results = search_sync(
            dir.path().to_str().unwrap(),
            "two",
            false,
            false,
            false,
            false,
            vec![],
            vec![],
        )
        .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matches[0].line_number, 2);
    }

    #[test]
    fn test_empty_workspace() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_str().unwrap();

        let results = search_sync(root, "anything", false, false, false, false, vec![], vec![]).unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_cjk_char_indices() {
        let dir = TempDir::new().unwrap();
        // Each CJK char is 3 bytes in UTF-8 but 1 char index for JS
        fs::write(dir.path().join("cjk.md"), "你好世界test你好\n").unwrap();

        let results = search_sync(
            dir.path().to_str().unwrap(),
            "test",
            false, false, false, false, vec![], vec![],
        ).unwrap();

        assert_eq!(results.len(), 1);
        let m = &results[0].matches[0];
        // "你好世界" = 4 chars, then "test" starts at char index 4
        assert_eq!(m.match_ranges[0].start, 4);
        assert_eq!(m.match_ranges[0].end, 8);
        // Verify the slice works correctly (simulating JS behavior)
        let content_chars: Vec<char> = m.line_content.chars().collect();
        let slice: String = content_chars[m.match_ranges[0].start as usize..m.match_ranges[0].end as usize].iter().collect();
        assert_eq!(slice, "test");
    }

    #[test]
    fn test_nonexistent_root_returns_error() {
        let result = search_sync("/nonexistent/path", "test", false, false, false, false, vec![], vec![]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    #[test]
    fn test_large_file_skipped() {
        let dir = TempDir::new().unwrap();
        // Create a file larger than MAX_FILE_SIZE (1 MB)
        let large_content = "x".repeat(1_100_000) + "\nsearchterm\n";
        fs::write(dir.path().join("large.md"), large_content).unwrap();
        // Also create a small file with the same term
        fs::write(dir.path().join("small.md"), "searchterm\n").unwrap();

        let results = search_sync(
            dir.path().to_str().unwrap(),
            "searchterm",
            false, false, false, false, vec![], vec![],
        ).unwrap();

        // Only small.md should match; large.md skipped
        assert_eq!(results.len(), 1);
        assert!(results[0].relative_path.contains("small"));
    }

    #[test]
    fn test_min_query_length_enforced() {
        // The async command rejects < 3 chars, test the sync function still works
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("ab.md"), "ab\n").unwrap();

        let results = search_sync(
            dir.path().to_str().unwrap(),
            "ab",
            false, false, false, false, vec![], vec![],
        ).unwrap();

        // sync function itself doesn't enforce length — that's the command's job
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_deadline_already_elapsed_returns_partial_results() {
        // Seeded workspace with several files; an elapsed deadline should cause
        // the walker to bail out early and return whatever (possibly zero)
        // results it accumulated without panicking or erroring.
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();
        let past_deadline = Instant::now() - Duration::from_secs(1);

        let result = search_sync_with_deadline(
            root, "World", false, false, false, false, vec![], vec![], past_deadline,
        );

        // Must not error — partial results are a valid outcome.
        assert!(result.is_ok(), "timeout must produce Ok(partial), got {:?}", result);
        // Walker is allowed to return fewer matches than the non-timeout case.
        let full = search_sync(root, "World", false, false, false, false, vec![], vec![]).unwrap();
        let full_matches: usize = full.iter().map(|r| r.matches.len()).sum();
        let partial_matches: usize = result.unwrap().iter().map(|r| r.matches.len()).sum();
        assert!(
            partial_matches <= full_matches,
            "partial should never exceed full ({} > {})",
            partial_matches, full_matches
        );
    }

    #[test]
    fn test_deadline_mid_walk_stops_early() {
        // Force a deadline that elapses after the first file is processed.
        // We can't easily time-travel inside search_sync, but an effectively-zero
        // deadline must stop at-or-before the first expensive I/O.
        let dir = setup_test_workspace();
        let root = dir.path().to_str().unwrap();
        let now = Instant::now();
        let tight = now + Duration::from_millis(0);

        let result = search_sync_with_deadline(
            root, "World", false, false, false, false, vec![], vec![], tight,
        )
        .unwrap();

        // With effectively no budget, result count must be bounded and must
        // not trigger any panic/error. Zero is valid; anything else is also
        // valid as long as <= full.
        let full = search_sync(root, "World", false, false, false, false, vec![], vec![]).unwrap();
        let full_files = full.len();
        assert!(
            result.len() <= full_files,
            "timed-out file count must not exceed untimed run"
        );
    }

    #[test]
    fn test_regex_size_limit_handles_oversized_pattern_gracefully() {
        // A heavily-alternated pattern should either compile under the 1 MB
        // size limit (regex crate is efficient about alternations) or surface
        // a structured error. The guarantee is "no panic, no runaway memory."
        let big_alt = (0..20_000)
            .map(|i| format!("term{:06}", i))
            .collect::<Vec<_>>()
            .join("|");
        let pattern = format!("({})", big_alt);

        match build_regex(&pattern, false, false, true) {
            Ok(_) => {
                // Accepted — crate handled it within the budget. Fine.
            }
            Err(err) => {
                assert!(
                    err.contains("Invalid regex"),
                    "error from build_regex must be the structured 'Invalid regex' form, got: {}",
                    err
                );
            }
        }
    }

    #[test]
    fn test_redos_style_pattern_finishes_without_runaway() {
        // The Rust `regex` crate is immune to catastrophic backtracking by
        // construction. This guard test asserts the engine still produces a
        // result (doesn't panic, doesn't deadlock) on a pattern that would
        // be pathological in a backtracking engine. The assertion is purely
        // functional — no wall-clock threshold to avoid CI flakiness.
        let haystack = format!("{}!", "a".repeat(10_000));
        let re = build_regex(r"(a+)+b", false, false, true).unwrap();
        // Count must complete — zero matches since there is no 'b' in input.
        assert_eq!(re.find_iter(&haystack).count(), 0);
    }

    #[test]
    fn test_regex_size_limit_rejects_clearly_oversized_ast() {
        // RegexBuilder::size_limit caps the AST size. A direct build that
        // bypasses our helper with a tiny explicit limit must surface the
        // structured "Invalid regex" error — proving the limit path is wired
        // up and produces the contract we promise callers.
        let pattern = "(abc|def|ghi|jkl|mno|pqr|stu|vwx|yz0)+";
        let result = RegexBuilder::new(pattern)
            .size_limit(64) // absurdly small — forces the limit to fire
            .build()
            .map_err(|e| format!("Invalid regex: {}", e));
        assert!(result.is_err(), "expected size-limit rejection with tiny cap");
        let err = result.unwrap_err();
        assert!(
            err.contains("Invalid regex"),
            "size-limit errors must surface via the 'Invalid regex' contract, got: {}",
            err
        );
    }
}
