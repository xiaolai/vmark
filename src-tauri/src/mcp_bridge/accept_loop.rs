//! The bridge's accept loop, as a function of its inputs (#167).
//!
//! Purpose: `start_bridge` used to spawn this loop inline, which made the
//! only things worth testing about it — that a shutdown signal ends it, that
//! it hands every accepted socket to admission, that persistent accept
//! failures end it rather than pin a CPU, and that `on_exit` runs exactly
//! once when it ends — reachable only through a live app. Here the loop
//! takes its listener, its shutdown receiver, its admission callback and its
//! exit hook as parameters, so `accept_loop.test.rs` drives it on a real
//! loopback listener with no app at all.
//!
//! Key decisions:
//!   - Admission is decided synchronously inside the loop, before anything
//!     is spawned or cloned (`connection::admit_connection`), so the caller's
//!     `admit` is a plain `FnMut`.
//!   - The listener is OWNED by the loop and dropped when it returns, so
//!     "the loop ended" and "the port is closed" are one event — the
//!     property the test checks by connecting after shutdown.
//!   - **`on_exit` runs from a DROP GUARD** (audit #385). It used to be a
//!     plain call after the loop, so it ran on the two paths the loop
//!     *returns* on and on neither of the two it can leave without returning:
//!     a panic inside `admit`, and the runtime dropping the task at shutdown.
//!     Either one left the bridge marked running, with a live `port:token`
//!     file, behind a listener that was gone. `spawn_logged` catches the panic
//!     OUTSIDE this future, so it never saw the difference.
//!   - **The accept side is a trait, not `TcpListener`** (audit #363). The
//!     retry counter, its threshold, the backoff and the reset are recovery
//!     logic no test could reach: producing 30 consecutive real `accept`
//!     failures means exhausting the process's file descriptors, which is not
//!     something a test in a shared binary may do. `Accept` is one method
//!     wide and `TcpListener` implements it, so production passes the real
//!     listener and nothing about the shipped path is faked.
//!
//! @coordinates-with server.rs — `start_bridge` spawns it
//! @module mcp_bridge::accept_loop

use std::future::Future;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

/// Consecutive accept failures after which the loop gives up. An immediate
/// retry turns a persistent failure (fd exhaustion, listener teardown) into a
/// CPU-pinned log loop; ending the loop lets `on_exit` reset the bridge state
/// instead of spinning forever.
pub(super) const MAX_CONSECUTIVE_ACCEPT_ERRORS: u32 = 30;

/// The one operation `accept_loop` performs on its listener.
///
/// Named `accept_one` rather than `accept` on purpose: an inherent method
/// wins name resolution over a trait method, so a trait method called
/// `accept` would make `TcpListener`'s impl silently call itself.
pub(super) trait Accept {
    fn accept_one(&self) -> impl Future<Output = std::io::Result<(TcpStream, SocketAddr)>> + Send;
}

impl Accept for TcpListener {
    fn accept_one(&self) -> impl Future<Output = std::io::Result<(TcpStream, SocketAddr)>> + Send {
        TcpListener::accept(self)
    }
}

/// Runs `on_exit` once, on every way out of the loop — return, panic, or the
/// task being dropped.
struct ExitGuard<F: FnOnce()>(Option<F>);

impl<F: FnOnce()> Drop for ExitGuard<F> {
    fn drop(&mut self) {
        if let Some(on_exit) = self.0.take() {
            on_exit();
        }
    }
}

/// Accept connections on `listener` until `shutdown` fires or accepting fails
/// persistently, handing each socket to `admit`; then drop the listener and
/// call `on_exit` — exactly once, on every exit path.
pub(super) async fn accept_loop<L: Accept>(
    listener: L,
    mut shutdown: oneshot::Receiver<()>,
    mut admit: impl FnMut(TcpStream, SocketAddr),
    on_exit: impl FnOnce(),
) {
    // Declared FIRST so it drops LAST among this body's locals: the port has
    // to be closed before the caller is told the loop is gone, so a restart
    // cannot race a listener that is still bound.
    let exit = ExitGuard(Some(on_exit));
    // Moved out of the parameter into a local declared AFTER the guard. A
    // function's parameters drop after its body's locals, so leaving the
    // listener in the parameter slot would run `on_exit` first on the unwind
    // path — the one ordering this function promises never happens.
    let listener = listener;

    let mut consecutive_errors: u32 = 0;
    loop {
        tokio::select! {
            // `biased`, so shutdown WINS a tie (audit #362). `select!` is
            // otherwise random between ready branches, and a socket already
            // waiting in the listener's backlog when the stop signal arrives
            // was admitted about half the time — a connection joining a bridge
            // the user had just stopped. The admission callback re-checks the
            // phase (`start.rs`, #394) and would have refused it, but a gate
            // that fires after the decision is a second chance, not the rule.
            biased;
            _ = &mut shutdown => {
                log::debug!("[MCP Bridge] Shutdown signal received");
                break;
            }
            result = listener.accept_one() => {
                match result {
                    Ok((stream, addr)) => {
                        consecutive_errors = 0;
                        admit(stream, addr);
                    }
                    Err(e) => {
                        consecutive_errors += 1;
                        log::error!(
                            "[MCP Bridge] Accept error ({consecutive_errors} consecutive): {e}"
                        );
                        if consecutive_errors >= MAX_CONSECUTIVE_ACCEPT_ERRORS {
                            log::error!(
                                "[MCP Bridge] Accept failing persistently — stopping bridge loop"
                            );
                            break;
                        }
                        let backoff = Duration::from_millis(
                            (100u64 * u64::from(consecutive_errors)).min(1_000),
                        );
                        // The shutdown arm is re-armed across the backoff: a
                        // bare `sleep().await` here made a stop wait out up to
                        // a second of a failure it was cancelling.
                        tokio::select! {
                            // Same tie-break, same reason: a stop that lands
                            // during a backoff must not wait it out.
                            biased;
                            _ = &mut shutdown => {
                                log::debug!("[MCP Bridge] Shutdown signal received during backoff");
                                break;
                            }
                            _ = tokio::time::sleep(backoff) => {}
                        }
                    }
                }
            }
        }
    }

    drop(listener);
    drop(exit);
}

#[cfg(test)]
#[path = "accept_loop.test.rs"]
mod tests;
