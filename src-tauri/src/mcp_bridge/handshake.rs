//! Pre-authentication policy for MCP bridge WebSocket connections (WI-9).
//!
//! Everything an *unauthenticated* peer can reach lives in this one module so
//! the surface is auditable in a single read: which HTTP `Origin`s may
//! upgrade, how large an inbound frame may be, how many sockets may be open
//! at once, and the auth state machine itself. `connection.rs` owns everything
//! that happens *after* a peer authenticates; the frames written during the
//! auth phase are in `frames.rs`; how a secret is compared is in
//! `token_compare.rs`; who the accepted peer turns out to be is in
//! `principal.rs`.
//!
//! Source for each control: `dev-docs/deep-researches/20260728-mcp-stack-audit.md` §2.2.

use super::principal::BridgePrincipal;
use super::token_compare::token_matches;
use super::types::WsMessage;
use crate::mcp_config::client_tokens::ProviderToken;
use futures_util::{Stream, StreamExt};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{header::ORIGIN, HeaderMap, StatusCode};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

/// How long a peer has to present its token before the socket is dropped.
pub(super) const AUTH_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

// --- 1. Origin allowlist (CWE-1385) ---------------------------------------

/// Browser origins permitted to open a bridge socket.
///
/// Deliberately EMPTY. No web page has any business driving the editor
/// bridge; the only legitimate client is the MCP sidecar, a Node process.
/// The list exists as the extension point — if a browser surface ever needs
/// the bridge, its exact origin goes here and gets a test, rather than the
/// check being removed.
const ALLOWED_ORIGINS: &[&str] = &[];

/// Whether an upgrade request's `Origin` header permits the connection.
///
/// The critical semantic (Chrome DevTools / Discord RPC): an **absent**
/// `Origin` means a non-browser client and is ALLOWED — that is the sidecar,
/// and rejecting it would break the whole product. Only a **present** origin
/// is checked against the allowlist. A present-but-unreadable header (non
/// visible-ASCII bytes) is rejected: it is a browser-shaped request whose
/// origin we cannot evaluate, so it fails closed. `Origin: null` (sandboxed
/// iframe, `data:`/`file:` document) is a present origin and is rejected too.
pub(super) fn origin_is_permitted(headers: &HeaderMap) -> bool {
    match headers.get(ORIGIN) {
        None => true,
        Some(value) => value
            .to_str()
            .is_ok_and(|origin| ALLOWED_ORIGINS.contains(&origin)),
    }
}

/// `tungstenite` handshake callback: refuse the upgrade with `403` when the
/// request carries a disallowed `Origin`.
///
/// The `Result<Response, ErrorResponse>` shape is fixed by tungstenite's
/// `Callback` trait — boxing the error would not satisfy it, and this runs
/// once per connection, so the large-`Err` lint has nothing to buy here.
#[allow(clippy::result_large_err)]
pub(super) fn check_upgrade_request(
    request: &Request,
    response: Response,
) -> Result<Response, ErrorResponse> {
    if origin_is_permitted(request.headers()) {
        return Ok(response);
    }
    let origin = request
        .headers()
        .get(ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<unreadable>")
        .to_string();
    log::warn!("[MCP Bridge] Rejected upgrade from disallowed origin {origin:?}");
    let mut rejection = ErrorResponse::new(Some("origin not allowed".to_string()));
    *rejection.status_mut() = StatusCode::FORBIDDEN;
    Err(rejection)
}

// --- 2. Message-size caps -------------------------------------------------

/// Largest inbound message assembled (tungstenite default: 64 MiB). Generous
/// next to a whole markdown document, small enough that a pre-auth peer
/// cannot make the process allocate meaningfully.
pub(super) const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

/// Largest inbound frame payload (tungstenite default: 16 MiB).
pub(super) const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

/// Eagerly allocated per-connection read buffer (default 128 KiB). The bridge
/// is low-throughput; 16 KiB × the connection cap is a small footprint.
pub(super) const READ_BUFFER_BYTES: usize = 16 * 1024;

/// Largest text frame accepted from an UNAUTHENTICATED peer.
///
/// The transport caps above have to be sized for authenticated traffic —
/// whole documents, browser screenshots — and `WebSocketConfig` is fixed at
/// accept time (tokio-tungstenite's `WebSocketStream` exposes `get_config`,
/// not `set_config`), so they cannot be relaxed after the handshake. That
/// left 32 pre-auth peers × 16 MiB ≥ 512 MiB of retainable memory bought with
/// no credential at all. An auth frame is a few hundred bytes, so this
/// application-layer cap costs honest clients nothing and disconnects the
/// peer on the first over-cap frame (audit round 1, finding 5).
pub(super) const MAX_PREAUTH_MESSAGE_BYTES: usize = 64 * 1024;
// Compile-time bounds: strictly under both transport caps (at or above
// either, this control would be dead code the transport already enforced),
// and comfortably over an auth frame's few hundred bytes.
const _: () = assert!(MAX_PREAUTH_MESSAGE_BYTES < MAX_FRAME_BYTES);
const _: () = assert!(MAX_PREAUTH_MESSAGE_BYTES < MAX_MESSAGE_BYTES);
const _: () = assert!(MAX_PREAUTH_MESSAGE_BYTES >= 4 * 1024);

/// Transport limits applied to every accepted socket.
///
/// Only the *inbound* knobs are tightened: both are read-path limits in
/// tungstenite, so outbound payloads (browser screenshots, large document
/// reads) are unaffected. Write buffering is deliberately left at its default
/// — the per-client bounded mpsc queue already bounds outbound memory, and
/// capping it here would break large legitimate responses.
pub(super) fn ws_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_FRAME_BYTES))
        .read_buffer_size(READ_BUFFER_BYTES)
}

