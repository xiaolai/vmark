//! Tests for `shell_integration.rs` (included via `#[path]`).
//!
//! Two layers: pure assertions on the embedded scripts and the
//! `{ env, args }` builder, plus `#[cfg(unix)]` BEHAVIORAL checks that
//! actually run `bash` against a fixture `$HOME`. The behavioral layer
//! exists because the bash hooks are the kind of thing that greps clean
//! and still silently reports exit code 0 for every command.

use super::*;

#[test]
fn shell_basename_extracts_name() {
    assert_eq!(shell_basename("/bin/zsh"), "zsh");
    assert_eq!(shell_basename("/usr/local/bin/zsh"), "zsh");
    assert_eq!(shell_basename("/bin/bash"), "bash");
    assert_eq!(shell_basename("zsh"), "zsh");
    assert_eq!(shell_basename(""), "");
}

#[test]
fn shell_kind_classifies_supported_shells() {
    assert_eq!(shell_kind("/bin/zsh"), Some(ShellKind::Zsh));
    assert_eq!(shell_kind("/opt/homebrew/bin/bash"), Some(ShellKind::Bash));
    // Unsupported shells degrade to a plain spawn.
    assert_eq!(shell_kind("/usr/local/bin/fish"), None);
    assert_eq!(shell_kind("/bin/sh"), None);
    assert_eq!(shell_kind(""), None);
    // Windows must not regress: %COMSPEC% and a git-bash `bash.exe` both
    // stay un-integrated, exactly as before WI-3.4.
    assert_eq!(shell_kind("C:\\Windows\\system32\\cmd.exe"), None);
    assert_eq!(shell_kind("C:\\Program Files\\Git\\bin\\bash.exe"), None);
}

#[test]
fn embedded_script_has_the_osc_marks() {
    // Guards against an empty/garbled include_str! and documents the contract.
    assert!(ZSH_INTEGRATION.contains("133;A"));
    assert!(ZSH_INTEGRATION.contains("133;C"));
    assert!(ZSH_INTEGRATION.contains("133;D"));
    assert!(ZSH_INTEGRATION.contains("add-zsh-hook"));
    // Non-destructive: restores the user's ZDOTDIR and sources their real
    // rc + env (terminal gap G1 / WI-1.2).
    assert!(ZSH_INTEGRATION.contains("USER_ZDOTDIR"));
    assert!(ZSH_INTEGRATION.contains("source \"$ZDOTDIR/.zshrc\""));
    assert!(ZSH_INTEGRATION.contains(".zshenv"));
    // Bootstrap: ~/.zshenv (where a custom ZDOTDIR is typically set) is read
    // explicitly since our injected ZDOTDIR makes zsh skip it (Codex audit).
    assert!(ZSH_INTEGRATION.contains("$HOME/.zshenv"));
}

#[test]
fn bash_script_has_the_osc_marks() {
    assert!(BASH_INTEGRATION.contains("133;A"));
    assert!(BASH_INTEGRATION.contains("133;C"));
    assert!(BASH_INTEGRATION.contains("133;D"));
    assert!(BASH_INTEGRATION.contains("7;file://"));
    // Non-destructive: --rcfile REPLACES ~/.bashrc, so the script must
    // source it back or shell integration would delete the user's config.
    assert!(BASH_INTEGRATION.contains("$HOME/.bashrc"));
}

#[test]
fn bash_script_preserves_existing_prompt_command() {
    // The script must COMPOSE with whatever the user's rc already set, and
    // run its own precmd FIRST so it observes the real `$?`.
    assert!(BASH_INTEGRATION.contains("__vmark_saved_prompt"));
    // …and must not double-append when sourced twice.
    assert!(BASH_INTEGRATION.contains("!= \"__vmark_prompt\""));
    // The DEBUG trap is likewise composed, not replaced.
    assert!(BASH_INTEGRATION.contains("__vmark_prior_debug"));
    assert!(BASH_INTEGRATION.contains("trap -p DEBUG"));
}

#[test]
fn bash_env_returns_rcfile_arg() {
    let dir = Path::new("/vmark/bash");
    let integration = build_integration(ShellKind::Bash, dir, None);
    assert_eq!(
        integration.args,
        vec!["--rcfile".to_string(), "/vmark/bash/vmark.bash".to_string()]
    );
    // bash is hooked entirely through the arg — no env override at all.
    assert!(integration.env.is_empty());
}

