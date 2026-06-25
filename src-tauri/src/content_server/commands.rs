//! Tauri command surface for the content server (Phase 1 WI-1.4; grill C3).
//!
//! Spawns the bundled Node content-server per workspace, discovers its port via
//! the port-file, mints browser-auth nonces over loopback, and tears down the
//! child on stop. The Node runtime + bundle are resolved from the provisioned
//! app-data dir, with a `VMARK_CONTENT_SERVER_CLI` env override for dev.

use crate::ai_provider::{build_command, login_shell_path, which_command};
use crate::app_paths::app_data_dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, State};

use super::ContentServerManager;

#[derive(Serialize)]
pub struct ServerHandle {
    pub url: String,
    pub port: u16,
}

#[derive(Deserialize)]
struct PortFile {
    port: u16,
    #[allow(dead_code)]
    token: String,
}

/// Stable per-workspace key (sha256 prefix), matching workspace.rs conventions.
fn workspace_key(root: &str) -> String {
    let digest = Sha256::digest(root.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// Resolve the `node` executable absolute path via the login-shell PATH.
fn resolve_node() -> Result<String, String> {
    let out = which_command()
        .arg("node")
        .env("PATH", login_shell_path())
        .output()
        .map_err(|e| format!("failed to locate node: {e}"))?;
    if !out.status.success() {
        return Err("node not found on PATH".into());
    }
    let path = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if path.is_empty() {
        return Err("node not found on PATH".into());
    }
    Ok(path)
}

/// Resolve the content-server `cli.js`: dev override, else provisioned bundle.
fn resolve_cli(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dev) = std::env::var("VMARK_CONTENT_SERVER_CLI") {
        return Ok(PathBuf::from(dev));
    }
    let dir = app_data_dir(app)?;
    let cli = dir.join("content-server").join("base-kb").join("dist").join("cli.js");
    if cli.exists() {
        Ok(cli)
    } else {
        Err("content-server runtime not provisioned".into())
    }
}

fn port_file_path(app: &AppHandle, root: &str) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("content-server");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{}.port.json", workspace_key(root))))
}

/// Start (or return the existing) content server for a workspace.
#[tauri::command]
pub async fn content_server_start(
    app: AppHandle,
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<ServerHandle, String> {
    if let Some(existing) = mgr.get(&workspace_root) {
        return Ok(ServerHandle {
            url: format!("http://127.0.0.1:{}", existing.port),
            port: existing.port,
        });
    }

    let node = resolve_node()?;
    let cli = resolve_cli(&app)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let port_file = port_file_path(&app, &workspace_root)?;
    let _ = std::fs::remove_file(&port_file);

    let cli_str = cli.to_string_lossy().to_string();
    let pf_str = port_file.to_string_lossy().to_string();
    let args = [
        cli_str.as_str(),
        "--root",
        workspace_root.as_str(),
        "--token",
        token.as_str(),
        "--port-file",
        pf_str.as_str(),
    ];
    let mut child = build_command(&node, &args)
        .env("PATH", login_shell_path())
        .spawn()
        .map_err(|e| format!("failed to spawn content server: {e}"))?;

    // Poll the port-file (written after the server binds) up to ~10s.
    let mut port: Option<u16> = None;
    for _ in 0..100 {
        if let Ok(bytes) = std::fs::read(&port_file) {
            if let Ok(pf) = serde_json::from_slice::<PortFile>(&bytes) {
                port = Some(pf.port);
                break;
            }
        }
        // If the child already exited, reap it + clean up before surfacing.
        if matches!(child.try_wait(), Ok(Some(_))) {
            let _ = child.wait();
            let _ = std::fs::remove_file(&port_file);
            return Err("content server exited before reporting a port".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let Some(port) = port else {
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&port_file);
        return Err("content server did not report a port in time".into());
    };

    // Atomic register; if a concurrent start already won, the manager kills the
    // child we spawned (so it is not orphaned) and returns the existing server.
    if let Some(existing) =
        mgr.register_or_existing(&workspace_root, port, token, child, port_file.clone())
    {
        let _ = std::fs::remove_file(&port_file);
        return Ok(ServerHandle {
            url: format!("http://127.0.0.1:{}", existing.port),
            port: existing.port,
        });
    }
    Ok(ServerHandle {
        url: format!("http://127.0.0.1:{port}"),
        port,
    })
}

/// Stop a workspace's content server and clean up its port-file.
#[tauri::command]
pub async fn content_server_stop(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<(), String> {
    if let Some((child, port_file)) = mgr.take(&workspace_root) {
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(pf) = port_file {
            let _ = std::fs::remove_file(pf);
        }
    }
    Ok(())
}

/// Current server handle for a workspace, or null if not running.
#[tauri::command]
pub async fn content_server_status(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<Option<ServerHandle>, String> {
    Ok(mgr.get(&workspace_root).map(|s| ServerHandle {
        url: format!("http://127.0.0.1:{}", s.port),
        port: s.port,
    }))
}

/// Mint a single-use nonce over loopback and return a ready `/__auth?t=` URL so
/// the browser/webview receives the session cookie (grill VULN-001 / ADR-9).
#[tauri::command]
pub async fn content_server_browser_url(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<String, String> {
    let server = mgr
        .get(&workspace_root)
        .ok_or_else(|| "content server not running".to_string())?;
    let token = mgr
        .token(&workspace_root)
        .ok_or_else(|| "missing bootstrap token".to_string())?;
    let base = format!("http://127.0.0.1:{}", server.port);

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/__mint"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("mint request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("mint rejected: {}", resp.status()));
    }
    #[derive(Deserialize)]
    struct Mint {
        nonce: String,
    }
    let mint: Mint = resp.json().await.map_err(|e| e.to_string())?;
    Ok(format!("{base}/__auth?t={}", mint.nonce))
}

/// Fetch the relationship graph JSON for the in-app native graph view (grill
/// H5). Fetched Rust-side (loopback, no CORS) using a one-time session token
/// extracted from the `/__auth` redirect's `?s=`.
#[tauri::command]
pub async fn content_server_graph(
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<String, String> {
    let server = mgr
        .get(&workspace_root)
        .ok_or_else(|| "content server not running".to_string())?;
    let token = mgr
        .token(&workspace_root)
        .ok_or_else(|| "missing bootstrap token".to_string())?;
    let base = format!("http://127.0.0.1:{}", server.port);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    #[derive(Deserialize)]
    struct Mint {
        nonce: String,
    }
    let mint: Mint = client
        .get(format!("{base}/__mint"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("mint failed: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let auth = client
        .get(format!("{base}/__auth?t={}", mint.nonce))
        .send()
        .await
        .map_err(|e| format!("auth failed: {e}"))?;
    let loc = auth
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "no auth redirect".to_string())?;
    let session = loc
        .split("s=")
        .nth(1)
        .ok_or_else(|| "no session token".to_string())?
        .to_string();

    client
        .get(format!("{base}/api/graph?s={session}"))
        .send()
        .await
        .map_err(|e| format!("graph fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_key_is_stable_and_hex() {
        let k1 = workspace_key("/ws/a");
        let k2 = workspace_key("/ws/a");
        let k3 = workspace_key("/ws/b");
        assert_eq!(k1, k2);
        assert_ne!(k1, k3);
        assert_eq!(k1.len(), 16);
        assert!(k1.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
