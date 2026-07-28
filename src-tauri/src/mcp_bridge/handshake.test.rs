//! WI-9 — pre-authentication policy for the MCP bridge WebSocket.
//!
//! The auth handshake shipped with zero tests (only token *generation* was
//! covered). These pin each control from audit 20260728 §2.2 at the unit
//! level; `connection.test.rs` proves the same controls over a real socket.

use super::*;
use futures_util::stream;
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};

// --- helpers ---------------------------------------------------------------

fn headers_with_origin(raw: &[u8]) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(ORIGIN, HeaderValue::from_bytes(raw).expect("header value"));
    headers
}

fn upgrade_request(origin: Option<&[u8]>) -> Request {
    let mut builder = tokio_tungstenite::tungstenite::http::Request::builder().uri("/");
    if let Some(origin) = origin {
        builder = builder.header(ORIGIN, HeaderValue::from_bytes(origin).expect("header"));
    }
    builder.body(()).expect("request")
}

fn upgrade_response() -> Response {
    tokio_tungstenite::tungstenite::http::Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .body(())
        .expect("response")
}

fn text(json: serde_json::Value) -> Result<Message, WsError> {
    Ok(Message::Text(json.to_string().into()))
}

async fn auth_over(frames: Vec<Result<Message, WsError>>, expected: &str) -> AuthOutcome {
    auth_over_with(frames, expected, &configured()).await
}

async fn auth_over_with(
    frames: Vec<Result<Message, WsError>>,
    expected: &str,
    configured: &[ProviderToken],
) -> AuthOutcome {
    let mut source = stream::iter(frames);
    await_auth(&mut source, expected, configured, 1).await
}

/// The credential registry the bridge would have published from the AI
/// clients' own MCP configs.
fn configured() -> Vec<ProviderToken> {
    vec![
        ProviderToken {
            provider: "claude".into(),
            token: "cred-claude".into(),
        },
        ProviderToken {
            provider: "codex".into(),
            token: "cred-codex".into(),
        },
    ]
}

/// An accepted connection that presented no per-client credential.
const ANONYMOUS: AuthOutcome = AuthOutcome::Accepted(BridgePrincipal::Anonymous);

// --- 1. Origin allowlist ---------------------------------------------------

/// THE load-bearing case: the sidecar is a Node process and sends no
/// `Origin`. Inverting this breaks the entire product, so it is pinned first.
#[test]
fn absent_origin_is_allowed() {
    assert!(origin_is_permitted(&HeaderMap::new()));
}

#[test]
fn present_browser_origin_is_rejected() {
    assert!(!origin_is_permitted(&headers_with_origin(
        b"https://evil.example"
    )));
}

/// A sandboxed iframe, `data:` or `file:` document sends the literal string
/// `null`. That is a PRESENT origin, not an absent one.
#[test]
fn null_origin_is_rejected() {
    assert!(!origin_is_permitted(&headers_with_origin(b"null")));
}

/// A page served from localhost is still a browser page. The allowlist is
/// empty on purpose; "it's local" is not a reason to let it in.
#[test]
fn localhost_origin_is_rejected() {
    assert!(!origin_is_permitted(&headers_with_origin(
        b"http://localhost:3000"
    )));
    assert!(!origin_is_permitted(&headers_with_origin(
        b"http://127.0.0.1:5173"
    )));
}

/// Present but not visible-ASCII: we cannot evaluate it, so it fails closed
/// rather than being mistaken for an absent header.
#[test]
fn unreadable_origin_is_rejected() {
    assert!(!origin_is_permitted(&headers_with_origin(&[0xff, 0xfe])));
}

#[test]
fn upgrade_without_origin_is_accepted() {
    assert!(check_upgrade_request(&upgrade_request(None), upgrade_response()).is_ok());
}

#[test]
fn upgrade_from_browser_origin_is_refused_with_403() {
    let rejection = check_upgrade_request(
        &upgrade_request(Some(b"https://attacker.test")),
        upgrade_response(),
    )
    .expect_err("a browser origin must not upgrade");
    assert_eq!(rejection.status(), StatusCode::FORBIDDEN);
    assert_eq!(rejection.body().as_deref(), Some("origin not allowed"));
}

// --- 2. Message-size caps --------------------------------------------------

