//! CLI provider detection and environment helpers.
//!
//! Discovers which CLI AI providers (claude, codex, gemini) are installed
//! on the system.  Also resolves the user's full login-shell PATH (needed
//! because macOS GUI apps inherit a minimal PATH) and reads well-known
//! API-key environment variables for REST providers.

use std::process::Command;
use std::sync::Mutex;
use tauri::command;

use super::spawn::{
    capture_stdout_with_timeout, parse_sentinel, which_command, windows_profile_path,
};
use super::types::CliProviderEntry;

// ============================================================================
// CLI Provider Detection
// ============================================================================

/// Session-stable cache. Installed CLIs don't appear/disappear mid-session, so
/// the first detection result is reused — repeated `detect_ai_providers` calls
/// otherwise re-spawn `which`/`where` ×3 (subprocesses) every time (O2).
static DETECTION_CACHE: Mutex<Option<Vec<CliProviderEntry>>> = Mutex::new(None);

/// Detect which CLI AI providers are available on the system.
///
/// `async` + `spawn_blocking` so the subprocess (`which`/`where`) lookups run
/// off the IPC thread instead of stalling it; the result is memoized for the
/// process lifetime (O2 / WI-2.2).
#[command]
pub async fn detect_ai_providers() -> Vec<CliProviderEntry> {
    if let Some(cached) = DETECTION_CACHE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
    {
        return cached;
    }

    let detected = tokio::task::spawn_blocking(|| detect_with(check_command))
        .await
        .unwrap_or_default();

    *DETECTION_CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some(detected.clone());
    detected
}

/// Pure detection over an injectable availability checker — keeps the provider
/// table in one place and is unit-testable without spawning subprocesses.
fn detect_with<F: Fn(&str) -> (bool, Option<String>)>(check: F) -> Vec<CliProviderEntry> {
    let providers = [
        ("claude", "Claude", "claude"),
        ("codex", "Codex", "codex"),
        ("gemini", "Gemini", "gemini"),
    ];

    providers
        .iter()
        .map(|(typ, name, cmd)| {
            let (available, path) = check(cmd);
            CliProviderEntry {
                provider_type: typ.to_string(),
                name: name.to_string(),
                command: cmd.to_string(),
                available,
                path,
            }
        })
        .collect()
}

// ============================================================================
// Login Shell PATH
// ============================================================================

/// Resolve the user's full login-shell `$PATH`.
///
/// macOS/Linux app bundles launched from Finder/Dock (or some Linux
/// desktop environments) inherit a minimal PATH.  We spawn the user's
/// interactive login shell and ask for its PATH.  Using `-li` ensures
/// both profile AND rc files are sourced (needed for nvm, fnm, pyenv,
/// etc.).  Markers isolate PATH from shell startup noise.
///
/// On Windows, GUI apps inherit the full system PATH -- no shell dance
/// needed.  On fish shell, `$PATH` is a list so we use `string join`.
///
/// The result is cached for the lifetime of the process.
pub(crate) fn login_shell_path() -> String {
    use std::sync::OnceLock;
    static CACHED: OnceLock<String> = OnceLock::new();

    CACHED
        .get_or_init(|| {
            // Windows: tools installed via npm/pnpm/scoop may add paths in the
            // PowerShell $PROFILE that aren't in the base system+user PATH.
            // Try spawning PowerShell to get the full PATH including profile
            // additions, with a timeout. Fall back to the inherited PATH.
            if cfg!(target_os = "windows") {
                if let Some(path) = windows_profile_path() {
                    return path;
                }
                return std::env::var("PATH").unwrap_or_default();
            }

            const START: &str = "__VMARK_PATH_START__";
            const END: &str = "__VMARK_PATH_END__";

            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

            // Fish uses list-based $PATH -- need `string join` for colon-separated
            let cmd = if shell.ends_with("/fish") {
                format!("echo {START}(string join : $PATH){END}")
            } else {
                format!("echo {START}${{PATH}}{END}")
            };

            run_login_shell_capture(&shell, &cmd)
                .and_then(|raw| parse_sentinel(&raw, START, END))
                .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
        })
        .clone()
}

/// Run `<shell> -lic <cmd>` with a 5 s timeout via the shared bounded
/// process-capture helper (`spawn::capture_stdout_with_timeout` — see its
/// docs for the pipe-drain and timeout semantics). Returns raw stdout on
/// success, or `None` on spawn failure, non-zero exit, or timeout. Shared by
/// `login_shell_path` and `query_login_shell_zdotdir`.
fn run_login_shell_capture(shell: &str, cmd: &str) -> Option<String> {
    let mut command = Command::new(shell);
    command.args(["-lic", cmd]);
    capture_stdout_with_timeout(
        command,
        std::time::Duration::from_secs(5),
        "login shell capture",
    )
}

