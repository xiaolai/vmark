//! Optional actionlint integration.
//!
//! When the `actionlint` binary is on the user's PATH, we shell out to it
//! and forward its diagnostics. When it isn't, we return a typed
//! `BinaryMissing` result so the frontend can hide the actionlint
//! diagnostics layer silently rather than treating it as an error.
//!
//! One PATH does both jobs: `run_actionlint` looks for the binary in the PATH
//! it is given and runs the child with that same PATH, so the subtools
//! actionlint shells out to (shellcheck, pyflakes) resolve the way the binary
//! did. The caller passes the login-shell PATH — a macOS GUI launch inherits a
//! minimal one that holds neither.
//!
//! Plan ADR-7. Cross-platform per AGENTS.md: never use bare
//! `Command::new`; route through the existing
//! `ai_provider::spawn::build_command` pattern.
//!
//! @coordinates-with gha_workflow/commands.rs — passes the login-shell PATH

use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};

/// Result of running actionlint, returned as a typed enum so the
/// frontend can distinguish "binary missing" (silent fallback) from
/// "binary failed" (error toast).
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LintResult {
    /// actionlint is on PATH and ran successfully — diagnostics carry the
    /// findings (may be empty).
    Ok {
        diagnostics: Vec<ActionlintDiagnostic>,
    },
    /// actionlint is not on PATH. Frontend hides the layer silently.
    BinaryMissing,
    /// actionlint ran but failed (parse error, panic, etc.). Frontend
    /// surfaces the message but doesn't block other linters.
    Failed { message: String },
}

/// One actionlint finding, normalized from its JSON output. Field names
/// match actionlint's `-format=json` schema.
#[derive(Debug, Serialize, Deserialize)]
pub struct ActionlintDiagnostic {
    pub message: String,
    /// Stable rule ID, e.g. "syntax-check", "expression", "shell".
    /// Forwarded verbatim; the frontend prefixes with `GHA-ACTIONLINT-`.
    pub kind: String,
    pub line: u32,
    pub column: u32,
    /// File-relative end position; actionlint emits this when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
    /// Code snippet around the finding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// The first file named `name` in the directories of `path`, a PATH-style
/// list. On Windows a bare `name` is never taken (npm-style shims leave a
/// POSIX script by that name that cannot be spawned): `name.exe`, `.cmd` and
/// `.bat` are tried instead, in each directory.
pub(crate) fn find_in_path(path: &str, name: &str) -> Option<PathBuf> {
    find_in_path_for(path, name, cfg!(windows))
}

/// [`find_in_path`] with the platform rule as a parameter, so both rules are
/// testable on every CI OS.
pub(crate) fn find_in_path_for(path: &str, name: &str, windows: bool) -> Option<PathBuf> {
    let names = crate::ai_provider::executable_names(name, windows);
    std::env::split_paths(path).find_map(|dir| {
        names
            .iter()
            .map(|file| dir.join(file))
            .find(|candidate| candidate.is_file())
    })
}

/// Run actionlint on the given YAML content. Returns a `LintResult`
/// that the caller serializes back to the frontend.
///
/// `path` is the PATH actionlint is looked for in and run with (see the
/// module header).
pub fn run_actionlint(yaml: &str, path: &str) -> LintResult {
    let exe = match find_in_path(path, "actionlint") {
        Some(p) => p,
        None => return LintResult::BinaryMissing,
    };

    use std::io::Write;

    let exe_str = exe.to_string_lossy();
    let mut cmd =
        crate::ai_provider::build_command(&exe_str, &["-format", "{{json .}}", "-no-color", "-"]);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    // macOS GUI launches inherit a minimal launchd PATH; without this,
    // actionlint can't find its subtools (shellcheck, pyflakes) and
    // silently degrades shell-script and Python-expression checks.
    // Same pattern as ai_provider/cli.rs, pandoc/commands.rs, external_editor.rs.
    cmd.env("PATH", path);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return LintResult::Failed {
                message: format!("Failed to spawn actionlint: {}", e),
            };
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(yaml.as_bytes()) {
            // Pipe closed early — actionlint likely panicked or aborted.
            // Logging avoids the silent-hang debugging trail.
            log::warn!("actionlint stdin write failed: {}", e);
        }
    }

    // Bound the wait so a hung / runaway actionlint process can't pin
    // the calling thread indefinitely (Codex audit: stale run lifecycle).
    // Polling is sufficient at this scale — the actionlint binary
    // typically returns in <100 ms over a workflow file.
    const ACTIONLINT_TIMEOUT_MS: u64 = 5_000;
    const POLL_INTERVAL_MS: u64 = 25;
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(ACTIONLINT_TIMEOUT_MS);
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return LintResult::Failed {
                        message: format!("actionlint timed out after {} ms", ACTIONLINT_TIMEOUT_MS),
                    };
                }
                std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return LintResult::Failed {
                    message: format!("actionlint poll failed: {}", e),
                };
            }
        }
    }

    let output = match child.wait_with_output() {
        Ok(o) => o,
        Err(e) => {
            return LintResult::Failed {
                message: format!("actionlint wait failed: {}", e),
            };
        }
    };

    // actionlint exits non-zero when there ARE findings — that's a
    // success for us. The non-trivial failure case is non-JSON stderr
    // (e.g., "panic: ..."). If stdout is empty AND stderr is non-empty
    // we treat it as a Failed.
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.trim().is_empty() {
            return LintResult::Failed {
                message: stderr.trim().to_string(),
            };
        }
        return LintResult::Ok {
            diagnostics: Vec::new(),
        };
    }

    parse_actionlint_output(&stdout)
}

/// Parse actionlint's JSON output. Each line is a JSON object per the
/// `{{json .}}` template. We parse leniently — malformed lines are
/// skipped rather than aborting the whole batch.
pub fn parse_actionlint_output(stdout: &str) -> LintResult {
    let mut diagnostics = Vec::new();
    // actionlint with `-format {{json .}}` may emit either a single
    // top-level array OR one JSON-per-line; handle both.
    let trimmed = stdout.trim();
    if trimmed.starts_with('[') {
        match serde_json::from_str::<Vec<ActionlintDiagnostic>>(trimmed) {
            Ok(arr) => diagnostics = arr,
            Err(e) => {
                return LintResult::Failed {
                    message: format!("Could not parse actionlint JSON array: {}", e),
                };
            }
        }
    } else {
        for line in trimmed.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(d) = serde_json::from_str::<ActionlintDiagnostic>(line) {
                diagnostics.push(d);
            }
        }
    }

    LintResult::Ok { diagnostics }
}

#[cfg(test)]
#[path = "actionlint.test.rs"]
mod tests;
