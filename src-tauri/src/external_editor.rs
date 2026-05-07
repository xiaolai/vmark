//! # External Editor
//!
//! Purpose: Launch the user's `$EDITOR` (or platform default) on a file
//! path. Backs the WI-4.4 "Open in external editor" button surfaced
//! inside the read-only code viewer.
//!
//! Pipeline: frontend `invoke("open_in_external_editor", { path })` →
//! resolve editor command via `$VMARK_EXTERNAL_EDITOR` → `$VISUAL` →
//! `$EDITOR` → platform default → spawn detached → return.
//!
//! Key decisions:
//!   - macOS GUI apps inherit a minimal PATH from launchd, so we go
//!     through `ai_provider::login_shell_path()` (already used for
//!     Codex / Claude CLI launch) so VS Code, Cursor, JetBrains
//!     wrappers, etc. resolve.
//!   - `ai_provider::build_command()` handles `.cmd` shims on Windows
//!     transparently. Same pattern as elsewhere in the codebase.
//!   - Spawn detached: we don't wait for the editor to exit. The
//!     Tauri command returns as soon as the child is launched.
//!   - Best-effort: spawn failures return a `Result::Err` with a
//!     human-readable message. The frontend toasts it.
//!
//! Known limitations:
//!   - No quoting / escaping for editor commands with spaces in the
//!     path. We split on whitespace, so `EDITOR="/Applications/Sublime
//!     Text.app/Contents/SharedSupport/bin/subl"` works as-is, but
//!     `EDITOR="path with spaces/cli arg"` doesn't. Wrap in a shell
//!     script if needed.

use crate::ai_provider::{build_command, login_shell_path};
use std::path::Path;

/// Reject editor overrides that look like shell commands.
///
/// `editor_override` is webview-supplied (the GUI Settings value). The
/// threat model is: a compromised webview (XSS-style attack) calls
/// `invoke("open_in_external_editor", { editorOverride: "<malicious>" })`.
/// We never invoke a shell, so the malicious string isn't *interpreted*
/// as shell — but `python -c "..."` style overrides would still execute
/// arbitrary code via the editor's own interpreter.
///
/// Mitigation: the override must be a SINGLE token (no whitespace, no
/// args). Multi-arg invocations belong in `$VMARK_EXTERNAL_EDITOR` env
/// var — env vars aren't webview-supplied so they can't be poisoned by
/// XSS. Combined with the no-shell-metachar check and the exists-on-disk
/// check, this leaves a webview attacker with only two options: pick a
/// bare command name (where they don't control the args) or pick an
/// existing absolute path (which they don't control either).
///
/// Returns the trimmed override on success, or an `Err` describing why
/// the input was refused.
fn validate_editor_override(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    // The entire override is treated as a single executable path or
    // command name (NOT split into exe + args). Args belong in
    // $VMARK_EXTERNAL_EDITOR env var, which isn't webview-supplied so
    // an XSS attacker can't poison it.
    //
    // Reject shell metacharacters as defense-in-depth — they would
    // never be interpreted (we don't shell-out) but accepting them
    // here makes a future shell-out refactor a security regression
    // by accident.
    const FORBIDDEN: &[char] = &[
        ';', '|', '&', '`', '$', '<', '>', '\n', '\r', '\0', '"', '\'',
    ];
    if let Some(c) = trimmed.chars().find(|c| FORBIDDEN.contains(c)) {
        return Err(format!(
            "external editor override contains forbidden character {c:?}; \
             pick an executable path or app bundle without shell metacharacters"
        ));
    }
    // Reject overrides that start with `-` — a bare leading-flag has
    // no useful semantics for an executable path/name and matches the
    // shape of "interpreter inline-code" exploits (`-c`, `--eval`, …).
    if trimmed.starts_with('-') {
        return Err(format!(
            "external editor override must not start with '-' (looks like a \
             command-line flag). Got: {trimmed:?}"
        ));
    }
    let is_absolute = trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || (trimmed.len() >= 2 && trimmed.chars().nth(1) == Some(':'));
    if is_absolute {
        // Absolute path: must exist on disk. This blocks the XSS
        // attacker from aiming the editor button at a writable
        // download folder they control.
        if !Path::new(trimmed).exists() {
            return Err(format!(
                "external editor override path '{trimmed}' does not exist"
            ));
        }
    } else {
        // Relative / bare-name override: must be a single token (no
        // whitespace, no separators). Real macOS `.app` paths use
        // spaces ("Visual Studio Code.app") but those are absolute and
        // covered above. Bare names like `code` / `subl` are safe.
        if trimmed.contains(char::is_whitespace) {
            return Err(format!(
                "external editor override with whitespace must be an absolute \
                 path that exists on disk (e.g. /Applications/My App.app). To \
                 pass arguments, set the $VMARK_EXTERNAL_EDITOR environment \
                 variable instead. Got: {trimmed:?}"
            ));
        }
    }
    Ok(trimmed.to_string())
}

