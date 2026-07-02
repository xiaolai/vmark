//! Process-spawn platform utilities.
//!
//! Platform pieces shared by every child-process spawn in the backend:
//! the `CREATE_NO_WINDOW` creation flag (a GUI app has no attached console,
//! so console-subsystem children flash a visible console window unless
//! suppressed — issue #1091), the `.cmd`-shim-aware `build_command`
//! constructor, the PATH-hijack-safe `where.exe` / `which` lookup, and the
//! PowerShell `$PROFILE` PATH probe.

use std::process::Command;

// ============================================================================
// Console-Window Suppression
// ============================================================================

/// Windows process-creation flag `CREATE_NO_WINDOW` (0x08000000).
///
/// A GUI app has no attached console, so every console-subsystem child
/// (cmd.exe, powershell, where.exe, node, pandoc, …) opens a fresh visible
/// console window unless this flag is set — the "black windows on startup"
/// bug (issue #1091).
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Suppress the child's console window on Windows.
///
/// Every direct `std::process::Command` construction in the backend must
/// pass through this (usually via [`build_command`] or [`which_command`])
/// so no spawn flashes a console window.
#[cfg(target_os = "windows")]
pub(crate) fn hide_console_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

/// Suppress the child's console window on Windows. No-op on other platforms.
#[cfg(not(target_os = "windows"))]
pub(crate) fn hide_console_window(_cmd: &mut Command) {}

// ============================================================================
// Command Building
// ============================================================================

/// Build a `std::process::Command` for the given executable and args.
///
/// On Windows, `.cmd`/`.bat` shims (created by npm/yarn global installs)
/// must run through `cmd.exe /c`, and the command is always marked
/// `CREATE_NO_WINDOW` so the child never flashes a console window.
/// On macOS/Linux this is a plain spawn.
///
/// Returns `std::process::Command` (not `tokio::process::Command`) so other
/// modules (pandoc, actionlint) can keep using synchronous spawn semantics.
/// `cli.rs` converts to `tokio::process::Command` at its call site.
pub(crate) fn build_command(exe: &str, args: &[&str]) -> Command {
    #[cfg(target_os = "windows")]
    {
        let lower = exe.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            // Use absolute path to cmd.exe to prevent CWD/PATH hijack attacks
            let system_root =
                std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
            let cmd_path = std::path::PathBuf::from(system_root)
                .join("System32")
                .join("cmd.exe");
            let mut c = Command::new(cmd_path);
            c.args(["/c", exe]);
            c.args(args);
            hide_console_window(&mut c);
            return c;
        }
    }
    let mut c = Command::new(exe);
    c.args(args);
    hide_console_window(&mut c);
    c
}

// ============================================================================
// Executable Lookup
// ============================================================================

/// Build a `Command` for the system's `which` (Unix) or `where` (Windows).
///
/// On Windows, uses the absolute path `%WINDIR%\System32\where.exe` to
/// prevent PATH-hijacking attacks (and hides the console window `where.exe`
/// would otherwise flash — issue #1091). On Unix, prefers the absolute
/// `/usr/bin/which` (present on macOS and virtually all Linux distros) so
/// the lookup binary itself can't be swapped via a hijacked parent PATH;
/// falls back to a bare lookup on systems without it.
pub(crate) fn which_command() -> Command {
    #[cfg(target_os = "windows")]
    {
        let where_exe = std::path::PathBuf::from(
            std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".to_string()),
        )
        .join("System32")
        .join("where.exe");
        let mut c = Command::new(where_exe);
        hide_console_window(&mut c);
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        let abs = std::path::Path::new("/usr/bin/which");
        if abs.exists() {
            Command::new(abs)
        } else {
            Command::new("which")
        }
    }
}

// ============================================================================
// Bounded Process Capture
// ============================================================================

/// Spawn `command`, capture its stdout with a hard `timeout`, and return the
/// raw stdout text only on a successful exit.
///
/// Shared by the Unix login-shell probes (`detection.rs`) and the Windows
/// PowerShell `$PROFILE` probe. Stdout is drained on a background thread to
/// avoid the pipe-buffer deadlock (a child that writes more than the ~64 KiB
/// pipe buffer blocks on write while we block on `try_wait`). The child's
/// stdin/stderr are nulled and its console window is hidden on Windows.
///
/// Returns `None` on spawn failure, non-zero exit, or timeout (the child is
/// killed and reaped, and `label` is used in the warn log). On the timeout
/// and error paths the drain thread is deliberately NOT joined: if the child
/// leaked its stdout write-end to a background grandchild (e.g. a daemon
/// spawned from a shell rc file), joining would block indefinitely — the
/// detached thread exits on its own once the pipe finally closes.
pub(crate) fn capture_stdout_with_timeout(
    mut command: Command,
    timeout: std::time::Duration,
    label: &str,
) -> Option<String> {
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    hide_console_window(&mut command);
    let mut child = command.spawn().ok()?;

    let stdout_pipe = child.stdout.take();
    let reader = std::thread::spawn(move || -> Vec<u8> {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stdout_pipe {
            use std::io::Read;
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let buf = reader.join().ok()?;
                return status
                    .success()
                    .then(|| String::from_utf8_lossy(&buf).to_string());
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    log::warn!("[VMark] {label} timed out after {}s", timeout.as_secs());
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

/// Extract the text between the first `start` sentinel and the next `end`
/// sentinel after it, trimmed. Returns `None` if either sentinel is absent.
/// Sentinels isolate the probed value from shell/profile startup noise.
pub(crate) fn parse_sentinel(raw: &str, start: &str, end: &str) -> Option<String> {
    let s = raw.find(start)? + start.len();
    let e = raw[s..].find(end)? + s;
    Some(raw[s..e].trim().to_string())
}

// ============================================================================
// Windows PowerShell PATH Probe
// ============================================================================

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
pub(crate) fn windows_profile_path() -> Option<String> {
    const START: &str = "__VMARK_PATH_START__";
    const END: &str = "__VMARK_PATH_END__";

    // Try pwsh (PowerShell 7+) first, then powershell.exe (Windows PowerShell 5.x)
    let shells = ["pwsh.exe", "powershell.exe"];
    for shell in &shells {
        let cmd_str =
            format!("Write-Output '{START}'; Write-Output $env:Path; Write-Output '{END}'");
        let mut command = Command::new(shell);
        command.args(["-NoLogo", "-NonInteractive", "-Command", &cmd_str]);
        let Some(raw) = capture_stdout_with_timeout(
            command,
            std::time::Duration::from_secs(3),
            &format!("windows_profile_path: {shell}"),
        ) else {
            continue; // spawn failure, non-zero exit, or timeout — try next shell
        };
        // parse_sentinel only matches END after START, so profile startup
        // noise containing the END marker can't panic or corrupt the value.
        if let Some(path) = parse_sentinel(&raw, START, END).filter(|p| !p.is_empty()) {
            return Some(path);
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn windows_profile_path() -> Option<String> {
    None
}

#[cfg(test)]
#[path = "spawn.test.rs"]
mod tests;
