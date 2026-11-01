//! Tests for `spawn.rs` — process-spawn platform utilities.

use super::*;

/// `build_command` output must stay spawnable after the Windows
/// `CREATE_NO_WINDOW` flag is applied (issue #1091 regression guard).
/// Uses the platform's trivial echo so this holds on every CI OS.
#[test]
fn build_command_spawns_after_hide_console_window() {
    #[cfg(target_os = "windows")]
    let output = build_command("cmd.exe", &["/c", "echo vmark"]).output();
    #[cfg(not(target_os = "windows"))]
    let output = build_command("echo", &["vmark"]).output();

    let output = output.expect("build_command must produce a spawnable command");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("vmark"));
}

// ---------------------------------------------------------------------------
// build_command never puts a shell in front of the program (WI-RA4.1)
// ---------------------------------------------------------------------------

/// The program is the executable itself on every target — for a `.cmd`/`.bat`
/// shim too. With `cmd.exe` as the program the arguments get the ordinary
/// quoting, which cmd.exe does not follow, so `&`, `"` and `%VAR%` in an
/// argument are acted on; with the shim as the program the standard library
/// escapes them by cmd.exe's own rules.
#[test]
fn build_command_runs_the_executable_itself_never_a_shell_around_it() {
    for exe in [
        r"C:\Users\me\AppData\Roaming\npm\claude.cmd",
        r"C:\tools\legacy.BAT",
        r"C:\Program Files\Pandoc\pandoc.exe",
        "/opt/homebrew/bin/codex",
        "git",
    ] {
        let args = ["exec", "a&b", "%PATH%", "say \"hi\""];
        let cmd = build_command(exe, &args);
        assert_eq!(cmd.get_program().to_str(), Some(exe), "program for {exe}");
        assert_eq!(
            cmd.get_args().map(|a| a.to_str()).collect::<Vec<_>>(),
            args.iter().map(|a| Some(*a)).collect::<Vec<_>>(),
            "arguments for {exe} are exactly the caller's, with nothing prepended"
        );
    }
}

/// An argument that cannot be passed on is refused at spawn, not truncated or
/// reinterpreted: a NUL on every target (and a line break, for a batch shim —
/// see the Windows test below).
#[test]
fn an_argument_holding_a_nul_is_refused_at_spawn() {
    #[cfg(target_os = "windows")]
    let exe = "cmd.exe";
    #[cfg(not(target_os = "windows"))]
    let exe = "echo";
    let error = build_command(exe, &["before\0after"])
        .spawn()
        .expect_err("a NUL cannot be part of an argument");
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
}

#[test]
fn spawn_failure_says_when_an_argument_was_refused() {
    let refused = std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "batch file arguments are invalid",
    );
    let message = spawn_failure("claude", &refused);
    assert!(
        message.contains("claude")
            && message.contains("argument")
            && message.contains("batch file arguments are invalid"),
        "a refused argument must be named as such: {message}"
    );

    let missing = std::io::Error::new(std::io::ErrorKind::NotFound, "program not found");
    assert_eq!(
        spawn_failure("claude", &missing),
        "Failed to spawn claude: program not found"
    );
}

/// A batch shim written to a temp directory. Windows-only: these tests run a
/// real `.cmd` through `build_command`, which is the only way to see what
/// cmd.exe makes of an argument.
#[cfg(windows)]
fn batch_shim(body: &str) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("shim.cmd");
    std::fs::write(&path, body).expect("write shim");
    (dir, path.to_str().expect("utf-8 path").to_string())
}

/// The injection the `cmd.exe /c` wrapper allowed: a quote in an argument
/// closed the wrapper's quoting, and the `&` after it started a second command.
#[cfg(windows)]
#[test]
fn a_batch_shim_argument_cannot_start_a_second_command() {
    let (_dir, shim) = batch_shim("@echo off\r\necho RAN\r\n");
    let output = build_command(&shim, &["a\" & echo VMARK_INJECTED & \""])
        .output()
        .expect("a .cmd shim must spawn directly");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "shim failed: {stdout}");
    assert!(stdout.contains("RAN"), "the shim must have run: {stdout}");
    assert!(
        !stdout.contains("VMARK_INJECTED"),
        "an argument ran as a command: {stdout}"
    );
}

