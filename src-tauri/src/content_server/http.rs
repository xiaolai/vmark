//! Loopback HTTP against a running content server (WI-DP2.6 split).
//!
//! Purpose: the two commands that TALK to the server over 127.0.0.1 rather than
//! managing its lifecycle — minting a single-use nonce for the webview's
//! `/__auth` handshake (grill VULN-001 / ADR-9) and fetching the relationship
//! graph for the native graph view (grill H5).
//!
//! Split out of `commands.rs` at the file-size gate. The seam is real: this
//! half needs a bounded `reqwest` client, a bearer token and a session
//! handshake — the `client::ServerClient` it shares with `slidev_commands.rs`
//! (#129) — where `commands.rs` needs a child process and a port-file.
//!
//! @coordinates-with content_server/client.rs — the authenticated loopback client
//! @coordinates-with content_server/commands.rs — lifecycle (start/stop/status)
//! @coordinates-with content_server/manager.rs — `ContentServerManager` state

use std::time::Duration;

use tauri::State;

use crate::command_error::CommandError;

use super::client::{body_failure, error_body, refusal, ServerClient};
use super::ContentServerManager;
use reqwest::StatusCode;

/// Every call here is answered from memory over loopback — a nonce, the
/// precomputed index — so a longer wait is a wedged server (#130). It bounds
/// the WHOLE conversation, not each request (#310): `graph_over` makes three.
const LOOPBACK_TIMEOUT: Duration = Duration::from_secs(30);

/// Mint a single-use nonce over loopback and return a ready `/__auth?t=` URL so
/// the browser/webview receives the session cookie (grill VULN-001 / ADR-9).
#[tauri::command]
pub async fn content_server_browser_url(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<String, CommandError> {
    let client = ServerClient::connect(&mgr, &workspace_root, LOOPBACK_TIMEOUT)?;
    let nonce = client.mint_nonce().await?;
    Ok(client.auth_url(&nonce, None))
}

/// Fetch the relationship graph JSON for the in-app native graph view (grill
/// H5). Fetched Rust-side (loopback, no CORS) using a one-time session token
/// extracted from the `/__auth` redirect's `?s=`.
#[tauri::command]
pub async fn content_server_graph(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<String, CommandError> {
    let client = ServerClient::connect(&mgr, &workspace_root, LOOPBACK_TIMEOUT)?;
    graph_over(&client).await
}

/// The status `/__auth` answers with when it accepted the nonce. The status is
/// CHECKED before `Location` is read (#285): an error response — a 403 for a
/// spent nonce, a proxy's 502 — can carry a `Location` header of its own, and
/// reading it treated that header as a session token and the refusal as a
/// successful handshake. A wrong status is reported as the refusal it is.
const AUTH_REDIRECT: StatusCode = StatusCode::FOUND;

/// The whole handshake over an explicit client, so `http.test.rs` can drive
/// it against a mock server rather than only in production (#284).
pub(super) async fn graph_over(client: &ServerClient) -> Result<String, CommandError> {
    let nonce = client.mint_nonce().await?;

    // `/__auth` answers with a redirect whose `Location` carries the session;
    // the client does not follow it, so the 302 is the response read here.
    let auth = client
        .send(
            "auth",
            client.get_anonymous(&client.auth_path(&nonce, None)),
        )
        .await?;
    let status = auth.status();
    if status != AUTH_REDIRECT {
        let body = error_body(auth).await;
        return Err(refusal("auth", status, &body));
    }
    let location = auth
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| CommandError::internal("no auth redirect"))?;
    let session = session_from_location(location)?.to_string();

    let resp = client
        .send_ok(
            "graph fetch",
            client.get_anonymous(&format!("/api/graph?s={session}")),
        )
        .await?;
    // `body_failure`, not `e.to_string()`: this request's URL carries the live
    // session token in `?s=`, and `reqwest::Error`'s Display appends it (#276).
    resp.text()
        .await
        .map_err(|e| body_failure("graph fetch", e))
}

/// The `s` query parameter of the `/__auth` redirect's `Location`.
///
/// `split("s=").nth(1)` was not query parsing (#287): it matches `s=` anywhere
/// — inside the path, inside a LONGER parameter name such as `next=` or
/// `ts=` — keeps every parameter that follows the token, and accepts an empty
/// value. This splits the query properly and requires a non-empty `s`. The
/// value is taken verbatim and re-emitted verbatim into `/api/graph?s=`, so
/// whatever encoding the server chose round-trips unchanged.
fn session_from_location(location: &str) -> Result<&str, CommandError> {
    let query = location
        .split('#')
        .next()
        .and_then(|without_fragment| without_fragment.split_once('?'))
        .map(|(_, query)| query)
        .unwrap_or("");
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(key, _)| *key == "s")
        .map(|(_, value)| value)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CommandError::internal("no session token"))
}

#[cfg(test)]
#[path = "http.test.rs"]
mod tests;
