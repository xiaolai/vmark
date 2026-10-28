// WI-AL4.1 — opening the export repository: a missing Git program is GIT_MISSING with an install hint, a plain folder or a file is NOT_A_REPOSITORY, a relative folder is INVALID_REQUEST, and a real repository opens
use super::error::ExportError;
use super::git::Git;
use crate::agent_journal::test_support::tmp;

fn text(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

#[test]
fn a_missing_git_program_is_git_missing_with_an_install_hint() {
    let root = tmp();
    let absent = root.path().join("no-such-git");
    let err = Git::open_with(&text(&absent), None, &text(root.path())).expect_err("no git");
    assert!(matches!(err, ExportError::GitMissing), "{err:?}");
    assert_eq!(err.code(), "GIT_MISSING");
    assert!(err.to_string().contains("install Git"), "{err}");
}

#[test]
fn a_plain_folder_is_not_a_repository() {
    let root = tmp();
    let plain = root.path().join("plain folder");
    std::fs::create_dir_all(&plain).expect("mkdir");
    let err = Git::open_with("git", None, &text(&plain)).expect_err("plain");
    assert_eq!(err.code(), "NOT_A_REPOSITORY", "{err}");
}

#[test]
fn a_file_is_not_a_repository() {
    let root = tmp();
    let file = root.path().join("notes.md");
    std::fs::write(&file, "x").expect("write");
    let err = Git::open_with("git", None, &text(&file)).expect_err("file");
    assert_eq!(err.code(), "NOT_A_REPOSITORY", "{err}");
}

/// Only Git's own "not a repository" answer is `NOT_A_REPOSITORY`: a
/// repository Git refuses to read (here a corrupt config) keeps Git's error.
#[test]
fn a_repository_git_cannot_read_is_a_git_failure_not_a_non_repository() {
    let root = tmp();
    let dir = root.path().join("repo");
    std::fs::create_dir_all(&dir).expect("mkdir");
    Git::new("git", dir.clone())
        .run(&["init", "-q"], None, &[])
        .expect("init");
    std::fs::write(dir.join(".git").join("config"), "[core\n").expect("corrupt");
    let err = Git::open_with("git", None, &text(&dir)).expect_err("unreadable");
    assert_eq!(err.code(), "GIT_FAILED", "{err}");
    assert!(err.to_string().contains("config"), "{err}");
}

#[test]
fn a_relative_folder_is_an_invalid_request() {
    let err = Git::open("relative/repo").expect_err("relative");
    assert_eq!(err.code(), "INVALID_REQUEST", "{err}");
}

#[test]
fn a_real_repository_opens() {
    let root = tmp();
    let dir = root.path().join("repo");
    std::fs::create_dir_all(&dir).expect("mkdir");
    Git::new("git", dir.clone())
        .run(&["init", "-q"], None, &[])
        .expect("init");
    let git = Git::open_with("git", None, &text(&dir)).expect("opens");
    assert_eq!(git.dir(), dir.as_path());
}

// Not on Windows: Win32 strips a trailing space from a path component, so
// such a directory cannot be created there and the case cannot arise.
#[cfg(not(windows))]
#[test]
fn a_bare_repository_whose_path_ends_in_a_space_keeps_it() {
    let root = tmp();
    let dir = root.path().join("bare ");
    std::fs::create_dir_all(&dir).expect("mkdir");
    Git::new("git", dir.clone())
        .run(&["init", "-q", "--bare"], None, &[])
        .expect("init");
    let git = Git::open_with("git", None, &text(&dir)).expect("opens");
    let common = git.common_dir().expect("common dir");
    assert!(common.ends_with("bare "), "{common:?}");
}

#[test]
fn a_refusing_git_reports_its_own_error_even_when_stdin_breaks() {
    let root = tmp();
    let dir = root.path().join("repo");
    std::fs::create_dir_all(&dir).expect("mkdir");
    let git = Git::new("git", dir);
    // Git exits without reading stdin; the feeder then hits a broken pipe.
    let big = vec![b'x'; 4 << 20];
    let err = git
        .run_raw(&["no-such-subcommand"], Some(&big))
        .expect_err("refused");
    let msg = err.to_string();
    assert!(msg.contains("exited with"), "{msg}");
    assert!(!msg.contains("writing to git failed"), "{msg}");
}

/// Git ends its output with one `\n`. Only that is Git's; a carriage
/// return before it is part of a Unix folder name (Windows forbids it in
/// names, and only there is a `\r\n` terminator stripped).
#[test]
fn only_gits_line_terminator_is_removed_from_a_path_line() {
    use super::git::path_line;
    assert_eq!(path_line("/repo/.git\n"), "/repo/.git");
    assert_eq!(path_line("/repo /.git \n"), "/repo /.git ", "spaces kept");
    assert_eq!(path_line("/r/中文\n\n"), "/r/中文\n", "one terminator only");
    assert_eq!(path_line("/no/newline"), "/no/newline");
    assert_eq!(path_line(""), "");
    let crlf = path_line("/repo/x\r\n");
    if cfg!(windows) {
        assert_eq!(crlf, "/repo/x");
    } else {
        assert_eq!(
            crlf, "/repo/x\r",
            "a Unix name may end in a carriage return"
        );
    }
}
