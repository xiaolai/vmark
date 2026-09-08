//! #375 — identify is informational, and it says so out loud: a payload that
//! does not parse is logged, the stored label is bounded and control-free, and
//! `clients-changed` fires only when the stored identity actually changed.

use super::*;
use crate::mcp_bridge::types::ClientIdentity;

fn identity(name: &str, version: Option<&str>) -> ClientIdentity {
    ClientIdentity {
        name: name.to_string(),
        version: version.map(str::to_string),
    }
}

#[test]
fn a_name_that_is_only_control_characters_names_nothing_and_is_refused() {
    // Storing it would blank the client's row in Settings → Integrations while
    // reporting a successful identify.
    assert!(sanitize(identity("\n\t\u{7}", None)).is_none());
    assert!(sanitize(identity("", Some("1.0"))).is_none());
    assert!(sanitize(identity("   ", None)).is_none());
}

#[test]
fn the_stored_label_loses_its_control_characters_and_keeps_its_text() {
    let kept = sanitize(identity("claude\ncode", Some("0\r.1"))).expect("a usable name");
    assert_eq!(kept.name, "claudecode");
    assert_eq!(kept.version.as_deref(), Some("0.1"));
    assert_eq!(kept.display_name(), "claudecode v0.1");
}

#[test]
fn the_stored_label_is_bounded() {
    let huge = "n".repeat(crate::mcp_bridge::peer_text::MAX_PEER_TEXT * 3);
    let kept = sanitize(identity(&huge, Some(&huge))).expect("a usable name");
    // Bounded, and visibly bounded, so a truncated name cannot read as whole.
    assert!(kept.name.chars().count() <= crate::mcp_bridge::peer_text::MAX_PEER_TEXT + 1);
    assert!(kept.name.ends_with('…'));
    assert!(kept.version.expect("version").ends_with('…'));
}

#[test]
fn a_version_that_sanitizes_to_nothing_is_dropped_rather_than_shown_as_v() {
    let kept = sanitize(identity("codex-cli", Some("\u{7}"))).expect("a usable name");
    assert_eq!(kept.version, None);
    assert_eq!(kept.display_name(), "codex-cli");
}

// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// `test` feature off it); gated like every mock-runtime suite in this crate.
#[cfg(not(target_os = "windows"))]
mod against_a_bridge {
    use super::*;
    use crate::mcp_bridge::managed::McpBridgeState;
    use crate::mcp_bridge::principal::BridgePrincipal;
    use crate::mcp_bridge::state::ClientConnection;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tauri::Listener;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(McpBridgeState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    /// Count `clients-changed` deliveries. Rust listeners run inside the emit,
    /// so a count read after the await is complete.
    fn watch(app: &tauri::AppHandle<tauri::test::MockRuntime>) -> Arc<AtomicUsize> {
        let seen = Arc::new(AtomicUsize::new(0));
        let counter = seen.clone();
        app.listen(CLIENTS_CHANGED, move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        seen
    }

    async fn connect(app: &tauri::AppHandle<tauri::test::MockRuntime>, client_id: u64) {
        let (tx, rx) = tokio::sync::mpsc::channel(4);
        // The receiver is leaked deliberately: a dropped one closes the
        // channel, and these tests never write to it.
        std::mem::forget(rx);
        let mut guard = bridge(app).lock().await;
        guard.clients.insert(
            client_id,
            ClientConnection {
                tx,
                shutdown: None,
                identity: None,
                principal: BridgePrincipal::Anonymous,
            },
        );
    }

    #[tokio::test]
    async fn an_identify_for_a_client_that_is_not_connected_changes_nothing_and_emits_nothing() {
        let app = mock_app();
        let handle = app.handle().clone();
        let seen = watch(&handle);
        handle_identify(serde_json::json!({ "name": "ghost" }), 404, &handle).await;
        assert_eq!(seen.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_repeated_identical_identify_does_not_re_announce_the_client_list() {
        let app = mock_app();
        let handle = app.handle().clone();
        connect(&handle, 1).await;
        let seen = watch(&handle);

        let payload = serde_json::json!({ "name": "claude-code", "version": "1.2" });
        handle_identify(payload.clone(), 1, &handle).await;
        assert_eq!(seen.load(Ordering::SeqCst), 1, "the first one is a change");
        handle_identify(payload, 1, &handle).await;
        assert_eq!(
            seen.load(Ordering::SeqCst),
            1,
            "a client may re-identify as often as it likes; the frontend re-reads the whole list on each event"
        );

        handle_identify(serde_json::json!({ "name": "codex-cli" }), 1, &handle).await;
        assert_eq!(seen.load(Ordering::SeqCst), 2, "a real change is announced");
    }

    #[tokio::test]
    async fn a_payload_that_does_not_parse_is_dropped_without_touching_the_client() {
        let app = mock_app();
        let handle = app.handle().clone();
        connect(&handle, 1).await;
        let seen = watch(&handle);

        handle_identify(serde_json::json!({ "version": "1.0" }), 1, &handle).await;
        handle_identify(serde_json::json!("not an object"), 1, &handle).await;
        assert_eq!(seen.load(Ordering::SeqCst), 0);
        assert!(bridge(&handle)
            .lock()
            .await
            .clients
            .get(&1)
            .expect("still connected")
            .identity
            .is_none());
    }
}
