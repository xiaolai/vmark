//! Tests for `shell_env.rs` (included via `#[path]`).
//!
//! The list-building logic is exercised through the pure collectors
//! (`collect_unix_shells` / `collect_windows_shells`) with injected
//! validators, so invalid/missing shells are testable without mutating
//! process env vars (racy across parallel tests).

use super::*;

// -- collect_unix_shells ----------------------------------------------------

fn valid_set<'a>(valid: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
    move |s: &str| valid.contains(&s)
}

#[test]
fn unix_skips_comments_and_blank_lines() {
    let etc = "# /etc/shells\n\n/bin/bash\n   \n# comment\n/bin/zsh\n";
    let shells = collect_unix_shells(etc, None, valid_set(&["/bin/bash", "/bin/zsh"]));
    assert_eq!(shells, vec!["/bin/bash", "/bin/zsh"]);
}

#[test]
fn unix_filters_invalid_etc_shells_entries() {
    let etc = "/bin/bash\n/opt/gone/fish\n/bin/zsh\n";
    let shells = collect_unix_shells(etc, None, valid_set(&["/bin/bash", "/bin/zsh"]));
    assert_eq!(shells, vec!["/bin/bash", "/bin/zsh"]);
}

#[test]
fn unix_invalid_user_shell_is_not_inserted() {
    // $SHELL / passwd can point at an uninstalled shell (e.g. a removed
    // homebrew fish). It must NOT be offered to the terminal.
    let etc = "/bin/bash\n";
    let shells = collect_unix_shells(
        etc,
        Some("/opt/homebrew/bin/fish".to_string()),
        valid_set(&["/bin/bash"]),
    );
    assert_eq!(shells, vec!["/bin/bash"]);
}

#[test]
fn unix_valid_user_shell_is_inserted_first() {
    let etc = "/bin/bash\n/bin/zsh\n";
    let shells = collect_unix_shells(
        etc,
        Some("/opt/homebrew/bin/fish".to_string()),
        valid_set(&["/bin/bash", "/bin/zsh", "/opt/homebrew/bin/fish"]),
    );
    assert_eq!(
        shells,
        vec!["/opt/homebrew/bin/fish", "/bin/bash", "/bin/zsh"]
    );
}

#[test]
fn unix_user_shell_already_listed_is_not_duplicated() {
    let etc = "/bin/bash\n/bin/zsh\n";
    let shells = collect_unix_shells(
        etc,
        Some("/bin/zsh".to_string()),
        valid_set(&["/bin/bash", "/bin/zsh"]),
    );
    assert_eq!(shells, vec!["/bin/bash", "/bin/zsh"]);
}

#[test]
fn unix_deduplicates_etc_shells_preserving_order() {
    let etc = "/bin/bash\n/bin/zsh\n/bin/bash\n";
    let shells = collect_unix_shells(etc, None, valid_set(&["/bin/bash", "/bin/zsh"]));
    assert_eq!(shells, vec!["/bin/bash", "/bin/zsh"]);
}

#[test]
fn unix_empty_inputs_yield_empty_list() {
    let shells = collect_unix_shells("", None, |_| true);
    assert!(shells.is_empty());
}

// -- collect_windows_shells ---------------------------------------------------

#[test]
fn windows_invalid_comspec_is_not_inserted() {
    // %COMSPEC% is attacker/user-controllable env; a value that doesn't
    // resolve to a real executable must not be offered as a shell.
    let resolved = vec![r"C:\Windows\System32\cmd.exe".to_string()];
    let shells = collect_windows_shells(
        resolved.clone(),
        Some(r"C:\Evil\definitely-missing.exe".to_string()),
        valid_set(&[r"C:\Windows\System32\cmd.exe"]),
    );
    assert_eq!(shells, resolved);
}

#[test]
fn windows_valid_comspec_is_inserted_first() {
    let resolved = vec![r"C:\Program Files\PowerShell\7\pwsh.exe".to_string()];
    let shells = collect_windows_shells(
        resolved,
        Some(r"C:\Windows\System32\cmd.exe".to_string()),
        valid_set(&[
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            r"C:\Windows\System32\cmd.exe",
        ]),
    );
    assert_eq!(
        shells,
        vec![
            r"C:\Windows\System32\cmd.exe",
            r"C:\Program Files\PowerShell\7\pwsh.exe",
        ]
    );
}

#[test]
fn windows_resolved_paths_are_validated_too() {
    // where.exe output is only as trustworthy as PATH, which is
    // user-controllable — a resolved entry that fails validation (deleted
    // since resolution, PATH shim pointing at a non-executable) must not
    // be offered.
    let resolved = vec![
        r"C:\Windows\System32\cmd.exe".to_string(),
        r"C:\Shims\ghost-pwsh.exe".to_string(),
    ];
    let shells =
        collect_windows_shells(resolved, None, valid_set(&[r"C:\Windows\System32\cmd.exe"]));
    assert_eq!(shells, vec![r"C:\Windows\System32\cmd.exe".to_string()]);
}

#[test]
fn windows_comspec_dedup_is_case_insensitive() {
    let resolved = vec![r"C:\Windows\System32\cmd.exe".to_string()];
    let shells = collect_windows_shells(
        resolved.clone(),
        Some(r"C:\WINDOWS\SYSTEM32\CMD.EXE".to_string()),
        |_| true,
    );
    assert_eq!(shells, resolved);
}

// -- shell_path_is_valid (real filesystem) -----------------------------------

#[cfg(unix)]
#[test]
fn valid_shell_path_accepts_bin_sh() {
    assert!(shell_path_is_valid("/bin/sh"));
}

#[test]
fn valid_shell_path_rejects_missing_path() {
    assert!(!shell_path_is_valid("/definitely/not/a/shell-vmark-test"));
}

#[cfg(unix)]
#[test]
fn valid_shell_path_rejects_non_executable_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("not-a-shell.txt");
    std::fs::write(&file, b"plain data").expect("write");
    assert!(!shell_path_is_valid(file.to_str().unwrap()));
}

#[cfg(unix)]
#[test]
fn valid_shell_path_rejects_directory() {
    let dir = tempfile::tempdir().expect("tempdir");
    assert!(!shell_path_is_valid(dir.path().to_str().unwrap()));
}

// -- get_default_shell / list_available_shells (integration, real system) ----

#[cfg(unix)]
#[test]
fn default_shell_is_an_existing_executable() {
    let shell = get_default_shell();
    assert!(
        shell_path_is_valid(&shell),
        "default shell '{shell}' must exist and be executable"
    );
}

#[test]
fn listed_shells_are_all_valid_executables() {
    // The contract the audit fix locks in: every entry returned to the
    // terminal's shell picker resolves to a real executable.
    for shell in list_available_shells() {
        assert!(
            shell_path_is_valid(&shell),
            "listed shell '{shell}' must exist and be executable"
        );
    }
}
