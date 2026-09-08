//! WI-FL5.6 — the built-in action steps' sandbox refusals and limits.
//!
//! Every file action goes through `sandbox::validate_path`; these tests pin
//! what a workflow author sees at the ACTION level — the refusal, and that
//! nothing was written or read outside the workspace — plus the three size
//! and count limits. `runner.test.rs` already covers notify/copy/unknown,
//! the accept-pattern matcher and the read-folder symlink cases; none of
//! that is repeated here.

use super::execute_action;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const TEN_MB: u64 = 10 * 1024 * 1024;

fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// A workspace INSIDE a parent directory the test owns, so `../escape`
/// resolves to a place we can prove stayed untouched.
fn workspace() -> (tempfile::TempDir, PathBuf) {
    let parent = tempfile::tempdir().expect("tempdir");
    let ws = parent.path().join("ws");
    fs::create_dir(&ws).expect("mkdir ws");
    (parent, ws)
}

/// A file with the given length and no data blocks: `metadata().len()` is
/// what the limits read, and a sparse file makes a 10 MB fixture free.
fn sparse_file(path: &Path, len: u64) {
    let file = fs::File::create(path).expect("create");
    file.set_len(len).expect("set_len");
}

// ── save-file ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn save_file_refuses_a_path_that_climbs_out_of_the_workspace() {
    let (parent, ws) = workspace();
    let err = execute_action(
        "action/save-file",
        &params(&[("path", "../escape.txt"), ("input", "x")]),
        &ws,
    )
    .await
    .expect_err("`..` must be refused");
    assert!(err.contains("outside the workspace root"), "got: {err}");
    assert!(
        !parent.path().join("escape.txt").exists(),
        "nothing may be written outside"
    );
}

#[tokio::test]
async fn save_file_refuses_an_absolute_path_outside_the_workspace() {
    let (_parent, ws) = workspace();
    let outside = tempfile::tempdir().expect("outside");
    let target = outside.path().join("dropped.txt");
    let err = execute_action(
        "action/save-file",
        &params(&[("path", target.to_str().unwrap()), ("input", "x")]),
        &ws,
    )
    .await
    .expect_err("absolute outside path must be refused");
    assert!(err.contains("outside the workspace root"), "got: {err}");
    assert!(!target.exists());
}

#[cfg(unix)]
#[tokio::test]
async fn save_file_refuses_writing_through_a_symlinked_directory_that_escapes() {
    let (_parent, ws) = workspace();
    let outside = tempfile::tempdir().expect("outside");
    std::os::unix::fs::symlink(outside.path(), ws.join("links")).expect("symlink");
    let err = execute_action(
        "action/save-file",
        &params(&[("path", "links/new.txt"), ("input", "x")]),
        &ws,
    )
    .await
    .expect_err("symlink escape must be refused");
    assert!(err.contains("resolves via symlink"), "got: {err}");
    assert!(!outside.path().join("new.txt").exists());
}

#[tokio::test]
async fn save_file_writes_inside_the_workspace_and_creates_missing_parents() {
    let (_parent, ws) = workspace();
    let out = execute_action(
        "action/save-file",
        &params(&[("path", "sub/dir/new.txt"), ("input", "written by a step")]),
        &ws,
    )
    .await
    .expect("inside the workspace");
    assert_eq!(out, "Saved to sub/dir/new.txt");
    assert_eq!(
        fs::read_to_string(ws.join("sub/dir/new.txt")).expect("read"),
        "written by a step"
    );
}

#[tokio::test]
async fn save_file_requires_both_path_and_input() {
    let (_parent, ws) = workspace();
    let err = execute_action("action/save-file", &params(&[("input", "x")]), &ws)
        .await
        .expect_err("no path");
    assert_eq!(err, "action/save-file requires 'path' parameter");

    let err = execute_action("action/save-file", &params(&[("path", "a.txt")]), &ws)
        .await
        .expect_err("no input");
    assert_eq!(err, "action/save-file requires 'input' parameter");
    assert!(!ws.join("a.txt").exists(), "a refused save writes nothing");
}

