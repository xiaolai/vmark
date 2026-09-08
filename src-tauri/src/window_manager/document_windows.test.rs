//! Tests for `document_windows.rs` (included via `#[path]`; split from the
//! former single window_manager test file).

use super::*;

// -- get_cascaded_position ------------------------------------------------

#[test]
fn cascade_first_window() {
    let (x, y) = get_cascaded_position(0);
    assert_eq!(x, BASE_X);
    assert_eq!(y, BASE_Y);
}

#[test]
fn cascade_third_window() {
    let (x, y) = get_cascaded_position(3);
    assert_eq!(x, BASE_X + 3.0 * CASCADE_OFFSET);
    assert_eq!(y, BASE_Y + 3.0 * CASCADE_OFFSET);
}

#[test]
fn cascade_wraps_after_max() {
    // Position at MAX_CASCADE should wrap to 0
    let (x, y) = get_cascaded_position(MAX_CASCADE);
    assert_eq!(x, BASE_X);
    assert_eq!(y, BASE_Y);
}

#[test]
fn cascade_wraps_correctly() {
    // Position at MAX_CASCADE + 2 should be same as position 2
    let (x1, y1) = get_cascaded_position(2);
    let (x2, y2) = get_cascaded_position(MAX_CASCADE + 2);
    assert_eq!(x1, x2);
    assert_eq!(y1, y2);
}

// -- allocate_window_label ------------------------------------------------

#[test]
fn allocate_label_returns_sequential_labels() {
    let l1 = allocate_window_label();
    let l2 = allocate_window_label();
    assert!(l1.starts_with("doc-"));
    assert!(l2.starts_with("doc-"));
    let n1: u32 = l1.strip_prefix("doc-").unwrap().parse().unwrap();
    let n2: u32 = l2.strip_prefix("doc-").unwrap().parse().unwrap();
    assert_eq!(n2, n1 + 1);
}

// -- pick_reopen_workspace_root_with --------------------------------------

#[test]
fn pick_reopen_returns_what_the_resolver_judged() {
    // Not the remembered NAME (#490): the resolver's answer is the value that
    // travels on, so a recent entry that resolves elsewhere scopes the window
    // to what it resolves to, and can no longer be re-pointed afterwards.
    let pick = pick_reopen_workspace_root_with(Some("/some/link".to_string()), |_| {
        Some("/some/real/workspace".to_string())
    });
    assert_eq!(pick, Some("/some/real/workspace".to_string()));
}

#[test]
fn pick_reopen_returns_none_when_path_missing() {
    // Path was the user's last workspace but the folder has been deleted
    // or moved — fall back to no-workspace so the new window opens fresh.
    let pick = pick_reopen_workspace_root_with(Some("/deleted/path".to_string()), |_| None);
    assert_eq!(pick, None);
}

#[test]
fn pick_reopen_returns_none_when_snapshot_empty() {
    // Fresh install or all recents cleared — never opened a workspace.
    let pick = pick_reopen_workspace_root_with(None, |p| Some(p.to_string()));
    assert_eq!(pick, None);
}

/// The real resolver: canonicalize, require a directory, hand on the CANONICAL
/// path. A symlinked recent entry must reopen the target it names today, and
/// the value the window is scoped to must be that target — not the link, which
/// resolves again every time anything touches it (#250, #490).
#[test]
fn pick_reopen_resolves_a_symlinked_recent_entry_to_its_target() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let real = dir.path().join("workspace");
    std::fs::create_dir(&real).expect("mkdir");
    let canonical = real.canonicalize().expect("canonical");

    assert_eq!(
        pick_reopen_workspace_root_with(Some(real.to_string_lossy().into_owned()), resolver),
        Some(canonical.to_string_lossy().into_owned()),
    );

    #[cfg(unix)]
    {
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        assert_eq!(
            pick_reopen_workspace_root_with(Some(link.to_string_lossy().into_owned()), resolver),
            Some(canonical.to_string_lossy().into_owned()),
            "the TARGET is what the window is scoped to, never the link name"
        );
    }
}

#[test]
fn pick_reopen_rejects_a_missing_path_and_a_regular_file() {
    // A regression to a weaker predicate — `exists()` instead of `is_dir()` —
    // would silently route the dock-reopen URL at a file path.
    let dir = tempfile::tempdir().expect("create tempdir");
    let missing = dir
        .path()
        .join("does-not-exist")
        .to_string_lossy()
        .into_owned();
    let file = dir.path().join("not-a-workspace.md");
    std::fs::write(&file, b"hi").expect("write");

    assert_eq!(
        pick_reopen_workspace_root_with(Some(missing), resolver),
        None
    );
    assert_eq!(
        pick_reopen_workspace_root_with(Some(file.to_string_lossy().into_owned()), resolver),
        None,
    );
}

/// The exact closure `pick_reopen_workspace_root` passes, so these tests
/// exercise the shipped resolution rather than a restatement of it.
fn resolver(p: &str) -> Option<String> {
    let canonical = std::path::Path::new(p).canonicalize().ok()?;
    if !canonical.is_dir() {
        return None;
    }
    crate::canonical_path::canonical_string(&canonical, "the recent workspace").ok()
}

// -- initial_window_title -------------------------------------------------
//
// Issue #1296. The title was unconditionally empty because the builder assumes
// macOS's overlay title bar, where the native title text is hidden and an empty
// string is the only correct value. Off macOS the OS draws a REAL title bar, so
// an empty string is a blank strip until the frontend's first title update —
// and a blank one is what the reporter saw. Both legs are asserted per target,
// which the 3-OS CI matrix exercises.

#[cfg(target_os = "macos")]
#[test]
fn initial_title_is_empty_where_the_native_title_is_hidden() {
    // TitleBarStyle::Overlay + hidden_title(true): the app draws its own strip,
    // so a non-empty title would only ever surface in the Window menu.
    assert_eq!(initial_window_title("VMark"), "");
}

#[cfg(not(target_os = "macos"))]
#[test]
fn initial_title_names_the_app_where_the_title_bar_is_visible() {
    // Whatever the app is called — the point is that the visible title bar gets
    // that name and not a blank strip.
    assert_eq!(initial_window_title("VMark"), "VMark");
    assert_eq!(initial_window_title("Renamed"), "Renamed");
}

/// #487/#489 — the allocator's spelling and the cascade parser's grammar are
/// ONE contract.
///
/// `create_document_window_with_label_and_url` parses the counter back out of
/// the label to place the window, and falls back to position zero when it
/// cannot. While the `doc-{n}` format was written out in three places, nothing
/// checked that the thing produced is the thing parsed — so a change to the
/// spelling would have silently cascaded every restored window to one corner.
#[test]
fn every_allocated_label_parses_back_to_the_counter_that_made_it() {
    for _ in 0..3 {
        let (count, label) = next_window_label();
        assert_eq!(
            label
                .strip_prefix("doc-")
                .and_then(|n| n.parse::<u32>().ok()),
            Some(count),
            "the allocator produced {label:?}, which the cascade parser reads as position 0"
        );
    }
}

/// The public allocator and the internal one are the same allocation — a
/// second counter would hand two windows the same label.
#[test]
fn allocate_window_label_is_the_same_allocation_as_the_creation_path() {
    let a = allocate_window_label();
    let (_, b) = next_window_label();
    assert_ne!(a, b, "two allocations must never collide");
}
