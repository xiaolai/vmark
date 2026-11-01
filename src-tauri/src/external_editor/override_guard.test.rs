//! WI-RA4.2 — the editor override cannot name an interpreter or a shell.
//!
//! `open_in_external_editor` runs `<override> <file>`, the webview supplies
//! both, and VMark opens `sh`/`py`/`rb`/`js` files — so an override of
//! `python3` or `/bin/sh` executed the file. These tests pin what the guard
//! accepts (a known editor name, or an existing absolute path to something
//! that is not an interpreter) and what it refuses, however it is spelled.

use super::*;

// ── fixtures ────────────────────────────────────────────────────────────────

/// An executable file named `name` in a fresh temp directory.
#[cfg(unix)]
fn executable_named(name: &str) -> (tempfile::TempDir, String) {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join(name);
    std::fs::write(&path, "#!/bin/sh\nexit 0\n").expect("write");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    (dir, path.to_str().expect("utf-8 path").to_string())
}

/// A symlink named `name`, in a fresh temp directory, pointing at `target`.
#[cfg(unix)]
fn link_named(name: &str, target: &str) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().expect("tempdir");
    let link = dir.path().join(name);
    std::os::unix::fs::symlink(target, &link).expect("symlink");
    (dir, link.to_str().expect("utf-8 path").to_string())
}

// ── accepted ────────────────────────────────────────────────────────────────

#[test]
fn accepts_empty_and_whitespace() {
    assert_eq!(validate_editor_override("").unwrap(), "");
    assert_eq!(validate_editor_override("   ").unwrap(), "");
}

#[test]
fn accepts_known_editor_names() {
    for name in [
        "code",
        "code-insiders",
        "cursor",
        "zed",
        "subl",
        "nvim",
        "emacs",
        "idea",
    ] {
        assert_eq!(validate_editor_override(name).as_deref(), Ok(name));
    }
    assert_eq!(validate_editor_override("  code  ").as_deref(), Ok("code"));
}

#[cfg(unix)]
#[test]
fn accepts_an_existing_absolute_path_to_any_other_executable() {
    for name in [
        "my-editor",
        "编辑器",
        "nodepad",
        "bashful",
        "shellcheck-gui",
    ] {
        let (_dir, path) = executable_named(name);
        assert_eq!(
            validate_editor_override(&path).as_deref(),
            Ok(path.as_str()),
            "{name} is not an interpreter and must be accepted"
        );
    }
}

#[cfg(unix)]
#[test]
fn accepts_a_symlink_that_resolves_to_an_editor() {
    let (_real_dir, real) = executable_named("sublime_text");
    let (_link_dir, link) = link_named("subl", &real);
    assert_eq!(
        validate_editor_override(&link).as_deref(),
        Ok(link.as_str())
    );
}

