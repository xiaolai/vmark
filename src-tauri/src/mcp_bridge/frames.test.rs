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
