//! Tests for `external_editor.rs` (moved from the inline `#[cfg(test)]` module;
//! included via `#[path]`).

use super::*;
use std::sync::Mutex;

/// Serializes tests that mutate the process environment. `cargo test`
/// runs `#[test]` functions in parallel threads, but `std::env` is
/// process-wide — without this guard the three `resolve_editor_*`
/// tests below race on `VMARK_EXTERNAL_EDITOR` / `VISUAL` / `EDITOR`,
/// producing platform-dependent flaky failures (notably on Linux CI).
/// Holding `_guard` for the duration of each test makes the env
/// mutations effectively atomic across the suite.
static ENV_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn resolve_editor_prefers_gui_override_above_all() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // GUI setting beats every env var.
    let _vmark = std::env::var("VMARK_EXTERNAL_EDITOR").ok();
    let _visual = std::env::var("VISUAL").ok();
    let _editor = std::env::var("EDITOR").ok();
    std::env::set_var("VMARK_EXTERNAL_EDITOR", "vmark-env");
    std::env::set_var("VISUAL", "visual-env");
    std::env::set_var("EDITOR", "editor-env");
    assert_eq!(
        resolve_editor(Some("/Applications/Cursor.app")),
        "/Applications/Cursor.app"
    );
    // Empty / whitespace override falls through to env var chain.
    assert_eq!(resolve_editor(Some("")), "vmark-env");
    assert_eq!(resolve_editor(Some("   ")), "vmark-env");
    std::env::remove_var("VMARK_EXTERNAL_EDITOR");
    std::env::remove_var("VISUAL");
    std::env::remove_var("EDITOR");
    if let Some(v) = _vmark {
        std::env::set_var("VMARK_EXTERNAL_EDITOR", v);
    }
    if let Some(v) = _visual {
        std::env::set_var("VISUAL", v);
    }
    if let Some(v) = _editor {
        std::env::set_var("EDITOR", v);
    }
}

#[test]
fn resolve_editor_prefers_vmark_env_when_no_override() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _vmark = std::env::var("VMARK_EXTERNAL_EDITOR").ok();
    let _visual = std::env::var("VISUAL").ok();
    let _editor = std::env::var("EDITOR").ok();
    std::env::set_var("VMARK_EXTERNAL_EDITOR", "myeditor");
    std::env::set_var("VISUAL", "should-be-ignored");
    std::env::set_var("EDITOR", "should-be-ignored");
    assert_eq!(resolve_editor(None), "myeditor");
    std::env::remove_var("VMARK_EXTERNAL_EDITOR");
    std::env::remove_var("VISUAL");
    std::env::remove_var("EDITOR");
    if let Some(v) = _vmark {
        std::env::set_var("VMARK_EXTERNAL_EDITOR", v);
    }
    if let Some(v) = _visual {
        std::env::set_var("VISUAL", v);
    }
    if let Some(v) = _editor {
        std::env::set_var("EDITOR", v);
    }
}

#[test]
fn resolve_editor_falls_through_to_platform_default() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _vmark = std::env::var("VMARK_EXTERNAL_EDITOR").ok();
    let _visual = std::env::var("VISUAL").ok();
    let _editor = std::env::var("EDITOR").ok();
    std::env::remove_var("VMARK_EXTERNAL_EDITOR");
    std::env::remove_var("VISUAL");
    std::env::remove_var("EDITOR");
    let resolved = resolve_editor(None);
    assert!(!resolved.is_empty());
    if let Some(v) = _vmark {
        std::env::set_var("VMARK_EXTERNAL_EDITOR", v);
    }
    if let Some(v) = _visual {
        std::env::set_var("VISUAL", v);
    }
    if let Some(v) = _editor {
        std::env::set_var("EDITOR", v);
    }
}

#[test]
fn open_in_external_editor_rejects_missing_path() {
    let result = open_in_external_editor_blocking("/definitely/does/not/exist".to_string(), None);
    assert!(result.is_err());
}

#[test]
fn open_in_external_editor_rejects_directory() {
    let dir = tempfile::tempdir().expect("tempdir");
    let result = open_in_external_editor_blocking(dir.path().to_string_lossy().into_owned(), None);
    assert!(result.is_err(), "directories must be rejected");
}

#[test]
fn open_in_external_editor_rejects_unsupported_extension() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("secret.bin");
    std::fs::write(&target, b"not a markdown file").expect("write");
    let result = open_in_external_editor_blocking(target.to_string_lossy().into_owned(), None);
    assert!(
        result.is_err(),
        "files with unregistered extensions must be rejected"
    );
}