/// `%VAR%` in an argument reaches the shim as written, not as the variable's
/// value (`%OS%` is `Windows_NT` on every Windows).
#[cfg(windows)]
#[test]
fn a_batch_shim_argument_is_not_expanded_as_a_variable() {
    let (_dir, shim) = batch_shim("@echo off\r\necho [%~1]\r\n");
    let output = build_command(&shim, &["%OS%"])
        .output()
        .expect("a .cmd shim must spawn directly");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("%OS%") && !stdout.contains("Windows_NT"),
        "the argument must arrive unexpanded: {stdout}"
    );
}

/// A line break cannot be escaped for cmd.exe at all, so the standard library
/// refuses the spawn. This is why the AI prompt travels on stdin: as an
/// argument, every multi-line prompt would be refused here.
#[cfg(windows)]
#[test]
fn a_line_break_in_a_batch_shim_argument_is_refused_at_spawn() {
    let (_dir, shim) = batch_shim("@echo off\r\n");
    for arg in ["line one\nline two", "line one\r\nline two"] {
        let error = build_command(&shim, &[arg])
            .spawn()
            .expect_err("a line break cannot be passed to a batch shim");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput, "{arg:?}");
    }
}

/// `which_command` must stay spawnable after the hidden-console flag is
/// applied on Windows (issue #1091 regression guard). Only asserts the
/// spawn itself — whether the lookup finds a hit depends on the env.
#[test]
fn which_command_spawns_after_hide_console_window() {
    let output = which_command().arg("cargo").output();
    assert!(output.is_ok(), "which/where must spawn: {:?}", output.err());
}

/// On macOS/Linux the lookup binary itself must resolve from the trusted
/// absolute path when it exists, so a hijacked parent PATH can't swap it.
#[cfg(unix)]
#[test]
fn which_command_prefers_absolute_path() {
    if std::path::Path::new("/usr/bin/which").exists() {
        assert_eq!(
            which_command().get_program().to_str(),
            Some("/usr/bin/which")
        );
    }
}

// ---------------------------------------------------------------------------
// parse_sentinel
// ---------------------------------------------------------------------------

#[test]
fn parse_sentinel_extracts_trimmed_value() {
    assert_eq!(
        parse_sentinel("noise<S>  /home/x/.zsh  <E>tail", "<S>", "<E>"),
        Some("/home/x/.zsh".to_string())
    );
}

#[test]
fn parse_sentinel_none_when_markers_missing() {
    assert_eq!(parse_sentinel("<S>only start, no end", "<S>", "<E>"), None);
    assert_eq!(parse_sentinel("no markers at all", "<S>", "<E>"), None);
}

#[test]
fn parse_sentinel_empty_between_markers() {
    // Unset value prints START immediately followed by END → empty value.
    assert_eq!(parse_sentinel("<S><E>", "<S>", "<E>"), Some(String::new()));
}

/// An END marker in startup noise BEFORE the START marker must not confuse
/// the parse (the old inline Windows logic sliced `raw[s..e]` with `e < s`,
/// which panics).
#[test]
fn parse_sentinel_ignores_end_marker_before_start() {
    assert_eq!(
        parse_sentinel("<E>noise<S>value<E>", "<S>", "<E>"),
        Some("value".to_string())
    );
}

/// WI-RA7C.4 — every child process, in tests as in production, is built by
/// `build_command` (or `which_command`). A bare `Command::new` skips the
/// console-window flag on Windows and, more to the point, is the shape a
/// future production call site gets copied from; the tests are where most of
/// the bare ones lived.
#[test]
fn only_this_module_constructs_a_command() {
    let constructor = regex::Regex::new(r"\bCommand::new\s*\(").expect("regex");
    let files = crate::source_scan::all_files();
    assert!(files.len() > 400, "only {} files were scanned", files.len());
    let offenders: Vec<String> = files
        .iter()
        .filter(|(path, _)| path != "ai_provider/spawn.rs")
        .flat_map(|(path, code)| {
            constructor
                .find_iter(code)
                .map(|found| format!("{path}:{}", code[..found.start()].matches('\n').count() + 1))
                .collect::<Vec<_>>()
        })
        .collect();
    assert!(
        offenders.is_empty(),
        "{} bare `Command::new` call(s) — use `ai_provider::build_command`:\n{}",
        offenders.len(),
        offenders.join("\n")
    );
}
