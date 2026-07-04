//! Shell discovery for the integrated terminal.
//!
//! Purpose: Resolves the user's default shell, the login shell's PATH, and
//! the list of available shells. Extracted verbatim from `lib.rs` to keep
//! that file under the size gate.
//!
//! Key decisions:
//!   - Default shell resolved via `getpwuid_r` → `$SHELL` → `/bin/sh` (reliable in
//!     GUI apps). Available shells detected from `/etc/shells` (Unix) or `where.exe`
//!     (Windows), always returning absolute paths.

use crate::ai_provider;

/// Return the login shell's PATH — needed by the integrated terminal so that
/// CLI tools (node, claude, etc.) are discoverable, matching system terminal behavior.
///
/// Delegates to `ai_provider::login_shell_path()` which caches the result.
#[tauri::command]
pub fn get_login_shell_path() -> String {
    ai_provider::login_shell_path()
}

/// Return the user's default shell.
///
/// Fallback chain:
/// - macOS/Linux: `getpwuid(getuid())` → `$SHELL` → `/bin/sh`
///   `getpwuid` reads the login shell from the user database, which is
///   reliable even in GUI apps where `$SHELL` may not be set.
/// - Windows: `%COMSPEC%` → `%SystemRoot%\System32\cmd.exe` → `C:\Windows\System32\cmd.exe`
#[tauri::command]
pub fn get_default_shell() -> String {
    if cfg!(target_os = "windows") {
        // Prefer %COMSPEC%, fall back to absolute cmd.exe path (never bare "cmd.exe")
        std::env::var("COMSPEC")
            .ok()
            .filter(|v| shell_path_is_valid(v))
            .unwrap_or_else(windows_absolute_cmd)
    } else {
        login_shell_from_passwd()
            .filter(|s| shell_path_is_valid(s))
            .or_else(|| {
                std::env::var("SHELL")
                    .ok()
                    .filter(|s| shell_path_is_valid(s))
            })
            .unwrap_or_else(|| "/bin/sh".to_string())
    }
}

/// Read login shell from the Unix user database via `getpwuid_r`.
///
/// Returns `None` if the lookup fails or the shell field is empty.
/// Retries with a larger buffer on `ERANGE` (large NSS entries).
#[cfg(unix)]
fn login_shell_from_passwd() -> Option<String> {
    use std::ffi::CStr;
    use std::mem::MaybeUninit;

    // SAFETY: getuid() is always safe and returns the real user ID.
    let uid = unsafe { libc::getuid() };

    // Start with sysconf hint, fall back to 1024
    let init_size = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let mut buf_size = if init_size > 0 {
        init_size as usize
    } else {
        1024
    };

    loop {
        let mut pwd = MaybeUninit::<libc::passwd>::uninit();
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        let mut buf = vec![0u8; buf_size];

        // SAFETY: getpwuid_r is the reentrant (thread-safe) variant.
        // We pass valid pointers and a buffer of known size.
        let rc = unsafe {
            libc::getpwuid_r(
                uid,
                pwd.as_mut_ptr(),
                buf.as_mut_ptr() as *mut libc::c_char,
                buf.len(),
                &mut result,
            )
        };

        if rc == libc::ERANGE && buf_size < 1_048_576 {
            // Buffer too small — double and retry (cap at 1 MB)
            buf_size *= 2;
            continue;
        }

        if rc != 0 || result.is_null() {
            return None;
        }

        // SAFETY: result is non-null and points to initialized pwd.
        let pwd = unsafe { pwd.assume_init() };
        if pwd.pw_shell.is_null() {
            return None;
        }

        // SAFETY: pw_shell is a valid C string from the passwd entry.
        let shell = unsafe { CStr::from_ptr(pwd.pw_shell) };
        let shell_str = shell.to_str().ok()?.to_string();

        return if shell_str.is_empty() {
            None
        } else {
            Some(shell_str)
        };
    }
}

#[cfg(not(unix))]
fn login_shell_from_passwd() -> Option<String> {
    None
}

/// Build an absolute path to `cmd.exe` using `%SystemRoot%` (or fallback).
/// Never returns a bare "cmd.exe" that could resolve via CWD/PATH.
fn windows_absolute_cmd() -> String {
    let sys_root = std::env::var("SystemRoot")
        .or_else(|_| std::env::var("WINDIR"))
        .unwrap_or_else(|_| r"C:\Windows".to_string());
    let cmd = std::path::PathBuf::from(&sys_root)
        .join("System32")
        .join("cmd.exe");
    cmd.to_string_lossy().into_owned()
}

