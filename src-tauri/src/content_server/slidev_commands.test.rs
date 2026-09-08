//! Tests for the Slidev commands' HTTP half (#132), against a loopback mock
//! server: non-2xx control replies, a malformed mint payload, a transport
//! failure, a server that accepts but never answers (#130), and a RESTART of
//! the workspace's server while a request is in flight — through the real
//! `ContentServerManager`, so the generation the command started against is
//! the one it finishes against. Every failure is asserted on its
//! `CommandError` code (#127) as well as its message — the code is what the
//! frontend branches on. The commands run over the shared
//! `client::ServerClient` (#129), so these tests also pin what every loopback
//! command inherits from it; the absent-server refusal lives in
//! `client.test.rs` with the client.
//! Loaded via `#[path] mod tests;` so `super::*` is the module.

use super::*;
use crate::command_error::ErrorCode;
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

// ── the format model ──────────────────────────────────────────────────────

#[test]
fn formats_map_to_flags_and_wire_names() {
    assert_eq!(SlidevExportFormat::Pdf.as_flag(), "pdf");
    assert_eq!(SlidevExportFormat::Png.as_flag(), "png");
    assert_eq!(SlidevExportFormat::Pptx.as_flag(), "pptx");
    let parsed: SlidevExportFormat = serde_json::from_str("\"pptx\"").unwrap();
    assert_eq!(parsed, SlidevExportFormat::Pptx);
}

// ── a mock content server ─────────────────────────────────────────────────

/// One canned reply per connection, in order. Every request's head + body is
/// recorded so a test can assert what was sent, not only what came back.
struct MockServer {
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        500 => "Internal Server Error",
        _ => "Other",
    }
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk).await.unwrap_or(0);
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..pos]).to_ascii_lowercase();
            let len = head
                .lines()
                .find_map(|l| l.strip_prefix("content-length:"))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if buf.len() >= pos + 4 + len {
                break;
            }
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

async fn serve(replies: Vec<(u16, &'static str)>) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let port = listener.local_addr().expect("addr").port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);
    tokio::spawn(async move {
        for (status, body) in replies {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            seen.lock().expect("requests").push(request);
            let response = format!(
                "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                reason(status),
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
        }
    });
    MockServer {
        base: format!("http://127.0.0.1:{port}"),
        requests,
    }
}

fn client(base: &str, token: &str) -> ServerClient {
    ServerClient::new(base.to_string(), token.to_string(), Duration::from_secs(5)).expect("client")
}

/// A loopback port nothing listens on: bind, read the port, drop the socket.
async fn closed_port_base() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);
    format!("http://127.0.0.1:{port}")
}