#[test]
fn zsh_integration_returns_no_args() {
    // WI-3.3's byte-identical guarantee: adding `args` to the contract must
    // not change what a zsh user gets.
    let dir = Path::new("/vmark/zsh");
    let integration = build_integration(ShellKind::Zsh, dir, Some("/home/x/.config/zsh".into()));
    assert!(integration.args.is_empty());
    assert_eq!(
        integration.env,
        build_zsh_env(dir, Some("/home/x/.config/zsh".into()))
    );
}

#[test]
fn shell_integration_serializes_env_and_args() {
    // The frontend destructures `{ env, args }`; a rename here would break
    // the spawn path silently.
    let json = serde_json::to_value(build_integration(
        ShellKind::Bash,
        Path::new("/vmark/bash"),
        None,
    ))
    .unwrap();
    assert!(json.get("env").is_some(), "env key missing: {json}");
    assert!(json.get("args").is_some(), "args key missing: {json}");
    assert_eq!(
        json["args"],
        serde_json::json!(["--rcfile", "/vmark/bash/vmark.bash"])
    );
}

#[test]
fn build_zsh_env_includes_user_zdotdir_when_resolved() {
    let env = build_zsh_env(Path::new("/vmark/zsh"), Some("/home/x/.config/zsh".into()));
    assert_eq!(env.get("ZDOTDIR").map(String::as_str), Some("/vmark/zsh"));
    assert_eq!(
        env.get("USER_ZDOTDIR").map(String::as_str),
        Some("/home/x/.config/zsh")
    );
}

#[test]
fn build_zsh_env_omits_user_zdotdir_when_unset_or_empty() {
    // Unset → vmark.zsh's `${USER_ZDOTDIR:-$HOME}` fallback handles it.
    let none = build_zsh_env(Path::new("/vmark/zsh"), None);
    assert_eq!(none.get("ZDOTDIR").map(String::as_str), Some("/vmark/zsh"));
    assert!(!none.contains_key("USER_ZDOTDIR"));
    // Empty string is treated as unset.
    let empty = build_zsh_env(Path::new("/vmark/zsh"), Some(String::new()));
    assert!(!empty.contains_key("USER_ZDOTDIR"));
}

#[test]
fn write_rc_atomic_writes_complete_contents() {
    let dir = tempfile::tempdir().unwrap();
    write_rc_atomic(dir.path(), ".zshrc", ZSH_INTEGRATION).unwrap();
    let written = std::fs::read_to_string(dir.path().join(".zshrc")).unwrap();
    assert_eq!(written, ZSH_INTEGRATION);
}

#[test]
fn write_rc_atomic_writes_the_bash_rc_under_its_own_name() {
    let dir = tempfile::tempdir().unwrap();
    write_rc_atomic(dir.path(), "vmark.bash", BASH_INTEGRATION).unwrap();
    let written = std::fs::read_to_string(dir.path().join("vmark.bash")).unwrap();
    assert_eq!(written, BASH_INTEGRATION);
    // The two shells must not share a filename in the same directory.
    assert!(!dir.path().join(".zshrc").exists());
}

#[test]
fn write_rc_atomic_overwrites_existing() {
    let dir = tempfile::tempdir().unwrap();
    write_rc_atomic(dir.path(), ".zshrc", "first").unwrap();
    write_rc_atomic(dir.path(), ".zshrc", "second").unwrap();
    let written = std::fs::read_to_string(dir.path().join(".zshrc")).unwrap();
    assert_eq!(written, "second");
}

