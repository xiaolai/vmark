//! Waiting for a freshly spawned content server to report its port (#328).
//!
//! Split from `start.rs` at the file-size gate, and it is a real seam: this
//! half knows only a path, a token and a child it can poll — no manager, no
//! registration, no teardown. `start.rs` owns the attempt around it.
//!
//! The TOKEN check is the point. A stale port file from a prior run, or a
//! concurrent start's child, would otherwise name the wrong loopback port and
//! this start's bearer token would go to whatever is listening there.
//!
//! @coordinates-with start.rs — the only caller
//! @module content_server/port_wait

use serde::Deserialize;
use std::process::Child;
use std::time::Duration;

#[derive(Deserialize)]
struct PortFile {
    port: u16,
    token: String,
}

pub(super) enum PortWait {
    Port(u16),
    /// The child exited before writing a port file that carries its token.
    Exited,
    /// The child could not be polled at all: its liveness is UNKNOWN (#328).
    /// Reported as itself rather than as "still running", which spent the
    /// whole ten-second budget and then blamed the timeout.
    PollFailed(String),
    /// The poll budget ran out with no matching port file.
    TimedOut,
}

/// The port THIS child announced, or `None` while there is nothing to read.
///
/// Every "not yet" is one answer here rather than four nested `if let`s in the
/// loop (#326): the file may be absent, unreadable, half-written, or a
/// concurrent start's — and the loop's business is only whether to poll again.
///
/// **Port 0 is not a port** (#327). It is what a listener reports before it
/// binds, so a record carrying it announces readiness the server does not
/// have; accepting it handed the caller `http://127.0.0.1:0`, which every
/// later call reports as a connection failure against a server the registry
/// says is running. Treated like a record that is not ours: keep polling, and
/// let the budget run out with the timeout that names what happened.
fn matching_port(port_file: &std::path::Path, token: &str) -> Option<u16> {
    let bytes = std::fs::read(port_file).ok()?;
    let pf: PortFile = serde_json::from_slice(&bytes).ok()?;
    if pf.token != token || pf.port == 0 {
        return None;
    }
    Some(pf.port)
}

/// The one thing the poll asks of the child, so a poll FAILURE — which a
/// real child cannot be made to produce on demand — is still pinned by a test.
/// Same shape, and the same reason, as `cleanup::Terminable`.
pub(super) trait Pollable {
    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>>;
}

impl Pollable for Child {
    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        Child::try_wait(self)
    }
}

/// `await_port` over the pieces it reads, so the poll can be driven by a child
/// that fails (#328).
///
/// A `try_wait` ERROR is not "still running": the OS could not tell us whether
/// the child is alive, and `matches!(.., Ok(Some(_)))` read that as alive,
/// spent the remaining budget, and then reported the generic port timeout —
/// losing the only diagnosis anyone had.
pub(super) async fn await_port_of<C: Pollable>(
    port_file: &std::path::Path,
    token: &str,
    child: &mut C,
) -> PortWait {
    for _ in 0..100 {
        if let Some(port) = matching_port(port_file, token) {
            return PortWait::Port(port);
        }
        match child.try_wait() {
            Ok(Some(_)) => return PortWait::Exited,
            Ok(None) => {}
            Err(e) => return PortWait::PollFailed(e.to_string()),
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    PortWait::TimedOut
}

#[cfg(test)]
#[path = "port_wait.test.rs"]
mod tests;
