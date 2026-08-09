//! The PTY reader thread (`pty_start`), split out of `pty.rs` at WI-DP4.1.
//!
//! Purpose: own the streaming half of a PTY session — hand the reader and the
//! child to a dedicated thread, pump bytes to the webview over the per-session
//! Channel, and guarantee the child is reaped and `pty:exit:{pid}` emitted on
//! BOTH the normal and the panic path.
//!
//! Split out because `pty.rs` holds nine commands and this one is longer than
//! the other eight together; the file-size gate flagged it and the reader loop
//! is the one part with real control flow to read.
//!
//! @coordinates-with pty.rs — re-exports `pty_start` so the command registry
//!   still resolves `pty::pty_start`
//! @coordinates-with pty/session.rs — `get_session`, `PtyExitEvent`

use super::session::{get_session, PtyExitEvent};
use super::{pty_internal, session_gone, PtyState};
use crate::command_error::CommandError;
use std::io::Read;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Runtime};

/// Start the reader thread for a PTY session.
/// Must be called exactly once per session, after the caller has wired the
/// `on_bytes` Channel and the `pty:exit:{pid}` listener.
/// Sends output bytes over `on_bytes` (Raw → ArrayBuffer); emits
/// `pty:exit:{pid}` on child exit.
#[tauri::command]
pub async fn pty_start<R: Runtime>(
    pid: u32,
    on_bytes: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    state: tauri::State<'_, PtyState>,
    app: AppHandle<R>,
) -> Result<(), CommandError> {
    let session = get_session(&state, pid)
        .await
        .map_err(|_| session_gone(pid))?;
    let mut reader = session
        .reader
        .lock()
        .await
        .take()
        .ok_or_else(|| CommandError::conflict("pty_start already called for this session"))?;
    let mut child = session
        .child
        .lock()
        .await
        .take()
        .ok_or_else(|| CommandError::conflict("pty_start already called for this session"))?;
    let pause_ctl = session.pause_ctl.clone();
    let shutdown = session.shutdown.clone();

    let exit_event = format!("pty:exit:{pid}");

    // Reader thread body wrapped in catch_unwind so a panic doesn't crash
    // the whole process. We must keep the explicit thread name (`pty-reader-{pid}`)
    // for log filtering, so we use Builder directly rather than spawn_thread_logged.
    //
    // `child.wait()` and the exit emit live OUTSIDE the catch_unwind below so
    // they run on BOTH the normal and the (defensive) panic path — the child is
    // always reaped, never a zombie, and the frontend always gets its exit.
    let session_for_panic = session.clone();
    std::thread::Builder::new()
        .name(format!("pty-reader-{pid}"))
        .spawn(move || {
            let pid_for_log = pid;
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // 64 KB buffer (WI-1.2): far fewer reads/sends per burst than the
                // old 4 KB, which compounds with the binary Channel (WI-1.1).
                let mut buf = vec![0u8; 65536];
                loop {
                    if shutdown.load(Ordering::Acquire) {
                        break;
                    }
                    pause_ctl.wait_if_paused();
                    if shutdown.load(Ordering::Acquire) {
                        break;
                    }
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            // Send raw bytes over the per-session Channel. Raw →
                            // ArrayBuffer in the webview (WI-1.1), point-to-point
                            // (no app.emit broadcast → closes T2). A send error
                            // means the webview/channel is gone; kill the child so
                            // the child.wait() below returns instead of hanging on
                            // a still-running shell, then stop reading.
                            if on_bytes
                                .send(tauri::ipc::InvokeResponseBody::Raw(buf[..n].to_vec()))
                                .is_err()
                            {
                                if let Ok(mut killer) = session_for_panic.child_killer.lock() {
                                    let _ = killer.kill();
                                }
                                break;
                            }
                        }
                        // EINTR is transient (signal during read) — retry rather
                        // than treat it as EOF and prematurely end the session.
                        Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                        // Any other read error ends the session. Log it before
                        // breaking so a terminal that dies on a read error leaves
                        // a diagnostic (WI-4.3 / G8) instead of vanishing silently.
                        // Kill the child too: on a fatal read error the shell may
                        // still be running, and the child.wait() below would then
                        // block this thread forever instead of reaping.
                        Err(e) => {
                            log::warn!(
                                "[pty] reader {pid_for_log} read error ({:?}): {e}",
                                e.kind(),
                            );
                            if let Ok(mut killer) = session_for_panic.child_killer.lock() {
                                let _ = killer.kill();
                            }
                            break;
                        }
                    }
                }
            }));
            // On panic the read loop bailed early and the shell may still be
            // running — kill it so the wait() below returns instead of blocking.
            // (The loop has no panic-able operation; this is defense in depth.)
            if let Err(payload) = result {
                log::error!(
                    "[task:pty-reader-{}] reader thread panicked: {}",
                    pid_for_log,
                    crate::task::panic_payload_message(&payload),
                );
                if let Ok(mut killer) = session_for_panic.child_killer.lock() {
                    let _ = killer.kill();
                }
            }
            // Reap the child and emit exit on BOTH the normal and panic paths —
            // guarantees no zombie even if the reader panicked (audit follow-up).
            let exit_code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
            let _ = app.emit(&exit_event, PtyExitEvent { exit_code });
        })
        .map_err(|e| pty_internal("failed to spawn PTY reader thread", e))?;

    Ok(())
}