/// tungstenite defaults are 64 MiB message / 16 MiB frame / 128 KiB read
/// buffer. Assert we are strictly under each — a future dependency bump that
/// silently changed a default must not quietly restore the DoS surface.
#[test]
fn ws_config_tightens_every_inbound_default() {
    let defaults = WebSocketConfig::default();
    let config = ws_config();

    assert_eq!(config.max_message_size, Some(MAX_MESSAGE_BYTES));
    assert_eq!(config.max_frame_size, Some(MAX_FRAME_BYTES));
    assert_eq!(config.read_buffer_size, READ_BUFFER_BYTES);
    assert!(config.max_message_size < defaults.max_message_size);
    assert!(config.max_frame_size < defaults.max_frame_size);
    assert!(config.read_buffer_size < defaults.read_buffer_size);
}

/// Outbound buffering is deliberately untouched: capping it would break large
/// legitimate responses (browser screenshots, whole-document reads).
#[test]
fn ws_config_leaves_outbound_buffering_alone() {
    let defaults = WebSocketConfig::default();
    let config = ws_config();
    assert_eq!(config.write_buffer_size, defaults.write_buffer_size);
    assert_eq!(config.max_write_buffer_size, defaults.max_write_buffer_size);
    assert!(!config.accept_unmasked_frames);
}

// --- 2b. Pre-auth message cap (audit round 1, finding 5) --------------------

// The cap's relationship to the transport caps is asserted at COMPILE time
// next to the constant itself (`const _: () = assert!(..)` in handshake.rs),
// following the `CLIENT_TX_CAPACITY` precedent in `state.rs` — a bound that
// can be checked by the compiler should not wait for a test run.

/// THE test for this control: even a frame carrying the CORRECT token is
/// rejected when it is over the pre-auth cap, so the cap is enforced before
/// the payload is parsed and cannot be bypassed by a peer that happens to
/// hold the secret.
#[tokio::test]
async fn an_oversized_preauth_frame_is_rejected_even_with_a_valid_token() {
    let padding = "x".repeat(MAX_PREAUTH_MESSAGE_BYTES);
    let outcome = auth_over(
        vec![text(serde_json::json!({
            "id": "auth",
            "type": "auth",
            "payload": { "token": "s3cret", "pad": padding },
        }))],
        "s3cret",
    )
    .await;
    assert_eq!(outcome, AuthOutcome::Rejected);
}

/// The complement: a frame that fits the cap is still parsed normally, so the
/// cap does not simply break the handshake.
#[tokio::test]
async fn a_frame_within_the_preauth_cap_still_authenticates() {
    let payload = serde_json::json!({
        "id": "auth",
        "type": "auth",
        "payload": { "token": "s3cret", "pad": "x".repeat(1024) },
    });
    assert!(payload.to_string().len() <= MAX_PREAUTH_MESSAGE_BYTES);
    assert_eq!(auth_over(vec![text(payload)], "s3cret").await, ANONYMOUS);
}

// --- 4. Auth state machine -------------------------------------------------

#[tokio::test]
async fn valid_token_is_accepted() {
    let outcome = auth_over(
        vec![text(
            serde_json::json!({ "id": "auth", "type": "auth", "payload": { "token": "s3cret" } }),
        )],
        "s3cret",
    )
    .await;
    assert_eq!(outcome, ANONYMOUS);
}

#[tokio::test]
async fn wrong_token_is_rejected() {
    let outcome = auth_over(
        vec![text(
            serde_json::json!({ "id": "auth", "type": "auth", "payload": { "token": "nope" } }),
        )],
        "s3cret",
    )
    .await;
    assert_eq!(outcome, AuthOutcome::Rejected);
}

#[tokio::test]
async fn missing_token_field_is_rejected() {
    let outcome = auth_over(
        vec![text(
            serde_json::json!({ "id": "auth", "type": "auth", "payload": {} }),
        )],
        "s3cret",
    )
    .await;
    assert_eq!(outcome, AuthOutcome::Rejected);
}

/// `identify` before `auth` would let an unauthenticated peer claim a
/// principal name. It is rejected, and the socket never reaches the loop that
/// would record it.
#[tokio::test]
async fn identify_before_auth_is_rejected() {
    let outcome = auth_over(
        vec![
            text(
                serde_json::json!({ "id": "identify", "type": "identify", "payload": { "name": "claude-code" } }),
            ),
            text(
                serde_json::json!({ "id": "auth", "type": "auth", "payload": { "token": "s3cret" } }),
            ),
        ],
        "s3cret",
    )
    .await;
    assert_eq!(outcome, AuthOutcome::Rejected);
}

#[tokio::test]
async fn unparseable_first_message_is_rejected() {
    let outcome = auth_over(vec![Ok(Message::Text("not json".into()))], "s3cret").await;
    assert_eq!(outcome, AuthOutcome::Rejected);
}