// ── read-file ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn read_file_refuses_a_path_outside_the_workspace_without_leaking_it() {
    let (parent, ws) = workspace();
    fs::write(parent.path().join("secret.txt"), "TOP-SECRET").expect("write secret");
    let err = execute_action(
        "action/read-file",
        &params(&[("path", "../secret.txt")]),
        &ws,
    )
    .await
    .expect_err("must be refused");
    assert!(err.contains("outside the workspace root"), "got: {err}");
    assert!(!err.contains("TOP-SECRET"));
}

#[tokio::test]
async fn read_file_refuses_a_file_over_the_10_mb_limit() {
    let (_parent, ws) = workspace();
    sparse_file(&ws.join("big.md"), TEN_MB + 1);
    let err = execute_action("action/read-file", &params(&[("path", "big.md")]), &ws)
        .await
        .expect_err("over the limit");
    assert!(err.contains("too large"), "got: {err}");
}

#[tokio::test]
async fn read_file_accepts_a_file_exactly_at_the_10_mb_limit() {
    let (_parent, ws) = workspace();
    sparse_file(&ws.join("edge.md"), TEN_MB);
    let text = execute_action("action/read-file", &params(&[("path", "edge.md")]), &ws)
        .await
        .expect("at the limit is allowed");
    assert_eq!(text.len() as u64, TEN_MB);
}

#[tokio::test]
async fn read_file_requires_a_path_parameter() {
    let (_parent, ws) = workspace();
    let err = execute_action("action/read-file", &HashMap::new(), &ws)
        .await
        .expect_err("no path");
    assert_eq!(err, "action/read-file requires 'path' parameter");
}

// ── read-folder ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn read_folder_refuses_a_directory_outside_the_workspace() {
    let (_parent, ws) = workspace();
    let err = execute_action("action/read-folder", &params(&[("path", "..")]), &ws)
        .await
        .expect_err("must be refused");
    assert!(err.contains("outside the workspace root"), "got: {err}");
}

#[tokio::test]
async fn read_folder_refuses_more_than_1000_entries() {
    let (_parent, ws) = workspace();
    for i in 0..1001 {
        fs::write(ws.join(format!("f{i}.md")), "").expect("write");
    }
    let err = execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect_err("over the count limit");
    assert!(err.contains("exceeds max file limit (1000)"), "got: {err}");
}

#[tokio::test]
async fn read_folder_accepts_exactly_1000_entries() {
    let (_parent, ws) = workspace();
    for i in 0..1000 {
        fs::write(ws.join(format!("f{i}.md")), "").expect("write");
    }
    execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect("at the count limit is allowed");
}

#[tokio::test]
async fn read_folder_skips_a_single_oversized_file_and_reads_the_rest() {
    let (_parent, ws) = workspace();
    sparse_file(&ws.join("big.md"), TEN_MB + 1);
    fs::write(ws.join("small.md"), "SMALL-OK").expect("write");
    let out = execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect("an oversized entry is skipped, not fatal");
    assert!(out.contains("--- small.md ---\nSMALL-OK"), "got: {out}");
    assert!(!out.contains("--- big.md ---"), "got: {out}");
}

#[tokio::test]
async fn read_folder_refuses_when_the_total_read_would_pass_100_mb() {
    // Oversized entries are SKIPPED, so the 100 MB total can only be reached
    // by ≥ 11 files of ≤ 10 MB each: ten at the per-file limit plus one byte.
    // The sparse files cost nothing on disk; the read is ~100 MB of zeros.
    let (_parent, ws) = workspace();
    for i in 0..10 {
        sparse_file(&ws.join(format!("ten-{i}.md")), TEN_MB);
    }
    fs::write(ws.join("one-byte.md"), "x").expect("write");
    let err = execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect_err("over the total limit");
    assert!(err.contains("Total read size exceeds limit"), "got: {err}");
}

#[tokio::test]
async fn read_folder_applies_the_accept_filter() {
    let (_parent, ws) = workspace();
    fs::write(ws.join("notes.md"), "MD-OK").expect("write");
    fs::write(ws.join("notes.txt"), "TXT-NO").expect("write");
    let out = execute_action(
        "action/read-folder",
        &params(&[("path", "."), ("accept", "*.md")]),
        &ws,
    )
    .await
    .expect("read");
    assert!(out.contains("MD-OK"), "got: {out}");
    assert!(!out.contains("TXT-NO"), "got: {out}");
}

