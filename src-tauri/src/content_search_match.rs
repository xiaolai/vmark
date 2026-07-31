//! # Content Search — Match Mechanics
//!
//! Purpose: the pure half of workspace content search — regex construction,
//! binary/extension/skip-dir filtering, and per-line matching with UTF-16
//! offset conversion and long-line windowing. Split from `content_search.rs`
//! along the mechanics/orchestration seam when the walker gained completeness
//! tracking; the directory walk and the Tauri commands stay there.
//!
//! @coordinates-with content_search.rs — sole consumer (walker + commands)

use regex::{Regex, RegexBuilder};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Maximum length of a single line snippet (chars).
pub(crate) const MAX_LINE_LEN: usize = 200;

/// Bytes to check for binary detection.
pub(crate) const BINARY_CHECK_LEN: usize = 8192;

/// Maximum compiled regex size (1 MB) to prevent regex compilation DoS.
pub(crate) const MAX_REGEX_SIZE: usize = 1_024 * 1_024;

/// Directories always skipped (in addition to user-configured excludeFolders).
pub(crate) const ALWAYS_SKIP: &[&str] = &[
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

/// Build a regex from the user's query, respecting search options.
pub(crate) fn build_regex(
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
pub(crate) fn is_binary(path: &Path) -> bool {
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
pub(crate) fn should_skip_dir(name: &str, exclude_folders: &[String]) -> bool {
    ALWAYS_SKIP.contains(&name) || exclude_folders.iter().any(|s| s == name)
}

/// Check if a file matches the allowed extensions.
pub(crate) fn matches_extensions(path: &Path, extensions: &[String]) -> bool {
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
pub(crate) fn search_line(line: &str, line_number: u32, re: &Regex) -> Option<LineMatch> {
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