/// Resolve which editor command to launch. Order:
///   1. `editor_override` from the GUI setting (explicit beats implicit;
///      already validated by `validate_editor_override`)
///   2. `$VMARK_EXTERNAL_EDITOR` (project override)
///   3. `$VISUAL`
///   4. `$EDITOR`
///   5. Platform default (`open -t` on macOS, `notepad.exe` on Windows,
///      `xdg-open` on Linux/BSD)
fn resolve_editor(editor_override: Option<&str>) -> String {
    if let Some(v) = editor_override {
        if !v.trim().is_empty() {
            return v.to_string();
        }
    }
    if let Ok(v) = std::env::var("VMARK_EXTERNAL_EDITOR") {
        if !v.trim().is_empty() {
            return v;
        }
    }
    if let Ok(v) = std::env::var("VISUAL") {
        if !v.trim().is_empty() {
            return v;
        }
    }
    if let Ok(v) = std::env::var("EDITOR") {
        if !v.trim().is_empty() {
            return v;
        }
    }
    // Platform default fallback.
    #[cfg(target_os = "macos")]
    {
        return "open -t".to_string();
    }
    #[cfg(target_os = "windows")]
    {
        return "notepad.exe".to_string();
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        return "xdg-open".to_string();
    }
}

/// macOS-only: when the resolved executable is an `.app` bundle directory,
/// rewrite the spawn arguments to `open -a <bundle> <file>` so Launch
/// Services routes the open through the bundle's main executable. Without
/// this, `Command::new("/Applications/Cursor.app").spawn()` fails because
/// `.app` is a directory, not an executable.
///
/// Returns `Some((exe, args))` if a rewrite happened; `None` to use the
/// caller's exe + args unchanged.
#[cfg(target_os = "macos")]
fn maybe_open_app_bundle(
    exe: &str,
    extra_args: &[&str],
    file_path: &str,
) -> Option<(String, Vec<String>)> {
    let p = Path::new(exe);
    if exe.ends_with(".app") && p.is_dir() {
        let mut args = vec!["-a".to_string(), exe.to_string()];
        args.extend(extra_args.iter().map(|a| a.to_string()));
        args.push(file_path.to_string());
        Some(("open".to_string(), args))
    } else {
        None
    }
}

