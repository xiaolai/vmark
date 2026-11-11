//! Process-spawn platform utilities.
//!
//! Platform pieces shared by every child-process spawn in the backend:
//! the `CREATE_NO_WINDOW` creation flag (a GUI app has no attached console,
//! so console-subsystem children flash a visible console window unless
//! suppressed — issue #1091), the `build_command` constructor (which never
//! puts a shell in front of the program, so a Windows `.cmd` shim gets the
//! standard library's batch-file argument escaping), the PATH-hijack-safe
//! `where.exe` / `which` lookup, and the PowerShell `$PROFILE` PATH probe.

use std::process::Command;

use super::capture::CaptureFailure;

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

/// Build a `std::process::Command` for the given executable and args, marked
/// `CREATE_NO_WINDOW` on Windows so the child never flashes a console window.
///
/// The program is always `exe` itself, never a shell placed in front of it —
/// including for the `.cmd`/`.bat` shims npm/yarn global installs create on
/// Windows. The standard library runs a batch file through the system
/// `cmd.exe` on its own, and only then escapes each argument by cmd.exe's
/// rules (`&`, `|`, `"` and `%VAR%` arrive as text), refusing the spawn with
/// `InvalidInput` when an argument cannot be escaped — a line break or a NUL.
/// Naming `cmd.exe` as the program here would switch that off: its arguments
/// get the ordinary quoting, which cmd.exe does not follow, so an argument
/// could start a second command.
///
/// Arguments are therefore for values the app chose (flags, file paths).
/// Text the app did not write — the AI prompt — travels on the child's stdin
/// (`cli.rs`), and [`spawn_failure`] words the refusal when one slips through.
///
/// Returns `std::process::Command` (not `tokio::process::Command`) so other
/// modules (pandoc, actionlint) can keep using synchronous spawn semantics.
/// `cli.rs` converts to `tokio::process::Command` at its call site.
pub(crate) fn build_command(exe: &str, args: &[&str]) -> Command {
    let mut c = Command::new(exe);
    c.args(args);
    hide_console_window(&mut c);
    c
}

/// Word a failed spawn of `program` for the caller's error channel.
///
/// `InvalidInput` is not "the program is missing": it is the standard library
/// refusing to hand an argument over because it holds something that cannot
/// be passed on intact (see [`build_command`]). It is logged as an error and
/// named in the message, so it is never mistaken for a missing install.
pub(crate) fn spawn_failure(program: &str, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::InvalidInput {
        log::error!("[spawn] {program:?}: an argument was refused at spawn: {error}");
        format!("Failed to spawn {program}: an argument cannot be passed to it safely ({error})")
    } else {
        format!("Failed to spawn {program}: {error}")
    }
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

/// Suffixes a Windows spawn can use: `.exe` directly, `.cmd` and `.bat`
/// through the batch interpreter the standard library invokes on its own (see
/// [`build_command`]). The same three `cli_path_guard` accepts, so a path
/// found here is never refused there (`cli_path_guard.test.rs` pins it); `.ps1`
/// and `.com` are in neither.
pub(crate) const SPAWNABLE_WINDOWS_SUFFIXES: [&str; 3] = ["exe", "cmd", "bat"];

/// True when the last path component of `line` ends in a suffix Windows can
/// spawn. Only the file name is read, so a dot or `.exe` in a directory name
/// never decides it; both `\` and `/` separate components.
fn has_spawnable_windows_suffix(line: &str) -> bool {
    let name = line.rsplit(['\\', '/']).next().unwrap_or(line);
    match name.rsplit_once('.') {
        Some((stem, suffix)) => {
            !stem.is_empty()
                && SPAWNABLE_WINDOWS_SUFFIXES
                    .iter()
                    .any(|s| suffix.eq_ignore_ascii_case(s))
        }
        None => false,
    }
}

/// Pick the entry of `where`/`which` output a spawn can use.
///
/// `where.exe` lists every match on PATH in order, and npm leaves an
/// extensionless POSIX shell shim (for Git Bash) beside each `.cmd` it
/// installs, ahead of it. Windows cannot execute that file — spawning it
/// fails with os error 193 — so on Windows the first line is not necessarily
/// the one to run: the first one with a spawnable suffix is (issue #1666).
/// With none, the answer is `None` — found-but-unrunnable is worse than not
/// found. Elsewhere `which` already reports what a shell would run, and a
/// POSIX binary has no suffix, so the first non-blank line stands.
///
/// `windows` is a parameter, not a `cfg!`, so both rules are testable on
/// every CI OS; call sites use [`first_spawnable_path`].
pub(crate) fn spawnable_candidate(stdout: &str, windows: bool) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .find(|line| !windows || has_spawnable_windows_suffix(line))
        .map(str::to_string)
}

/// File names to try for `name` in one PATH directory.
///
/// Elsewhere that is `name` itself. On Windows a bare `name` is never
/// spawnable (npm leaves a POSIX shim by that name), so it is tried with each
/// spawnable suffix, in `.exe`, `.cmd`, `.bat` order — unless `name` already
/// ends in one.
pub(crate) fn executable_names(name: &str, windows: bool) -> Vec<String> {
    if !windows || has_spawnable_windows_suffix(name) {
        return vec![name.to_string()];
    }
    SPAWNABLE_WINDOWS_SUFFIXES
        .iter()
        .map(|suffix| format!("{name}.{suffix}"))
        .collect()
}

/// [`spawnable_candidate`] for the platform this build runs on.
pub(crate) fn first_spawnable_path(stdout: &str) -> Option<String> {
    spawnable_candidate(stdout, cfg!(windows))
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
pub(crate) fn windows_profile_path() -> Result<String, Option<CaptureFailure>> {
    use super::capture::capture_stdout_detailed;

    const START: &str = "__VMARK_PATH_START__";
    const END: &str = "__VMARK_PATH_END__";

    // Try pwsh (PowerShell 7+) first, then powershell.exe (Windows PowerShell 5.x)
    let shells = ["pwsh.exe", "powershell.exe"];
    let mut last_failure = None;
    for shell in &shells {
        let cmd_str =
            format!("Write-Output '{START}'; Write-Output $env:Path; Write-Output '{END}'");
        let mut command = Command::new(shell);
        command.args(["-NoLogo", "-NonInteractive", "-Command", &cmd_str]);
        let raw = match capture_stdout_detailed(
            command,
            std::time::Duration::from_secs(3),
            &format!("windows_profile_path: {shell}"),
        ) {
            Ok(raw) => raw,
            Err(failure) => {
                last_failure = Some(failure);
                continue; // spawn failure, non-zero exit, or timeout — try next shell
            }
        };
        // parse_sentinel only matches END after START, so profile startup
        // noise containing the END marker can't panic or corrupt the value.
        if let Some(path) = parse_sentinel(&raw, START, END).filter(|p| !p.is_empty()) {
            return Ok(path);
        }
        last_failure = None;
    }
    Err(last_failure)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn windows_profile_path() -> Result<String, Option<CaptureFailure>> {
    Err(None)
}

#[cfg(test)]
#[path = "spawn.test.rs"]
mod tests;
