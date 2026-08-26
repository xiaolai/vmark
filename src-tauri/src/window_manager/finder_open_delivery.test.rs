//! Tauri-runtime contract tests for system file-open delivery.
//!
//! Every item here is `cfg(not(target_os = "windows"))`. `tauri::test::
//! MockRuntime` does not exist on Windows — Cargo.toml scopes tauri's `test`
//! feature to `cfg(not(target_os = "windows"))` because the mock-runtime test
//! binary dies at startup there with STATUS_ENTRYPOINT_NOT_FOUND — and an
//! ungated caller does not fail at runtime, it fails to COMPILE, on the one
//! target you cannot run locally.
//!
//! This file was protected by accident until #1330: the module it tests was
//! `cfg(macos)`, so the Windows target never saw it. Sharing the delivery path
//! with the Windows/Linux single-instance callback removed that accident, and
//! `scripts/check-cross-target.sh` caught it in about a minute.

#[cfg(not(target_os = "windows"))]
use std::sync::mpsc;
#[cfg(not(target_os = "windows"))]
use std::time::Duration;

#[cfg(not(target_os = "windows"))]
use serde_json::Value;
#[cfg(not(target_os = "windows"))]
use tauri::Listener;

#[cfg(not(target_os = "windows"))]
use super::{focus_and_emit, focus_and_emit_with_fallback};
#[cfg(not(target_os = "windows"))]
use crate::PendingFileOpen;

#[cfg(not(target_os = "windows"))]
fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

#[cfg(not(target_os = "windows"))]
#[test]
fn focus_and_emit_reveals_the_target_and_broadcasts_its_label() {
    let app = mock_app();
    let window =
        tauri::webview::WebviewWindowBuilder::new(&app, "doc-7", tauri::WebviewUrl::default())
            .visible(false)
            .build()
            .expect("build mock document window");
    let (tx, rx) = mpsc::channel();
    app.listen_any("app:open-file", move |event| {
        tx.send(event.payload().to_string()).expect("capture event");
    });

    let failed = focus_and_emit(
        app.handle(),
        "doc-7",
        vec![PendingFileOpen {
            path: "/docs/example.md".into(),
            workspace_root: Some("/docs".into()),
        }],
    );

    assert!(failed.is_empty());
    assert!(window.is_visible().expect("read visibility"));
    // MockRuntime does not retain native focus state after `set_focus`; the
    // real macOS Space activation remains a manual smoke-test boundary.
    let payload: Value = serde_json::from_str(
        &rx.recv_timeout(Duration::from_secs(1))
            .expect("receive Finder event"),
    )
    .expect("parse event payload");
    assert_eq!(payload["path"], "/docs/example.md");
    assert_eq!(payload["workspace_root"], "/docs");
    assert_eq!(payload["target_window_label"], "doc-7");
}

#[cfg(not(target_os = "windows"))]
#[test]
fn focus_and_emit_returns_the_payload_when_the_target_vanished() {
    let app = mock_app();
    let pending = PendingFileOpen {
        path: "/docs/retry.md".into(),
        workspace_root: Some("/docs".into()),
    };

    let failed = focus_and_emit(app.handle(), "doc-gone", vec![pending]);

    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].path, "/docs/retry.md");
    assert_eq!(failed[0].workspace_root.as_deref(), Some("/docs"));
}

#[cfg(not(target_os = "windows"))]
#[test]
fn vanished_target_retries_delivery_to_a_ready_fallback_window() {
    let app = mock_app();
    let main =
        tauri::webview::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .visible(false)
            .build()
            .expect("build fallback main window");
    let (tx, rx) = mpsc::channel();
    app.listen_any("app:open-file", move |event| {
        tx.send(event.payload().to_string()).expect("capture event");
    });

    let failed = focus_and_emit_with_fallback(
        app.handle(),
        "doc-vanished",
        vec![PendingFileOpen {
            path: "/docs/retry.md".into(),
            workspace_root: Some("/docs".into()),
        }],
        || Some("main".to_string()),
    );

    assert!(failed.is_empty());
    assert!(main.is_visible().expect("read fallback visibility"));
    let payload: Value = serde_json::from_str(
        &rx.recv_timeout(Duration::from_secs(1))
            .expect("receive fallback Finder event"),
    )
    .expect("parse fallback event payload");
    assert_eq!(payload["path"], "/docs/retry.md");
    assert_eq!(payload["target_window_label"], "main");
}
