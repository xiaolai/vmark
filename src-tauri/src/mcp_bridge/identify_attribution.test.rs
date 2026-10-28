// WI-AL1.1 — identity reaches the request envelope: the identify frame as the sidecar sends it (name, version, pid, parentProcess, sessionLabel) sets the session label every later McpRequestEvent carries, for the anonymous, unrecognized, ambiguous and provider principals alike
//! Tests mounted from `identify.rs`: `handle_identify` → stored identity →
//! `register_attributed` → serialized `McpRequestEvent`, the path a session
//! label takes from the sidecar to the webview. Mock runtime, so not on
//! Windows (`tauri::test` does not exist there).

use super::*;
use crate::mcp_bridge::attribution::register_attributed;
use crate::mcp_bridge::managed::McpBridgeState;
use crate::mcp_bridge::principal::BridgePrincipal;
use crate::mcp_bridge::state::ClientConnection;
use crate::mcp_bridge::types::{McpRequestEvent, McpResponse};
use serde_json::{json, Value};

type Handle = tauri::AppHandle<tauri::test::MockRuntime>;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(McpBridgeState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// Connect client 1 under `principal`; the receiver is returned so a refusal
/// reply has somewhere to go.
async fn connect(
    handle: &Handle,
    principal: BridgePrincipal,
) -> tokio::sync::mpsc::Receiver<String> {
    let (tx, rx) = tokio::sync::mpsc::channel(4);
    bridge(handle).lock().await.clients.insert(
        1,
        ClientConnection {
            tx,
            shutdown: None,
            identity: None,
            principal,
            connection_id: uuid::Uuid::from_u128(0xa1_1100),
        },
    );
    rx
}

/// The identify payload exactly as `server/mcp` builds it: the guessed
/// identity plus `sessionLabel` when one is configured.
fn sidecar_identify(label: Option<&str>) -> Value {
    let mut payload = json!({
        "name": "claude-code",
        "version": "2.1",
        "pid": 4242,
        "parentProcess": "claude",
    });
    if let Some(label) = label {
        payload["sessionLabel"] = json!(label);
    }
    payload
}

/// The serialized event the webview would receive for client 1's next request.
async fn next_event(handle: &Handle) -> Value {
    let (tx, _rx) = tokio::sync::oneshot::channel::<McpResponse>();
    let mut guard = bridge(handle).lock().await;
    let attribution =
        register_attributed(&mut guard, 1, "bridge-1".into(), tx).expect("client is connected");
    serde_json::to_value(McpRequestEvent {
        id: "bridge-1".into(),
        request_type: "vmark.document.write".into(),
        args_json: "{}".into(),
        attribution,
    })
    .expect("serialize event")
}

fn principals() -> [(&'static str, BridgePrincipal); 4] {
    [
        ("anonymous", BridgePrincipal::Anonymous),
        ("unrecognized", BridgePrincipal::Unrecognized),
        (
            "ambiguous",
            BridgePrincipal::Ambiguous(vec!["claude".into(), "codex".into()]),
        ),
        ("provider", BridgePrincipal::Provider("claude".into())),
    ]
}

#[tokio::test]
async fn the_sidecars_session_label_reaches_the_request_envelope_under_every_principal() {
    // 128 UTF-8 bytes: the boundary, counted in bytes as the sidecar counts.
    let label = format!("{}ab", "审".repeat(42));
    for (kind, principal) in principals() {
        let app = mock_app();
        let handle = app.handle().clone();
        let _rx = connect(&handle, principal).await;
        handle_identify("identify", sidecar_identify(Some(&label)), 1, &handle).await;

        let event = next_event(&handle).await;
        let a = &event["attribution"];
        assert_eq!(
            a["principal"]["kind"], kind,
            "{kind}: principal kept distinct"
        );
        assert_eq!(a["sessionLabel"], json!(label), "{kind}: label verbatim");
        assert_eq!(a["displayName"], "claude-code v2.1", "{kind}");
        assert_eq!(
            a["connectionId"], "00000000-0000-0000-0000-000000a11100",
            "{kind}"
        );
    }
}

#[tokio::test]
async fn a_sidecar_without_a_label_sends_requests_with_a_null_label_not_a_default() {
    for (kind, principal) in principals() {
        let app = mock_app();
        let handle = app.handle().clone();
        let _rx = connect(&handle, principal).await;
        handle_identify("identify", sidecar_identify(None), 1, &handle).await;

        let event = next_event(&handle).await;
        assert_eq!(event["attribution"]["sessionLabel"], Value::Null, "{kind}");
        assert_eq!(event["attribution"]["principal"]["kind"], kind);
    }
}

#[tokio::test]
async fn a_refused_label_never_reaches_a_request_and_the_principal_is_unaffected() {
    for (kind, principal) in principals() {
        let app = mock_app();
        let handle = app.handle().clone();
        let mut rx = connect(&handle, principal).await;
        // 129 bytes: one over. Refused whole, so the identify stores nothing.
        handle_identify(
            "identify",
            sidecar_identify(Some(&"审".repeat(43))),
            1,
            &handle,
        )
        .await;
        assert!(rx
            .try_recv()
            .expect("refusal answered")
            .contains("SESSION_LABEL_TOO_LONG:"));

        let event = next_event(&handle).await;
        assert_eq!(
            event["attribution"]["sessionLabel"],
            Value::Null,
            "{kind}: never truncated in"
        );
        assert_eq!(event["attribution"]["displayName"], Value::Null, "{kind}");
        assert_eq!(event["attribution"]["principal"]["kind"], kind);
    }
}
