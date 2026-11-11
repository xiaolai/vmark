// WI-RA7C.4 — actionlint is found in, and run with, the one PATH it is given.
// (The output-parsing cases predate that and moved here with the module's
// other tests.)

use super::*;

#[test]
fn parse_actionlint_array_form() {
    let input = r#"[{"message":"unused","kind":"syntax-check","line":3,"column":5}]"#;
    let result = parse_actionlint_output(input);
    match result {
        LintResult::Ok { diagnostics } => {
            assert_eq!(diagnostics.len(), 1);
            assert_eq!(diagnostics[0].line, 3);
            assert_eq!(diagnostics[0].kind, "syntax-check");
        }
        _ => panic!("expected Ok"),
    }
}

#[test]
fn parse_actionlint_jsonl_form() {
    let input = r#"{"message":"a","kind":"x","line":1,"column":1}
{"message":"b","kind":"y","line":2,"column":1}"#;
    let result = parse_actionlint_output(input);
    match result {
        LintResult::Ok { diagnostics } => {
            assert_eq!(diagnostics.len(), 2);
            assert_eq!(diagnostics[0].message, "a");
            assert_eq!(diagnostics[1].message, "b");
        }
        _ => panic!("expected Ok"),
    }
}

#[test]
fn parse_actionlint_skips_malformed_lines() {
    let input = "{\"message\":\"a\",\"kind\":\"x\",\"line\":1,\"column\":1}\nnot-json\n{\"message\":\"b\",\"kind\":\"y\",\"line\":2,\"column\":1}";
    let result = parse_actionlint_output(input);
    match result {
        LintResult::Ok { diagnostics } => {
            assert_eq!(diagnostics.len(), 2);
        }
        _ => panic!("expected Ok"),
    }
}

#[test]
fn parse_actionlint_returns_failed_for_corrupt_array() {
    let input = "[ this is not valid json ]";
    let result = parse_actionlint_output(input);
    assert!(matches!(result, LintResult::Failed { .. }));
}

#[test]
fn parse_actionlint_empty_array_means_clean() {
    let input = "[]";
    let result = parse_actionlint_output(input);
    match result {
        LintResult::Ok { diagnostics } => assert!(diagnostics.is_empty()),
        _ => panic!("expected Ok with empty diagnostics"),
    }
}

// -- finding and running the binary ------------------------------------------

/// An executable `name` in `dir` that runs `script` under /bin/sh.
#[cfg(unix)]
fn fake_tool(dir: &std::path::Path, name: &str, script: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).expect("write tool");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    path
}

fn join(dirs: &[&std::path::Path]) -> String {
    std::env::join_paths(dirs)
        .expect("joinable")
        .to_string_lossy()
        .into_owned()
}

#[test]
fn the_binary_is_found_in_the_first_directory_that_holds_it() {
    let (first, second, empty) = (
        tempfile::tempdir().expect("tempdir"),
        tempfile::tempdir().expect("tempdir"),
        tempfile::tempdir().expect("tempdir"),
    );
    let file = if cfg!(windows) {
        "actionlint.exe"
    } else {
        "actionlint"
    };
    std::fs::write(first.path().join(file), "").expect("write");
    std::fs::write(second.path().join(file), "").expect("write");

    let path = join(&[empty.path(), first.path(), second.path()]);
    assert_eq!(
        find_in_path(&path, "actionlint"),
        Some(first.path().join(file))
    );
}

/// #1666: an extensionless `actionlint` beside the real one is a POSIX shim
/// Windows cannot run (os error 193); it must lose to `actionlint.exe`, and
/// must not be taken at all when nothing runnable sits next to it.
#[test]
fn on_windows_an_extensionless_shim_is_never_taken() {
    let (shim_dir, exe_dir) = (
        tempfile::tempdir().expect("tempdir"),
        tempfile::tempdir().expect("tempdir"),
    );
    std::fs::write(shim_dir.path().join("actionlint"), "").expect("write");
    std::fs::write(exe_dir.path().join("actionlint.exe"), "").expect("write");

    let shim_only = join(&[shim_dir.path()]);
    assert_eq!(find_in_path_for(&shim_only, "actionlint", true), None);
    // The same directory is a hit where a bare name is the executable.
    assert_eq!(
        find_in_path_for(&shim_only, "actionlint", false),
        Some(shim_dir.path().join("actionlint"))
    );

    let both = join(&[shim_dir.path(), exe_dir.path()]);
    assert_eq!(
        find_in_path_for(&both, "actionlint", true),
        Some(exe_dir.path().join("actionlint.exe"))
    );
}

#[test]
fn nothing_is_found_in_an_empty_path_or_under_a_directory_of_that_name() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir(dir.path().join("actionlint")).expect("mkdir");

    assert_eq!(find_in_path("", "actionlint"), None);
    assert_eq!(find_in_path(&join(&[dir.path()]), "actionlint"), None);
    // A name with a space can never be a file here.
    assert_eq!(
        find_in_path(&join(&[dir.path()]), "not a real binary"),
        None
    );
}

#[test]
fn a_path_without_the_binary_reports_it_missing() {
    // No process environment is touched: the PATH is an argument.
    let dir = tempfile::tempdir().expect("tempdir");
    let result = run_actionlint("on: push\njobs: {}\n", &join(&[dir.path()]));
    assert!(matches!(result, LintResult::BinaryMissing));
}

/// The child runs with exactly the PATH the binary was found on — once. The
/// frontend used to supply a PATH that was then prepended to the same
/// login-shell PATH, so the child saw every directory twice.
#[cfg(unix)]
#[test]
fn the_child_runs_with_the_path_it_was_found_on() {
    let dir = tempfile::tempdir().expect("tempdir");
    fake_tool(
        dir.path(),
        "actionlint",
        r#"cat >/dev/null; printf '[{"message":"%s","kind":"path","line":1,"column":1}]' "$PATH""#,
    );
    // /bin and /usr/bin so the script's own `cat` and `printf` resolve.
    let path = format!("{}:/bin:/usr/bin", dir.path().display());

    match run_actionlint("on: push\n", &path) {
        LintResult::Ok { diagnostics } => {
            assert_eq!(diagnostics.len(), 1);
            assert_eq!(diagnostics[0].message, path);
        }
        other => panic!("expected the fake's report, got {other:?}"),
    }
}

/// A subtool is resolved through the same PATH: actionlint shells out to
/// shellcheck and pyflakes by bare name.
#[cfg(unix)]
#[test]
fn a_subtool_on_the_same_path_is_reachable_from_the_child() {
    let dir = tempfile::tempdir().expect("tempdir");
    fake_tool(dir.path(), "vmark-fake-subtool", "printf found");
    fake_tool(
        dir.path(),
        "actionlint",
        r#"cat >/dev/null; printf '[{"message":"%s","kind":"sub","line":1,"column":1}]' "$(vmark-fake-subtool)""#,
    );
    let path = format!("{}:/bin:/usr/bin", dir.path().display());

    match run_actionlint("on: push\n", &path) {
        LintResult::Ok { diagnostics } => assert_eq!(diagnostics[0].message, "found"),
        other => panic!("expected the fake's report, got {other:?}"),
    }
}
