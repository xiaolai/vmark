//! Loopback HTTP against a running content server (WI-DP2.6 split).
//!
//! Purpose: the two commands that TALK to the server over 127.0.0.1 rather than
//! managing its lifecycle — minting a single-use nonce for the webview's
//! `/__auth` handshake (grill VULN-001 / ADR-9) and fetching the relationship
//! graph for the native graph view (grill H5).
//!
//! Split out of `commands.rs` at the file-size gate. The seam is real: this
//! half needs a `reqwest` client, a bearer token and a session handshake;
//! `commands.rs` needs a child process and a port-file.
//!
//! @coordinates-with content_server/commands.rs — lifecycle (start/stop/status)
//! @coordinates-with content_server/manager.rs — `ContentServerManager` state

use serde::Deserialize;
use tauri::State;

use crate::command_error::CommandError;

use super::ContentServerManager;

/// The loopback base URL and bootstrap token for a running server, or a typed
/// refusal. Shared by both commands that talk to the server over HTTP.
fn loopback(
    mgr: &State<'_, ContentServerManager>,
    workspace_root: &str,
) -> Result<(String, String), CommandError> {
    let server = mgr
        .get(workspace_root)
        .ok_or_else(|| CommandError::not_found("content server not running"))?;
    let token = mgr
        .token(workspace_root)
        .ok_or_else(|| CommandError::internal("missing bootstrap token"))?;
    Ok((format!("http://127.0.0.1:{}", server.port), token))
}

#[derive(Deserialize)]
struct Mint {
    nonce: String,
}

/// Mint a single-use nonce over loopback. Both HTTP commands need one, and the
/// two hand-written copies had already drifted: one checked the response status
/// before parsing and the other did not.
async fn mint_nonce(
    client: &reqwest::Client,
    base: &str,
    token: &str,
) -> Result<String, CommandError> {
    let resp = client
        .get(format!("{base}/__mint"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| CommandError::network(format!("mint request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(CommandError::internal(format!(
            "mint rejected: {}",
            resp.status()
        )));
    }
    let mint: Mint = resp
        .json()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;
    Ok(mint.nonce)
}

/// Mint a single-use nonce over loopback and return a ready `/__auth?t=` URL so
/// the browser/webview receives the session cookie (grill VULN-001 / ADR-9).
#[tauri::command]
pub async fn content_server_browser_url(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<String, CommandError> {
    let (base, token) = loopback(&mgr, &workspace_root)?;
    let nonce = mint_nonce(&reqwest::Client::new(), &base, &token).await?;
    Ok(format!("{base}/__auth?t={nonce}"))
}

/// Fetch the relationship graph JSON for the in-app native graph view (grill
/// H5). Fetched Rust-side (loopback, no CORS) using a one-time session token
/// extracted from the `/__auth` redirect's `?s=`.
#[tauri::command]
pub async fn content_server_graph(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<String, CommandError> {
    let (base, token) = loopback(&mgr, &workspace_root)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| CommandError::internal(e.to_string()))?;

    // Shared with `content_server_browser_url`. This path previously parsed the
    // mint response WITHOUT checking its status, so a non-2xx mint surfaced as
    // an opaque JSON error; the helper checks it.
    let nonce = mint_nonce(&client, &base, &token).await?;

    let auth = client
        .get(format!("{base}/__auth?t={nonce}"))
        .send()
        .await
        .map_err(|e| CommandError::network(format!("auth failed: {e}")))?;
    let loc = auth
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| CommandError::internal("no auth redirect"))?;
    let session = loc
        .split("s=")
        .nth(1)
        .ok_or_else(|| CommandError::internal("no session token"))?
        .to_string();

    let resp = client
        .get(format!("{base}/api/graph?s={session}"))
        .send()
        .await
        .map_err(|e| CommandError::network(format!("graph fetch failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(CommandError::internal(format!(
            "graph fetch rejected: {}",
            resp.status()
        )));
    }
    resp.text()
        .await
        .map_err(|e| CommandError::network(e.to_string()))
}
