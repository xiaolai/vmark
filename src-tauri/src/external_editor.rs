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

/// Resolve which editor command to launch. Order:
///   1. `$VMARK_EXTERNAL_EDITOR` (explicit project override)
///   2. `$VISUAL`
///   3. `$EDITOR`
///   4. Platform default (`open -a TextEdit` on macOS,
///      `notepad.exe` on Windows, `xdg-open` on Linux/BSD)
fn resolve_editor() -> String {
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

/// Open `path` in the user's external editor. Returns `Ok(())` once
/// the child has been spawned (we do NOT wait). On spawn failure,
/// returns a human-readable error so the frontend can toast it.
#[tauri::command]
pub fn open_in_external_editor(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    let editor_cmd = resolve_editor();
    // Split on whitespace — supports `EDITOR="code -n"` style args.
    let mut parts = editor_cmd.split_whitespace();
    let exe = match parts.next() {
        Some(e) => e,
        None => return Err("No editor configured (EDITOR / VISUAL unset)".to_string()),
    };
    let mut args: Vec<&str> = parts.collect();
    args.push(path.as_str());

    let mut cmd = build_command(exe, &args);
    cmd.env("PATH", login_shell_path());
    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) => Err(format!(
            "Failed to launch editor '{exe}' for '{path}': {e}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_editor_prefers_vmark_override() {
        // Save / restore env
        let _vmark = std::env::var("VMARK_EXTERNAL_EDITOR").ok();
        let _visual = std::env::var("VISUAL").ok();
        let _editor = std::env::var("EDITOR").ok();
        std::env::set_var("VMARK_EXTERNAL_EDITOR", "myeditor");
        std::env::set_var("VISUAL", "should-be-ignored");
        std::env::set_var("EDITOR", "should-be-ignored");
        assert_eq!(resolve_editor(), "myeditor");
        std::env::remove_var("VMARK_EXTERNAL_EDITOR");
        std::env::remove_var("VISUAL");
        std::env::remove_var("EDITOR");
        // Restore
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
        let _vmark = std::env::var("VMARK_EXTERNAL_EDITOR").ok();
        let _visual = std::env::var("VISUAL").ok();
        let _editor = std::env::var("EDITOR").ok();
        std::env::remove_var("VMARK_EXTERNAL_EDITOR");
        std::env::remove_var("VISUAL");
        std::env::remove_var("EDITOR");
        let resolved = resolve_editor();
        // Platform default isn't empty.
        assert!(!resolved.is_empty());
        // Restore
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
        let result =
            open_in_external_editor("/definitely/does/not/exist".to_string());
        assert!(result.is_err());
    }
}