#[test]
fn write_rc_atomic_concurrent_writes_yield_intact_file() {
    // N threads write the same large payload concurrently to the same dir.
    // Every call must succeed, no temp files may be left behind, and the
    // final rc must be one writer's *complete* payload — never a torn
    // mix of two writers (WI-4.6 atomic-write race).
    use std::sync::Arc;
    use std::thread;

    for (file_name, base) in [
        (".zshrc", ZSH_INTEGRATION),
        ("vmark.bash", BASH_INTEGRATION),
    ] {
        let dir = Arc::new(tempfile::tempdir().unwrap());
        // Distinct, byte-length-varied payloads so a torn write is detectable:
        // a corrupt file would not equal any single payload.
        let payloads: Vec<String> = (0..16)
            .map(|i| format!("# writer {i}\n{}", base.repeat(i + 1)))
            .collect();

        let mut handles = Vec::new();
        for payload in &payloads {
            let dir = Arc::clone(&dir);
            let payload = payload.clone();
            handles.push(thread::spawn(move || {
                write_rc_atomic(dir.path(), file_name, &payload)
            }));
        }
        for h in handles {
            // Every concurrent call succeeds (no clobbered temp, no rename error).
            h.join()
                .unwrap()
                .expect("concurrent write_rc_atomic failed");
        }

        // The final file is exactly one writer's complete payload.
        let written = std::fs::read_to_string(dir.path().join(file_name)).unwrap();
        assert!(
            payloads.contains(&written),
            "final {file_name} is corrupt/torn — not equal to any single writer's payload",
        );

        // No leftover temp files: each rename consumed its own unique temp.
        let prefix = format!("{file_name}.tmp.");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
            .collect();
        assert!(
            leftovers.is_empty(),
            "stray temp files left behind: {leftovers:?}",
        );
    }
}

/// Run `bash` with the integration script sourced under a fixture $HOME.
/// Returns combined stdout+stderr. `None` when bash is unavailable.
#[cfg(unix)]
fn run_bash_with_script(home: &Path, script: &Path, snippet: &str) -> Option<String> {
    use std::process::Command;
    let out = Command::new("bash")
        .arg("--norc")
        .arg("--noprofile")
        .arg("-c")
        .arg(format!(". {}\n{snippet}", script.display()))
        .env("HOME", home)
        .output()
        .ok()?;
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    s.push_str(&String::from_utf8_lossy(&out.stderr));
    Some(s)
}

/// Materialize the bash rc plus a fixture `~/.bashrc` that already owns
/// both hooks the integration wants (WI-3.4 fixture, per the plan).
#[cfg(unix)]
fn bash_fixture() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join(".bashrc"),
        "export VMARK_TEST_RC_SOURCED=1\n\
         PROMPT_COMMAND='echo PRIOR_PC'\n\
         trap 'echo PRIOR_DEBUG' DEBUG\n",
    )
    .unwrap();
    let script_dir = dir.path().join("integration");
    std::fs::create_dir_all(&script_dir).unwrap();
    write_rc_atomic(&script_dir, "vmark.bash", BASH_INTEGRATION).unwrap();
    (dir, script_dir.join("vmark.bash"))
}

#[cfg(unix)]
#[test]
fn bash_script_sources_the_user_rc_and_composes_both_hooks() {
    let (dir, script) = bash_fixture();
    let home = dir.path().join("home");
    let Some(out) = run_bash_with_script(
        &home,
        &script,
        "echo \"RC=$VMARK_TEST_RC_SOURCED\"\n\
         echo \"PC=$PROMPT_COMMAND\"\n\
         echo \"SAVED=${__vmark_saved_prompt[0]}\"\n\
         trap -p DEBUG\n",
    ) else {
        eprintln!("bash unavailable — skipping behavioral check");
        return;
    };

    // The user's rc really ran (their aliases/theme survive).
    assert!(out.contains("RC=1"), "user .bashrc was not sourced: {out}");
    // Our precmd runs FIRST so it sees the command's real exit status,
    // and the user's own PROMPT_COMMAND is still there.
    assert!(
        out.contains("PC=__vmark_prompt"),
        "PROMPT_COMMAND was not wrapped: {out}"
    );
    assert!(
        out.contains("SAVED=echo PRIOR_PC"),
        "the user's PROMPT_COMMAND was dropped rather than captured: {out}"
    );
    // The DEBUG trap is ours, and it calls through to theirs.
    assert!(
        out.contains("__vmark_debug_trap"),
        "DEBUG trap missing: {out}"
    );
    assert!(
        out.contains("PRIOR_DEBUG"),
        "the user's pre-existing DEBUG trap stopped firing: {out}"
    );
}

