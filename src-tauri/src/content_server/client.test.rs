//! Tests for `client.rs` — the shared authenticated loopback client (#129).
//! The HTTP behaviours every caller inherits — the bearer header, the
//! status-before-body refusal, the bounded wait, transport classing — are
//! pinned end-to-end by `slidev_commands.test.rs` against a mock server. This
//! file covers what needs no server, plus the one contract that harness
//! cannot reach: a redirect is an answer, not a hop.
//! Loaded via `#[path] mod tests;` so `super::*` is the client module.

use super::*;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn client(base: &str) -> ServerClient {
    ServerClient::new(base.to_string(), "tok".to_string(), Duration::from_secs(5)).expect("client")
}

// #128 — port and token come from ONE manager record.
#[test]
fn connect_needs_a_running_server_and_reads_port_and_token_together() {
    let mgr = ContentServerManager::new();
    // `.err()` rather than `expect_err`: the client carries the bearer token,
    // so it deliberately has no `Debug` for a `{:?}` to print it through.
    let err = ServerClient::connect(&mgr, "/ws", Duration::from_secs(1))
        .err()
        .expect("nothing running");
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(err.message(), "content server not running");

    mgr.register_running("/ws", 4321, "boot-token".into(), None, None);
    let client = ServerClient::connect(&mgr, "/ws", Duration::from_secs(1)).expect("running");
    assert_eq!(client.base, "http://127.0.0.1:4321");
    assert_eq!(client.token, "boot-token");
}

// #128 — a restart between two connects can never pair the old port with
// the new token: each client holds ONE generation's pair, read together.
#[test]
fn a_restart_between_connects_never_pairs_the_old_port_with_the_new_token() {
    let mgr = ContentServerManager::new();
    mgr.register_running("/ws", 4321, "gen-1".into(), None, None);
    let before = ServerClient::connect(&mgr, "/ws", Duration::from_secs(1)).expect("gen 1");
    mgr.register_running("/ws", 4322, "gen-2".into(), None, None);
    let after = ServerClient::connect(&mgr, "/ws", Duration::from_secs(1)).expect("gen 2");
    assert_eq!(
        (before.base.as_str(), before.token.as_str()),
        ("http://127.0.0.1:4321", "gen-1")
    );
    assert_eq!(
        (after.base.as_str(), after.token.as_str()),
        ("http://127.0.0.1:4322", "gen-2")
    );
}

#[test]
fn auth_url_lands_on_next_or_the_site_root() {
    let client = client("http://127.0.0.1:1");
    assert_eq!(
        client.auth_url("n0nce", None),
        "http://127.0.0.1:1/__auth?t=n0nce"
    );
    assert_eq!(
        client.auth_url("n0nce", Some("/slidev/")),
        "http://127.0.0.1:1/__auth?t=n0nce&next=/slidev/"
    );
}

// #131 — a refusal is reported as one: the status is machine-readable and the
// server's own words are in the message when it said any.
#[test]
fn a_refusal_carries_the_status_in_detail_and_the_body_in_the_message() {
    let err = refusal(
        "nonce mint",
        StatusCode::FORBIDDEN,
        "{\"error\":\"unauthorized\"}\n",
    );
    assert_eq!(err.code(), ErrorCode::Network);
    assert_eq!(
        err.message(),
        "nonce mint failed (403 Forbidden): {\"error\":\"unauthorized\"}"
    );
    assert_eq!(err.detail(), Some(&json!({ "status": 403 })));

    let bare = refusal("graph fetch", StatusCode::INTERNAL_SERVER_ERROR, "  ");
    assert_eq!(
        bare.message(),
        "graph fetch failed (500 Internal Server Error)"
    );
    assert_eq!(bare.detail(), Some(&json!({ "status": 500 })));
}

