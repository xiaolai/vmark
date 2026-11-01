// WI-RA11.3 — the directory walk: one deadline budget for every loop, and one
// `file_type()` per entry deciding what is entered, scanned or left alone.

use super::super::matching::build_regex;
use super::*;
use std::time::Duration;
use tempfile::tempdir;

fn past() -> DeadlineBudget {
    DeadlineBudget::until(Instant::now() - Duration::from_secs(1))
}

fn future() -> DeadlineBudget {
    DeadlineBudget::until(Instant::now() + Duration::from_secs(60))
}

/// A plan over `root` with the given budget; `markdown` limits files to `.md`.
fn with_plan<T>(
    root: &Path,
    budget: DeadlineBudget,
    markdown: bool,
    exclude: &[&str],
    run: impl FnOnce(&SearchPlan) -> T,
) -> T {
    let re = build_regex("probe", false, false, false).unwrap();
    let extensions = vec!["md".to_string()];
    let exclude_folders: Vec<String> = exclude.iter().map(|e| e.to_string()).collect();
    run(&SearchPlan {
        re: &re,
        root,
        markdown_only: markdown,
        extensions: &extensions,
        exclude_folders: &exclude_folders,
        budget,
    })
}

fn names(paths: &[PathBuf]) -> Vec<String> {
    let mut names: Vec<String> = paths
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

// ── DeadlineBudget ───────────────────────────────────────────────────────────

#[test]
fn a_budget_with_time_left_is_never_spent() {
    let budget = future();
    assert!(!budget.spent());
    assert!((0..1024).all(|step| !budget.spent_at_step(step)));
}

#[test]
fn a_spent_budget_is_noticed_on_the_first_step_and_then_once_per_stride() {
    let budget = past();
    assert!(budget.spent());
    let noticed: Vec<usize> = (0..=2 * DEADLINE_CHECK_STRIDE)
        .filter(|step| budget.spent_at_step(*step))
        .collect();
    assert_eq!(
        noticed,
        vec![0, DEADLINE_CHECK_STRIDE, 2 * DEADLINE_CHECK_STRIDE]
    );
}

// ── one directory level ──────────────────────────────────────────────────────

#[test]
fn a_level_separates_files_to_scan_from_directories_to_enter() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    for file in ["b.md", "a.txt", "笔记.md", ".hidden.md"] {
        fs::write(root.join(file), "x").unwrap();
    }
    for sub in ["zeta", "alpha", ".github", "node_modules", "skipme"] {
        fs::create_dir(root.join(sub)).unwrap();
    }

    let level = with_plan(root, future(), false, &["skipme"], |plan| {
        list_dir_level(root, plan).expect("root is readable")
    });

    assert!(level.fully_listed);
    assert_eq!(names(&level.files), vec!["a.txt", "b.md", "笔记.md"]);
    // Sorted by path, in the order the walk relies on — not merely as a set.
    let subdirs: Vec<String> = level
        .subdirs
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        .collect();
    assert_eq!(subdirs, vec![".github", "alpha", "zeta"]);
}

#[test]
fn markdown_only_filters_files_and_never_directories() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("a.MD"), "x").unwrap();
    fs::write(root.join("b.txt"), "x").unwrap();
    fs::write(root.join("noext"), "x").unwrap();
    fs::create_dir(root.join("notes.txt")).unwrap();

    let level = with_plan(root, future(), true, &[], |plan| {
        list_dir_level(root, plan).unwrap()
    });

    assert_eq!(names(&level.files), vec!["a.MD"]);
    assert_eq!(names(&level.subdirs), vec!["notes.txt"]);
}

#[cfg(unix)]
#[test]
fn links_are_neither_scanned_nor_entered() {
    let dir = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret.md"), "probe").unwrap();
    let root = dir.path();
    fs::write(root.join("real.md"), "x").unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.md"), root.join("file-link.md"))
        .unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("dir-link")).unwrap();
    std::os::unix::fs::symlink(root.join("gone"), root.join("dangling.md")).unwrap();

    let level = with_plan(root, future(), false, &[], |plan| {
        list_dir_level(root, plan).unwrap()
    });

    assert_eq!(names(&level.files), vec!["real.md"]);
    assert!(level.subdirs.is_empty());
}

