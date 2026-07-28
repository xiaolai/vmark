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

mod coherence_answers;
pub mod commands;
mod connection;
mod delivery;
mod frames;
mod handshake;
mod principal;
mod routing;
mod server;
mod state;
mod token_compare;
mod token_dir;
mod token_file;
mod types;
mod window_routing;

// Re-export public API used by other modules (mcp_server.rs, lib.rs)
pub use commands::{client_count, connected_clients};
pub use server::{start_bridge, stop_bridge};
pub use token_file::remove_port_file;
pub use types::ConnectedClientInfo;