// ── preview ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn preview_starts_the_deck_then_mints_a_nonce_into_the_auth_url() {
    let server = serve(vec![
        (200, r#"{"ok":true,"path":"/slidev/"}"#),
        (200, r#"{"nonce":"n0nce"}"#),
    ])
    .await;
    let url = preview_url(&client(&server.base, "tok-1"), "/ws/deck.md")
        .await
        .expect("preview");
    assert_eq!(url, format!("{}/__auth?t=n0nce&next=/slidev/", server.base));

    let requests = server.requests.lock().expect("requests").clone();
    assert_eq!(requests.len(), 2);
    assert!(
        requests[0].starts_with("POST /api/slidev/preview "),
        "{}",
        requests[0]
    );
    assert!(
        requests[0].contains("authorization: Bearer tok-1")
            || requests[0].contains("Authorization: Bearer tok-1"),
        "{}",
        requests[0]
    );
    assert!(
        requests[0].ends_with(r#"{"deck":"/ws/deck.md"}"#),
        "{}",
        requests[0]
    );
    assert!(requests[1].starts_with("GET /__mint "), "{}", requests[1]);
    assert!(
        requests[1].contains("authorization: Bearer tok-1")
            || requests[1].contains("Authorization: Bearer tok-1"),
        "the mint is bearer-authed too: {}",
        requests[1]
    );
}

#[tokio::test]
async fn preview_reports_the_servers_refusal_body() {
    let server = serve(vec![(
        500,
        r#"{"error":"slidev start failed: no chromium"}"#,
    )])
    .await;
    let err = preview_url(&client(&server.base, "tok"), "/ws/deck.md")
        .await
        .expect_err("refused");
    assert_eq!(err.code(), ErrorCode::Network);
    assert!(
        err.message()
            .starts_with("slidev preview failed (500 Internal Server Error): "),
        "{err}"
    );
    assert!(err.message().contains("no chromium"), "{err}");
    assert_eq!(err.detail(), Some(&json!({ "status": 500 })));
}

#[tokio::test]
async fn preview_reports_a_rejected_mint_by_status() {
    let server = serve(vec![
        (200, r#"{"ok":true}"#),
        (403, r#"{"error":"unauthorized"}"#),
    ])
    .await;
    let err = preview_url(&client(&server.base, "tok"), "/ws/deck.md")
        .await
        .expect_err("mint refused");
    // #131: the status is read before the body, so a refusal is reported as
    // one — not as the error document failing to decode as a nonce.
    assert_eq!(err.code(), ErrorCode::Network);
    assert!(
        err.message()
            .starts_with("nonce mint failed (403 Forbidden): "),
        "{err}"
    );
    assert!(err.message().contains("unauthorized"), "{err}");
    assert_eq!(err.detail(), Some(&json!({ "status": 403 })));
}

#[tokio::test]
async fn preview_reports_a_malformed_mint_payload() {
    let server = serve(vec![(200, r#"{"ok":true}"#), (200, r#"{"nonsense":1}"#)]).await;
    let err = preview_url(&client(&server.base, "tok"), "/ws/deck.md")
        .await
        .expect_err("no nonce");
    assert_eq!(
        err.code(),
        ErrorCode::Internal,
        "a contract break with our own server"
    );
    assert!(err.message().contains("not the expected JSON"), "{err}");
}

#[tokio::test]
async fn preview_reports_a_transport_failure_when_nothing_listens() {
    let base = closed_port_base().await;
    let err = preview_url(&client(&base, "tok"), "/ws/deck.md")
        .await
        .expect_err("nothing listens");
    assert_eq!(err.code(), ErrorCode::Network);
    assert!(
        err.message().starts_with("slidev preview request failed: "),
        "{err}"
    );
}

// ── export ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn export_forwards_deck_format_and_output_and_returns_the_output_path() {
    let server = serve(vec![(200, r#"{"ok":true,"output":"/out/deck.pptx"}"#)]).await;
    let out = export_deck(
        &client(&server.base, "tok-2"),
        "/ws/deck.md",
        SlidevExportFormat::Pptx,
        "/out/deck.pptx",
    )
    .await
    .expect("export");
    assert_eq!(out, "/out/deck.pptx");
    let requests = server.requests.lock().expect("requests").clone();
    assert!(
        requests[0].starts_with("POST /api/slidev/export "),
        "{}",
        requests[0]
    );
    assert!(
        requests[0]
            .ends_with(r#"{"deck":"/ws/deck.md","format":"pptx","output":"/out/deck.pptx"}"#),
        "{}",
        requests[0]
    );
}

// #309 — the CONFIRMED destination travels on, not the one that was asked
// for. A server that wrote somewhere else, or answered a 2xx that is not the
// export contract at all, used to be reported as a successful export of the
// caller's own path.
#[tokio::test]
async fn export_returns_the_path_the_server_confirms_not_the_one_requested() {
    let server = serve(vec![(200, r#"{"ok":true,"output":"/out/deck-1.pdf"}"#)]).await;
    let out = export_deck(
        &client(&server.base, "tok"),
        "/ws/deck.md",
        SlidevExportFormat::Pdf,
        "/out/deck.pdf",
    )
    .await
    .expect("export");
    assert_eq!(out, "/out/deck-1.pdf");
}

#[tokio::test]
async fn a_2xx_that_is_not_the_export_contract_is_internal_not_a_success() {
    let server = serve(vec![(200, "not json at all")]).await;
    let err = export_deck(
        &client(&server.base, "tok"),
        "/ws/deck.md",
        SlidevExportFormat::Pdf,
        "/out/deck.pdf",
    )
    .await
    .expect_err("a contract break, not an export");
    assert_eq!(err.code(), ErrorCode::Internal);
}

#[tokio::test]
async fn export_reports_the_servers_refusal_body() {
    let server = serve(vec![(
        400,
        r#"{"error":"output path must match the export format"}"#,
    )])
    .await;
    let err = export_deck(
        &client(&server.base, "tok"),
        "/ws/deck.md",
        SlidevExportFormat::Pdf,
        "/out/deck.png",
    )
    .await
    .expect_err("refused");
    assert_eq!(err.code(), ErrorCode::Network);
    assert!(
        err.message()
            .starts_with("slidev export failed (400 Bad Request): "),
        "{err}"
    );
    assert!(err.message().contains("must match"), "{err}");
    assert_eq!(err.detail(), Some(&json!({ "status": 400 })));
}

// ── the bound (#130) ──────────────────────────────────────────────────────

/// A server that accepts every connection and never answers on any of them.
/// The old `Client::new()` had no request timeout: such a connection left the
/// Tauri command pending for the life of the process.
async fn holding_server() -> (ServerClient, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let hold = tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                return;
            };
            held.push(stream);
        }
    });
    let client = ServerClient::new(
        format!("http://127.0.0.1:{port}"),
        "tok".to_string(),
        Duration::from_millis(300),
    )
    .expect("client");
    (client, hold)
}

#[tokio::test]
async fn a_server_that_accepts_but_never_answers_is_a_bounded_error_not_a_hang() {
    let (client, hold) = holding_server().await;
    let attempt =
        tokio::time::timeout(Duration::from_secs(5), preview_url(&client, "/ws/deck.md")).await;
    hold.abort();
    let err = attempt
        .expect("the bounded client must give up, not hang")
        .expect_err("no reply is a failure");
    assert_eq!(
        err.code(),
        ErrorCode::Timeout,
        "the bound elapsing is a timeout, not a generic network failure"
    );
    assert!(
        err.message().starts_with("slidev preview request failed: "),
        "{err}"
    );
}

#[tokio::test]
async fn an_export_the_server_never_answers_is_a_bounded_error_not_a_hang() {
    let (client, hold) = holding_server().await;
    let attempt = tokio::time::timeout(
        Duration::from_secs(5),
        export_deck(
            &client,
            "/ws/deck.md",
            SlidevExportFormat::Pdf,
            "/out/deck.pdf",
        ),
    )
    .await;
    hold.abort();
    let err = attempt
        .expect("the bounded client must give up, not hang")
        .expect_err("no reply is a failure");
    assert_eq!(err.code(), ErrorCode::Timeout);
    assert!(
        err.message().starts_with("slidev export request failed: "),
        "{err}"
    );
}

#[tokio::test]
async fn export_reports_a_transport_failure_when_nothing_listens() {
    let base = closed_port_base().await;
    let err = export_deck(
        &client(&base, "tok"),
        "/ws/deck.md",
        SlidevExportFormat::Pdf,
        "/out/deck.pdf",
    )
    .await
    .expect_err("nothing listens");
    assert_eq!(err.code(), ErrorCode::Network);
    assert!(
        err.message().starts_with("slidev export request failed: "),
        "{err}"
    );
}

// ── an empty token ────────────────────────────────────────────────────────

#[tokio::test]
async fn an_empty_token_is_sent_as_an_empty_bearer_and_the_refusal_is_reported() {
    // Nothing client-side special-cases a blank token: the header goes out
    // with nothing after `Bearer`, and the server's refusal comes back as one.
    // (Production mints a uuid per child; only the test-support `register`
    // can put a blank token in the registry.)
    let server = serve(vec![(401, r#"{"error":"missing bearer"}"#)]).await;
    let err = preview_url(&client(&server.base, ""), "/ws/deck.md")
        .await
        .expect_err("refused");
    assert_eq!(err.code(), ErrorCode::Network);
    assert_eq!(err.detail(), Some(&json!({ "status": 401 })));
    assert!(
        err.message()
            .starts_with("slidev preview failed (401 Unauthorized): "),
        "{err}"
    );
    let head = server.requests.lock().expect("requests")[0].to_ascii_lowercase();
    let auth = head
        .lines()
        .find_map(|l| l.strip_prefix("authorization:"))
        .expect("the header is sent even when the token is blank");
    assert_eq!(auth.trim(), "bearer", "{head}");
}

// ── a restart during an in-flight request (#132, #128) ────────────────────
//
// `ServerClient::connect` reads port and token from ONE manager lock, and a
// command holds that snapshot for its whole life. A restart in the middle of
// a request therefore has exactly two honest outcomes, pinned here through
// the real manager: the request finishes against the generation it started
// with, or fails as a transport error because that generation died. It is
// never re-pointed at the new server — which would send one generation's
// bearer, or pair one generation's nonce with the other's port.

/// A server that reads its first request and then waits to be told what to
/// do with it: answer (`Some(reply)`), or die without answering (`None` —
/// the old generation killed by the restart). Later connections get the
/// canned replies in order.
struct GatedServer {
    base: String,
    port: u16,
    requests: Arc<Mutex<Vec<String>>>,
    /// Fires once the first request has been read in full.
    received: Option<tokio::sync::oneshot::Receiver<()>>,
    /// Decides the first request's fate.
    release: Option<tokio::sync::oneshot::Sender<Option<(u16, &'static str)>>>,
}

async fn serve_gated(later: Vec<(u16, &'static str)>) -> GatedServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind gated");
    let port = listener.local_addr().expect("addr").port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);
    let (received_tx, received_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel::<Option<(u16, &'static str)>>();
    tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        let request = read_request(&mut stream).await;
        seen.lock().expect("requests").push(request);
        let _ = received_tx.send(());
        match release_rx.await {
            Ok(Some((status, body))) => {
                let response = format!(
                    "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    reason(status),
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            }
            // Killed: the connection closes with nothing on it.
            Ok(None) | Err(_) => drop(stream),
        }
        for (status, body) in later {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            seen.lock().expect("requests").push(request);
            let response = format!(
                "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                reason(status),
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
        }
    });
    GatedServer {
        base: format!("http://127.0.0.1:{port}"),
        port,
        requests,
        received: Some(received_rx),
        release: Some(release_tx),
    }
}

fn bearer_of(request: &str) -> String {
    request
        .to_ascii_lowercase()
        .lines()
        .find_map(|l| {
            l.strip_prefix("authorization:")
                .map(|v| v.trim().to_string())
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn a_restart_during_an_in_flight_preview_fails_it_as_a_transport_error_and_the_next_reaches_the_new_server(
) {
    let mgr = ContentServerManager::new();
    let mut old = serve_gated(vec![]).await;
    let new = serve(vec![(200, r#"{"ok":true}"#), (200, r#"{"nonce":"n3w"}"#)]).await;
    let new_port: u16 = new.base.rsplit(':').next().unwrap().parse().unwrap();
    mgr.register_running("/ws", old.port, "tok-old".into(), None, None);

    // The command connects — one lock, generation 1 — and its request
    // reaches the old server.
    let client = ServerClient::connect(&mgr, "/ws", Duration::from_secs(5)).expect("gen 1");
    let in_flight = tokio::spawn(async move { preview_url(&client, "/ws/deck.md").await });
    old.received
        .take()
        .unwrap()
        .await
        .expect("the old server read the request");

    // The restart: generation 2 replaces the record, and the old process
    // dies with the request still unanswered.
    mgr.register_running("/ws", new_port, "tok-new".into(), None, None);
    old.release.take().unwrap().send(None).expect("kill");

    let err = in_flight
        .await
        .expect("join")
        .expect_err("the generation it started against died");
    assert_eq!(
        err.code(),
        ErrorCode::Network,
        "a dead server is a transport failure — not a timeout, not a success against the new one"
    );
    assert!(
        err.message().starts_with("slidev preview request failed: "),
        "{err}"
    );

    // The next command reads generation 2 — port AND token together (#128).
    let client = ServerClient::connect(&mgr, "/ws", Duration::from_secs(5)).expect("gen 2");
    let url = preview_url(&client, "/ws/deck.md").await.expect("preview");
    assert_eq!(url, format!("{}/__auth?t=n3w&next=/slidev/", new.base));

    let old_requests = old.requests.lock().expect("requests").clone();
    assert_eq!(
        old_requests.len(),
        1,
        "nothing was re-sent to the old server"
    );
    assert_eq!(bearer_of(&old_requests[0]), "bearer tok-old");
    let new_requests = new.requests.lock().expect("requests").clone();
    assert_eq!(
        new_requests.len(),
        2,
        "preview, then mint — both on the new server"
    );
    assert!(
        new_requests
            .iter()
            .all(|r| bearer_of(r) == "bearer tok-new"),
        "the new server's token, never the old one's: {new_requests:?}"
    );
}

#[tokio::test]
async fn a_restart_during_an_in_flight_preview_completes_it_against_the_generation_it_started_with()
{
    // The old generation survives long enough to answer (a stop that has
    // not reached it yet). Both halves of the command — the preview call
    // and the mint — go to it, and the URL names ITS port with ITS nonce:
    // the new server never learns this nonce, so a URL that paired it with
    // the new port would authenticate nothing.
    let mgr = ContentServerManager::new();
    let mut old = serve_gated(vec![(200, r#"{"nonce":"0ld"}"#)]).await;
    let new = serve(vec![(200, r#"{"ok":true}"#)]).await;
    let new_port: u16 = new.base.rsplit(':').next().unwrap().parse().unwrap();
    mgr.register_running("/ws", old.port, "tok-old".into(), None, None);

    let client = ServerClient::connect(&mgr, "/ws", Duration::from_secs(5)).expect("gen 1");
    let in_flight = tokio::spawn(async move { preview_url(&client, "/ws/deck.md").await });
    old.received.take().unwrap().await.expect("read");

    mgr.register_running("/ws", new_port, "tok-new".into(), None, None);
    old.release
        .take()
        .unwrap()
        .send(Some((200, r#"{"ok":true}"#)))
        .expect("answer");

    let url = in_flight.await.expect("join").expect("preview");
    assert_eq!(url, format!("{}/__auth?t=0ld&next=/slidev/", old.base));
    assert_eq!(old.requests.lock().expect("requests").len(), 2);
    assert!(
        new.requests.lock().expect("requests").is_empty(),
        "the new generation saw nothing of a command that predates it"
    );
    assert_eq!(
        mgr.server_and_token("/ws").map(|(s, t)| (s.port, t)),
        Some((new_port, "tok-new".to_string())),
        "while the registry already answers with generation 2"
    );
}

#[tokio::test]
async fn a_restart_during_an_in_flight_export_fails_it_rather_than_returning_the_output_path() {
    // The other half of #132's restart boundary. Export is not preview with a
    // different path: it has ONE request and returns the caller's
    // `output_path` on success, so a restart that kills the generation
    // mid-request must surface as an error — a stray `Ok(output)` would name
    // a file the dead server never wrote, and the frontend would open it.
    let mgr = ContentServerManager::new();
    let mut old = serve_gated(vec![]).await;
    let new = serve(vec![(200, r#"{"ok":true,"output":"/out/deck.pptx"}"#)]).await;
    let new_port: u16 = new.base.rsplit(':').next().unwrap().parse().unwrap();
    mgr.register_running("/ws", old.port, "tok-old".into(), None, None);

    let client = ServerClient::connect(&mgr, "/ws", Duration::from_secs(5)).expect("gen 1");
    let in_flight = tokio::spawn(async move {
        export_deck(
            &client,
            "/ws/deck.md",
            SlidevExportFormat::Pptx,
            "/out/deck.pptx",
        )
        .await
    });
    old.received
        .take()
        .unwrap()
        .await
        .expect("the old server read the request");

    mgr.register_running("/ws", new_port, "tok-new".into(), None, None);
    old.release.take().unwrap().send(None).expect("kill");

    let err = in_flight
        .await
        .expect("join")
        .expect_err("no output path for an export whose server died");
    assert_eq!(err.code(), ErrorCode::Network);
    assert!(
        err.message().starts_with("slidev export request failed: "),
        "{err}"
    );
    assert!(
        new.requests.lock().expect("requests").is_empty(),
        "nothing was re-sent to the generation that replaced it"
    );

    // The next export reads generation 2 — its port AND its token (#128).
    let client = ServerClient::connect(&mgr, "/ws", Duration::from_secs(5)).expect("gen 2");
    let out = export_deck(
        &client,
        "/ws/deck.md",
        SlidevExportFormat::Pptx,
        "/out/deck.pptx",
    )
    .await
    .expect("export");
    assert_eq!(out, "/out/deck.pptx");
    let new_requests = new.requests.lock().expect("requests").clone();
    assert_eq!(new_requests.len(), 1);
    assert_eq!(bearer_of(&new_requests[0]), "bearer tok-new");
    assert!(
        new_requests[0].contains(r#""format":"pptx""#),
        "{}",
        new_requests[0]
    );
}
