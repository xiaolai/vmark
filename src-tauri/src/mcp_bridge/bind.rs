//! The bridge's one bind: loopback, OS-assigned port (D9).
//!
//! Split out of `server.rs` so the property is testable without an app and so
//! the port story lives in one place: the retired `mcpServer.port` setting was
//! forwarded to `mcp_bridge_start` and ignored, and callers learn the real port
//! from this return value, the `mcp-port` file and the status, never from a
//! setting. `server.test.rs` pins it (`the_bridge_binds_an_os_assigned_loopback_port`).
//!
//! Typed from the start (#164): a bind failure is an `io` `CommandError`, and
//! it travels to `mcp_bridge_start`'s caller as one — no prose is re-wrapped
//! at the command boundary.
//!
//! @coordinates-with server.rs — `start_bridge` consumes the listener
//! @coordinates-with ../mcp_server.rs — `mcp_bridge_start` reports the bound port

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use tokio::net::TcpListener;

/// Bind the bridge's loopback listener and return it with the port the OS
/// assigned.
///
/// ALWAYS `127.0.0.1:0` — there is no requested port to honour. That is the
/// whole port story (D9): the retired `mcpServer.port` setting was forwarded to
/// `mcp_bridge_start` and ignored, and callers learn the real port from this
/// return value, the `mcp-port` file and the status, never from a setting.
/// Separate from `start_bridge` so the property is testable without an app.
pub(crate) async fn bind_listener() -> Result<(TcpListener, u16), CommandError> {
    let addr = "127.0.0.1:0";
    // Localized, with the STAGE in machine-readable detail (audit 20260907
    // #366). These two reach the Integrations panel through
    // `mcp_bridge_start`, so they were the module's only raw-English strings on
    // an otherwise translated surface; and "Failed to bind" vs "Failed to get
    // local address" were distinguishable only by their prose, which is the
    // matching `CommandError` exists to end (rule 50 §10). The `stage` says
    // which half of the bind failed without anyone reading the message.
    let listener = TcpListener::bind(addr).await.map_err(|e| {
        localized_error!(
            ErrorCode::Io,
            "errors.mcp.bindFailed",
            address = addr,
            detail = e.to_string()
        )
        .with_detail(serde_json::json!({ "stage": "bind", "address": addr }))
    })?;
    let actual_port = listener
        .local_addr()
        .map_err(|e| {
            localized_error!(
                ErrorCode::Io,
                "errors.mcp.localAddrFailed",
                detail = e.to_string()
            )
            .with_detail(serde_json::json!({ "stage": "local_addr", "address": addr }))
        })?
        .port();
    Ok((listener, actual_port))
}