#[tokio::test]
async fn read_folder_skips_subdirectories() {
    let (_parent, ws) = workspace();
    fs::create_dir(ws.join("sub")).expect("mkdir");
    fs::write(ws.join("sub").join("nested.md"), "NESTED").expect("write");
    fs::write(ws.join("top.md"), "TOP").expect("write");
    let out = execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect("read");
    assert!(out.contains("--- top.md ---\nTOP"), "got: {out}");
    assert!(!out.contains("--- sub ---"), "got: {out}");
    assert!(
        !out.contains("NESTED"),
        "read-folder is not recursive: {out}"
    );
}

// ── #255: folder order is by file name, not by the filesystem ───────────────

#[tokio::test]
async fn read_folder_returns_entries_sorted_by_name_regardless_of_creation_order() {
    let (_parent, ws) = workspace();
    for name in ["delta.md", "bravo.md", "echo.md", "alpha.md", "charlie.md"] {
        fs::write(ws.join(name), name).expect("write");
    }
    let out = execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect("read");
    let order: Vec<&str> = out
        .lines()
        .filter_map(|l| l.strip_prefix("--- ").and_then(|l| l.strip_suffix(" ---")))
        .collect();
    assert_eq!(
        order,
        ["alpha.md", "bravo.md", "charlie.md", "delta.md", "echo.md"]
    );
}

/// The ordering key is the same on every platform, and that is what makes
/// "identical folders feed a workflow identically" true rather than hopeful.
///
/// `OsString`'s `Ord` compares the ENCODED BYTES: raw bytes on Unix, WTF-8 on
/// Windows (`std::sys::os_str`). For any name that can exist on both — i.e.
/// valid Unicode — those two encodings are the same bytes, and UTF-8 byte
/// order is code-point order. So this asserts the property directly: sorting
/// as `OsString` agrees with sorting the UTF-8 bytes, including for
/// non-ASCII, combining marks and astral characters, where a UTF-16 order
/// (which Windows filenames are STORED in) would disagree.
#[test]
fn os_string_order_is_utf8_byte_order_so_every_platform_agrees() {
    use std::ffi::OsString;
    // `\u{10000}` sorts AFTER `\u{ffff}` by code point and BEFORE it in
    // UTF-16 code-unit order — the one case where the encodings disagree.
    let names = [
        "Z.md",
        "a.md",
        "e\u{301}.md",
        "\u{e9}.md",
        "\u{4e2d}\u{6587}.md",
        "\u{ffff}.md",
        "\u{10000}.md",
        "zz.md",
    ];

    let mut as_os: Vec<OsString> = names.iter().map(OsString::from).collect();
    as_os.sort();
    let mut as_bytes: Vec<&str> = names.to_vec();
    as_bytes.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

    assert_eq!(
        as_os
            .iter()
            .map(|n| n.to_str().expect("valid unicode fixture"))
            .collect::<Vec<_>>(),
        as_bytes,
        "read_folder sorts by OsString; it must agree with UTF-8 byte order"
    );
}

// ── #256: only bytes actually read are charged to the total ─────────────────

#[tokio::test]
async fn read_folder_does_not_charge_the_budget_for_a_file_it_could_not_read() {
    // Ten files at the per-file limit fill the 100 MB total exactly; a
    // one-byte file that is not UTF-8 is skipped, and skipped means unpaid —
    // charging it before the read (as the metadata size check once did)
    // would refuse the whole folder for a file that contributed nothing.
    let (_parent, ws) = workspace();
    for i in 0..10 {
        sparse_file(&ws.join(format!("ten-{i}.md")), TEN_MB);
    }
    fs::write(ws.join("not-utf8.md"), [0xffu8]).expect("write");
    let out = execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect("an unreadable file is skipped, not charged");
    assert!(
        !out.contains("--- not-utf8.md ---"),
        "the skipped file's CONTENT must not appear"
    );
    assert_eq!(out.matches("--- ten-").count(), 10);
    // ...and the read now SAYS it was partial (audit 20260907 #510). It was
    // only ever a log line before, which the next workflow step cannot read.
    assert!(
        out.contains("--- skipped (1) ---") && out.contains("not-utf8.md: not valid UTF-8"),
        "a partial read must announce itself: {}",
        out.lines().rev().take(3).collect::<Vec<_>>().join(" | ")
    );
}

