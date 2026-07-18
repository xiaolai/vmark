//! Content-server integration (Phase 1).
//!
//! Owns runtime provisioning and the workspace-keyed lifecycle of spawned
//! content-server processes (`ContentServerManager`, in `manager`).
//!
//! Live wiring: `commands` + `slidev_commands` (registered in `lib.rs`) drive
//! the lifecycle; `spawn` spawns the Node runtime with piped stdio → `log` and
//! supervises it (`monitor_child` → `content-server:exited`, WI-1.2).
//!
//! The `provision` / `swap` / `signature` modules implement the ADR-2 runtime
//! upgrade path (signed download → checksum → atomic swap). They are fully
//! unit-tested but have no production caller yet — a packaged build's runtime
//! ships via the bundled resource / signed tarball (external release infra).
//! Those three modules carry a scoped `#[allow(dead_code)]`; the wired
//! manager/supervisor code stays warning-checked.

pub mod commands;
pub mod manager;
#[allow(dead_code)] // ADR-2 runtime-upgrade path — unit-tested, no production caller yet.
pub mod provision;
#[allow(dead_code)] // ADR-2 signature verification — unit-tested, no production caller yet.
pub mod signature;
pub mod slidev;
pub mod slidev_commands;
pub mod spawn;
#[allow(dead_code)] // ADR-2 atomic-swap path — unit-tested, no production caller yet.
pub mod swap;

pub use manager::{ChildState, ContentServerManager};

/// Kill all managed content-server children and remove their port files.
///
/// Must be called explicitly on the quit path (`quit::finalize_quit` and the
/// `ExitRequested` → `AllowExit` branch): `app.exit` terminates the process
/// via `std::process::exit`, which never drops Tauri-managed state, so the
/// manager's `Drop` cannot be relied on at quit. Idempotent.
pub fn cleanup(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(mgr) = app.try_state::<ContentServerManager>() {
        mgr.shutdown_all();
    }
}
