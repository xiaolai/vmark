// WI-AL0.3 — identify carries an optional sessionLabel; an over-limit or control-bearing one refuses the whole identify with a structured error reply
//! #375 — identify is informational, and it says so out loud: a payload that
//! does not parse is logged, the stored label is bounded and control-free, and
//! `clients-changed` fires only when the stored identity actually changed.

use super::*;
use crate::mcp_bridge::types::ClientIdentity;

fn identity(name: &str, version: Option<&str>) -> ClientIdentity {
    ClientIdentity {
        name: name.to_string(),
        version: version.map(str::to_string),
        session_label: None,
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
    let huge = "n".repeat(crate::peer_text::MAX_PEER_TEXT * 3);
    let kept = sanitize(identity(&huge, Some(&huge))).expect("a usable name");
    // Bounded, and visibly bounded, so a truncated name cannot read as whole.
    assert!(kept.name.chars().count() <= crate::peer_text::MAX_PEER_TEXT + 1);
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
                connection_id: uuid::Uuid::from_u128(u128::from(client_id)),
            },
        );
    }

    #[tokio::test]
    async fn an_identify_for_a_client_that_is_not_connected_changes_nothing_and_emits_nothing() {
        let app = mock_app();
        let handle = app.handle().clone();
        let seen = watch(&handle);
        handle_identify(
            "identify",
            serde_json::json!({ "name": "ghost" }),
            404,
            &handle,
        )
        .await;
        assert_eq!(seen.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_repeated_identical_identify_does_not_re_announce_the_client_list() {
        let app = mock_app();
        let handle = app.handle().clone();
        connect(&handle, 1).await;
        let seen = watch(&handle);

        let payload = serde_json::json!({ "name": "claude-code", "version": "1.2" });
        handle_identify("identify", payload.clone(), 1, &handle).await;
        assert_eq!(seen.load(Ordering::SeqCst), 1, "the first one is a change");
        handle_identify("identify", payload, 1, &handle).await;
        assert_eq!(
            seen.load(Ordering::SeqCst),
            1,
            "a client may re-identify as often as it likes; the frontend re-reads the whole list on each event"
        );

        handle_identify(
            "identify",
            serde_json::json!({ "name": "codex-cli" }),
            1,
            &handle,
        )
        .await;
        assert_eq!(seen.load(Ordering::SeqCst), 2, "a real change is announced");
    }

    #[tokio::test]
    async fn a_payload_that_does_not_parse_is_dropped_without_touching_the_client() {
        let app = mock_app();
        let handle = app.handle().clone();
        connect(&handle, 1).await;
        let seen = watch(&handle);

        handle_identify(
            "identify",
            serde_json::json!({ "version": "1.0" }),
            1,
            &handle,
        )
        .await;
        handle_identify("identify", serde_json::json!("not an object"), 1, &handle).await;
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

    /// Connect a client whose outbound frames the test can read.
    async fn connect_reading(
        app: &tauri::AppHandle<tauri::test::MockRuntime>,
        client_id: u64,
    ) -> tokio::sync::mpsc::Receiver<String> {
        let (tx, rx) = tokio::sync::mpsc::channel(4);
        bridge(app).lock().await.clients.insert(
            client_id,
            ClientConnection {
                tx,
                shutdown: None,
                identity: None,
                principal: BridgePrincipal::Anonymous,
                connection_id: uuid::Uuid::from_u128(u128::from(client_id)),
            },
        );
        rx
    }

    #[tokio::test]
    async fn a_session_label_is_stored_beside_the_name_and_a_label_change_is_a_change() {
        let app = mock_app();
        let handle = app.handle().clone();
        let _rx = connect_reading(&handle, 1).await;
        let seen = watch(&handle);

        handle_identify(
            "identify",
            serde_json::json!({ "name": "claude-code", "sessionLabel": "审阅 pass" }),
            1,
            &handle,
        )
        .await;
        let first = bridge(&handle).lock().await.clients[&1].identity.clone();
        assert_eq!(
            first.as_ref().and_then(|i| i.session_label.as_deref()),
            Some("审阅 pass")
        );
        assert_eq!(first.as_ref().map(|i| i.name.as_str()), Some("claude-code"));

        handle_identify(
            "identify",
            serde_json::json!({ "name": "claude-code", "sessionLabel": "second pass" }),
            1,
            &handle,
        )
        .await;
        assert_eq!(
            seen.load(Ordering::SeqCst),
            2,
            "a label-only change is still a change"
        );
    }

    #[tokio::test]
    async fn an_over_limit_session_label_refuses_the_whole_identify_with_a_structured_reply() {
        let app = mock_app();
        let handle = app.handle().clone();
        let mut rx = connect_reading(&handle, 1).await;
        handle_identify(
            "identify",
            serde_json::json!({ "name": "claude-code", "sessionLabel": "first" }),
            1,
            &handle,
        )
        .await;
        let seen = watch(&handle);

        // 43 CJK characters: 129 UTF-8 bytes, one over.
        let over = "审".repeat(43);
        handle_identify(
            "identify-2",
            serde_json::json!({ "name": "codex-cli", "sessionLabel": over }),
            1,
            &handle,
        )
        .await;

        let raw = rx.try_recv().expect("the refusal is answered, not silent");
        let reply: serde_json::Value = serde_json::from_str(&raw).expect("json");
        assert_eq!(reply["id"], "identify-2");
        assert_eq!(reply["type"], "response");
        assert_eq!(reply["payload"]["success"], false);
        assert!(reply["payload"]["error"]
            .as_str()
            .expect("error text")
            .starts_with("SESSION_LABEL_TOO_LONG:"));

        let kept = bridge(&handle).lock().await.clients[&1]
            .identity
            .clone()
            .expect("kept");
        assert_eq!(
            kept.name, "claude-code",
            "nothing of the refused identify is applied"
        );
        assert_eq!(
            kept.session_label.as_deref(),
            Some("first"),
            "never truncated into place"
        );
        assert_eq!(seen.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_session_label_with_a_newline_is_refused_not_stripped() {
        let app = mock_app();
        let handle = app.handle().clone();
        let mut rx = connect_reading(&handle, 1).await;
        handle_identify(
            "identify",
            serde_json::json!({ "name": "claude-code", "sessionLabel": "a\nb" }),
            1,
            &handle,
        )
        .await;
        let raw = rx.try_recv().expect("answered");
        assert!(raw.contains("SESSION_LABEL_INVALID:"), "{raw}");
        assert!(bridge(&handle).lock().await.clients[&1].identity.is_none());
    }
}