/// Open `path` in the user's external editor. Returns `Ok(())` once
/// the child has been spawned (we do NOT wait). On spawn failure,
/// returns a human-readable error so the frontend can toast it.
///
/// Accepts only paths that:
///   1. Resolve to a regular file (not a directory or device).
///   2. Have a registered VMark format extension (mirrors the
///      `validate_openable_path` security gate so a compromised
///      webview can't aim the external editor at arbitrary targets).
/// Canonicalization runs first so symlinks resolve before the
/// extension check (a `.md` link to `/etc/passwd` is rejected).
#[tauri::command]
pub fn open_in_external_editor(
    path: String,
    editor_override: Option<String>,
) -> Result<(), String> {
    let canonical = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("invalid path '{path}': {e}"))?;
    if !canonical.is_file() {
        return Err(format!("path '{path}' is not a regular file"));
    }
    if !crate::is_openable_supported(&canonical) {
        return Err(format!(
            "path '{path}' is not an openable VMark file"
        ));
    }

    // Validate the GUI override BEFORE feeding it into the resolution
    // chain. This catches XSS-style attacks where the webview supplies
    // `editor_override = "/usr/bin/python -c 'malicious'"` — the
    // forbidden-character check rejects shell metacharacters and the
    // existence check rejects absolute paths the user can't possibly
    // have configured intentionally.
    let validated_override = match editor_override.as_deref() {
        Some(raw) => Some(validate_editor_override(raw)?),
        None => None,
    };
    let editor_cmd = resolve_editor(validated_override.as_deref());
    // GUI override: treat the entire string as a single exe (path or
    // bare command — already validated to have no internal whitespace
    // unless it's an existing absolute path like `/Applications/My
    // App.app`). Env-var / platform-default values still allow args
    // via whitespace because they aren't webview-supplied.
    let (exe, extra_args): (&str, Vec<&str>) =
        if validated_override.as_deref().is_some_and(|s| !s.is_empty()) {
            (editor_cmd.as_str(), Vec::new())
        } else {
            let mut parts = editor_cmd.split_whitespace();
            let first = parts.next().unwrap_or("");
            let rest: Vec<&str> = parts.collect();
            (first, rest)
        };
    if exe.is_empty() {
        return Err("No editor configured (EDITOR / VISUAL unset)".to_string());
    }

    // macOS .app bundle support: a path like `/Applications/Cursor.app`
    // isn't executable directly. Rewrite to `open -a <bundle> <file>`
    // so Launch Services dispatches to the bundle's main executable.
    #[cfg(target_os = "macos")]
    let (exe_owned, args_owned): (String, Vec<String>) =
        match maybe_open_app_bundle(exe, &extra_args, &path) {
            Some((e, a)) => (e, a),
            None => {
                let mut a: Vec<String> =
                    extra_args.iter().map(|s| s.to_string()).collect();
                a.push(path.clone());
                (exe.to_string(), a)
            }
        };
    #[cfg(not(target_os = "macos"))]
    let (exe_owned, args_owned): (String, Vec<String>) = {
        let mut a: Vec<String> =
            extra_args.iter().map(|s| s.to_string()).collect();
        a.push(path.clone());
        (exe.to_string(), a)
    };

    let args_refs: Vec<&str> = args_owned.iter().map(|s| s.as_str()).collect();
    let mut cmd = build_command(&exe_owned, &args_refs);
    cmd.env("PATH", login_shell_path());
    match cmd.spawn() {
        Ok(child) => {
            // Reap on a detached thread so fast-exiting launchers
            // (`open -t`, `xdg-open`) don't leave zombies on Unix.
            // We deliberately don't wait synchronously — the editor
            // may run for hours.
            let mut child = child;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        }
        Err(e) => Err(format!(
            "Failed to launch editor '{exe_owned}' for '{path}': {e}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_editor_prefers_gui_override_above_all() {
        // GUI setting beats every env var.
        let _vmark = std::env::var("VMARK_EXTERNAL_EDITOR").ok();
        let _visual = std::env::var("VISUAL").ok();
        let _editor = std::env::var("EDITOR").ok();
        std::env::set_var("VMARK_EXTERNAL_EDITOR", "vmark-env");
        std::env::set_var("VISUAL", "visual-env");
        std::env::set_var("EDITOR", "editor-env");
        assert_eq!(resolve_editor(Some("/Applications/Cursor.app")), "/Applications/Cursor.app");
        // Empty / whitespace override falls through to env var chain.
        assert_eq!(resolve_editor(Some("")), "vmark-env");
        assert_eq!(resolve_editor(Some("   ")), "vmark-env");
        std::env::remove_var("VMARK_EXTERNAL_EDITOR");
        std::env::remove_var("VISUAL");
        std::env::remove_var("EDITOR");
        if let Some(v) = _vmark { std::env::set_var("VMARK_EXTERNAL_EDITOR", v); }
        if let Some(v) = _visual { std::env::set_var("VISUAL", v); }
        if let Some(v) = _editor { std::env::set_var("EDITOR", v); }
    }

    #[test]
    fn resolve_editor_prefers_vmark_env_when_no_override() {
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
        if let Some(v) = _vmark { std::env::set_var("VMARK_EXTERNAL_EDITOR", v); }
        if let Some(v) = _visual { std::env::set_var("VISUAL", v); }
        if let Some(v) = _editor { std::env::set_var("EDITOR", v); }
    }

    #[test]
    fn resolve_editor_falls_through_to_platform_default() {
        let _vmark = std::env::var("VMARK_EXTERNAL_EDITOR").ok();
        let _visual = std::env::var("VISUAL").ok();
        let _editor = std::env::var("EDITOR").ok();
        std::env::remove_var("VMARK_EXTERNAL_EDITOR");
        std::env::remove_var("VISUAL");
        std::env::remove_var("EDITOR");
        let resolved = resolve_editor(None);
        assert!(!resolved.is_empty());
        if let Some(v) = _vmark { std::env::set_var("VMARK_EXTERNAL_EDITOR", v); }
        if let Some(v) = _visual { std::env::set_var("VISUAL", v); }
        if let Some(v) = _editor { std::env::set_var("EDITOR", v); }
    }

    #[test]
    fn open_in_external_editor_rejects_missing_path() {
        let result =
            open_in_external_editor("/definitely/does/not/exist".to_string(), None);
        assert!(result.is_err());
    }

    #[test]
    fn open_in_external_editor_rejects_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let result = open_in_external_editor(
            dir.path().to_string_lossy().into_owned(),
            None,
        );
        assert!(result.is_err(), "directories must be rejected");
    }

    #[test]
    fn open_in_external_editor_rejects_unsupported_extension() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("secret.bin");
        std::fs::write(&target, b"not a markdown file").expect("write");
        let result = open_in_external_editor(
            target.to_string_lossy().into_owned(),
            None,
        );
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
            "code;",
            "code|",
            "code&",
            "code`",
            "code$",
            "code>",
            "code\"",
            "code'",
            "code\nrm",
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
        assert!(
            result.is_err(),
            "must reject overrides that start with '-'"
        );
    }

    #[test]
    fn validate_editor_override_rejects_nonexistent_absolute_paths() {
        let result =
            validate_editor_override("/totally/not/a/real/path/code");
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
        let result =
            maybe_open_app_bundle("/tmp/not-real-cursor.app", &[], "/tmp/file.md");
        assert!(
            result.is_none(),
            "non-existent .app path should not trigger rewrite"
        );
    }
}
