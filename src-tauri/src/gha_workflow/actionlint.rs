//! Optional actionlint integration.
//!
//! When the `actionlint` binary is on the user's PATH, we shell out to it
//! and forward its diagnostics. When it isn't, we return a typed
//! `BinaryMissing` result so the frontend can hide the actionlint
//! diagnostics layer silently rather than treating it as an error.
//!
//! Plan ADR-7 + WI-5.4. Cross-platform per AGENTS.md: never use bare
//! `Command::new`; route through the existing
//! `ai_provider::cli::build_command` pattern.

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
    Ok { diagnostics: Vec<ActionlintDiagnostic> },
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

/// Walk PATH looking for an executable named `name`. Returns the first
/// match. macOS GUI apps inherit a minimal PATH, so for production the
/// call site should also feed in the result of
/// `ai_provider::login_shell_path()`.
pub fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        #[cfg(target_os = "windows")]
        {
            // Windows: try both `name` and `name.exe`.
            if candidate.is_file() {
                return Some(candidate);
            }
            let exe = dir.join(format!("{}.exe", name));
            if exe.is_file() {
                return Some(exe);
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Run actionlint on the given YAML content. Returns a `LintResult`
/// that the caller serializes back to the frontend.
///
/// `extra_path` is an optional PATH addition (typically the result of
/// `ai_provider::login_shell_path()` for macOS GUI launches).
pub fn run_actionlint(yaml: &str, extra_path: Option<&str>) -> LintResult {
    let exe = match find_actionlint(extra_path) {
        Some(p) => p,
        None => return LintResult::BinaryMissing,
    };

    use std::io::Write;

    let exe_str = exe.to_string_lossy();
    let mut cmd = crate::ai_provider::build_command(
        &exe_str,
        &["-format", "{{json .}}", "-no-color", "-"],
    );
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

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
            // Logging avoids the silent-hang debugging trail (Rust audit
            // round 5 finding).
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
                        message: format!(
                            "actionlint timed out after {} ms",
                            ACTIONLINT_TIMEOUT_MS
                        ),
                    };
                }
                std::thread::sleep(std::time::Duration::from_millis(
                    POLL_INTERVAL_MS,
                ));
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

fn find_actionlint(extra_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = find_on_path("actionlint") {
        return Some(p);
    }
    // Fallback: split extra_path and probe each entry.
    let extra = extra_path?;
    for dir in std::env::split_paths(extra) {
        let candidate = dir.join("actionlint");
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(target_os = "windows")]
        {
            let exe = dir.join("actionlint.exe");
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
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

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_on_path_returns_none_for_unknown_binary() {
        // A binary name with whitespace can never exist as a file.
        assert!(find_on_path("not a real binary xyz").is_none());
    }

    #[test]
    fn find_on_path_finds_common_unix_binary_when_present() {
        // sh exists on every reasonable Unix; on Windows we just verify
        // the function doesn't panic.
        #[cfg(not(target_os = "windows"))]
        {
            let result = find_on_path("sh");
            assert!(result.is_some());
        }
        #[cfg(target_os = "windows")]
        {
            let _ = find_on_path("cmd"); // existence is best-effort
        }
    }

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

    #[test]
    fn run_actionlint_returns_binary_missing_when_not_installed() {
        // Override PATH to an empty location so actionlint can't be found.
        let saved_path = std::env::var_os("PATH");
        std::env::set_var("PATH", "/tmp/definitely-empty-dir-xyz-12345");
        let result = run_actionlint("on: push\njobs:\n  a:\n    runs-on: x\n    steps: []", None);
        if let Some(p) = saved_path {
            std::env::set_var("PATH", p);
        }
        assert!(matches!(result, LintResult::BinaryMissing));
    }
}