/// A socket is neither a file nor a directory. Opening one to "check whether
/// it is binary" can block; it must never get as far as an open.
#[cfg(unix)]
#[test]
fn an_entry_that_is_not_a_regular_file_is_left_alone() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let _listener = std::os::unix::net::UnixListener::bind(root.join("sock")).unwrap();
    fs::write(root.join("real.md"), "probe\n").unwrap();

    let level = with_plan(root, future(), false, &[], |plan| {
        list_dir_level(root, plan).unwrap()
    });
    assert_eq!(names(&level.files), vec!["real.md"]);

    let tally = with_plan(root, future(), false, &[], walk);
    assert_eq!(tally.results.len(), 1);
    assert!(tally.complete, "a special file is not missing evidence");
}

#[test]
fn a_directory_that_cannot_be_read_has_no_level() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("gone");
    let level = with_plan(dir.path(), future(), false, &[], |plan| {
        list_dir_level(&missing, plan)
    });
    assert!(level.is_none());
}

#[test]
fn a_spent_budget_lists_nothing_and_says_the_listing_is_partial() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("a.md"), "x").unwrap();

    let level = with_plan(dir.path(), past(), false, &[], |plan| {
        list_dir_level(dir.path(), plan).unwrap()
    });

    assert!(!level.fully_listed);
    assert!(level.files.is_empty());
}

// ── the walk ─────────────────────────────────────────────────────────────────

#[test]
fn sibling_directories_are_visited_from_the_last_name_first() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    for sub in ["a", "b", "c"] {
        fs::create_dir(root.join(sub)).unwrap();
        fs::write(root.join(sub).join("note.md"), "probe\n").unwrap();
    }

    let tally = with_plan(root, future(), false, &[], walk);

    let order: Vec<&str> = tally
        .results
        .iter()
        .map(|r| r.relative_path.as_str())
        .collect();
    assert_eq!(order, vec!["c/note.md", "b/note.md", "a/note.md"]);
    assert_eq!(tally.total_matches, 3);
    assert!(tally.complete);
}

#[test]
fn a_file_without_matches_is_not_a_result() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("quiet.md"), "nothing here\n").unwrap();
    let tally = with_plan(dir.path(), future(), false, &[], walk);
    assert!(tally.results.is_empty());
    assert!(tally.complete);
}

#[test]
fn the_file_cap_stops_the_walk_and_voids_completeness() {
    let dir = tempdir().unwrap();
    for i in 0..(MAX_FILES + 5) {
        fs::write(dir.path().join(format!("f{i:03}.md")), "probe\n").unwrap();
    }
    let tally = with_plan(dir.path(), future(), false, &[], walk);
    assert_eq!(tally.results.len(), MAX_FILES);
    assert!(!tally.complete);
}

/// A subdirectory the process may not list leaves its files unseen: the scan
/// is partial, and the rest of the tree is still searched.
#[cfg(unix)]
#[test]
fn an_unreadable_subdirectory_voids_completeness_and_the_walk_goes_on() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("open.md"), "probe\n").unwrap();
    let locked = root.join("locked");
    fs::create_dir(&locked).unwrap();
    fs::write(locked.join("inside.md"), "probe\n").unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    // A privileged user can list any directory; there is nothing to pin then.
    let enforced = fs::read_dir(&locked).is_err();

    let tally = with_plan(root, future(), false, &[], walk);

    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    if enforced {
        assert_eq!(tally.results.len(), 1);
        assert_eq!(tally.results[0].relative_path, "open.md");
        assert!(!tally.complete);
    }
}

/// The same for one file: zero hits from a scan that could not open an
/// eligible document must not read as "nothing references it".
#[cfg(unix)]
#[test]
fn an_unreadable_file_voids_completeness_and_the_walk_goes_on() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("open.md"), "nothing relevant\n").unwrap();
    let locked = root.join("locked.md");
    fs::write(&locked, "probe\n").unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    let enforced = fs::File::open(&locked).is_err();

    let tally = with_plan(root, future(), false, &[], walk);

    if enforced {
        assert!(tally.results.is_empty());
        assert!(
            !tally.complete,
            "an eligible file nobody could open went unscanned"
        );
    }
}

/// A backslash is part of a name off Windows: the relative path must name the
/// file that exists, not a look-alike one folder down.
#[cfg(unix)]
#[test]
fn result_keeps_a_backslash_that_is_part_of_a_file_name() {
    let result = result_for(Path::new("/ws/sub/a\\b.md"), Path::new("/ws"), Vec::new());
    assert_eq!(result.relative_path, "sub/a\\b.md");
}
