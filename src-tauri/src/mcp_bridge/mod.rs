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

pub mod commands;
mod server;
mod state;
mod types;

// Re-export public API used by other modules (mcp_server.rs, lib.rs)
pub use commands::{client_count, connected_clients};
pub use server::{start_bridge, stop_bridge};
pub use types::ConnectedClientInfo;