/// Resolve the user's effective `ZDOTDIR` by asking a login shell. macOS GUI
/// apps inherit a minimal environment, so reading `$ZDOTDIR` from this process is
/// unreliable — the user's real value is only visible inside their login shell.
/// Returns `None` when unset/empty or the shell fails. Uncached so it is
/// unit-testable; the session cache lives in [`login_shell_zdotdir`].
fn query_login_shell_zdotdir(shell: &str) -> Option<String> {
    const START: &str = "__VMARK_ZDOTDIR_START__";
    const END: &str = "__VMARK_ZDOTDIR_END__";
    // Sentinels live in the format string and the value is a printf arg, so this
    // works across sh/zsh/bash/fish without `${...}` brace syntax.
    let cmd = format!("printf '{START}%s{END}' \"$ZDOTDIR\"");
    let raw = run_login_shell_capture(shell, &cmd)?;
    parse_sentinel(&raw, START, END).filter(|v| !v.is_empty())
}

/// Resolve the user's `ZDOTDIR` via the GIVEN login shell, cached per shell.
/// Callers pass the shell actually being spawned (e.g. the user-configured
/// terminal shell) — NOT the process `$SHELL`, which in a minimal GUI env can
/// be `/bin/sh` and would misresolve. The user's `ZDOTDIR` does not change
/// mid-session, so the per-shell result is cached. Used by shell integration so
/// the injected zsh rc can re-point `ZDOTDIR` at the user's real config (see
/// `shell_integration.rs` / `vmark.zsh`).
pub(crate) fn login_shell_zdotdir(shell: &str) -> Option<String> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(c) = cache.lock() {
        if let Some(v) = c.get(shell) {
            return v.clone();
        }
    }
    // zsh integration is Unix-only; skip the shell spawn on Windows.
    let result = if cfg!(target_os = "windows") {
        None
    } else {
        query_login_shell_zdotdir(shell)
    };
    if let Ok(mut c) = cache.lock() {
        c.insert(shell.to_string(), result.clone());
    }
    result
}

/// Check if a command exists on the system PATH.
///
/// Uses `which` (Unix) or `where` (Windows) via `which_command()` —
/// intentionally bypasses `build_command()` because `which`/`where` are
/// system lookup utilities, not AI tools that need `.cmd` shim handling.
fn check_command(cmd: &str) -> (bool, Option<String>) {
    match which_command()
        .arg(cmd)
        .env("PATH", login_shell_path())
        .output()
    {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout);
            // `where` on Windows may return multiple lines -- take the first
            let path = raw.lines().next().unwrap_or("").trim().to_string();
            if path.is_empty() {
                (false, None)
            } else {
                (true, Some(path))
            }
        }
        _ => (false, None),
    }
}

// ============================================================================
// Environment API Keys
// ============================================================================

/// Read well-known API key environment variables for REST providers.
///
/// Returns a map of `RestProviderType -> key` for any env var that is set
/// and non-empty. The frontend uses this to pre-fill empty API key fields.
#[command]
pub fn read_env_api_keys() -> std::collections::HashMap<String, String> {
    read_env_api_keys_with(|var| std::env::var(var).ok())
}