#[cfg(unix)]
#[test]
fn bash_script_reports_the_real_exit_code_and_cwd() {
    let (dir, script) = bash_fixture();
    let home = dir.path().join("home");
    let Some(out) = run_bash_with_script(
        &home,
        &script,
        "(exit 3)\n__vmark_prompt\necho \"RET=$?\"\n",
    ) else {
        eprintln!("bash unavailable — skipping behavioral check");
        return;
    };

    // Exit-status decorations are only correct if `$?` survives the DEBUG
    // trap — the single most likely way this script breaks.
    assert!(
        out.contains("\u{1b}]133;D;3\u{7}"),
        "wrong or missing exit-code mark: {out:?}"
    );
    assert!(
        out.contains("\u{1b}]133;A\u{7}"),
        "missing prompt mark: {out:?}"
    );
    assert!(
        out.contains("\u{1b}]7;file://"),
        "missing cwd report: {out:?}"
    );
    // …and precmd must not swallow the status for the rest of PROMPT_COMMAND.
    assert!(out.contains("RET=3"), "precmd clobbered $?: {out}");
}

#[cfg(unix)]
#[test]
fn bash_script_emits_preexec_once_per_command() {
    let (dir, script) = bash_fixture();
    let home = dir.path().join("home");
    let Some(out) = run_bash_with_script(&home, &script, "true | true | true\n") else {
        eprintln!("bash unavailable — skipping behavioral check");
        return;
    };
    // The DEBUG trap fires per simple command; a pipeline of three must
    // still produce exactly one command-start mark.
    assert_eq!(
        out.matches("\u{1b}]133;C\u{7}").count(),
        1,
        "expected exactly one 133;C for one command line: {out:?}"
    );
}

#[cfg(unix)]
#[test]
fn bash_script_is_idempotent_when_sourced_twice() {
    let (dir, script) = bash_fixture();
    let home = dir.path().join("home");
    let Some(out) = run_bash_with_script(
        &home,
        &script,
        &format!(
            ". {}\necho \"PC=$PROMPT_COMMAND\"\necho \"SAVEDN=${{#__vmark_saved_prompt[@]}}\"\n",
            script.display()
        ),
    ) else {
        eprintln!("bash unavailable — skipping behavioral check");
        return;
    };
    // Sourcing twice (e.g. a user's rc that re-sources it) must not stack
    // duplicate precmd entries, which would emit two 133;D per prompt.
    assert!(
        out.contains("PC=__vmark_prompt"),
        "second source broke the prompt hook: {out}"
    );
    assert!(
        out.contains("SAVEDN=1"),
        "second source re-captured our own hook as the user's: {out}"
    );
}

#[cfg(unix)]
#[test]
fn bash_script_works_with_no_user_rc_at_all() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let script_dir = dir.path().join("integration");
    std::fs::create_dir_all(&script_dir).unwrap();
    write_rc_atomic(&script_dir, "vmark.bash", BASH_INTEGRATION).unwrap();

    let Some(out) = run_bash_with_script(
        &home,
        &script_dir.join("vmark.bash"),
        "echo \"PC=[$PROMPT_COMMAND]\"\n",
    ) else {
        eprintln!("bash unavailable — skipping behavioral check");
        return;
    };
    assert!(
        out.contains("PC=[__vmark_prompt]"),
        "empty-$HOME case did not install the hook: {out}"
    );
}

/// Run an INTERACTIVE bash so the real prompt lifecycle happens, feeding
/// `input` on stdin. Returns combined stdout+stderr, or None if bash is
/// unavailable.
#[cfg(unix)]
fn run_interactive_bash(home: &Path, script: &Path, input: &str) -> Option<String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new("bash")
        .arg("--rcfile")
        .arg(script)
        .arg("-i")
        .env("HOME", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    child.stdin.as_mut()?.write_all(input.as_bytes()).ok()?;
    let out = child.wait_with_output().ok()?;
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    s.push_str(&String::from_utf8_lossy(&out.stderr));
    Some(s)
}

/// Materialize the bash rc plus a fixture `~/.bashrc` with the given contents.
#[cfg(unix)]
fn interactive_fixture(bashrc: &str) -> (tempfile::TempDir, PathBuf, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(home.join(".bashrc"), bashrc).unwrap();
    let script_dir = dir.path().join("integration");
    std::fs::create_dir_all(&script_dir).unwrap();
    write_rc_atomic(&script_dir, "vmark.bash", BASH_INTEGRATION).unwrap();
    let script = script_dir.join("vmark.bash");
    (dir, home, script)
}

