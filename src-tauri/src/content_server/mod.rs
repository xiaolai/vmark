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
