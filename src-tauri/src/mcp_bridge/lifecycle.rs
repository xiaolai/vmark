//! The bridge's start/stop lifecycle, as one object (audit 20260907 #177).
//!
//! `mcp_bridge_start` used to coordinate three process-global statics by hand
//! — a running flag, a port slot and a generation counter — and two races
//! lived in the gaps between them: a stop that ran while a start was still
//! binding found no shutdown sender, reported "stopped", and the start then
//! installed its sender and launched a live bridge nobody tracked (#179);
//! and a poisoned port slot AFTER the listener was up made the command return
//! an error while the bridge kept running (#180).
//!
//! Two mechanisms close them. `serial` is an async mutex held by a start and a
//! stop for their WHOLE duration, so the two cannot interleave. `inner` is
//! the state itself — running, port, generation — read and written under one
//! lock that recovers from poisoning, so publishing a port cannot fail.
//!
//! The generation survives from the static version, and for the same reason
//! `McpBridgeState::connection_generation` does: an accept loop that exits
//! late compares the generation it was started under and no-ops when a newer
//! start has taken over, so a dying old loop cannot clobber the new bridge's
//! state or delete its port file.
//!
//! @coordinates-with mcp_server.rs — the commands that drive it
//! @coordinates-with managed.rs — where the app holds it
//! @module mcp_bridge::lifecycle

use std::sync::Mutex;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Lifecycle {
    running: bool,
    port: Option<u16>,
    generation: u64,
}

/// Where the bridge is in its lifecycle, as one value (#178). `Starting` is
/// the window between a start's claim and its bind: it is neither stopped
/// (a start owns it) nor running (nothing listens yet), and reporting it as
/// "running with no port" said two things that could not both be true.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgePhase {
    /// Nothing listens and nothing is claimed.
    Stopped,
    /// A start has claimed the bridge and is still binding.
    Starting,
    /// The listener is up on this port.
    Running(u16),
}

/// Start/stop state of the bridge server, held by `McpBridgeState`.
#[derive(Default)]
pub struct BridgeLifecycle {
    /// Held across a whole start and a whole stop (#179).
    serial: tokio::sync::Mutex<()>,
    inner: Mutex<Lifecycle>,
}

impl BridgeLifecycle {
    /// Take the start/stop serialization lock. A stop that arrives while a
    /// start is binding waits for the start to finish, then stops the bridge
    /// it produced.
    pub async fn serialize(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.serial.lock().await
    }

    fn state(&self) -> std::sync::MutexGuard<'_, Lifecycle> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The phase the bridge is in now. A port is reported only once the
    /// listener is up — a number nothing listens on must never be reported,
    /// and `Starting` says so without a contradictory "running" flag.
    pub fn snapshot(&self) -> BridgePhase {
        let s = self.state();
        match (s.running, s.port) {
            (false, _) => BridgePhase::Stopped,
            (true, None) => BridgePhase::Starting,
            (true, Some(port)) => BridgePhase::Running(port),
        }
    }

    /// Claim the not-running → running transition. `Some(claim)` when this
    /// caller now owns the start; `None` when a bridge is already running (or
    /// a start already claimed).
    ///
    /// The claim is a DROP GUARD (audit #392). It used to be a bare
    /// generation, released by an explicit `abort_start()` on the one path
    /// that returns `Err` — so a start that panicked, or whose future was
    /// dropped, left `running: true` with no port: the phase stuck at
    /// `Starting` for the life of the process, and every later
    /// `mcp_bridge_start` returned that phase instead of starting anything.
    /// Only an explicit stop could clear it, and the UI has no reason to
    /// offer one for a bridge it is told is still starting.
    pub fn begin_start(&self) -> Option<StartClaim<'_>> {
        let mut s = self.state();
        if s.running {
            return None;
        }
        s.running = true;
        s.port = None;
        s.generation += 1;
        let generation = s.generation;
        drop(s);
        Some(StartClaim {
            lifecycle: self,
            generation,
            committed: false,
        })
    }

    /// A start that failed after claiming releases the claim so a later start
    /// can try again — but only while it is still the CURRENT start.
    /// Generation-guarded for the reason `on_loop_exit` is: a claim dropped
    /// late, after a stop and a fresh start, must not clear the new bridge's
    /// state.
    fn abort_start(&self, generation: u64) {
        let mut s = self.state();
        if s.generation != generation {
            return;
        }
        s.running = false;
        s.port = None;
    }

    /// The listener is up on `port`. Infallible: a poisoned lock is recovered
    /// rather than reported, because by now the bridge IS running and an
    /// error here would describe a failure that did not happen (#180).
    ///
    /// Reached only through `StartClaim::commit`, so publishing a port and
    /// committing the claim that produced it are one step.
    fn publish(&self, port: u16) {
        self.state().port = Some(port);
    }

    /// The bridge is being stopped: supersede any in-flight loop (its
    /// `on_loop_exit` will see a stale generation) and clear the state.
    pub fn mark_stopped(&self) {
        let mut s = self.state();
        s.generation += 1;
        s.running = false;
        s.port = None;
    }

    /// The accept loop started under `generation` has exited. Returns `true`
    /// when that loop was still the current bridge — the state is cleared and
    /// the caller should remove the port file — and `false` for a stale loop,
    /// whose exit must touch nothing.
    pub fn on_loop_exit(&self, generation: u64) -> bool {
        let mut s = self.state();
        if s.generation != generation {
            return false;
        }
        s.running = false;
        s.port = None;
        true
    }
}

/// An owned start claim. While it lives the bridge is `Starting`; committing
/// it publishes the bound port and makes the bridge `Running`, and dropping it
/// uncommitted releases the claim — on the `Err` path, on a panic, and on the
/// command future being dropped alike.
pub struct StartClaim<'a> {
    lifecycle: &'a BridgeLifecycle,
    generation: u64,
    committed: bool,
}

impl StartClaim<'_> {
    /// The generation this start owns — what a loop's exit hook compares
    /// against so a stale loop cannot clobber a newer start.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// The listener is up on `port`: publish it and keep the claim.
    pub fn commit(mut self, port: u16) {
        self.committed = true;
        self.lifecycle.publish(port);
    }
}

impl Drop for StartClaim<'_> {
    fn drop(&mut self) {
        if !self.committed {
            self.lifecycle.abort_start(self.generation);
        }
    }
}

#[cfg(test)]
#[path = "lifecycle.test.rs"]
mod tests;
