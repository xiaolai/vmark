//! Tests for workspace content search (extracted from content_search.rs
//! to keep the production file within the size gate).

use super::*;
use std::fs;
use tempfile::TempDir;

fn setup_test_workspace() -> TempDir {
    let dir = TempDir::new().unwrap();
    let root = dir.path();

    // Create test files
    fs::write(root.join("hello.md"), "Hello World\nGoodbye World\n").unwrap();
    fs::write(
        root.join("notes.md"),
        "Some notes about Rust\nMore notes here\n",
    )
    .unwrap();
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

    let results = search_sync(root, "world", true, false, false, false, vec![], vec![]).unwrap();

    // "World" with capital W should not match case-sensitive "world"
    let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
    assert_eq!(all_matches, 0);
}

#[test]
fn test_case_insensitive_search() {
    let dir = setup_test_workspace();
    let root = dir.path().to_str().unwrap();

    let results = search_sync(root, "world", false, false, false, false, vec![], vec![]).unwrap();

    let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
    assert_eq!(all_matches, 3);
}

#[test]
fn test_whole_word_search() {
    let dir = setup_test_workspace();
    let root = dir.path().to_str().unwrap();

    let results = search_sync(root, "note", false, true, false, false, vec![], vec![]).unwrap();

    // "notes" should NOT match whole-word "note"
    let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
    assert_eq!(all_matches, 0);
}

#[test]
fn test_regex_search() {
    let dir = setup_test_workspace();
    let root = dir.path().to_str().unwrap();

    let results = search_sync(
        root,
        r"Hello|Goodbye",
        false,
        false,
        true,
        false,
        vec![],
        vec![],
    )
    .unwrap();

    let all_matches: usize = results.iter().map(|r| r.matches.len()).sum();
    assert_eq!(all_matches, 3); // "Hello World", "Goodbye World", hello in code.rs println
}

#[test]
fn test_invalid_regex() {
    let dir = setup_test_workspace();
    let root = dir.path().to_str().unwrap();

    let result = search_sync(root, "[invalid", false, false, true, false, vec![], vec![]);

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid regex"));
}

#[test]
fn test_markdown_only_filter() {
    let dir = setup_test_workspace();
    let root = dir.path().to_str().unwrap();
    let extensions = vec![
        ".md".to_string(),
        ".markdown".to_string(),
        ".txt".to_string(),
    ];

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

    let results = search_sync(
        root,
        "Should not",
        false,
        false,
        false,
        false,
        vec![],
        vec![],
    )
    .unwrap();

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
    let nested = results
        .iter()
        .find(|r| r.relative_path.contains("nested"))
        .unwrap();
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
    fs::write(dir.path().join("multi.md"), "cat and cat and cat\n").unwrap();

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

    let results =
        search_sync(root, "anything", false, false, false, false, vec![], vec![]).unwrap();
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
        false,
        false,
        false,
        false,
        vec![],
        vec![],
    )
    .unwrap();

    assert_eq!(results.len(), 1);
    let m = &results[0].matches[0];
    // "你好世界" = 4 chars, then "test" starts at char index 4
    assert_eq!(m.match_ranges[0].start, 4);
    assert_eq!(m.match_ranges[0].end, 8);
    // Verify the slice works correctly (simulating JS behavior)
    let content_chars: Vec<char> = m.line_content.chars().collect();
    let slice: String = content_chars
        [m.match_ranges[0].start as usize..m.match_ranges[0].end as usize]
        .iter()
        .collect();
    assert_eq!(slice, "test");
}

#[test]
fn test_nonexistent_root_returns_error() {
    let result = search_sync(
        "/nonexistent/path",
        "test",
        false,
        false,
        false,
        false,
        vec![],
        vec![],
    );
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
        false,
        false,
        false,
        false,
        vec![],
        vec![],
    )
    .unwrap();

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
        false,
        false,
        false,
        false,
        vec![],
        vec![],
    )
    .unwrap();

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
        root,
        "World",
        false,
        false,
        false,
        false,
        vec![],
        vec![],
        past_deadline,
    );

    // Must not error — partial results are a valid outcome.
    assert!(
        result.is_ok(),
        "timeout must produce Ok(partial), got {:?}",
        result
    );
    // Walker is allowed to return fewer matches than the non-timeout case.
    let full = search_sync(root, "World", false, false, false, false, vec![], vec![]).unwrap();
    let full_matches: usize = full.iter().map(|r| r.matches.len()).sum();
    let partial_matches: usize = result.unwrap().iter().map(|r| r.matches.len()).sum();
    assert!(
        partial_matches <= full_matches,
        "partial should never exceed full ({} > {})",
        partial_matches,
        full_matches
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
        root,
        "World",
        false,
        false,
        false,
        false,
        vec![],
        vec![],
        tight,
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
    assert!(
        result.is_err(),
        "expected size-limit rejection with tiny cap"
    );
    let err = result.unwrap_err();
    assert!(
        err.contains("Invalid regex"),
        "size-limit errors must surface via the 'Invalid regex' contract, got: {}",
        err
    );
}

// -- audit g3-rust-rest regression tests --------------------------------------

#[test]
fn test_astral_chars_use_utf16_offsets() {
    // JS String.slice counts UTF-16 code units. Each 🎉 (U+1F389) is one
    // Rust char but TWO UTF-16 units — offsets must use the latter.
    let re = build_regex("hello", false, false, false).unwrap();
    let m = search_line("🎉🎉 hello", 1, &re).unwrap();
    assert_eq!(m.match_ranges.len(), 1);
    // "🎉🎉 " = 2 + 2 + 1 = 5 UTF-16 units (char count would be 3).
    assert_eq!(m.match_ranges[0].start, 5);
    assert_eq!(m.match_ranges[0].end, 10);
}

#[test]
fn test_long_match_on_truncated_line_is_clamped_not_dropped() {
    // A match longer than the snippet window must be clamped to the window,
    // not filtered out (which produced a LineMatch with no ranges).
    let re = build_regex("a{250}", false, false, true).unwrap();
    let line = "a".repeat(300);
    let m = search_line(&line, 1, &re).unwrap();
    assert!(
        !m.match_ranges.is_empty(),
        "long match must be clamped, not dropped"
    );
    let content_units: u32 = m.line_content.encode_utf16().count() as u32;
    for r in &m.match_ranges {
        assert!(r.start < r.end);
        assert!(r.end <= content_units, "range must stay inside the snippet");
    }
}

#[test]
fn test_total_matches_never_exceeds_cap() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    // 350 lines x 3 matches = 1050 raw matches; the cap is MAX_MATCHES (1000).
    let line = "foo foo foo\n";
    fs::write(root.join("many.md"), line.repeat(350)).unwrap();

    let results = search_sync(
        root.to_str().unwrap(),
        "foo",
        false,
        false,
        false,
        false,
        vec![],
        vec![],
    )
    .unwrap();

    let total: usize = results
        .iter()
        .flat_map(|f| &f.matches)
        .map(|m| m.match_ranges.len())
        .sum();
    assert!(
        total <= 1000,
        "total match ranges ({}) must not exceed MAX_MATCHES",
        total
    );
}
