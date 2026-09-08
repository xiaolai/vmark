//! Content-server integration (Phase 1).
//!
//! Owns runtime provisioning and the workspace-keyed lifecycle of spawned
//! content-server processes (`ContentServerManager`, in `manager`).
//!
//! Live wiring: `commands` + `slidev_commands` (registered in `lib.rs`) drive
//! the lifecycle; `spawn` spawns the Node runtime with piped stdio → `log`;
//! `drain` turns its pipes into log lines;
//! `supervisor` watches it (`monitor_child` → `content-server:exited`,
//! WI-1.2); every teardown goes through `cleanup` (#123), and a child it
//! could not stop or reap stays owned by the manager (#122); `http` +
//! `slidev_commands` talk to the running server through the one
//! authenticated loopback client in `client` (#129).
//! `runtime` probes what a start would find without starting anything
//! (`content_server_runtime` + the one startup log line, WI-FL1.1 — settled at
//! quit so a missing line is explained, #126), and
//! `bundle_manifest` holds the single constant that joins `spawn::resolve_cli`
//! to `tauri.conf.json`'s `bundle.resources` (WI-FL0.8) — `None` today, because
//! no release build ships the content server.
//!
//! The `provision` / `swap` / `signature` modules implement the ADR-2 runtime
//! upgrade path (signed download → checksum → atomic swap). They are fully
//! unit-tested but have no production caller yet — a packaged build's runtime
//! ships via the bundled resource / signed tarball (external release infra).
//!
//! Their dormancy is declared PER ITEM, not per module (audit 20260907 #304).
//! A module-wide `#[allow(dead_code)]` here suppressed the intentionally
//! dormant items AND any accidental one added later, which is a warning
//! generator disguised as a warning suppressor. The eleven public entry points
//! carry their own allow with the reason; every private helper they reach stays
//! warning-checked, because an allowed item is still a live root for the
//! reachability pass. Measured on the change: 16 warnings → 0, and a new
//! uncalled helper inside those modules now warns again.

pub mod bundle_manifest;
pub mod cleanup;
mod client;
pub mod commands;
mod drain;
pub mod http;
pub mod manager;
mod port_wait;
pub mod provision;
pub mod runtime;
pub mod signature;
pub mod slidev_commands;
pub mod spawn;
mod start;
mod supervisor;
pub mod swap;

pub use manager::{ChildState, ContentServerManager};

/// Kill all managed content-server children and remove their port files,
/// after settling the startup probe (#126) so the log explains a missing
/// runtime line before it goes quiet.
///
/// Must be called explicitly on the quit path (`quit::finalize_quit` and the
/// `ExitRequested` → `AllowExit` branch): `app.exit` terminates the process
/// via `std::process::exit`, which never drops Tauri-managed state, so the
/// manager's `Drop` cannot be relied on at quit. Idempotent.
pub fn cleanup(app: &tauri::AppHandle) {
    use tauri::Manager;
    runtime::settle_probe(app);
    if let Some(mgr) = app.try_state::<ContentServerManager>() {
        mgr.shutdown_all();
    }
}