// #511 — and the same rule when the BUDGET is what noticed. The check that
// refuses an over-budget read runs before any decode, so the identical
// directory succeeded or failed on filename ORDER: `not-utf8.md` sorts before
// `ten-*` and was free, while a name sorting after them refused the whole
// folder for a file that contributes nothing either way.
#[tokio::test]
async fn a_file_that_is_not_utf8_is_skipped_even_when_the_budget_is_exhausted() {
    let (_parent, ws) = workspace();
    for i in 0..10 {
        sparse_file(&ws.join(format!("a-{i}.md")), TEN_MB);
    }
    // Sorts LAST, so the remaining budget is zero when it is reached.
    fs::write(ws.join("zz-not-utf8.md"), [0xffu8]).expect("write");
    let out = execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect("a file that is not text does not refuse the folder");
    assert!(
        !out.contains("--- zz-not-utf8.md ---"),
        "the skipped file's CONTENT must not appear"
    );
    assert_eq!(out.matches("--- a-").count(), 10);
    assert!(
        out.contains("--- skipped (1) ---") && out.contains("zz-not-utf8.md: not valid UTF-8"),
        "a partial read must announce itself (#510)"
    );
}

// The other direction is unchanged: a real file that would carry the total
// past its budget still refuses the folder, whatever its position.
#[tokio::test]
async fn a_text_file_past_the_remaining_budget_still_refuses_the_folder() {
    let (_parent, ws) = workspace();
    for i in 0..10 {
        sparse_file(&ws.join(format!("a-{i}.md")), TEN_MB);
    }
    fs::write(ws.join("zz-text.md"), "still text").expect("write");
    let err = execute_action("action/read-folder", &params(&[("path", ".")]), &ws)
        .await
        .expect_err("over the total");
    assert!(err.contains("Total read size exceeds limit"), "{err}");
}

// ── disallowed action ───────────────────────────────────────────────────────

#[tokio::test]
async fn prompt_is_refused_with_the_documented_message() {
    let (_parent, ws) = workspace();
    let err = execute_action("action/prompt", &HashMap::new(), &ws)
        .await
        .expect_err("no interactive prompts in a workflow");
    assert_eq!(
        err,
        rust_i18n::t!("errors.workflow.noInteractivePrompt").to_string()
    );
}

// ── #270: the required-parameter table IS the executor's contract ────────────

#[tokio::test]
async fn every_parameter_in_the_table_is_one_the_executor_refuses_without() {
    // For each action, drop one required parameter while supplying the rest
    // and expect the exact refusal. A table row the executor does not enforce
    // — or an enforced parameter missing from the table — fails here.
    let (_parent, ws) = workspace();
    fs::write(ws.join("in.md"), "x").expect("write");
    for action in ["read-file", "read-folder", "save-file"] {
        let required = super::required_params(action);
        assert!(!required.is_empty(), "{action} has a contract");
        for missing in required {
            let supplied: Vec<(&str, &str)> = required
                .iter()
                .filter(|p| p != &missing)
                .map(|p| (*p, if *p == "path" { "in.md" } else { "x" }))
                .collect();
            let err = execute_action(&format!("action/{action}"), &params(&supplied), &ws)
                .await
                .expect_err("a missing required parameter is refused");
            assert_eq!(
                err,
                format!("action/{action} requires '{missing}' parameter")
            );
        }
    }
    assert!(super::required_params("notify").is_empty());
}

// ── #253: only regular files are read ────────────────────────────────────────

#[cfg(unix)]
#[tokio::test]
async fn read_file_refuses_a_fifo_instead_of_blocking_on_it() {
    let (_parent, ws) = workspace();
    let fifo = ws.join("pipe.md");
    let c_path = std::ffi::CString::new(fifo.to_str().unwrap()).expect("cstring");
    assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0, "mkfifo");
    let err = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        execute_action("action/read-file", &params(&[("path", "pipe.md")]), &ws),
    )
    .await
    .expect("must not block on the FIFO")
    .expect_err("a FIFO is not a regular file");
    assert!(err.contains("not a regular file"), "got: {err}");
}

