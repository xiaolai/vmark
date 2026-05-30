//! CLI provider detection and environment helpers.
//!
//! Discovers which CLI AI providers (claude, codex, gemini) are installed
//! on the system.  Also resolves the user's full login-shell PATH (needed
//! because macOS GUI apps inherit a minimal PATH) and reads well-known
//! API-key environment variables for REST providers.

use std::process::Command;
use std::sync::Mutex;
use tauri::command;

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

            let output = Command::new(&shell)
                .args(["-lic", &cmd])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .spawn()
                .ok()
                .and_then(|mut child| {
                    // Drain stdout in a background thread to prevent pipe-buffer deadlock.
                    // If the shell writes more than the OS pipe buffer (~64 KB), it blocks
                    // on write while we block on try_wait() — a classic deadlock.
                    let stdout_pipe = child.stdout.take();
                    let reader = std::thread::spawn(move || -> Vec<u8> {
                        let mut buf = Vec::new();
                        if let Some(mut pipe) = stdout_pipe {
                            use std::io::Read;
                            let _ = pipe.read_to_end(&mut buf);
                        }
                        buf
                    });

                    // Wait with a 5-second timeout to avoid blocking indefinitely
                    // if the shell hangs (broken .zshrc, password prompt, etc.)
                    let timeout = std::time::Duration::from_secs(5);
                    let start = std::time::Instant::now();
                    loop {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                let buf = reader.join().ok()?;
                                if status.success() {
                                    return Some(String::from_utf8_lossy(&buf).to_string());
                                }
                                return None;
                            }
                            Ok(None) => {
                                if start.elapsed() > timeout {
                                    let _ = child.kill();
                                    let _ = child.wait();
                                    // Reader thread will see broken pipe and exit
                                    log::warn!("[VMark] login_shell_path timed out after {}s", timeout.as_secs());
                                    return None;
                                }
                                std::thread::sleep(std::time::Duration::from_millis(50));
                            }
                            Err(_) => return None,
                        }
                    }
                });

            if let Some(raw) = output {
                if let Some(start) = raw.find(START) {
                    if let Some(end) = raw.find(END) {
                        let path = &raw[start + START.len()..end];
                        return path.trim().to_string();
                    }
                }
            }
            std::env::var("PATH").unwrap_or_default()
        })
        .clone()
}

/// Spawn PowerShell to get the full PATH including `$PROFILE` additions.
///
/// Many Windows CLI tools (claude, codex, fnm, volta, etc.) add themselves
/// to PATH via the PowerShell profile rather than the system environment
/// variables.  This mirrors the macOS approach where we spawn a login shell
/// to source `.zshrc`/`.bashrc`.
///
/// Returns `None` if PowerShell is unavailable, times out (3s), or produces
/// empty output.
#[cfg(target_os = "windows")]
fn windows_profile_path() -> Option<String> {
    const START: &str = "__VMARK_PATH_START__";
    const END: &str = "__VMARK_PATH_END__";

    // Try pwsh (PowerShell 7+) first, then powershell.exe (Windows PowerShell 5.x)
    let shells = ["pwsh.exe", "powershell.exe"];
    for shell in &shells {
        let cmd_str = format!("Write-Output '{START}'; Write-Output $env:Path; Write-Output '{END}'");
        let result = Command::new(shell)
            .args(["-NoLogo", "-NonInteractive", "-Command", &cmd_str])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn();

        let mut child = match result {
            Ok(c) => c,
            Err(_) => continue,
        };

        let stdout_pipe = child.stdout.take();
        let reader = std::thread::spawn(move || -> Vec<u8> {
            let mut buf = Vec::new();
            if let Some(mut pipe) = stdout_pipe {
                use std::io::Read;
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });

        let timeout = std::time::Duration::from_secs(3);
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let Ok(buf) = reader.join() else { break };
                    if status.success() {
                        let raw = String::from_utf8_lossy(&buf);
                        if let Some(s) = raw.find(START) {
                            if let Some(e) = raw.find(END) {
                                let path = raw[s + START.len()..e].trim();
                                if !path.is_empty() {
                                    return Some(path.to_string());
                                }
                            }
                        }
                    }
                    break;
                }
                Ok(None) => {
                    if start.elapsed() > timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        log::warn!("[VMark] windows_profile_path: {shell} timed out");
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn windows_profile_path() -> Option<String> {
    None
}

/// Build a `Command` for the system's `which` (Unix) or `where` (Windows).
///
/// On Windows, uses the absolute path `%WINDIR%\System32\where.exe` to
/// prevent PATH-hijacking attacks. On Unix, uses bare `which` (safe because
/// `/usr/bin` is always on PATH and not user-writable).
pub(crate) fn which_command() -> Command {
    #[cfg(target_os = "windows")]
    {
        let where_exe = std::path::PathBuf::from(
            std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".to_string()),
        )
        .join("System32")
        .join("where.exe");
        Command::new(where_exe)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("which")
    }
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

        let claude = entries.iter().find(|e| e.provider_type == "claude").unwrap();
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
}