#[cfg(unix)]
#[test]
fn bash_preexec_marks_the_user_command_not_the_prompt_hook() {
    // REGRESSION (Codex audit): while this script merely PREPENDED itself to
    // PROMPT_COMMAND, the user's own prompt hook tripped the DEBUG trap first,
    // consumed the single pre-exec mark, and the user's actual command got
    // none — so exit-status decorations attached to the wrong command. None of
    // the non-interactive tests above can see that: it only happens during a
    // real prompt cycle, which is why this one drives an interactive shell.
    let (_dir, home, script) = interactive_fixture("PS1='$ '\nPROMPT_COMMAND='echo HOOKRAN'\n");

    let Some(out) = run_interactive_bash(&home, &script, "echo USERCMD\nexit\n") else {
        eprintln!("bash unavailable — skipping interactive check");
        return;
    };

    let usercmd = out
        .find("USERCMD")
        .unwrap_or_else(|| panic!("no command output: {out:?}"));
    let before = &out[..usercmd];
    let mark = before
        .rfind("\u{1b}]133;C\u{7}")
        .unwrap_or_else(|| panic!("no pre-exec mark before the command: {out:?}"));
    let hook = before
        .rfind("HOOKRAN")
        .unwrap_or_else(|| panic!("the user's prompt hook never ran: {out:?}"));

    // The mark must fall AFTER the prompt hook finished and BEFORE the
    // command's output — i.e. it belongs to the command, not the hook.
    assert!(
        hook < mark,
        "pre-exec mark was consumed by the user's PROMPT_COMMAND: {out:?}"
    );
}

#[cfg(unix)]
#[test]
fn bash_reports_the_real_exit_code_through_a_full_prompt_cycle() {
    // The other half of the same regression: the user's prompt hook must still
    // observe the command's real `$?`, and the D mark must carry it.
    let (_dir, home, script) = interactive_fixture("PS1='$ '\nPROMPT_COMMAND='echo HOOK_SAW=$?'\n");

    let Some(out) = run_interactive_bash(&home, &script, "(exit 7)\nexit\n") else {
        eprintln!("bash unavailable — skipping interactive check");
        return;
    };

    assert!(
        out.contains("\u{1b}]133;D;7\u{7}"),
        "exit-code mark did not carry the real status: {out:?}"
    );
    assert!(
        out.contains("HOOK_SAW=7"),
        "the user's prompt hook lost the command's exit status: {out:?}"
    );
}

#[cfg(unix)]
#[test]
fn bash_script_survives_set_u_in_the_user_rc() {
    // `set -u` is a common, legitimate thing to have in a .bashrc. Reading a
    // variable we did not define — COMP_LINE, PROMPT_COMMAND, HOSTNAME, or an
    // EMPTY saved-prompt array — then aborts with "unbound variable" at every
    // prompt, turning shell integration into a stream of errors.
    let (_dir, home, script) = interactive_fixture("set -u\nPS1='$ '\n");

    let Some(out) = run_interactive_bash(&home, &script, "echo READY\nexit\n") else {
        eprintln!("bash unavailable — skipping interactive check");
        return;
    };

    assert!(
        !out.contains("unbound variable"),
        "set -u produced unbound-variable errors: {out:?}"
    );
    // …and the integration must still actually work, not merely stay quiet.
    assert!(
        out.contains("READY"),
        "the shell did not run the command: {out:?}"
    );
    assert!(
        out.contains("\u{1b}]133;A\u{7}"),
        "no prompt mark under set -u: {out:?}"
    );
}

#[cfg(unix)]
#[test]
fn bash_script_survives_set_u_with_a_user_prompt_command() {
    // The empty-array case is only one half; with a saved entry the loop runs,
    // and `${arr[@]}` still has to be safe.
    let (_dir, home, script) =
        interactive_fixture("set -u\nPS1='$ '\nPROMPT_COMMAND='echo HOOKRAN'\n");

    let Some(out) = run_interactive_bash(&home, &script, "echo READY\nexit\n") else {
        eprintln!("bash unavailable — skipping interactive check");
        return;
    };

    assert!(
        !out.contains("unbound variable"),
        "set -u with a user PROMPT_COMMAND produced errors: {out:?}"
    );
    assert!(
        out.contains("HOOKRAN"),
        "the user's prompt hook stopped running: {out:?}"
    );
}