// ── #254: the limit is measured on the bytes read ────────────────────────────

#[tokio::test]
async fn read_bounded_refuses_a_file_over_the_limit_on_the_bytes_it_reads() {
    use crate::bounded_read::BoundedReadError;
    let (_parent, ws) = workspace();
    let path = ws.join("grown.md");
    fs::write(&path, vec![b'a'; 101]).expect("write");
    // The metadata says 101 too, but the point is the read itself refuses.
    let err = super::read_bounded(&path, 100)
        .await
        .expect_err("101 > 100");
    assert!(
        matches!(err, BoundedReadError::TooLarge { limit: 100 }),
        "{err:?}"
    );
    assert_eq!(
        super::read_bounded(&path, 101).await.expect("read").len(),
        101
    );
}

// ── #257: the commit re-checks the parent on the writing thread ─────────────

#[cfg(unix)]
#[test]
fn the_commit_refuses_a_parent_that_now_resolves_outside_the_workspace() {
    // What a symlink swapped in between validation and the write looks like
    // at commit time: `ws/out` points outside. The commit resolves the parent
    // itself and refuses; nothing lands where the link points.
    let (_parent, ws) = workspace();
    let outside = tempfile::tempdir().expect("outside");
    std::os::unix::fs::symlink(outside.path(), ws.join("out")).expect("symlink");
    let err = super::commit_inside_workspace(&ws.join("out").join("new.txt"), &ws, b"x")
        .expect_err("the parent escapes");
    assert!(err.contains("outside the workspace"), "got: {err}");
    assert!(!outside.path().join("new.txt").exists());
}

#[test]
fn the_commit_writes_through_the_canonical_parent_inside_the_workspace() {
    let (_parent, ws) = workspace();
    fs::create_dir(ws.join("sub")).expect("mkdir");
    super::commit_inside_workspace(&ws.join("sub").join("doc.md"), &ws, b"committed")
        .expect("inside");
    assert_eq!(
        fs::read_to_string(ws.join("sub").join("doc.md")).expect("read"),
        "committed"
    );
}

// ── #258: a save replaces atomically ─────────────────────────────────────────

#[tokio::test]
async fn save_file_replaces_an_existing_file_atomically_and_leaves_no_temp_file() {
    let (_parent, ws) = workspace();
    fs::write(ws.join("doc.md"), "old").expect("write");
    execute_action(
        "action/save-file",
        &params(&[("path", "doc.md"), ("input", "new content")]),
        &ws,
    )
    .await
    .expect("save");
    assert_eq!(
        fs::read_to_string(ws.join("doc.md")).expect("read"),
        "new content"
    );
    let names: Vec<String> = fs::read_dir(&ws)
        .expect("read_dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec!["doc.md".to_string()], "no temp file survives");
}

/// #495 — the `action/*` namespace is required, not stripped when present.
///
/// `strip_prefix("action/").unwrap_or(uses)` ran a bare `read-file` as if it
/// had been spelled correctly, so the module's own contract held only because
/// `runner.rs` happens to route on the prefix. A second accepted syntax that
/// nothing documents is how a typo becomes a feature.
#[tokio::test]
async fn a_step_without_the_action_namespace_is_refused_rather_than_run() {
    let ws = tempfile::tempdir().expect("tempdir");
    let err = execute_action("read-file", &params(&[("path", "a.txt")]), ws.path())
        .await
        .expect_err("a bare name is not an action/* step");
    assert!(
        err.contains("action/<name>"),
        "the refusal must say what the name should look like, got: {err}"
    );
}

/// The prefixed spelling still routes — the refusal above must not have made
/// every built-in step unreachable.
#[tokio::test]
async fn the_prefixed_spelling_still_reaches_its_action() {
    let ws = tempfile::tempdir().expect("tempdir");
    std::fs::write(ws.path().join("a.txt"), b"hello").expect("write");
    let out = execute_action("action/read-file", &params(&[("path", "a.txt")]), ws.path())
        .await
        .expect("a real action/read-file step");
    assert_eq!(out, "hello");
}
