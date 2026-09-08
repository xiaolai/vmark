//! Tests for the graph handshake (#284, #285, #287) — the security-critical
//! nonce → session exchange that had no direct coverage at all.
//!
//! Two halves: the pure `Location` parser, and `graph_over` driven end to end
//! against a loopback mock that answers the three requests the handshake
//! makes (`/__mint`, `/__auth`, `/api/graph`). The mock speaks raw HTTP
//! because the interesting reply is a 302 with a `Location` header, which the
//! JSON-only mock in `slidev_commands.test.rs` cannot produce.
//! Loaded via `#[path] mod tests;` so `super::*` is the http module.

use super::*;
use crate::command_error::ErrorCode;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

// ── the Location parser ───────────────────────────────────────────────────

#[test]
fn the_session_is_the_s_parameter_not_the_first_thing_after_an_s_equals() {
    assert_eq!(session_from_location("/?s=abc").expect("s"), "abc");
    assert_eq!(session_from_location("/slidev/?s=abc").expect("s"), "abc");
}

// #287 — `split("s=").nth(1)` matched the tail of a LONGER parameter name and
// then kept everything after it, so the "session" was another parameter's
// value with the rest of the query glued on.
#[test]
fn a_longer_parameter_name_ending_in_s_is_not_the_session() {
    let loc = "/?ts=1700000000&s=real";
    assert_eq!(session_from_location(loc).expect("s"), "real");

    // …and a path segment containing `s=` is not the session either.
    assert_eq!(session_from_location("/docs=x/?s=real").expect("s"), "real");
}

// #287 — a trailing parameter used to be swallowed into the token, which was
// then sent on as part of `?s=`.
#[test]
fn a_trailing_parameter_is_not_part_of_the_session() {
    assert_eq!(
        session_from_location("/?s=real&next=/x").expect("s"),
        "real"
    );
}

#[test]
fn a_fragment_is_not_part_of_the_session() {
    assert_eq!(session_from_location("/?s=real#top").expect("s"), "real");
}

#[test]
fn a_missing_or_empty_session_is_refused_rather_than_sent_on() {
    for loc in ["/", "/?", "/?s=", "/?t=nonce", "/?s"] {
        let err = session_from_location(loc).expect_err(loc);
        assert_eq!(err.code(), ErrorCode::Internal, "{loc}");
        assert_eq!(err.message(), "no session token", "{loc}");
    }
}

// ── a raw-HTTP mock content server ────────────────────────────────────────

/// One canned raw reply per connection, in order; the request heads are
/// recorded so a test can assert what the handshake actually sent.
async fn serve(replies: Vec<String>) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let port = listener.local_addr().expect("addr").port();
    let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = std::sync::Arc::clone(&requests);
    tokio::spawn(async move {
        for reply in replies {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            seen.lock()
                .expect("requests")
                .push(String::from_utf8_lossy(&buf[..n]).into_owned());
            let _ = stream.write_all(reply.as_bytes()).await;
            let _ = stream.shutdown().await;
        }
    });
    (format!("http://127.0.0.1:{port}"), requests)
}

fn json_reply(status: u16, reason: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// A refusal that ALSO carries a `Location` — the shape #285 is about.
fn forbidden_with_location() -> String {
    let body = "{\"error\":\"invalid or expired\"}";
    format!(
        "HTTP/1.1 403 Forbidden\r\nLocation: /?s=not-a-session\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn redirect(location: &str) -> String {
    format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
}

fn client(base: &str) -> ServerClient {
    ServerClient::new(
        base.to_string(),
        "boot-token".to_string(),
        Duration::from_secs(5),
    )
    .expect("client")
}

// #284 — the whole handshake, end to end: the mint is Bearer-authed, the
// `/__auth` call carries the nonce and NO bearer, and the graph call carries
// the session the redirect handed back.
#[tokio::test]
async fn the_handshake_mints_exchanges_and_fetches_with_the_session_it_was_given() {
    let (base, requests) = serve(vec![
        json_reply(200, "OK", "{\"nonce\":\"n0nce\"}"),
        redirect("/?s=sess-1"),
        json_reply(200, "OK", "{\"nodes\":[]}"),
    ])
    .await;

    let graph = graph_over(&client(&base)).await.expect("the graph");
    assert_eq!(graph, "{\"nodes\":[]}");

    let sent = requests.lock().expect("requests").clone();
    assert_eq!(sent.len(), 3, "mint, auth, graph");
    assert!(sent[0].starts_with("GET /__mint "), "{}", sent[0]);
    assert!(
        sent[0]
            .to_ascii_lowercase()
            .contains("authorization: bearer"),
        "the mint is the one Bearer-authed call: {}",
        sent[0]
    );
    assert!(sent[1].starts_with("GET /__auth?t=n0nce "), "{}", sent[1]);
    assert!(
        !sent[1].to_ascii_lowercase().contains("authorization:"),
        "the bootstrap token must not travel on a session call: {}",
        sent[1]
    );
    assert!(
        sent[2].starts_with("GET /api/graph?s=sess-1 "),
        "{}",
        sent[2]
    );
}

// #285 — a refusal is reported as one. The status is read BEFORE `Location`,
// so an error response carrying a redirect header of its own cannot be read
// as a successful handshake.
#[tokio::test]
async fn a_non_redirect_answer_is_a_refusal_even_when_it_carries_a_location() {
    let (base, _) = serve(vec![
        json_reply(200, "OK", "{\"nonce\":\"n0nce\"}"),
        forbidden_with_location(),
    ])
    .await;

    let err = graph_over(&client(&base)).await.expect_err("refused");
    assert_eq!(err.code(), ErrorCode::Network);
    assert!(
        err.message().starts_with("auth failed (403 Forbidden)"),
        "{err}"
    );
    assert_eq!(
        err.detail().and_then(|d| d.get("status").cloned()),
        Some(serde_json::json!(403))
    );
}

// #285 — a 302 with no `Location` at all is still refused, not decoded.
#[tokio::test]
async fn a_redirect_without_a_location_is_refused() {
    let (base, _) = serve(vec![
        json_reply(200, "OK", "{\"nonce\":\"n0nce\"}"),
        "HTTP/1.1 302 Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
    ])
    .await;

    let err = graph_over(&client(&base)).await.expect_err("refused");
    assert_eq!(err.code(), ErrorCode::Internal);
    assert_eq!(err.message(), "no auth redirect");
}

// #276 — a transport failure must not carry the URL, because the URL of the
// two session calls IS a live credential. Nothing is listening on the port,
// so the mint's connect fails.
#[tokio::test]
async fn a_transport_failure_does_not_name_the_url_it_failed_on() {
    // Bind and drop, so the port is almost certainly free and unlistened.
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        l.local_addr().expect("addr").port()
    };
    let err = graph_over(&client(&format!("http://127.0.0.1:{port}")))
        .await
        .expect_err("nothing is listening");
    assert!(
        !err.message().contains("__mint") && !err.message().contains("127.0.0.1"),
        "the URL must not reach the message: {err}"
    );
    assert!(
        err.message().starts_with("nonce mint request failed:"),
        "{err}"
    );
}
