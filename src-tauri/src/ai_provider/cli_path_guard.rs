//! `cli_path` boundary guard — WI-0B.2.
//!
//! Purpose: stop `run_ai_prompt`'s `cli_path` parameter from being an arbitrary
//! process-execution primitive.
//!
//! The hole: `cli.rs` computes `effective_cmd = cli_path.unwrap_or(cmd)` with no
//! validation, so `cli_path="/bin/sh"` turns an AI request into RCE. The Tauri
//! ACL cannot help — it is per-window, not per-caller, and these custom commands
//! are not ACL-gated at all.
//!
//! The legitimate use of `cli_path` is a custom *install location* for the same
//! provider binary (detection resolves an absolute path, and on Windows a
//! `.cmd`/`.bat` shim). So the directory is free, but the **file name must still
//! be the provider's own binary**. That keeps every real configuration working
//! while removing the primitive.
//!
//! Validation is applied at the Tauri command boundary (`run_ai_prompt`), not in
//! the internal spawn helper — external input is untrusted, internal callers
//! (workflow runner, tests) are not.
//!
//! @module ai_provider/cli_path_guard

/// CLI providers VMark may spawn. Mirrors `detection.rs`'s provider table.
const KNOWN_CLI_PROVIDERS: [&str; 3] = ["claude", "codex", "gemini"];

/// Executable suffixes Windows uses for shims; stripped before comparison, and
/// ONLY on Windows (see `basename_matches`).
///
/// `.ps1` is intentionally absent: `ai_provider::build_command` wraps `.cmd`
/// and `.bat` shims for `CreateProcess`, but a PowerShell script cannot be
/// spawned directly, so accepting one would let a path pass the guard that can
/// never actually run.
const WINDOWS_SUFFIXES: [&str; 3] = [".cmd", ".bat", ".exe"];

/// Characters that must never appear in a path we are about to execute.
/// `build_command` does not use a shell, so these cannot inject today — this is
/// defence in depth against a future caller that does.
const FORBIDDEN: [char; 9] = ['\0', '\n', '\r', ';', '|', '&', '$', '`', '\''];

/// Reject a `cli_path` that does not point at the expected provider binary.
///
/// `None` is always accepted — it means "use the bare command name", which
/// `build_command` resolves against PATH.
///
/// Boundary this DOES enforce: the path's file name must be the provider's own
/// binary (`claude`/`codex`/`gemini`), no other provider, and no shell or
/// interpreter. This removes the trivial `cli_path="/bin/sh"` RCE primitive.
///
/// Boundary this does NOT enforce: it cannot tell a legitimate custom install
/// (`/opt/tools/claude`) from a file the caller planted and named `claude`.
/// Distinguishing those requires knowing WHO is asking, not WHAT they asked
/// for — there is no caller principal available to a Tauri command. That
/// residual is the subject of ADR-016 and is closed only by an isolation
/// boundary, not by inspecting the path here. Filesystem canonicalization was
/// considered and rejected: it breaks legitimate symlinked installs (Homebrew)
/// while still not stopping a planted real binary.
pub fn validate_cli_path(cmd: &str, cli_path: Option<&str>) -> Result<(), String> {
    // Only the known CLI providers may be spawned at all.
    if !KNOWN_CLI_PROVIDERS.contains(&cmd) {
        return Err(format!("Unknown CLI provider: {cmd}"));
    }

    let Some(path) = cli_path else {
        return Ok(());
    };

    if path.is_empty() {
        return Err("cli_path must not be empty".to_string());
    }

    if let Some(bad) = path.chars().find(|c| FORBIDDEN.contains(c)) {
        return Err(format!(
            "cli_path contains a forbidden character ({bad:?}); expected a plain path to `{cmd}`"
        ));
    }

    // Reject parent-directory traversal. It cannot bypass the basename check
    // (`/x/../sh` has basename `sh`), but a `..` in an execution path is never
    // legitimate here and rejecting it is consistent with `atomic_write_file`.
    if path.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(format!(
            "cli_path must not contain `..`; expected a plain path to `{cmd}`"
        ));
    }

    // Split on both separators — a Windows path may reach a macOS build in
    // config that syncs across machines, and vice versa.
    let basename = path.rsplit(['/', '\\']).next().unwrap_or("");
    if basename.is_empty() {
        return Err(format!(
            "cli_path must name a file, not a directory; expected `{cmd}`"
        ));
    }

    if basename_matches(basename, cmd) {
        Ok(())
    } else {
        Err(format!(
            "cli_path must point at the `{cmd}` binary (found `{basename}`)"
        ))
    }
}

/// True when `basename` is the provider binary, allowing Windows shim suffixes.
fn basename_matches(basename: &str, cmd: &str) -> bool {
    if basename == cmd {
        return true;
    }

    // Shim suffixes (`.cmd`/`.bat`/`.exe`) are a Windows concept, so strip them
    // only there. On POSIX a `claude.exe` is an unrelated file, not the provider,
    // and must not pass — stripping unconditionally widened the guard.
    if cfg!(windows) {
        // Windows executables and their shims are case-insensitive.
        strip_windows_suffix(basename).eq_ignore_ascii_case(cmd)
    } else {
        false
    }
}

/// Strip a trailing Windows executable suffix, if present.
fn strip_windows_suffix(basename: &str) -> &str {
    for suffix in WINDOWS_SUFFIXES {
        if basename.len() > suffix.len() {
            let split = basename.len() - suffix.len();
            let (stem, ext) = basename.split_at(split);
            if ext.eq_ignore_ascii_case(suffix) {
                return stem;
            }
        }
    }
    basename
}

#[cfg(test)]
#[path = "cli_path_guard.test.rs"]
mod tests;