/// Resolve absolute path for a shell executable using `which`/`where`.
/// Returns `None` if the executable is not found.
fn resolve_windows_shell(name: &str) -> Option<String> {
    let output = ai_provider::which_command().arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    // where.exe may return multiple lines; take the first (highest priority) one
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next()?.trim().to_string();
    if first_line.is_empty() {
        None
    } else {
        Some(first_line)
    }
}

/// Check if a shell path exists and is executable (for validating env vars).
fn shell_path_is_valid(path: &str) -> bool {
    let p = std::path::Path::new(path);
    p.is_file() && is_executable(p)
}

/// List available shells on the system.
///
/// - macOS/Linux: reads `/etc/shells`, filters to existing executable paths, deduplicates.
///   Includes the user's login shell (via `getpwuid` → `$SHELL` fallback) when it
///   validates as an existing executable.
/// - Windows: checks for known shell executables via `where.exe` (absolute path);
///   `%COMSPEC%` is included only if it validates too.
#[tauri::command]
pub fn list_available_shells() -> Vec<String> {
    if cfg!(target_os = "windows") {
        let resolved = ["powershell.exe", "pwsh.exe", "cmd.exe"]
            .iter()
            .filter_map(|candidate| resolve_windows_shell(candidate))
            .collect();
        collect_windows_shells(resolved, std::env::var("COMSPEC").ok(), shell_path_is_valid)
    } else {
        let etc_shells = std::fs::read_to_string("/etc/shells").unwrap_or_default();
        let user_shell = login_shell_from_passwd().or_else(|| std::env::var("SHELL").ok());
        collect_unix_shells(&etc_shells, user_shell, shell_path_is_valid)
    }
}

/// Build the Unix shell list from `/etc/shells` content plus the user's login
/// shell. Every candidate — including the env-derived `user_shell` — must pass
/// `valid` (existence + executability) before it is offered; env vars are
/// user-controllable and can point at uninstalled shells.
fn collect_unix_shells(
    etc_shells: &str,
    user_shell: Option<String>,
    valid: impl Fn(&str) -> bool,
) -> Vec<String> {
    let mut shells: Vec<String> = Vec::new();
    for line in etc_shells.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if valid(trimmed) {
            shells.push(trimmed.to_string());
        }
    }
    // Include the user's login shell first — but only if it validates, same
    // gate get_default_shell applies.
    if let Some(shell) = user_shell.filter(|s| valid(s)) {
        if !shells.contains(&shell) {
            shells.insert(0, shell);
        }
    }
    // Deduplicate while preserving order
    let mut seen = std::collections::HashSet::new();
    shells.retain(|s| seen.insert(s.clone()));
    shells
}

/// Build the Windows shell list from `where.exe`-resolved paths plus
/// `%COMSPEC%`. Every candidate must validate: COMSPEC is env-derived, and
/// `where.exe` results are only as trustworthy as PATH (also user-writable)
/// — a shim or since-deleted entry must not be offered (mirrors
/// `get_default_shell`). Dedup is case-insensitive (Windows paths).
fn collect_windows_shells(
    resolved: Vec<String>,
    comspec: Option<String>,
    valid: impl Fn(&str) -> bool,
) -> Vec<String> {
    let mut shells: Vec<String> = resolved.into_iter().filter(|s| valid(s)).collect();
    if let Some(comspec) = comspec.filter(|c| valid(c)) {
        if !shells.iter().any(|s| s.eq_ignore_ascii_case(&comspec)) {
            shells.insert(0, comspec);
        }
    }
    shells
}

/// Check if a file is executable by the current user (Unix: `access(X_OK)`).
#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::ffi::CString;
    let Ok(c_path) = CString::new(path.as_os_str().as_encoded_bytes()) else {
        return false;
    };
    // SAFETY: c_path is a valid null-terminated C string.
    unsafe { libc::access(c_path.as_ptr(), libc::X_OK) == 0 }
}

#[cfg(not(unix))]
fn is_executable(_path: &std::path::Path) -> bool {
    true // Windows executability is determined by extension, not permissions
}

#[cfg(test)]
#[path = "shell_env.test.rs"]
mod tests;
