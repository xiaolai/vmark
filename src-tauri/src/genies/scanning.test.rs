//! Tests for `genies/scanning.rs` (WI-5.4, #144). Loaded via `#[path]`.

use super::*;
use std::collections::HashMap;
use std::ffi::OsStr;
use tempfile::tempdir;

#[test]
fn classify_recognizes_md_and_yaml_case_insensitively() {
    assert_eq!(classify(Some(OsStr::new("md"))), Some(GenieKind::Markdown));
    assert_eq!(classify(Some(OsStr::new("MD"))), Some(GenieKind::Markdown));
    assert_eq!(classify(Some(OsStr::new("yml"))), Some(GenieKind::Workflow));
    assert_eq!(
        classify(Some(OsStr::new("YAML"))),
        Some(GenieKind::Workflow)
    );
    assert_eq!(classify(Some(OsStr::new("txt"))), None);
    assert_eq!(classify(None), None);
}

#[test]
fn scan_derives_categories_from_subdirs_and_skips_non_genies() {
    let dir = tempdir().unwrap();
    let base = dir.path();
    std::fs::write(base.join("top.md"), "x").unwrap();
    let sub = base.join("writing");
    std::fs::create_dir(&sub).unwrap();
    std::fs::write(sub.join("clarity.md"), "x").unwrap();
    std::fs::write(sub.join("flow.yml"), "x").unwrap();
    std::fs::write(base.join("notgenie.txt"), "x").unwrap();

    let mut entries = HashMap::new();
    scan_genies_dir(base, base, "global", &mut entries);

    // top.md + writing/clarity.md + writing/flow.yml; .txt skipped.
    assert_eq!(entries.len(), 3);
    assert_eq!(entries.get("top.md").unwrap().category, None);
    assert_eq!(entries.get("top.md").unwrap().kind, GenieKind::Markdown);
    let clarity = entries.get("writing/clarity.md").unwrap();
    assert_eq!(clarity.category.as_deref(), Some("writing"));
    assert_eq!(
        entries.get("writing/flow.yml").unwrap().kind,
        GenieKind::Workflow
    );
}

#[test]
#[cfg(unix)]
fn scan_skips_symlinks() {
    let dir = tempdir().unwrap();
    let base = dir.path();
    let real = base.join("real.md");
    std::fs::write(&real, "x").unwrap();
    std::os::unix::fs::symlink(&real, base.join("link.md")).unwrap();

    let mut entries = HashMap::new();
    scan_genies_dir(base, base, "global", &mut entries);
    assert!(entries.contains_key("real.md"));
    assert!(!entries.contains_key("link.md"));
}

#[test]
fn scan_menu_titles_are_sorted() {
    let dir = tempdir().unwrap();
    let base = dir.path();
    std::fs::write(base.join("zebra.md"), "x").unwrap();
    std::fs::write(base.join("alpha.md"), "x").unwrap();
    let menu = scan_genies_with_titles(base);
    let titles: Vec<&str> = menu.iter().map(|m| m.title.as_str()).collect();
    assert_eq!(titles, vec!["alpha", "zebra"]);
}

// -- #144: the walk is bounded in depth and in entries ------------------

/// `base/d1/d2/.../d<levels>/deep.md`, returning the deepest directory.
fn nested(base: &Path, levels: usize) -> PathBuf {
    let mut dir = base.to_path_buf();
    for i in 1..=levels {
        dir.push(format!("d{i}"));
    }
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("deep.md"), "x").unwrap();
    dir
}

#[test]
fn a_directory_past_the_depth_cap_is_not_entered() {
    let dir = tempdir().unwrap();
    let base = dir.path();
    nested(base, 3);
    std::fs::write(base.join("d1").join("shallow.md"), "x").unwrap();

    let mut seen = Vec::new();
    let truncated = walk_bounded(base, 2, MAX_SCAN_ENTRIES, |p, _| {
        seen.push(p.file_name().unwrap().to_string_lossy().to_string())
    });
    assert!(truncated, "d1/d2/d3 is deeper than the cap of 2");
    assert_eq!(seen, vec!["shallow.md"], "d3's file is never reached");
}

#[test]
fn a_tree_within_the_depth_cap_is_walked_whole() {
    let dir = tempdir().unwrap();
    let base = dir.path();
    nested(base, 2);
    let mut seen = 0;
    let truncated = walk_bounded(base, 2, MAX_SCAN_ENTRIES, |_, _| seen += 1);
    assert!(!truncated);
    assert_eq!(seen, 1);
}

#[test]
fn the_walk_stops_after_the_entry_cap() {
    let dir = tempdir().unwrap();
    let base = dir.path();
    for i in 0..20 {
        std::fs::write(base.join(format!("g{i:02}.md")), "x").unwrap();
    }
    let mut seen = 0;
    let truncated = walk_bounded(base, MAX_SCAN_DEPTH, 5, |_, _| seen += 1);
    assert!(truncated, "20 entries exceed a cap of 5");
    assert_eq!(seen, 5, "exactly the cap is visited, then the walk stops");
}

