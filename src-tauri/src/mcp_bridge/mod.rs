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
mod bind;
mod coherence_answers;
pub mod commands;
mod connection;
mod delivery;
mod frames;
mod handshake;
mod identify;
mod lifecycle;
pub(crate) mod managed;
mod message_loop;
mod peer_text;
mod principal;
mod routed_request;
mod routing;
mod server;
mod start;
mod state;
mod token_compare;
mod token_dir;
mod token_file;
mod types;
mod wake_retry;
mod window_routing;

// Re-export public API used by other modules (mcp_server.rs, lib.rs)
pub use commands::{client_count, connected_clients};
pub use lifecycle::{BridgeLifecycle, BridgePhase, StartClaim};
pub use managed::McpBridgeState;
pub use server::stop_bridge;
pub use start::start_bridge;
pub use types::ConnectedClientInfo;
