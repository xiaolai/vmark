//! Slidev Tauri commands (split from `commands.rs` to stay under the file-size
//! limit). Preview returns a browser auth URL landing on the proxied `/slidev/`
//! deck; export shells out to `slidev export` via the content server.
//!
//! The HTTP half is two plain async functions over a `client::ServerClient`,
//! so `slidev_commands.test.rs` can drive them against a loopback mock server
//! (#132). The client is the one every loopback command shares (#129): BOUNDED
//! (#130 — an accepted connection that never answers used to leave the Tauri
//! command pending forever), built from ONE manager read (#128 — a restart
//! between two reads paired the old port with the new token), and refusing
//! with the status read before the body (#131).
//!
//! Errors are `CommandError` (#127), classed by what failed: no server for
//! the workspace is `not-found`; a request the bounded client gave up on is
//! `timeout` and any other transport failure `network`; a non-2xx answer is
//! `network` carrying the status in `detail`; a mint reply that is not the
//! expected JSON is `internal` (a contract break with VMark's own server).

use crate::command_error::CommandError;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

use super::client::{body_failure, ServerClient};
use super::ContentServerManager;

/// Starting a Slidev dev server installs nothing but does spawn Vite.
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(120);
/// `slidev export` renders every slide through a headless browser.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Slidev export formats — the live half of what used to be `slidev.rs`. The
/// Rust-side `slidev export` argument builder that lived beside it had no
/// caller (the export runs through the Node content server, which shells out
/// itself) and was deleted by WI-FL3.6; the format model is what the command
/// below still deserializes and forwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlidevExportFormat {
    Pdf,
    Png,
    Pptx,
}

impl SlidevExportFormat {
    pub fn as_flag(self) -> &'static str {
        match self {
            SlidevExportFormat::Pdf => "pdf",
            SlidevExportFormat::Png => "png",
            SlidevExportFormat::Pptx => "pptx",
        }
    }
}

/// Start the Slidev server for `deck` (Bearer-authed control call), then mint
/// a nonce and return the browser auth URL that redirects to `/slidev/`.
pub(super) async fn preview_url(client: &ServerClient, deck: &str) -> Result<String, CommandError> {
    client
        .send_ok(
            "slidev preview",
            client.post_json("/api/slidev/preview", &serde_json::json!({ "deck": deck })),
        )
        .await?;
    let nonce = client.mint_nonce().await?;
    Ok(client.auth_url(&nonce, Some("/slidev/")))
}

/// What `/api/slidev/export` answers on success: the destination it actually
/// wrote (`server/content/src/server/createServer.ts` — `{ok, output}`).
#[derive(Deserialize)]
struct ExportDone {
    output: String,
}

/// Ask the content server to export `deck` (it shells out to `slidev export`).
///
/// The path returned is the SERVER'S, not the one asked for (#309). Echoing
/// the request read every 2xx as a successful export to a file nothing had
/// confirmed — including an answer that was not the export contract at all —
/// and named a destination the caller then tried to open. A reply that is not
/// the expected JSON is `internal`, the same class `mint_nonce` reports for a
/// contract break with VMark's own server.
pub(super) async fn export_deck(
    client: &ServerClient,
    deck: &str,
    format: SlidevExportFormat,
    output_path: &str,
) -> Result<String, CommandError> {
    let done: ExportDone = client
        .send_ok(
            "slidev export",
            client.post_json(
                "/api/slidev/export",
                &serde_json::json!({
                    "deck": deck,
                    "format": format.as_flag(),
                    "output": output_path,
                }),
            ),
        )
        .await?
        .json()
        .await
        .map_err(|e| body_failure("slidev export", e))?;
    if done.output.trim().is_empty() {
        return Err(CommandError::internal(
            "slidev export reported no output path",
        ));
    }
    Ok(done.output)
}

/// Start a Slidev preview for a deck and return a browser URL that authenticates
/// (sets the cookie) and lands on the proxied `/slidev/` deck.
#[tauri::command]
pub async fn content_server_slidev_preview(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
    deck_path: String,
) -> Result<String, CommandError> {
    let client = ServerClient::connect(&mgr, &workspace_root, PREVIEW_TIMEOUT)?;
    preview_url(&client, &deck_path).await
}

/// Export a Slidev deck via the content server (which shells out to `slidev export`).
#[tauri::command]
pub async fn content_server_slidev_export(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
    deck_path: String,
    format: SlidevExportFormat,
    output_path: String,
) -> Result<String, CommandError> {
    let client = ServerClient::connect(&mgr, &workspace_root, EXPORT_TIMEOUT)?;
    export_deck(&client, &deck_path, format, &output_path).await
}

#[cfg(test)]
#[path = "slidev_commands.test.rs"]
mod tests;