// --- 3. Concurrent-connection cap -----------------------------------------

/// Maximum sockets alive at once, authenticated or not.
///
/// Real usage is one sidecar per AI client — a handful. The cap exists so an
/// unauthenticated peer cannot open sockets without bound; the `clients` map
/// itself has no ceiling.
pub(super) const MAX_CONCURRENT_CONNECTIONS: usize = 32;

static LIVE_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);

/// RAII reservation of one of the [`MAX_CONCURRENT_CONNECTIONS`] slots.
/// Acquired as the very first act of a connection task — before the WebSocket
/// handshake — and released on drop, covering every exit path incl. panics.
pub(super) struct ConnectionSlot;

impl ConnectionSlot {
    /// Reserve a slot, or `None` when the bridge is already at capacity.
    pub(super) fn try_acquire() -> Option<Self> {
        LIVE_CONNECTIONS
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |live| {
                (live < MAX_CONCURRENT_CONNECTIONS).then_some(live + 1)
            })
            .ok()
            .map(|_| ConnectionSlot)
    }

    /// Currently reserved slots. Diagnostics and tests only.
    pub(super) fn live() -> usize {
        LIVE_CONNECTIONS.load(Ordering::Acquire)
    }
}

impl Drop for ConnectionSlot {
    fn drop(&mut self) {
        LIVE_CONNECTIONS.fetch_sub(1, Ordering::AcqRel);
    }
}

// --- 4. Auth state machine ------------------------------------------------

/// How the pre-auth phase ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum AuthOutcome {
    /// Valid bridge token presented — the peer may be allocated resources.
    /// Carries the principal its per-client credential resolved to, which is
    /// [`BridgePrincipal::Anonymous`] when it presented none.
    Accepted(BridgePrincipal),
    /// The peer spoke, but not a valid `auth` message. Tell it, then close.
    Rejected,
    /// The peer went away, errored, or timed out. Nothing left to tell.
    Aborted,
}

/// Read frames until the peer authenticates or disqualifies itself.
///
/// Generic over the stream so the state machine is testable without a socket.
/// The first *meaningful* frame must be `auth`: an `identify` (or anything
/// else) sent first is rejected, so a peer cannot register a name before
/// proving it holds the token. Ping/Pong are keep-alives and are skipped;
/// binary frames are rejected outright — the protocol is JSON text only, and
/// an unauthenticated peer should not be able to stream bytes at us.
///
/// Two credentials, two jobs (audit 20260728 §2.1):
///
/// * `token` — the shared bridge token from the port file. This alone decides
///   **access**; nothing else authenticates a peer, and that has not changed.
/// * `client_token` — optional, the per-client credential VMark wrote into
///   that AI client's MCP config. This alone decides the **principal**.
///
/// Keeping them separate is deliberate. If the per-client credential were the
/// access credential, then a rotated, hand-edited, or unparseable-config
/// credential would refuse the connection outright and cost that client every
/// tool it has; here it costs only the identity, and only delegated actions
/// are refused. It also means every failure of this mechanism — migration,
/// rotation, a broken third-party config — degrades to exactly one behaviour
/// with one remedy, instead of two.
pub(super) async fn await_auth<S>(
    source: &mut S,
    expected_token: &str,
    configured: &[ProviderToken],
    peer: u64,
) -> AuthOutcome
where
    S: Stream<Item = Result<Message, WsError>> + Unpin,
{
    while let Some(frame) = source.next().await {
        match frame {
            Ok(Message::Text(text)) => {
                // Size before parse: a peer that has not authenticated does
                // not get to choose how much the process parses or retains.
                if text.len() > MAX_PREAUTH_MESSAGE_BYTES {
                    log::warn!(
                        "[MCP Bridge] Peer {peer} sent {} bytes before auth (cap {}) — rejected",
                        text.len(),
                        MAX_PREAUTH_MESSAGE_BYTES
                    );
                    return AuthOutcome::Rejected;
                }
                let Ok(msg) = serde_json::from_str::<WsMessage>(&text) else {
                    log::warn!(
                        "[MCP Bridge] Peer {peer} sent unparseable first message — rejected"
                    );
                    return AuthOutcome::Rejected;
                };
                if msg.msg_type != "auth" {
                    log::warn!(
                        "[MCP Bridge] Peer {peer} sent '{}' before auth — rejected",
                        msg.msg_type
                    );
                    return AuthOutcome::Rejected;
                }
                let token = msg
                    .payload
                    .get("token")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if token_matches(token, expected_token) {
                    let presented = msg.payload.get("client_token").and_then(|v| v.as_str());
                    let principal = BridgePrincipal::resolve(presented, configured);
                    if matches!(principal, BridgePrincipal::Unrecognized) {
                        log::warn!(
                            "[MCP Bridge] Peer {peer} presented a client credential no configured \
                             AI client holds — connecting unidentified"
                        );
                    }
                    return AuthOutcome::Accepted(principal);
                }
                log::warn!("[MCP Bridge] Peer {peer} auth failed: invalid token");
                return AuthOutcome::Rejected;
            }
            Ok(Message::Binary(_)) => {
                log::warn!("[MCP Bridge] Peer {peer} sent a binary frame before auth — rejected");
                return AuthOutcome::Rejected;
            }
            Ok(Message::Close(_)) | Err(_) => return AuthOutcome::Aborted,
            Ok(_) => continue,
        }
    }
    AuthOutcome::Aborted
}

#[cfg(test)]
#[path = "handshake.test.rs"]
mod tests;