/// Pure core of `read_env_api_keys` over an injectable env getter — testable
/// without mutating the process environment (WI-5.4, TQ5).
fn read_env_api_keys_with<F: Fn(&str) -> Option<String>>(
    get: F,
) -> std::collections::HashMap<String, String> {
    let mapping: &[(&str, &[&str])] = &[
        ("anthropic", &["ANTHROPIC_API_KEY"]),
        ("openai", &["OPENAI_API_KEY"]),
        ("google-ai", &["GOOGLE_API_KEY", "GEMINI_API_KEY"]),
    ];

    let mut result = std::collections::HashMap::new();
    for (provider, vars) in mapping {
        for var in *vars {
            if let Some(val) = get(var) {
                if !val.is_empty() {
                    result.insert(provider.to_string(), val);
                    break; // first match wins
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_with_maps_all_three_providers() {
        // Inject a checker that marks only `codex` available.
        let entries = detect_with(|cmd| {
            if cmd == "codex" {
                (true, Some("/usr/local/bin/codex".to_string()))
            } else {
                (false, None)
            }
        });

        assert_eq!(entries.len(), 3);
        let types: Vec<&str> = entries.iter().map(|e| e.provider_type.as_str()).collect();
        assert_eq!(types, ["claude", "codex", "gemini"]);

        let codex = entries.iter().find(|e| e.provider_type == "codex").unwrap();
        assert!(codex.available);
        assert_eq!(codex.path.as_deref(), Some("/usr/local/bin/codex"));

        let claude = entries
            .iter()
            .find(|e| e.provider_type == "claude")
            .unwrap();
        assert!(!claude.available);
        assert_eq!(claude.path, None);
        assert_eq!(claude.command, "claude");
        assert_eq!(claude.name, "Claude");
    }

    #[test]
    fn env_keys_present_absent_and_empty() {
        // anthropic present, openai absent, google empty → only anthropic.
        let keys = read_env_api_keys_with(|var| match var {
            "ANTHROPIC_API_KEY" => Some("sk-ant".to_string()),
            "GOOGLE_API_KEY" => Some(String::new()), // empty → ignored
            _ => None,
        });
        assert_eq!(keys.get("anthropic").map(String::as_str), Some("sk-ant"));
        assert!(!keys.contains_key("openai"));
        assert!(!keys.contains_key("google-ai"));
    }

    #[test]
    fn google_falls_back_to_gemini_var() {
        // GOOGLE_API_KEY unset/empty, GEMINI_API_KEY set → google-ai resolves.
        let keys = read_env_api_keys_with(|var| match var {
            "GOOGLE_API_KEY" => Some(String::new()),
            "GEMINI_API_KEY" => Some("gm-key".to_string()),
            _ => None,
        });
        assert_eq!(keys.get("google-ai").map(String::as_str), Some("gm-key"));
    }

    #[test]
    fn google_prefers_google_var_over_gemini() {
        let keys = read_env_api_keys_with(|var| match var {
            "GOOGLE_API_KEY" => Some("goog".to_string()),
            "GEMINI_API_KEY" => Some("gem".to_string()),
            _ => None,
        });
        // First match wins → GOOGLE_API_KEY.
        assert_eq!(keys.get("google-ai").map(String::as_str), Some("goog"));
    }

    #[test]
    fn env_keys_none_when_all_absent() {
        let keys = read_env_api_keys_with(|_| None);
        assert!(keys.is_empty());
    }

    // --- WI-1.1: login-shell ZDOTDIR resolution (terminal gap G1) ---
    // (parse_sentinel unit tests live next to its definition in spawn.test.rs.)

    #[test]
    fn zdotdir_none_for_nonexistent_shell() {
        // Spawn failure must degrade to None, never panic.
        assert_eq!(query_login_shell_zdotdir("/no/such/shell/vmark-xyz"), None);
    }

    /// Write a fake login "shell" that ignores its args and prints `body`.
    #[cfg(unix)]
    fn write_fake_shell(dir: &tempfile::TempDir, body: &str) -> std::path::PathBuf {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        let shell = dir.path().join("fakezsh");
        let mut f = std::fs::File::create(&shell).unwrap();
        write!(f, "#!/bin/sh\nprintf '{body}'\n").unwrap();
        drop(f);
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        shell
    }

    #[cfg(unix)]
    #[test]
    fn zdotdir_none_when_unset_in_login_shell() {
        // A fake shell that prints empty sentinels — deterministically models
        // "ZDOTDIR unset" regardless of this test process's environment, and
        // exercises the full spawn→capture→parse pipeline on the unset path.
        let dir = tempfile::tempdir().unwrap();
        let shell = write_fake_shell(&dir, "__VMARK_ZDOTDIR_START____VMARK_ZDOTDIR_END__");
        assert_eq!(query_login_shell_zdotdir(shell.to_str().unwrap()), None);
    }

    #[cfg(unix)]
    #[test]
    fn zdotdir_round_trips_via_fake_login_shell() {
        // A fake "shell" that prints a sentinel-wrapped value — exercises the
        // full spawn→capture→parse→non-empty path (closing the WI-1.1 coverage
        // gap) without racy/edition-fragile env mutation.
        let dir = tempfile::tempdir().unwrap();
        let shell = write_fake_shell(
            &dir,
            "__VMARK_ZDOTDIR_START__/home/x/.config/zsh__VMARK_ZDOTDIR_END__",
        );
        assert_eq!(
            query_login_shell_zdotdir(shell.to_str().unwrap()).as_deref(),
            Some("/home/x/.config/zsh"),
        );
    }
}