/// The protocol is JSON text. An unauthenticated peer must not be able to
/// stream binary frames at the server inside the auth window.
#[tokio::test]
async fn binary_frame_before_auth_is_rejected() {
    let outcome = auth_over(vec![Ok(Message::Binary(vec![0u8; 8].into()))], "s3cret").await;
    assert_eq!(outcome, AuthOutcome::Rejected);
}

/// Keep-alives are transport noise, not protocol messages — they are skipped
/// so a ping racing the token does not fail an honest client.
#[tokio::test]
async fn ping_and_pong_do_not_consume_the_auth_slot() {
    let outcome = auth_over(
        vec![
            Ok(Message::Ping(vec![1u8].into())),
            Ok(Message::Pong(vec![1u8].into())),
            text(
                serde_json::json!({ "id": "auth", "type": "auth", "payload": { "token": "s3cret" } }),
            ),
        ],
        "s3cret",
    )
    .await;
    assert_eq!(outcome, ANONYMOUS);
}

#[tokio::test]
async fn close_and_empty_stream_abort_without_a_reply() {
    assert_eq!(
        auth_over(vec![Ok(Message::Close(None))], "s3cret").await,
        AuthOutcome::Aborted
    );
    assert_eq!(auth_over(vec![], "s3cret").await, AuthOutcome::Aborted);
    assert_eq!(
        auth_over(vec![Err(WsError::ConnectionClosed)], "s3cret").await,
        AuthOutcome::Aborted
    );
}

// --- 5. The per-client credential and the principal it fixes ---------------
//
// Access and identity are two credentials with two jobs: the shared bridge
// token decides whether the peer connects at all, `client_token` decides who
// it is. These pin that separation, because collapsing it is what would turn
// a rotated credential or a broken third-party config into a client that
// cannot use VMark at all.

fn auth_frame(token: &str, client_token: Option<&str>) -> Result<Message, WsError> {
    let mut payload = serde_json::json!({ "token": token });
    if let Some(client_token) = client_token {
        payload["client_token"] = serde_json::json!(client_token);
    }
    text(serde_json::json!({ "id": "auth", "type": "auth", "payload": payload }))
}

/// THE positive case: the credential VMark wrote into Codex CLI's config
/// arrives in the auth frame, and the connection is Codex CLI from then on.
#[tokio::test]
async fn a_configured_client_credential_fixes_the_principal_at_auth_time() {
    let outcome = auth_over(vec![auth_frame("s3cret", Some("cred-codex"))], "s3cret").await;
    assert_eq!(
        outcome,
        AuthOutcome::Accepted(BridgePrincipal::Provider("codex".into()))
    );
}

/// The migration state. Every install that predates this mechanism has no
/// `VMARK_MCP_TOKEN`, so its sidecar presents none — and must still connect,
/// with every tool but the delegated ones unaffected.
#[tokio::test]
async fn a_client_with_no_credential_still_connects_unidentified() {
    let outcome = auth_over(vec![auth_frame("s3cret", None)], "s3cret").await;
    assert_eq!(outcome, ANONYMOUS);
}

/// A rotated credential, a hand-edited config, or a config VMark could not
/// parse at startup. Refusing the CONNECTION here would cost that client every
/// tool it has because of a syntax error in a third-party file; refusing only
/// the IDENTITY costs it exactly the delegated actions, with an error that
/// says how to fix it.
#[tokio::test]
async fn an_unknown_client_credential_connects_but_names_nobody() {
    let outcome = auth_over(vec![auth_frame("s3cret", Some("cred-stale"))], "s3cret").await;
    assert_eq!(
        outcome,
        AuthOutcome::Accepted(BridgePrincipal::Unrecognized)
    );
}

/// The identity credential is not an access credential. Holding Codex CLI's
/// credential without the shared bridge token gets you nothing.
#[tokio::test]
async fn a_valid_client_credential_cannot_substitute_for_the_bridge_token() {
    let outcome = auth_over(vec![auth_frame("wrong", Some("cred-codex"))], "s3cret").await;
    assert_eq!(outcome, AuthOutcome::Rejected);
}

/// With no configured credentials at all — a first run, or every config
/// unreadable — nobody is identified and nobody is locked out.
#[tokio::test]
async fn an_empty_registry_leaves_every_client_unidentified() {
    let outcome = auth_over_with(
        vec![auth_frame("s3cret", Some("cred-codex"))],
        "s3cret",
        &[],
    )
    .await;
    assert_eq!(
        outcome,
        AuthOutcome::Accepted(BridgePrincipal::Unrecognized)
    );
}

// The frames written during the auth phase moved to `frames.rs`; their tests
// live in `frames.test.rs`.
