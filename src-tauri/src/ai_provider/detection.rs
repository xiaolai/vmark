//! CLI provider detection and environment helpers.
//!
//! Discovers which CLI AI providers (claude, codex, gemini) are installed
//! on the system, and reads well-known API-key environment variables for REST
//! providers. The login-shell PATH the scan searches lives in `login_path`.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::command;

use super::login_path::{login_shell_path, refresh_login_shell_path, run_login_shell_capture};
use super::spawn::{first_spawnable_path, parse_sentinel, which_command};
use super::types::CliProviderEntry;

// ============================================================================
// CLI Provider Detection
// ============================================================================

/// Detection cache. Startup, the picker and the Settings page all detect, and
/// each call would otherwise re-spawn `which`/`where` ×3 (subprocesses), so a
/// result is reused — except when the user clicks Detect (`refresh`), which
/// must find a CLI installed since the last scan.
static DETECTION_CACHE: Mutex<Option<Vec<CliProviderEntry>>> = Mutex::new(None);

/// Held across a whole scan and its commit to [`DETECTION_CACHE`], whose reason
/// for being static it shares. Scans run one at a time, so an older scan's
/// "Not found" cannot land on top of a newer result.
static SCAN_ORDER: Mutex<()> = Mutex::new(());

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
/// call passes `refresh: true` (the Settings Detect button), which reads the
/// login shell's PATH again, rescans, and replaces it.
#[command]
pub async fn detect_ai_providers(refresh: Option<bool>) -> Vec<CliProviderEntry> {
    if let Some(cached) = cached_detection(&DETECTION_CACHE, refresh.unwrap_or(false)) {
        return cached;
    }

    let refresh = refresh.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        scan_in_order(
            &SCAN_ORDER,
            &DETECTION_CACHE,
            refresh,
            reread_login_shell,
            check_command,
        )
    })
    .await
    .unwrap_or_default()
}

/// One scan at a time, each committing its result before the next starts. A
/// caller that only wanted a cached result takes what the scan it waited for
/// found instead of repeating it.
fn scan_in_order<R: FnOnce(), C: Fn(&str) -> (bool, Option<String>)>(
    order: &Mutex<()>,
    cache: &Mutex<Option<Vec<CliProviderEntry>>>,
    refresh: bool,
    refresh_path: R,
    check: C,
) -> Vec<CliProviderEntry> {
    let _one_at_a_time = order.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(cached) = cached_detection(cache, refresh) {
        return cached;
    }
    let detected = scan_with(refresh, refresh_path, check);
    store_detection(cache, detected.clone());
    detected
}

/// Forget what the login shell told VMark and ask again. An explicit Detect is
/// the one retry a user has after repairing their shell profile.
fn reread_login_shell() {
    refresh_login_shell_path();
    forget_zdotdirs(zdotdir_cache());
}

/// One scan. An explicit refresh re-reads PATH first, so that it can recover
/// from a login-shell probe that failed at startup without a restart.
fn scan_with<R: FnOnce(), C: Fn(&str) -> (bool, Option<String>)>(
    refresh: bool,
    refresh_path: R,
    check: C,
) -> Vec<CliProviderEntry> {
    if refresh {
        refresh_path();
    }
    detect_with(check)
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
    let raw = run_login_shell_capture(shell, &cmd).ok()?;
    parse_sentinel(&raw, START, END).filter(|v| !v.is_empty())
}

/// Resolve the user's `ZDOTDIR` via the GIVEN login shell, cached per shell.
/// Callers pass the shell actually being spawned (e.g. the user-configured
/// terminal shell) — NOT the process `$SHELL`, which in a minimal GUI env can
/// be `/bin/sh` and would misresolve. The per-shell result is cached until an
/// explicit Detect, because a probe that failed looks the same as an unset
/// `ZDOTDIR` and would otherwise stick until restart. Used by shell integration
/// so the injected zsh rc can re-point `ZDOTDIR` at the user's real config (see
/// `shell_integration.rs` / `vmark.zsh`).
pub(crate) fn login_shell_zdotdir(shell: &str) -> Option<String> {
    cached_zdotdir(zdotdir_cache(), shell, || {
        // zsh integration is Unix-only; skip the shell spawn on Windows.
        if cfg!(target_os = "windows") {
            None
        } else {
            query_login_shell_zdotdir(shell)
        }
    })
}

/// Per-shell `ZDOTDIR` answers, `None` included: a shell with no `ZDOTDIR` is
/// asked once, not on every spawn. `generation` counts the times they were
/// forgotten, so a query already running then cannot restore an old answer.
#[derive(Default)]
struct ZdotdirAnswers {
    by_shell: HashMap<String, Option<String>>,
    generation: u64,
}

type ZdotdirCache = Mutex<ZdotdirAnswers>;

fn zdotdir_cache() -> &'static ZdotdirCache {
    static CACHE: std::sync::OnceLock<ZdotdirCache> = std::sync::OnceLock::new();
    CACHE.get_or_init(ZdotdirCache::default)
}

fn recover(cache: &ZdotdirCache) -> std::sync::MutexGuard<'_, ZdotdirAnswers> {
    cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn forget_zdotdirs(cache: &ZdotdirCache) {
    let mut answers = recover(cache);
    answers.by_shell.clear();
    answers.generation += 1;
}

fn cached_zdotdir(
    cache: &ZdotdirCache,
    shell: &str,
    query: impl FnOnce() -> Option<String>,
) -> Option<String> {
    // A poisoned cache is read through: its entries are independent, so a
    // panic mid-insert cannot have torn one, and skipping the cache would run
    // a login shell on every spawn. The lock is not held across `query`, which
    // can take seconds.
    let generation = {
        let answers = recover(cache);
        if let Some(answer) = answers.by_shell.get(shell) {
            return answer.clone();
        }
        answers.generation
    };
    let result = query();
    let mut answers = recover(cache);
    if answers.generation == generation {
        answers.by_shell.insert(shell.to_string(), result.clone());
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
            // `where` lists every match, and on Windows the first may be npm's
            // extensionless shell shim, which cannot be spawned (#1666).
            match first_spawnable_path(&raw) {
                Some(path) => (true, Some(path)),
                None => (false, None),
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
pub(super) mod tests;
