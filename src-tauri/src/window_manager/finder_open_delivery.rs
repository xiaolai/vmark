//! Delivery of macOS Finder hot-open events to one document window.
//!
//! Rust broadcasts the event because the frontend listens through Tauri's
//! global event API. The payload carries the selected window label so every
//! other document window can reject the broadcast.

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::{file_open::FILE_OPEN_STATE, PendingFileOpen};

use super::create_main_window;

#[derive(Clone, Serialize)]
struct TargetedFileOpen {
    path: String,
    workspace_root: Option<String>,
    target_window_label: String,
}

fn live_target_excluding<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    excluded: Option<&str>,
) -> Option<String> {
    let live_labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| excluded != Some(label.as_str()))
        .cloned()
        .collect();
    let state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
    state.finder_window_target(&live_labels)
}

fn live_target<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    live_target_excluding(app, None)
}

fn queue_for_new_main(app: &tauri::AppHandle, payloads: Vec<PendingFileOpen>) {
    {
        let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
        state.frontend_ready = false;
        state.pending.extend(payloads);
    }
    if app.get_webview_window("main").is_none() {
        if let Err(error) = create_main_window(app, None) {
            log::error!(
                "[Finder] Failed to create main window for re-queued opens: {}",
                error
            );
        }
    }
}

fn focus_and_emit<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    target_label: &str,
    payloads: Vec<PendingFileOpen>,
) -> Vec<PendingFileOpen> {
    let Some(window) = app.get_webview_window(target_label) else {
        return payloads;
    };

    // `set_focus` is Tauri's native bring-to-front operation. Showing and
    // unminimizing first also covers hidden/minimized windows before focus.
    if let Err(error) = window.show() {
        log::warn!(
            "[Finder] Failed to show window '{}': {}",
            target_label,
            error
        );
    }
    if let Err(error) = window.unminimize() {
        log::warn!(
            "[Finder] Failed to unminimize window '{}': {}",
            target_label,
            error
        );
    }
    if let Err(error) = window.set_focus() {
        log::warn!(
            "[Finder] Failed to focus window '{}': {}",
            target_label,
            error
        );
    }

    log::info!("[Finder] Emitting to window '{}'", target_label);
    let mut failed = Vec::new();
    for payload in payloads {
        let event = TargetedFileOpen {
            path: payload.path.clone(),
            workspace_root: payload.workspace_root.clone(),
            target_window_label: target_label.to_string(),
        };
        if let Err(error) = app.emit("app:open-file", event) {
            log::warn!("[Finder] emit failed, queueing: {error}");
            failed.push(payload);
        }
    }
    failed
}

/// Retry once against a freshly selected fallback if the chosen window
/// vanished between selection and native delivery.
fn focus_and_emit_with_fallback<R, F>(
    app: &tauri::AppHandle<R>,
    target_label: &str,
    payloads: Vec<PendingFileOpen>,
    fallback_target: F,
) -> Vec<PendingFileOpen>
where
    R: tauri::Runtime,
    F: FnOnce() -> Option<String>,
{
    let failed = focus_and_emit(app, target_label, payloads);
    if failed.is_empty() {
        return failed;
    }

    let Some(fallback_label) = fallback_target() else {
        return failed;
    };
    if fallback_label == target_label {
        return failed;
    }

    log::info!(
        "[Finder] retrying delivery after '{}' vanished using '{}'",
        target_label,
        fallback_label
    );
    focus_and_emit(app, &fallback_label, failed)
}

/// Reveal the selected native window and broadcast target-tagged open events.
/// Re-check the ready-window set at delivery time. If no listener-ready
/// document window remains, return the payloads to the cold-start queue.
pub(crate) fn emit_finder_opens_to_window(app: &tauri::AppHandle, payloads: Vec<PendingFileOpen>) {
    let Some(target_label) = live_target(app) else {
        log::info!("[Finder] no ready target window before emit — re-queueing");
        queue_for_new_main(app, payloads);
        return;
    };
    let failed = focus_and_emit_with_fallback(app, &target_label, payloads, || {
        live_target_excluding(app, Some(&target_label))
    });

    if !failed.is_empty() {
        log::info!("[Finder] target vanished or emit failed — re-queueing");
        queue_for_new_main(app, failed);
    }
}

#[cfg(test)]
#[path = "finder_open_delivery.test.rs"]
mod tests;