// `/__auth` replies 302 with the session in `Location`; following it would
// hand `content_server_graph` the landing page instead of the token, and a
// session-in-query call must not carry the bootstrap token.
#[tokio::test]
async fn a_redirect_is_the_answer_not_a_hop_and_a_session_call_sends_no_bearer() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let (seen_tx, seen_rx) = tokio::sync::oneshot::channel::<String>();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).await.unwrap_or(0);
        let _ = seen_tx.send(String::from_utf8_lossy(&buf[..n]).into_owned());
        let _ = stream
            .write_all(
                b"HTTP/1.1 302 Found\r\nLocation: /?s=sess-1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await;
        let _ = stream.shutdown().await;
        // The listener drops here: a followed redirect would be a second
        // connection, and it would be refused.
    });

    let client = client(&format!("http://127.0.0.1:{port}"));
    let resp = client
        .send("auth", client.get_anonymous("/__auth?t=n0nce"))
        .await
        .expect("the 302 is the answer, not a hop to follow");
    assert_eq!(resp.status(), StatusCode::FOUND);
    assert_eq!(
        resp.headers().get("location").and_then(|v| v.to_str().ok()),
        Some("/?s=sess-1")
    );

    let head = seen_rx.await.expect("the request head");
    assert!(head.starts_with("GET /__auth?t=n0nce "), "{head}");
    assert!(
        !head.to_ascii_lowercase().contains("authorization:"),
        "the bootstrap token must not travel on a session call: {head}"
    );
}

// ===== #286 — one construction of the `/__auth?t=` request =================

#[test]
fn the_auth_path_the_webview_navigates_to_is_the_one_the_graph_handshake_sends() {
    let client = client("http://127.0.0.1:1");
    // `graph_over` sends `auth_path`; the webview gets `auth_url`. Built
    // separately, the endpoint and the parameter name lived in two places.
    assert_eq!(client.auth_path("n0nce", None), "/__auth?t=n0nce");
    assert_eq!(
        client.auth_url("n0nce", None),
        format!("http://127.0.0.1:1{}", client.auth_path("n0nce", None))
    );
    assert_eq!(
        client.auth_url("n0nce", Some("/slidev/")),
        format!(
            "http://127.0.0.1:1{}",
            client.auth_path("n0nce", Some("/slidev/"))
        )
    );
}

// ===== #310 — the bound is the CONVERSATION's, not each request's ==========

#[tokio::test]
async fn a_request_past_the_clients_deadline_is_refused_before_it_is_sent() {
    // A listener that accepts and answers nothing: reaching it would hang for
    // the client's per-request ceiling, so a `send` that returns instantly is
    // proof the deadline was consulted first.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let accepted = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = accepted.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::mem::forget(stream);
        }
    });

    let client = ServerClient::new(
        format!("http://127.0.0.1:{port}"),
        "tok".to_string(),
        Duration::from_millis(1),
    )
    .expect("client");
    tokio::time::sleep(Duration::from_millis(20)).await;

    let started = std::time::Instant::now();
    let err = client
        .send("nonce mint", client.get("/__mint"))
        .err_after()
        .await;
    assert_eq!(err.code(), ErrorCode::Timeout);
    assert!(
        err.message().contains("was not attempted"),
        "{}",
        err.message()
    );
    assert!(started.elapsed() < Duration::from_millis(500));
    assert_eq!(
        accepted.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "a spent budget must not open a connection the server would then work for"
    );
}

/// `Result<Response, _>` has no `Debug` for `expect_err` to print (a `Response`
/// carries the request URL, which on the session calls is a live credential).
trait ErrAfter {
    async fn err_after(self) -> CommandError;
}

impl<F> ErrAfter for F
where
    F: std::future::Future<Output = Result<Response, CommandError>>,
{
    async fn err_after(self) -> CommandError {
        match self.await {
            Ok(_) => panic!("expected a refusal"),
            Err(e) => e,
        }
    }
}

// ===== #275 — an empty nonce is a contract break, not an auth failure ======

#[tokio::test]
async fn an_empty_nonce_is_refused_at_the_mint_rather_than_carried_into_the_handshake() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let mut buf = [0u8; 4096];
        let _ = stream.read(&mut buf).await;
        let body = b"{\"nonce\":\"\"}";
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(head.as_bytes()).await;
        let _ = stream.write_all(body).await;
        let _ = stream.shutdown().await;
    });

    let client = client(&format!("http://127.0.0.1:{port}"));
    let err = match client.mint_nonce().await {
        Ok(nonce) => panic!("an empty nonce must not be handed on: {nonce:?}"),
        Err(e) => e,
    };
    assert_eq!(err.code(), ErrorCode::Internal);
    assert_eq!(err.message(), "nonce mint returned an empty nonce");
}