#[test]
fn a_pathologically_deep_tree_is_bounded_work_not_a_stack() {
    // 64 levels — far past MAX_SCAN_DEPTH. The old recursion descended
    // all of it; the walk stops entering at the cap and never sees the
    // file at the bottom.
    let dir = tempdir().unwrap();
    let base = dir.path();
    nested(base, 64);
    let mut entries = HashMap::new();
    scan_genies_dir(base, base, "global", &mut entries);
    assert!(entries.is_empty(), "{entries:?}");
    assert!(scan_genies_with_titles(base).is_empty());
}

/// A FIFO named `x.md` is not a genie (#352).
///
/// The scan used to accept anything that was neither a directory nor a
/// symlink, so a pipe, a socket or a device node with a registered extension
/// was listed in the picker. `bounded_read` refuses to open one, so the row
/// could only ever fail when clicked — and the reason the reader passes
/// `O_NONBLOCK` at all is that opening a FIFO for reading otherwise blocks
/// until a writer appears, which for a planted pipe never happens.
#[cfg(unix)]
#[test]
fn a_fifo_with_a_genie_extension_is_not_listed() {
    let dir = tempdir().unwrap();
    let base = dir.path();
    std::fs::write(base.join("real.md"), "x").unwrap();
    let fifo = base.join("pipe.md");
    let c_path = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0, "mkfifo");

    let mut entries = HashMap::new();
    scan_genies_dir(base, base, "global", &mut entries);

    assert!(
        entries.contains_key("real.md"),
        "the regular file is listed"
    );
    assert!(
        !entries.contains_key("pipe.md"),
        "a FIFO is not a genie, however it is named: {:?}",
        entries.keys().collect::<Vec<_>>()
    );
}

// #353 — `char::is_control` does not cover the bidi format characters, which
// are `Cf`. A RIGHT-TO-LEFT OVERRIDE in a filename reorders everything after
// it, so the picker's label read as a completely different file — in a list
// the user clicks to run something.
#[test]
fn a_bidi_override_is_stripped_from_the_label_like_a_control_character() {
    let path = std::path::Path::new("/g/harmless\u{202E}gnp.exe.md");
    assert_eq!(display_name(path), "harmlessgnp.exe");
}

// And a stem that is NOTHING but those characters must not leave an empty row,
// which names no file at all.
#[test]
fn a_stem_made_only_of_hidden_characters_falls_back_to_the_file_name() {
    let path = std::path::Path::new("/g/\u{202E}\u{200F}.md");
    assert_eq!(display_name(path), ".md");
}

// #355 — a path that is not UTF-8 reaches the picker as a lossy string, and
// `read_genie` then canonicalizes THAT and fails. Never list a row that can
// only fail (the same rule the FIFO check already applies).
#[cfg(unix)]
#[test]
fn a_genie_whose_path_is_not_utf8_is_skipped_and_the_scan_says_so() {
    use std::os::unix::ffi::OsStrExt;

    let dir = tempdir().unwrap();
    let base = dir.path();
    std::fs::write(base.join("fine.md"), "x").unwrap();
    let bad = base.join(std::ffi::OsStr::from_bytes(b"br\xffoken.md"));
    // APFS enforces UTF-8 names and refuses this with EILSEQ, so the case
    // cannot be built on the dev platform at all; it is real on ext4, which is
    // where CI's Linux leg runs this.
    if std::fs::write(&bad, "x").is_err() {
        return;
    }

    let mut entries = HashMap::new();
    scan_genies_dir(base, base, "global", &mut entries);
    assert_eq!(entries.len(), 1, "{entries:?}");
    assert!(entries.contains_key("fine.md"));

    let mut seen = Vec::new();
    let incomplete = walk_genie_files(base, |path, _| seen.push(path.to_path_buf()));
    assert!(incomplete, "the skip is reported as an incomplete listing");
}

// #340 — a directory that cannot be LISTED used to produce an empty result
// indistinguishable from a user with no genies. It is now reported.
#[cfg(unix)]
#[test]
fn a_directory_that_cannot_be_listed_reports_an_incomplete_scan() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let closed = dir.path().join("closed");
    std::fs::create_dir(&closed).unwrap();
    std::fs::write(closed.join("hidden.md"), "x").unwrap();
    std::fs::set_permissions(&closed, std::fs::Permissions::from_mode(0o000)).unwrap();

    let readable_anyway = std::fs::read_dir(&closed).is_ok();
    let incomplete = walk_genie_files(dir.path(), |_, _| {});
    std::fs::set_permissions(&closed, std::fs::Permissions::from_mode(0o700)).unwrap();
    // Root ignores the mode bits, so there is nothing to assert there.
    if readable_anyway {
        return;
    }
    assert!(incomplete, "an unreadable directory is not an empty one");
}

// #341 — two genies in different categories share a stem, so the title alone
// does not order them. Filesystem order made the menu differ between runs.
#[test]
fn menu_entries_with_the_same_title_are_ordered_by_path() {
    let dir = tempdir().unwrap();
    let base = dir.path();
    for category in ["writing", "code"] {
        let sub = base.join(category);
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("summarize.md"), "x").unwrap();
    }
    let titles: Vec<(String, String)> = scan_genies_with_titles(base)
        .into_iter()
        .map(|e| (e.title, e.path))
        .collect();
    assert_eq!(titles.len(), 2);
    assert_eq!(titles[0].0, titles[1].0);
    assert!(titles[0].1 < titles[1].1, "{titles:?}");
}
