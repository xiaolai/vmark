//! WI-9 — the two frames an unauthenticated peer is allowed to receive.
//!
//! Moved here with the frames themselves when `handshake.rs` was split for
//! the file-size gate; the assertions are unchanged.

use super::*;

/// The welcome payload is byte-compatible with the pre-WI-9 wire format: the
/// sidecar ignores `status` frames, but a client that waited for one before
/// sending its token must not be broken by the reordering.
#[test]
fn welcome_frame_keeps_its_historical_shape() {
    let frame = welcome_frame(7);
    assert_eq!(frame.id, "system");
    assert_eq!(frame.msg_type, "status");
    assert_eq!(
        frame.payload,
        serde_json::json!({ "connected": true, "clientId": 7, "authRequired": true })
    );
}

#[test]
fn auth_result_frames_carry_the_expected_verdict() {
    let ok = auth_result_frame(true);
    assert_eq!(ok.msg_type, "auth_result");
    assert_eq!(ok.payload["success"], serde_json::json!(true));

    let bad = auth_result_frame(false);
    assert_eq!(bad.payload["success"], serde_json::json!(false));
    assert_eq!(
        bad.payload["error"],
        serde_json::json!("Authentication failed")
    );
}

// -- announcing the verdict ---------------------------------------------------

/// A sink whose every write fails, as a peer gone between auth and verdict.
fn broken_sink() -> std::pin::Pin<Box<impl Sink<Message, Error = std::io::Error>>> {
    Box::pin(futures_util::sink::unfold((), |(), _: Message| async {
        Err::<(), _>(std::io::Error::other("peer gone"))
    }))
}

fn sent(frames: &[Message]) -> Vec<serde_json::Value> {
    frames
        .iter()
        .map(|m| serde_json::from_str(m.to_text().expect("text")).expect("json"))
        .collect()
}

#[tokio::test]
async fn an_acceptance_that_never_reached_the_peer_registers_no_client() {
    let mut sink = broken_sink();
    let principal = announce_verdict(
        &mut sink,
        AuthOutcome::Accepted(BridgePrincipal::Provider("claude".into())),
        3,
    )
    .await;
    assert_eq!(
        principal, None,
        "a failed accept write must not admit the peer"
    );
}

#[tokio::test]
async fn a_delivered_acceptance_yields_the_principal() {
    let mut frames: Vec<Message> = Vec::new();
    let principal = announce_verdict(
        &mut frames,
        AuthOutcome::Accepted(BridgePrincipal::Provider("审阅".into())),
        4,
    )
    .await;
    assert_eq!(principal, Some(BridgePrincipal::Provider("审阅".into())));
    assert_eq!(
        sent(&frames)[0]["payload"],
        serde_json::json!({ "success": true })
    );
}

#[tokio::test]
async fn a_rejection_or_abort_never_yields_a_principal() {
    let mut frames: Vec<Message> = Vec::new();
    assert_eq!(
        announce_verdict(&mut frames, AuthOutcome::Rejected, 5).await,
        None
    );
    assert_eq!(
        sent(&frames)[0]["payload"]["success"],
        serde_json::json!(false)
    );
    let mut none: Vec<Message> = Vec::new();
    assert_eq!(
        announce_verdict(&mut none, AuthOutcome::Aborted, 6).await,
        None
    );
    assert!(none.is_empty(), "an aborted peer is told nothing");
}
