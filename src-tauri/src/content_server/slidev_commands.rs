//! Slidev Tauri commands (split from `commands.rs` to stay under the file-size
//! limit). Preview returns a browser auth URL landing on the proxied `/slidev/`
//! deck; export shells out to `slidev export` via the content server.

use reqwest::Client;
use serde::Deserialize;
use tauri::State;

use super::slidev::SlidevExportFormat;
use super::ContentServerManager;

/// Start a Slidev preview for a deck and return a browser URL that authenticates
/// (sets the cookie) and lands on the proxied `/slidev/` deck.
#[tauri::command]
pub async fn content_server_slidev_preview(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
    deck_path: String,
) -> Result<String, String> {
    let server = mgr
        .get(&workspace_root)
        .ok_or_else(|| "content server not running".to_string())?;
    let token = mgr
        .token(&workspace_root)
        .ok_or_else(|| "missing bootstrap token".to_string())?;
    let base = format!("http://127.0.0.1:{}", server.port);
    let client = Client::new();

    // 1. Start the Slidev server for the deck (Bearer-authed control call).
    let resp = client
        .post(format!("{base}/api/slidev/preview"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "deck": deck_path }))
        .send()
        .await
        .map_err(|e| format!("slidev preview request failed: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("slidev preview failed: {body}"));
    }

    // 2. Mint a nonce and return a browser auth URL that redirects to /slidev/.
    #[derive(Deserialize)]
    struct Mint {
        nonce: String,
    }
    let mint: Mint = client
        .get(format!("{base}/__mint"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("mint request failed: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!("{base}/__auth?t={}&next=/slidev/", mint.nonce))
}

/// Export a Slidev deck via the content server (which shells out to `slidev export`).
#[tauri::command]
pub async fn content_server_slidev_export(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
    deck_path: String,
    format: SlidevExportFormat,
    output_path: String,
) -> Result<String, String> {
    let server = mgr
        .get(&workspace_root)
        .ok_or_else(|| "content server not running".to_string())?;
    let token = mgr
        .token(&workspace_root)
        .ok_or_else(|| "missing bootstrap token".to_string())?;
    let base = format!("http://127.0.0.1:{}", server.port);
    let client = Client::new();
    let resp = client
        .post(format!("{base}/api/slidev/export"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({
            "deck": deck_path,
            "format": format.as_flag(),
            "output": output_path,
        }))
        .send()
        .await
        .map_err(|e| format!("slidev export request failed: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("slidev export failed: {body}"));
    }
    Ok(output_path)
}