#[test]
fn accepts_absolute_path_with_whitespace_when_real() {
    // macOS `.app` bundles routinely have spaces in their names. Whitespace
    // is allowed ONLY in an absolute path that exists on disk.
    #[cfg(target_os = "macos")]
    {
        let bundle = "/Applications/Calculator.app";
        if Path::new(bundle).is_dir() {
            let result = validate_editor_override(bundle);
            assert!(
                result.is_ok(),
                "real .app bundle path must validate; got {result:?}"
            );
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let with_space = dir.path().join("My App.app");
        std::fs::create_dir(&with_space).expect("mkdir");
        let path_str = with_space.to_string_lossy().into_owned();
        let result = validate_editor_override(&path_str);
        assert!(
            result.is_ok(),
            "real absolute path with whitespace must validate; got {result:?}"
        );
    }
}

// ── refused: a bare name that is not a known editor ─────────────────────────

/// The hole: a bare interpreter name passed validation, and the file it was
/// handed is one VMark opens (`.py`, `.sh`, `.rb`, `.js`).
#[test]
fn refuses_bare_interpreter_and_shell_names() {
    for name in [
        "python3",
        "python",
        "node",
        "ruby",
        "perl",
        "lua",
        "deno",
        "bun",
        "sh",
        "bash",
        "zsh",
        "pwsh",
        "osascript",
        "env",
        "open",
        "xdg-open",
    ] {
        assert!(
            validate_editor_override(name).is_err(),
            "{name:?} must not be accepted as an editor"
        );
    }
}

#[test]
fn refuses_a_bare_name_vmark_does_not_know_and_says_what_to_do() {
    let error = validate_editor_override("my-own-editor").expect_err("unknown bare name");
    assert!(
        error.contains("my-own-editor"),
        "names the value it refused: {error}"
    );
}

#[test]
fn refuses_relative_paths() {
    for input in ["bin/code", "./code", "../code", r"bin\code", "code/"] {
        assert!(
            validate_editor_override(input).is_err(),
            "{input:?} resolves against the working directory and must be refused"
        );
    }
}

#[cfg(unix)]
#[test]
fn windows_absolute_spellings_are_relative_names_on_posix() {
    // Classified as absolute, these would reach the existence check and pass
    // for any file of that name in the working directory, skipping the
    // known-editor list. "does not exist" is the mark of that wrong branch.
    for name in [r"\vmark-guard-probe", "a:vmark-guard-probe"] {
        let error = validate_editor_override(name).expect_err(name);
        assert!(!error.contains("does not exist"), "{name:?}: {error}");
    }
}

#[test]
fn refuses_relative_with_whitespace() {
    // Multi-token bare overrides belong in $VMARK_EXTERNAL_EDITOR — the env
    // var isn't webview-supplied so a script in the page can't poison it.
    for input in ["code --wait", "subl -n", "nvim +0", "python -c x"] {
        assert!(
            validate_editor_override(input).is_err(),
            "multi-token bare override must be rejected: {input:?}"
        );
    }
}

// ── refused: an absolute path to something that runs its argument ───────────

#[cfg(unix)]
#[test]
fn refuses_absolute_paths_to_system_shells_and_launchers() {
    for path in ["/bin/sh", "/bin/bash", "/usr/bin/env"] {
        if Path::new(path).exists() {
            assert!(
                validate_editor_override(path).is_err(),
                "{path} runs the file it is given"
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn refuses_interpreters_under_any_version_suffix_or_case() {
    for name in [
        "python3",
        "python3.12",
        "Python",
        "pypy3",
        "node",
        "node20",
        "nodejs",
        "ruby3.2",
        "lua5.4",
        "perl5.36",
        "bash-5.2",
        "osascript",
        "python3.exe",
        "tsx",
        "rust-script",
    ] {
        let (_dir, path) = executable_named(name);
        assert!(
            validate_editor_override(&path).is_err(),
            "an executable named {name:?} must be refused"
        );
    }
}

/// The file name the override is spelled with is not enough: a link called
/// `code` that resolves to a shell is a shell.
#[cfg(unix)]
#[test]
fn refuses_a_symlink_with_an_editor_name_that_resolves_to_an_interpreter() {
    let (_dir, to_shell) = link_named("code", "/bin/sh");
    assert!(
        validate_editor_override(&to_shell).is_err(),
        "a link to /bin/sh must be refused whatever it is called"
    );

    let (_real_dir, python) = executable_named("python3.12");
    let (_first_dir, first) = link_named("editor-launcher", &python);
    let (_second_dir, second) = link_named("subl", &first);
    assert!(
        validate_editor_override(&second).is_err(),
        "a chain of links ending at an interpreter must be refused"
    );
}

#[cfg(unix)]
#[test]
fn refuses_parent_directory_and_trailing_separator_spellings() {
    let (_dir, editor) = executable_named("my-editor");
    let parent = Path::new(&editor)
        .parent()
        .expect("parent")
        .to_str()
        .expect("utf-8");
    for input in [
        format!(
            "{parent}/../{}/my-editor",
            Path::new(parent).file_name().unwrap().to_str().unwrap()
        ),
        format!("{editor}/"),
        format!("{parent}/"),
        "/bin/../bin/sh".to_string(),
        "/bin/sh/".to_string(),
        "/bin/sh/.".to_string(),
    ] {
        assert!(
            validate_editor_override(&input).is_err(),
            "{input:?} must be refused"
        );
    }
}

/// `open -a Terminal.app script.sh` runs the script, so a terminal emulator
/// bundle is refused like a shell.
#[cfg(unix)]
#[test]
fn refuses_terminal_emulator_bundles() {
    for bundle in ["Terminal.app", "iTerm.app", "Python Launcher.app"] {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(bundle);
        std::fs::create_dir(&path).expect("mkdir");
        assert!(
            validate_editor_override(path.to_str().expect("utf-8")).is_err(),
            "{bundle} must be refused"
        );
    }
}

#[test]
fn refuses_absolute_path_with_whitespace_when_fake() {
    assert!(
        validate_editor_override("/tmp/Not Real.app").is_err(),
        "absolute path with whitespace must NOT validate when it doesn't exist"
    );
}

#[test]
fn refuses_nonexistent_absolute_paths() {
    assert!(
        validate_editor_override("/totally/not/a/real/path/code").is_err(),
        "non-existent absolute paths must be rejected"
    );
}

#[test]
fn refuses_shell_metacharacters() {
    // Quotes are also rejected to prevent any future shell-out path
    // from being tricked into argv-injection.
    for input in &[
        "code;", "code|", "code&", "code`", "code$", "code>", "code\"", "code'", "code\nrm",
        "code\0",
    ] {
        assert!(
            validate_editor_override(input).is_err(),
            "must reject shell metacharacters in: {input:?}"
        );
    }
}

#[test]
fn refuses_flag_prefix() {
    assert!(
        validate_editor_override("-c").is_err(),
        "must reject overrides that start with '-'"
    );
}

// ── the file-name classifier ────────────────────────────────────────────────

#[test]
fn runs_its_argument_matches_whole_names_not_fragments() {
    for name in [
        "sh",
        "bash",
        "zsh",
        "fish",
        "python",
        "python3",
        "python3.12",
        "PYTHON3",
        "node",
        "node.exe",
        "Ruby.EXE",
        "cmd.exe",
        "powershell.exe",
        "pwsh",
        "wscript.exe",
        "env",
        "osascript",
        "Terminal.app",
        "iTerm.app",
    ] {
        assert!(runs_its_argument(name), "{name:?} runs its argument");
    }
    for name in [
        "code",
        "Code.exe",
        "subl",
        "nvim",
        "notepad.exe",
        "nodepad",
        "bashful",
        "shell-editor",
        "pythonista-editor",
        "Visual Studio Code.app",
        "Sublime Text.app",
        "zed",
        "",
        "3.12",
    ] {
        assert!(!runs_its_argument(name), "{name:?} is not an interpreter");
    }
}
