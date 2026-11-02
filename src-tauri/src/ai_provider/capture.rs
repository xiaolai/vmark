//! Running a helper process for its stdout, with bounds on time and size.
//!
//! The helpers are login shells, `pandoc --version` and similar lookups, so
//! anything they do wrong (hang, leak stdout to a daemon, print without end)
//! comes from the user's machine and must cost a bounded wait, not a hang.

use std::process::Command;

use super::spawn::hide_console_window;

/// Spawn `command`, capture its stdout with a hard `timeout`, and return the
/// raw stdout text only on a successful exit.
///
/// Shared by the Unix login-shell probes (`login_path.rs`) and the Windows
/// PowerShell `$PROFILE` probe. Stdout is drained on a background thread to
/// avoid the pipe-buffer deadlock (a child that writes more than the ~64 KiB
/// pipe buffer blocks on write while we block on `try_wait`). The child's
/// stdin/stderr are nulled and its console window is hidden on Windows.
///
/// Returns `None` on spawn failure, non-zero exit, timeout, or too much output; see
/// [`capture_stdout_detailed`] for a caller that must say which.
pub(crate) fn capture_stdout_with_timeout(
    command: Command,
    timeout: std::time::Duration,
    label: &str,
) -> Option<String> {
    capture_stdout_detailed(command, timeout, label).ok()
}

/// Why [`capture_stdout_detailed`] produced no output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaptureFailure {
    /// The process could not be started.
    Spawn,
    /// It exited unsuccessfully, or its status could not be read.
    Exit,
    /// It was still running, or still holding stdout, at the bound.
    Timeout,
    /// It printed more than [`MAX_CAPTURE_BYTES`].
    TooMuchOutput,
}

/// Far above anything a version string, a tool path or a PATH can need. Without
/// a cap, a process writing flat out could fill memory inside the time bound.
const MAX_CAPTURE_BYTES: usize = 4 * 1024 * 1024;

/// [`capture_stdout_with_timeout`], keeping the reason for a failure.
///
/// On timeout the child is killed and reaped, and `label` is used in the warn
/// log. A child can leak its stdout write-end to a background grandchild (a
/// daemon started from a shell rc file), and then the pipe outlives the child,
/// so waiting for end-of-file is bounded by the same `timeout`.
///
/// The drain thread is never joined. It forwards chunks over a bounded channel,
/// so once this function returns its next send fails, it exits, and the pipe
/// closes: a grandchild that keeps writing stops accumulating anywhere. A
/// grandchild that stays silent parks the thread in `read` until it exits, which
/// costs one idle thread and descriptor per capture. Closing that read early
/// would take platform-specific non-blocking I/O for no user-visible gain.
pub(crate) fn capture_stdout_detailed(
    mut command: Command,
    timeout: std::time::Duration,
    label: &str,
) -> Result<String, CaptureFailure> {
    use std::sync::mpsc::RecvTimeoutError;
    const POLL: std::time::Duration = std::time::Duration::from_millis(50);

    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    hide_console_window(&mut command);
    let mut child = command.spawn().map_err(|_| CaptureFailure::Spawn)?;

    let stdout_pipe = child.stdout.take();
    let (chunks_in, chunks) = std::sync::mpsc::sync_channel::<Vec<u8>>(4);
    std::thread::spawn(move || {
        let Some(mut pipe) = stdout_pipe else { return };
        use std::io::Read;
        let mut chunk = [0_u8; 8192];
        // End-of-file, a read error and a departed receiver all end the drain;
        // dropping `chunks_in` is what tells the receiver the output is complete.
        while let Ok(read @ 1..) = pipe.read(&mut chunk) {
            if chunks_in.send(chunk[..read].to_vec()).is_err() {
                break;
            }
        }
    });

    let reap = |child: &mut std::process::Child| {
        let _ = child.kill();
        let _ = child.wait();
    };
    let deadline = std::time::Instant::now() + timeout;
    let mut output = Vec::new();
    let (mut running, mut pipe_open) = (true, true);
    while running || pipe_open {
        // Checked on every pass: a channel that always has a chunk ready must
        // not be able to outrun the bound.
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            if running {
                reap(&mut child);
            }
            log::warn!("[VMark] {label} timed out after {}s", timeout.as_secs());
            return Err(CaptureFailure::Timeout);
        }
        if pipe_open {
            match chunks.recv_timeout(POLL.min(remaining)) {
                Ok(chunk) => output.extend_from_slice(&chunk),
                Err(RecvTimeoutError::Disconnected) => pipe_open = false,
                Err(RecvTimeoutError::Timeout) => {}
            }
            if output.len() > MAX_CAPTURE_BYTES {
                if running {
                    reap(&mut child);
                }
                log::warn!("[VMark] {label} printed too much output");
                return Err(CaptureFailure::TooMuchOutput);
            }
        } else {
            std::thread::sleep(POLL.min(remaining));
        }
        if running {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => running = false,
                Ok(Some(_)) => return Err(CaptureFailure::Exit),
                Ok(None) => {}
                Err(_) => {
                    reap(&mut child);
                    return Err(CaptureFailure::Exit);
                }
            }
        }
    }
    Ok(String::from_utf8_lossy(&output).to_string())
}

#[cfg(test)]
#[path = "capture.test.rs"]
mod tests;
