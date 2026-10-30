//! MCP Bridge - WebSocket server for AI assistant communication.
//!
//! Provides a WebSocket server that MCP sidecars connect to.
//! Access model:
//! - Read operations: All clients can execute simultaneously
//! - Write operations: Serialized via write lock, released after each write
//!
//! Port discovery:
//! - Server binds to port 0 (OS assigns available port)
//! - Actual port written to Tauri's app data directory (platform-specific)
//! - MCP sidecar uses platform-specific path to find the app data directory

mod accept_loop;
mod attribution;
mod bind;
mod coherence_answers;
mod coherence_dispatch;
pub mod commands;
mod connection;
mod connection_closed;
pub(crate) mod control;
mod delivery;
mod frames;
mod handshake;
mod identify;
mod lifecycle;
mod live_emit;
pub(crate) mod managed;
mod message_loop;
pub(crate) mod path_guard;
mod principal;
mod routed_request;
mod routing;
mod server;
mod session_fanout;
/// The sidecar `--health-check` probe, split out of `control` at the
/// file-size limit: it spawns a child and drains its pipes, which shares
/// nothing with the bridge lifecycle beyond living behind the same Settings
/// panel.
pub(crate) mod sidecar_health;
mod start;
mod state;
mod token_compare;
mod token_dir;
mod token_file;
mod types;
mod wake_retry;
mod window_routing;

// Re-export the API the lifecycle commands (`control.rs`) and `lib.rs` use
pub use commands::{client_count, connected_clients};
pub use lifecycle::{BridgeLifecycle, BridgePhase, StartClaim};
pub use managed::McpBridgeState;
pub use server::{stop_bridge, stop_bridge_with, InFlightWrites};
pub use start::start_bridge;
pub use types::ConnectedClientInfo;
