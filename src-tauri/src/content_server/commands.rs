//! Tauri command surface for the content server (Phase 1 WI-1.4; grill C3).
//!
//! Spawns the bundled Node content-server per workspace, discovers its port via
//! the port-file, mints browser-auth nonces over loopback, and tears down the
//! child on stop. The Node runtime + bundle are resolved from the provisioned
//! app-data dir, with a `VMARK_CONTENT_SERVER_CLI` env override for dev.

use crate::app_paths::app_data_dir;
use crate::command_error::CommandError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, State};

use super::manager::RegisterOutcome;
use super::spawn::{monitor_child, resolve_cli, resolve_node, spawn_server};
use super::ContentServerManager;

#[derive(Serialize)]
pub struct ServerHandle {
    pub url: String,
    pub port: u16,
}

#[derive(Deserialize)]
struct PortFile {
    port: u16,
    token: String,
}

/// Stable per-workspace key (sha256 prefix), matching workspace.rs conventions.
fn workspace_key(root: &str) -> String {
    let digest = Sha256::digest(root.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn port_file_path(app: &AppHandle, root: &str) -> Result<PathBuf, CommandError> {
    let dir = app_data_dir(app)
        .map_err(CommandError::internal)?
        .join("content-server");
    std::fs::create_dir_all(&dir).map_err(|e| CommandError::io(e.to_string()))?;
    Ok(dir.join(format!("{}.port.json", workspace_key(root))))
}

/// Start (or return the existing) content server for a workspace.
#[tauri::command]
pub async fn content_server_start(
    app: AppHandle,
    mgr: State<'_, ContentServerManager>,
    workspace_root: String,
) -> Result<ServerHandle, CommandError> {
    if let Some(existing) = mgr.get(&workspace_root) {
        return Ok(ServerHandle {
            url: format!("http://127.0.0.1:{}", existing.port),
            port: existing.port,
        });
    }

    // A missing Node or CLI is `not-found`: it is absent from the machine and
    // installing it is the fix — not an internal VMark failure.
    let node = resolve_node().map_err(CommandError::not_found)?;
    let cli = resolve_cli(&app).map_err(CommandError::not_found)?;
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
    let mut child = spawn_server(&node, &args, &workspace_root)
        .map_err(|e| CommandError::internal(format!("failed to spawn content server: {e}")))?;

    // Poll the port-file (written after the server binds) up to ~10s.
    let mut port: Option<u16> = None;
    for _ in 0..100 {
        if let Ok(bytes) = std::fs::read(&port_file) {
            if let Ok(pf) = serde_json::from_slice::<PortFile>(&bytes) {
                // Only trust a port file written by THIS child (matching token).
                // A stale file from a prior run could otherwise point us at the
                // wrong loopback port — and leak the bearer token to it.
                if pf.token == token {
                    port = Some(pf.port);
                    break;
                }
            }
        }
        // If the child already exited, reap it + clean up before surfacing.
        if matches!(child.try_wait(), Ok(Some(_))) {
            let _ = child.wait();
            let _ = std::fs::remove_file(&port_file);
            return Err(CommandError::internal(
                "content server exited before reporting a port",
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let Some(port) = port else {
        let _ = child.kill();
        let _ = child.wait();
        // A concurrent start for the same workspace may have won the race — its
        // child wrote the port-file with a different token, which our token
        // check skipped. Return that running server instead of a spurious error.
        if let Some(existing) = mgr.get(&workspace_root) {
            return Ok(ServerHandle {
                url: format!("http://127.0.0.1:{}", existing.port),
                port: existing.port,
            });
        }
        let _ = std::fs::remove_file(&port_file);
        // The poll loop above ran its full ~10s budget without a matching
        // port-file: a timeout, not an internal fault.
        return Err(CommandError::timeout(
            "content server did not report a port in time",
        ));
    };

    // Atomic register; on a lost concurrent-start race or a shutdown that
    // began mid-spawn, the manager kills + reaps the child we spawned (so it
    // is not orphaned) — we only clean up the port-file we own.
    match mgr.register_or_existing(&workspace_root, port, token, child, port_file.clone()) {
        RegisterOutcome::Existing(existing) => {
            let _ = std::fs::remove_file(&port_file);
            return Ok(ServerHandle {
                url: format!("http://127.0.0.1:{}", existing.port),
                port: existing.port,
            });
        }
        RegisterOutcome::ShuttingDown => {
            let _ = std::fs::remove_file(&port_file);
            // The app is going away, so the request is moot rather than wrong.
            return Err(CommandError::cancelled(
                "app is shutting down; not starting a content server",
            ));
        }
        RegisterOutcome::Registered => {}
    }

    // Supervise the freshly-registered child: detect an unexpected exit, log it,
    // and emit `content-server:exited` for the frontend's restart policy.
    if let Some(generation) = mgr.get(&workspace_root).map(|s| s.generation) {
        monitor_child(app.clone(), workspace_root.clone(), generation);
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
) -> Result<(), CommandError> {
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
) -> Result<Option<ServerHandle>, CommandError> {
    Ok(mgr.get(&workspace_root).map(|s| ServerHandle {
        url: format!("http://127.0.0.1:{}", s.port),
        port: s.port,
    }))
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
