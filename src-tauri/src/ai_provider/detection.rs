//! CLI provider detection and environment helpers.
//!
//! Discovers which CLI AI providers (claude, codex, gemini) are installed
//! on the system.  Also resolves the user's full login-shell PATH (needed
//! because macOS GUI apps inherit a minimal PATH) and reads well-known
//! API-key environment variables for REST providers.

use std::process::Command;
use tauri::command;

use super::types::CliProviderEntry;

// ============================================================================
// CLI Provider Detection
// ============================================================================

/// Detect which CLI AI providers are available on the system.
#[command]
pub fn detect_ai_providers() -> Vec<CliProviderEntry> {
    let providers = [
        ("claude", "Claude", "claude"),
        ("codex", "Codex", "codex"),
        ("gemini", "Gemini", "gemini"),
    ];

    providers
        .iter()
        .map(|(typ, name, cmd)| {
            let (available, path) = check_command(cmd);
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
            // Windows GUI apps inherit full system PATH -- skip the shell dance
            if cfg!(target_os = "windows") {
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
    let mapping: &[(&str, &[&str])] = &[
        ("anthropic", &["ANTHROPIC_API_KEY"]),
        ("openai", &["OPENAI_API_KEY"]),
        ("google-ai", &["GOOGLE_API_KEY", "GEMINI_API_KEY"]),
    ];

    let mut result = std::collections::HashMap::new();
    for (provider, vars) in mapping {
        for var in *vars {
            if let Ok(val) = std::env::var(var) {
                if !val.is_empty() {
                    result.insert(provider.to_string(), val);
                    break; // first match wins
                }
            }
        }
    }
    result
}
