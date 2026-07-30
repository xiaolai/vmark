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
