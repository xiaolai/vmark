//! Blocking Pandoc subprocess execution.
//!
//! Purpose: Run the Pandoc CLI with markdown piped over stdin, draining
//! stderr concurrently and enforcing a timeout. Called from
//! `commands::export_via_pandoc` via `spawn_blocking`.
//!
//! Key decisions:
//!   - The stderr drain thread starts BEFORE any stdin is written, and stdin
//!     is written from its own thread: a child that fills its stderr pipe
//!     without reading stdin would otherwise deadlock the stdin writer
//!     forever — and the timeout loop would never even start.
//!   - Retained stderr is capped at `MAX_STDERR_BYTES`; the drain keeps
//!     reading to EOF past the cap so the child can never block on stderr.
//!   - Every terminal path kills AND reaps the child (`kill` + `wait`) — a
//!     kill without a wait leaves a zombie until the parent exits.
//!
//! @coordinates-with pandoc/commands.rs — command surface + arg building

use std::io::{Read, Write};
use std::process::{ChildStderr, ChildStdin, Stdio};
use std::time::Duration;

use crate::ai_provider::{build_command, login_shell_path};

/// Cap on stderr bytes retained for the error message. The drain thread keeps
/// reading past this cap so the child can never block on a full stderr pipe.
const MAX_STDERR_BYTES: usize = 64 * 1024;

/// Execute Pandoc synchronously (called from `spawn_blocking`).
pub(super) fn run_pandoc(
    pandoc_exe: &str,
    markdown: &str,
    output_path: &str,
    source_dir: Option<&str>,
    timeout: Duration,
) -> Result<(), String> {
    let args_owned = super::commands::build_pandoc_args(output_path, source_dir);
    let args: Vec<&str> = args_owned.iter().map(|s| s.as_str()).collect();

    let mut child = build_command(pandoc_exe, &args)
        .env("PATH", login_shell_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            rust_i18n::t!("errors.pandoc.startFailed", detail = e.to_string()).to_string()
        })?;

    // Start the stderr drain BEFORE writing any stdin: a child that fills its
    // stderr pipe while not yet reading stdin would otherwise block, blocking
    // our stdin write in turn (mutual pipe deadlock).
    let stderr_handle = child.stderr.take().map(spawn_stderr_drain);

    // Write stdin from a dedicated thread so this thread enters the timeout
    // loop immediately — a child that never reads stdin can then still be
    // timed out and killed (which unblocks the writer with EPIPE).
    let stdin_handle = child.stdin.take().map(|stdin| {
        let markdown = markdown.to_string();
        std::thread::spawn(move || write_stdin(stdin, &markdown))
    });

    // Poll with timeout. On timeout or a try_wait failure, kill AND reap; the
    // closed pipes then unblock the helper threads, which exit on their own.
    let start = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(rust_i18n::t!("errors.pandoc.timeout").to_string());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(
                    rust_i18n::t!("errors.pandoc.waitFailed", detail = e.to_string()).to_string(),
                );
            }
        }
    };

    // The child has exited, so its pipe ends are closed and both helper
    // threads finish promptly — joining here is bounded.
    let stdin_result = stdin_handle
        .map(|h| h.join().unwrap_or(Ok(())))
        .unwrap_or(Ok(()));
    let stderr_buf = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();

    if status.success() {
        // A stdin write failure with a successful exit still means Pandoc saw
        // truncated input — surface it rather than report a bogus success.
        stdin_result
    } else {
        let stderr = String::from_utf8_lossy(&stderr_buf);
        Err(if stderr.trim().is_empty() {
            rust_i18n::t!("errors.pandoc.exitedWithCode", code = status.to_string()).to_string()
        } else {
            stderr.trim().to_string()
        })
    }
}

/// Write the markdown to the child's stdin; dropping the handle closes the
/// pipe so the child sees EOF.
fn write_stdin(mut stdin: ChildStdin, markdown: &str) -> Result<(), String> {
    stdin
        .write_all(markdown.as_bytes())
        .map_err(|e| rust_i18n::t!("errors.pandoc.stdinFailed", detail = e.to_string()).to_string())
}

/// Drain stderr to EOF on a background thread, retaining at most
/// `MAX_STDERR_BYTES` for the error message.
fn spawn_stderr_drain(mut stderr: ChildStderr) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut retained = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            match stderr.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if retained.len() < MAX_STDERR_BYTES {
                        let take = n.min(MAX_STDERR_BYTES - retained.len());
                        retained.extend_from_slice(&buf[..take]);
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        retained
    })
}

#[cfg(test)]
#[path = "run.test.rs"]
mod tests;
