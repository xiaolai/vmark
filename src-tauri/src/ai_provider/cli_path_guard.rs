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

/// Executable suffixes Windows uses for shims; stripped before comparison.
const WINDOWS_SUFFIXES: [&str; 4] = [".cmd", ".bat", ".exe", ".ps1"];

/// Characters that must never appear in a path we are about to execute.
/// `build_command` does not use a shell, so these cannot inject today — this is
/// defence in depth against a future caller that does.
const FORBIDDEN: [char; 9] = ['\0', '\n', '\r', ';', '|', '&', '$', '`', '\''];

/// Reject a `cli_path` that does not point at the expected provider binary.
///
/// `None` is always accepted — it means "use the bare command name", which
/// `build_command` resolves against PATH.
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

    // Windows executables and their shims are case-insensitive; POSIX is not.
    let stem = strip_windows_suffix(basename);
    if cfg!(windows) {
        stem.eq_ignore_ascii_case(cmd)
    } else {
        stem == cmd
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