#[test]
fn validate_editor_override_accepts_empty_and_whitespace() {
    assert_eq!(validate_editor_override("").unwrap(), "");
    assert_eq!(validate_editor_override("   ").unwrap(), "");
}

#[test]
fn validate_editor_override_accepts_bare_command_names() {
    assert_eq!(validate_editor_override("code").unwrap(), "code");
    assert_eq!(validate_editor_override("subl").unwrap(), "subl");
    assert_eq!(validate_editor_override("nvim").unwrap(), "nvim");
}

#[test]
fn validate_editor_override_rejects_relative_with_whitespace() {
    // Multi-token bare overrides (relative or PATH-resolved) belong
    // in $VMARK_EXTERNAL_EDITOR env var — the env var isn't
    // webview-supplied so XSS can't poison it.
    for input in &["code --wait", "subl -n", "nvim +0", "python -c x"] {
        let result = validate_editor_override(input);
        assert!(
            result.is_err(),
            "multi-token bare override must be rejected (XSS gate): {input:?}"
        );
    }
}

#[test]
fn validate_editor_override_accepts_absolute_path_with_whitespace_when_real() {
    // macOS `.app` bundles routinely have spaces in their names.
    // We allow whitespace ONLY when the path exists on disk —
    // /Applications/Calculator.app exists on every macOS install.
    #[cfg(target_os = "macos")]
    {
        let bundle = "/Applications/Calculator.app";
        if Path::new(bundle).is_dir() {
            let result = validate_editor_override(bundle);
            assert!(
                result.is_ok(),
                "real .app bundle path with no whitespace must validate; got {result:?}"
            );
        }
        // Synthesize a real path with whitespace: /tmp/My Tool.app
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

#[test]
fn validate_editor_override_rejects_absolute_path_with_whitespace_when_fake() {
    let result = validate_editor_override("/tmp/Not Real.app");
    assert!(
        result.is_err(),
        "absolute path with whitespace must NOT validate when it doesn't exist"
    );
}

#[test]
fn validate_editor_override_rejects_shell_metacharacters() {
    // Quotes are also rejected to prevent any future shell-out path
    // from being tricked into argv-injection.
    for input in &[
        "code;", "code|", "code&", "code`", "code$", "code>", "code\"", "code'", "code\nrm",
    ] {
        let result = validate_editor_override(input);
        assert!(
            result.is_err(),
            "must reject shell metacharacters in: {input:?}"
        );
    }
}

#[test]
fn validate_editor_override_rejects_flag_prefix() {
    let result = validate_editor_override("-c");
    assert!(result.is_err(), "must reject overrides that start with '-'");
}

#[test]
fn validate_editor_override_rejects_nonexistent_absolute_paths() {
    let result = validate_editor_override("/totally/not/a/real/path/code");
    assert!(
        result.is_err(),
        "non-existent absolute paths must be rejected (XSS gate)"
    );
}

#[test]
fn validate_editor_override_accepts_existing_absolute_path() {
    // /bin/sh exists on macOS / Linux; on Windows this branch is skipped
    // since /bin/sh isn't a Windows path.
    #[cfg(unix)]
    {
        let result = validate_editor_override("/bin/sh");
        assert!(
            result.is_ok(),
            "existing absolute paths should validate; got {result:?}"
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn maybe_open_app_bundle_rewrites_dot_app_directory() {
    // /Applications/Calculator.app exists on every macOS install.
    let bundle = "/Applications/Calculator.app";
    if !Path::new(bundle).is_dir() {
        return; // Skip on macOS variants without Calculator.
    }
    let result = maybe_open_app_bundle(bundle, &[], "/tmp/file.md");
    let (exe, args) = result.expect(".app dir should rewrite");
    assert_eq!(exe, "open");
    assert_eq!(args, vec!["-a", bundle, "/tmp/file.md"]);
}

#[cfg(target_os = "macos")]
#[test]
fn maybe_open_app_bundle_returns_none_for_regular_executable() {
    let result = maybe_open_app_bundle("/bin/sh", &["-c"], "/tmp/file.md");
    assert!(
        result.is_none(),
        "regular executable should not trigger .app rewrite"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn maybe_open_app_bundle_returns_none_for_dot_app_string_that_isnt_a_dir() {
    // The string ends with .app but the path isn't a directory.
    let result = maybe_open_app_bundle("/tmp/not-real-cursor.app", &[], "/tmp/file.md");
    assert!(
        result.is_none(),
        "non-existent .app path should not trigger rewrite"
    );
}
