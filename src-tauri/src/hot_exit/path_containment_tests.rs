//! WI-17.3 — windows_path_case_containment parity tests. On Windows,
//! containment folds the FULL path case (components and UNC hosts, not just
//! the drive letter), matching the frontend's `normalizePathForCompare`
//! (WI-17.1). macOS/Linux stay byte-exact. The platform-parameterized form is
//! tested directly so the Windows branch is exercised on every host OS.

use super::v5;

#[test]
fn windows_path_case_containment_folds_full_path() {
    // Windows semantics (case-insensitive): component-case variants contain.
    assert!(v5::is_within_root_for_platform(
        "C:\\Repo",
        "c:\\repo\\a.md",
        true
    ));
    assert!(v5::is_within_root_for_platform(
        "C:\\Repo",
        "C:/REPO/sub/deep.md",
        true
    ));
    // UNC host/share case variants unify.
    assert!(v5::is_within_root_for_platform(
        "\\\\Server\\Share",
        "//server/share/x.md",
        true
    ));
    // Boundary check still holds under folding.
    assert!(!v5::is_within_root_for_platform(
        "C:\\Repo",
        "C:\\RepoOther\\a.md",
        true
    ));
    // Byte-exact semantics (macOS/Linux): alternate casing does NOT contain.
    assert!(!v5::is_within_root_for_platform("/a/B", "/a/b/c.md", false));
    assert!(v5::is_within_root_for_platform("/a/B", "/a/B/c.md", false));
}

/// Off Windows a backslash is part of a name, so a loose tab under `/repo/x`
/// is not inside a workspace at `/repo\x`, and a sibling is not inside `/repo`.
#[test]
fn a_backslash_in_a_posix_name_is_not_a_separator() {
    assert!(!v5::is_within_root_for_platform(
        "/repo\\x",
        "/repo/x/note.md",
        false
    ));
    assert!(!v5::is_within_root_for_platform(
        "/repo",
        "/repo\\sibling.md",
        false
    ));
    assert!(v5::is_within_root_for_platform(
        "/repo\\x",
        "/repo\\x/note.md",
        false
    ));
    assert!(v5::is_within_root_for_platform(
        "/repo\\x",
        "/repo/x/note.md",
        true
    ));
    assert!(v5::is_within_root_for_platform(
        "C:\\repo",
        "C:\\repo\\note.md",
        false
    ));
}

/// `/\safe` is its own top-level folder off Windows. These are paths the OS
/// opened, so this is not a network spelling and must not collapse into `/safe`.
#[test]
fn a_top_level_folder_opening_with_a_backslash_is_not_the_folder_after_it() {
    assert!(!v5::is_within_root_for_platform(
        "/safe",
        r"/\safe/note.md",
        false
    ));
    assert!(v5::is_within_root_for_platform(
        r"/\safe",
        r"/\safe/note.md",
        false
    ));
    assert!(!v5::is_within_root_for_platform(
        r"//repo\x",
        "//repo/x/note.md",
        false
    ));
    // The Windows reading of the same text is unchanged.
    assert!(v5::is_within_root_for_platform(
        "/safe",
        r"/\safe/note.md",
        true
    ));
}
