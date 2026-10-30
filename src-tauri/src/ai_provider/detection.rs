//! CLI provider detection and environment helpers.
//!
//! Discovers which CLI AI providers (claude, codex, gemini) are installed
//! on the system.  Also resolves the user's full login-shell PATH (needed
//! because macOS GUI apps inherit a minimal PATH) and reads well-known
//! API-key environment variables for REST providers.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::command;

use super::spawn::{
    build_command, capture_stdout_with_timeout, parse_sentinel, which_command, windows_profile_path,
};
use super::types::CliProviderEntry;

// ============================================================================
// CLI Provider Detection
// ============================================================================

/// Detection cache. Startup, the picker and the Settings page all detect, and
/// each call would otherwise re-spawn `which`/`where` ×3 (subprocesses), so a
/// result is reused — except when the user clicks Detect (`refresh`), which
/// must find a CLI installed since the last scan.
static DETECTION_CACHE: Mutex<Option<Vec<CliProviderEntry>>> = Mutex::new(None);

/// The cached result, unless `refresh` asks for a fresh scan.
fn cached_detection(
    cache: &Mutex<Option<Vec<CliProviderEntry>>>,
    refresh: bool,
) -> Option<Vec<CliProviderEntry>> {
    if refresh {
        return None;
    }
    cache.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// Record a scan's result as the one later calls reuse.
fn store_detection(cache: &Mutex<Option<Vec<CliProviderEntry>>>, detected: Vec<CliProviderEntry>) {
    *cache.lock().unwrap_or_else(|p| p.into_inner()) = Some(detected);
}

/// Detect which CLI AI providers are available on the system.
///
/// `async` + `spawn_blocking` so the subprocess (`which`/`where`) lookups run
/// off the IPC thread instead of stalling it. The result is reused until a
/// call passes `refresh: true` (the Settings Detect button), which rescans
/// and replaces it.
#[command]
pub async fn detect_ai_providers(refresh: Option<bool>) -> Vec<CliProviderEntry> {
    if let Some(cached) = cached_detection(&DETECTION_CACHE, refresh.unwrap_or(false)) {
        return cached;
    }

    let detected = tokio::task::spawn_blocking(|| detect_with(check_command))
        .await
        .unwrap_or_default();

    store_detection(&DETECTION_CACHE, detected.clone());
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
    capture_stdout_with_timeout(
        build_command(shell, &["-lic", cmd]),
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
    use std::sync::OnceLock;
    static CACHE: OnceLock<ZdotdirCache> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    cached_zdotdir(cache, shell, || {
        // zsh integration is Unix-only; skip the shell spawn on Windows.
        if cfg!(target_os = "windows") {
            None
        } else {
            query_login_shell_zdotdir(shell)
        }
    })
}

/// Per-shell `ZDOTDIR` answers, `None` included: a shell with no `ZDOTDIR` is
/// asked once, not on every spawn.
type ZdotdirCache = Mutex<HashMap<String, Option<String>>>;

fn recover(cache: &ZdotdirCache) -> std::sync::MutexGuard<'_, HashMap<String, Option<String>>> {
    cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The cached answer for `shell`, or `query`'s — stored for next time.
fn cached_zdotdir(
    cache: &ZdotdirCache,
    shell: &str,
    query: impl FnOnce() -> Option<String>,
) -> Option<String> {
    // A poisoned cache is read through: its entries are independent, so a
    // panic mid-insert cannot have torn one, and skipping the cache would run
    // a login shell on every spawn. The lock is not held across `query`, which
    // can take seconds.
    let cached = recover(cache).get(shell).cloned();
    if let Some(answer) = cached {
        return answer;
    }
    let result = query();
    recover(cache).insert(shell.to_string(), result.clone());
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
pub fn read_env_api_keys() -> HashMap<String, String> {
    read_env_api_keys_with(|var| std::env::var(var).ok())
}

/// Pure core of `read_env_api_keys` over an injectable env getter — testable
/// without mutating the process environment.
fn read_env_api_keys_with<F: Fn(&str) -> Option<String>>(get: F) -> HashMap<String, String> {
    let mapping: &[(&str, &[&str])] = &[
        ("anthropic", &["ANTHROPIC_API_KEY"]),
        ("openai", &["OPENAI_API_KEY"]),
        ("google-ai", &["GOOGLE_API_KEY", "GEMINI_API_KEY"]),
    ];

    let mut result = HashMap::new();
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
#[path = "detection.test.rs"]
mod tests;
