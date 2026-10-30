//! Tests for `rest_api.rs` — the settings-page probes end to end over real
//! HTTP against a loopback mock server: what `send` puts on the wire, how
//! `check_response` turns a non-2xx reply into the error the page shows, and
//! how each command reads the response it gets. Request construction alone is
//! pinned in `rest_api/provider_endpoint.test.rs`.

use super::*;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Serve one canned raw reply per connection, in order; the request heads are
/// recorded so a test can assert what was actually sent.
async fn serve(replies: Vec<String>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let port = listener.local_addr().expect("addr").port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);
    tokio::spawn(async move {
        for reply in replies {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let mut buf = [0u8; 8192];
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

fn reply(status: u16, reason: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn first_request(requests: &Arc<Mutex<Vec<String>>>) -> String {
    requests
        .lock()
        .expect("requests")
        .first()
        .cloned()
        .expect("a request was sent")
}

#[tokio::test]
async fn a_2xx_key_probe_reports_connected_and_hits_the_listing() {
    let (base, requests) = serve(vec![reply(200, "OK", r#"{"models":[]}"#)]).await;

    let result = test_api_key("ollama-api".into(), None, Some(base)).await;

    assert_eq!(result.as_deref(), Ok("Connected"));
    assert!(first_request(&requests).starts_with("GET /api/tags "));
}

#[tokio::test]
async fn a_non_2xx_reply_becomes_status_plus_body() {
    let (base, _) = serve(vec![reply(401, "Unauthorized", "invalid api key")]).await;

    let result = test_api_key(
        "openai-compatible".into(),
        Some("sk-bad".into()),
        Some(base),
    )
    .await;

    assert_eq!(result, Err("HTTP 401: invalid api key".to_string()));
}

#[tokio::test]
async fn the_key_travels_in_the_bearer_header_and_models_are_parsed() {
    let (base, requests) = serve(vec![reply(
        200,
        "OK",
        r#"{"data":[{"id":"m-b"},{"id":"m-a"}]}"#,
    )])
    .await;

    let models = list_models(
        "openai-compatible".into(),
        Some("sk-live".into()),
        Some(base),
    )
    .await
    .expect("listing succeeds");

    assert!(models.contains(&"m-a".to_string()) && models.contains(&"m-b".to_string()));
    let head = first_request(&requests).to_ascii_lowercase();
    assert!(head.starts_with("get /v1/models "));
    assert!(head.contains("authorization: bearer sk-live"));
}

#[tokio::test]
async fn a_2xx_listing_that_is_not_json_is_a_parse_error() {
    let (base, _) = serve(vec![reply(200, "OK", "<html>proxy login</html>")]).await;

    let err = list_models("ollama-api".into(), None, Some(base))
        .await
        .unwrap_err();

    assert!(err.starts_with("Failed to parse response:"), "{err}");
}

#[tokio::test]
async fn a_listing_json_without_its_key_is_the_parser_error() {
    let (base, _) = serve(vec![reply(200, "OK", r#"{"unexpected":true}"#)]).await;

    let result = list_models("ollama-api".into(), None, Some(base)).await;

    assert!(result.is_err());
}

#[tokio::test]
async fn anthropic_listing_is_curated_and_sends_nothing() {
    let models = list_models("anthropic".into(), None, None)
        .await
        .expect("curated");
    assert_eq!(models, ANTHROPIC_MODELS.map(String::from).to_vec());
}

#[tokio::test]
async fn validate_model_posts_the_model_and_reports_a_missing_one() {
    let (base, requests) = serve(vec![reply(
        404,
        "Not Found",
        r#"{"error":"model not found"}"#,
    )])
    .await;

    let result = validate_model("ollama-api".into(), "llama-x".into(), None, Some(base)).await;

    assert_eq!(
        result,
        Err(r#"HTTP 404: {"error":"model not found"}"#.to_string())
    );
    let head = first_request(&requests);
    assert!(head.starts_with("POST /api/show "));
    assert!(head.contains(r#""name":"llama-x""#));
}

#[tokio::test]
async fn validate_model_reports_ok_on_2xx() {
    let (base, _) = serve(vec![reply(200, "OK", "{}")]).await;
    let result = validate_model("ollama-api".into(), "llama3".into(), None, Some(base)).await;
    assert_eq!(result.as_deref(), Ok("Model OK"));
}

#[tokio::test]
async fn an_unreachable_server_is_a_request_failure() {
    // Bind, learn the port, close: nothing listens there any more.
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        listener.local_addr().expect("addr").port()
    };

    let err = test_api_key(
        "ollama-api".into(),
        None,
        Some(format!("http://127.0.0.1:{port}")),
    )
    .await
    .unwrap_err();

    assert!(err.starts_with("Request failed:"), "{err}");
}

#[tokio::test]
async fn an_unknown_provider_is_refused_before_any_request() {
    let err = test_api_key("nope".into(), None, None).await.unwrap_err();
    assert_eq!(err, "Unknown provider: nope");
}
