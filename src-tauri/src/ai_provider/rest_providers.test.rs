//! WI-FL5.3 — REST provider request shapes and the response contract.
//!
//! Request shapes are read off the UNSENT `reqwest::RequestBuilder`s in
//! `rest_request.rs`: no server, and the only way to see Google's request at
//! all (its host is hard-coded) or the 120 s per-request timeout. The
//! response contract — status handling, the 5 MB body cap, field extraction —
//! is exercised by sending the real `run_rest_*` functions at a one-shot
//! loopback server, the technique `http_client.rs` already uses for its
//! timeout test.

use super::{run_rest_anthropic, run_rest_ollama, run_rest_openai};
use crate::ai_provider::rest_request::{
    anthropic_request, google_request, ollama_request, openai_request, PROMPT_REQUEST_TIMEOUT,
};
use crate::ai_provider::sink::testing::{RecordingSink, SinkEvent};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const KEY: &str = "sk-LEAK-CANARY";
const PROMPT: &str = "Say hello";
const ENDPOINT: &str = "https://api.example.test";

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

fn build(rb: reqwest::RequestBuilder) -> reqwest::Request {
    rb.build().expect("request builds")
}

fn body_json(req: &reqwest::Request) -> serde_json::Value {
    let bytes = req
        .body()
        .and_then(|b| b.as_bytes())
        .expect("a buffered JSON body");
    serde_json::from_slice(bytes).expect("body is JSON")
}

fn header<'a>(req: &'a reqwest::Request, name: &str) -> Option<&'a str> {
    req.headers()
        .get(name)
        .map(|v| v.to_str().expect("ascii header value"))
}

// ── request shapes (no network) ─────────────────────────────────────────────

#[test]
fn anthropic_posts_v1_messages_with_key_version_and_a_4096_default_cap() {
    let req = build(anthropic_request(
        &client(),
        ENDPOINT,
        KEY,
        "claude-x",
        PROMPT,
        None,
    ));
    assert_eq!(req.method(), reqwest::Method::POST);
    assert_eq!(req.url().as_str(), "https://api.example.test/v1/messages");
    assert_eq!(header(&req, "x-api-key"), Some(KEY));
    assert_eq!(header(&req, "anthropic-version"), Some("2023-06-01"));
    assert_eq!(header(&req, "content-type"), Some("application/json"));
    assert_eq!(
        body_json(&req),
        serde_json::json!({
            "model": "claude-x",
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": PROMPT}]
        })
    );
}

#[test]
fn anthropic_applies_an_explicit_max_tokens_cap() {
    let req = build(anthropic_request(
        &client(),
        ENDPOINT,
        KEY,
        "claude-x",
        PROMPT,
        Some(77),
    ));
    assert_eq!(body_json(&req)["max_tokens"], serde_json::json!(77));
}

#[test]
fn openai_posts_chat_completions_with_bearer_auth_and_omits_max_tokens_by_default() {
    let req = build(openai_request(
        &client(),
        ENDPOINT,
        KEY,
        "gpt-x",
        PROMPT,
        None,
    ));
    assert_eq!(req.method(), reqwest::Method::POST);
    assert_eq!(
        req.url().as_str(),
        "https://api.example.test/v1/chat/completions"
    );
    assert_eq!(header(&req, "authorization"), Some("Bearer sk-LEAK-CANARY"));
    assert_eq!(header(&req, "content-type"), Some("application/json"));
    assert_eq!(
        body_json(&req),
        serde_json::json!({
            "model": "gpt-x",
            "messages": [{"role": "user", "content": PROMPT}]
        }),
        "no max_tokens key unless a cap was asked for"
    );

    let capped = build(openai_request(
        &client(),
        ENDPOINT,
        KEY,
        "gpt-x",
        PROMPT,
        Some(9),
    ));
    assert_eq!(body_json(&capped)["max_tokens"], serde_json::json!(9));
}

#[test]
fn google_targets_the_public_host_with_the_key_header_and_maps_the_cap_to_max_output_tokens() {
    let req = build(google_request(
        &client(),
        KEY,
        "gemini-2.0-flash",
        PROMPT,
        None,
    ));
    assert_eq!(req.method(), reqwest::Method::POST);
    assert_eq!(
        req.url().as_str(),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    );
    assert_eq!(header(&req, "x-goog-api-key"), Some(KEY));
    assert_eq!(header(&req, "content-type"), Some("application/json"));
    assert_eq!(
        body_json(&req),
        serde_json::json!({"contents": [{"parts": [{"text": PROMPT}]}]}),
        "no generationConfig unless a cap was asked for"
    );

    let capped = build(google_request(
        &client(),
        KEY,
        "gemini-2.0-flash",
        PROMPT,
        Some(5),
    ));
    assert_eq!(
        body_json(&capped)["generationConfig"],
        serde_json::json!({"maxOutputTokens": 5})
    );
}

#[test]
fn google_strips_a_models_prefix_so_the_id_is_not_doubled() {
    let req = build(google_request(
        &client(),
        KEY,
        "models/gemini-pro",
        PROMPT,
        None,
    ));
    let url = req.url().as_str();
    assert!(url.ends_with("/models/gemini-pro:generateContent"), "{url}");
    assert!(!url.contains("models/models"), "{url}");
}

#[test]
fn ollama_posts_api_generate_non_streaming_with_no_credentials() {
    let req = build(ollama_request(
        &client(),
        "http://127.0.0.1:11434",
        "llama3.2",
        PROMPT,
        None,
    ));
    assert_eq!(req.method(), reqwest::Method::POST);
    assert_eq!(req.url().as_str(), "http://127.0.0.1:11434/api/generate");
    assert_eq!(
        body_json(&req),
        serde_json::json!({"model": "llama3.2", "prompt": PROMPT, "stream": false})
    );
    for name in ["authorization", "x-api-key", "x-goog-api-key"] {
        assert_eq!(header(&req, name), None, "Ollama sends no {name}");
    }

    let capped = build(ollama_request(
        &client(),
        "http://127.0.0.1:11434",
        "llama3.2",
        PROMPT,
        Some(3),
    ));
    assert_eq!(
        body_json(&capped)["options"],
        serde_json::json!({"num_predict": 3})
    );
}

#[test]
fn every_provider_request_carries_the_120_second_prompt_timeout() {
    assert_eq!(PROMPT_REQUEST_TIMEOUT, Duration::from_secs(120));
    let c = client();
    let requests = [
        (
            "anthropic",
            build(anthropic_request(&c, ENDPOINT, KEY, "m", PROMPT, None)),
        ),
        (
            "openai",
            build(openai_request(&c, ENDPOINT, KEY, "m", PROMPT, None)),
        ),
        ("google", build(google_request(&c, KEY, "m", PROMPT, None))),
        (
            "ollama",
            build(ollama_request(&c, ENDPOINT, "m", PROMPT, None)),
        ),
    ];
    for (name, req) in &requests {
        assert_eq!(req.timeout(), Some(&PROMPT_REQUEST_TIMEOUT), "{name}");
    }
}

#[test]
fn api_keys_travel_only_in_headers_never_in_the_url_or_body() {
    let c = client();
    let keyed = [
        (
            "anthropic",
            "x-api-key",
            build(anthropic_request(&c, ENDPOINT, KEY, "m", PROMPT, None)),
        ),
        (
            "openai",
            "authorization",
            build(openai_request(&c, ENDPOINT, KEY, "m", PROMPT, None)),
        ),
        (
            "google",
            "x-goog-api-key",
            build(google_request(&c, KEY, "m", PROMPT, None)),
        ),
    ];
    for (name, header_name, req) in &keyed {
        assert!(!req.url().as_str().contains(KEY), "{name}: key in URL");
        let body = req.body().and_then(|b| b.as_bytes()).expect("body");
        assert!(
            !body.windows(KEY.len()).any(|w| w == KEY.as_bytes()),
            "{name}: key in body"
        );
        assert!(
            header(req, header_name).is_some_and(|v| v.contains(KEY)),
            "{name}: key must ride in `{header_name}`"
        );
    }
}

// ── response contract (one-shot loopback server) ────────────────────────────

/// A one-shot HTTP/1.1 server on loopback. It reads the WHOLE request (head,
/// then `Content-Length` bytes of body) before answering, so unread request
/// bytes cannot make the kernel RST the socket and cut the response short,
/// then waits for the client to hang up. Returns the base URL and a handle
/// resolving to the raw request text.
async fn serve_once(
    status_line: &'static str,
    body: Vec<u8>,
) -> (String, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind loopback");
    let addr = listener.local_addr().expect("local addr");
    let handle = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let mut request = Vec::new();
        let head_end = loop {
            let mut chunk = [0u8; 4096];
            let n = stream.read(&mut chunk).await.expect("read request head");
            if n == 0 {
                break request.len();
            }
            request.extend_from_slice(&chunk[..n]);
            if let Some(pos) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos + 4;
            }
        };
        let head = String::from_utf8_lossy(&request[..head_end]).into_owned();
        let content_length = head
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.trim()
                    .eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        while request.len() < head_end + content_length {
            let mut chunk = [0u8; 4096];
            let n = stream.read(&mut chunk).await.expect("read request body");
            if n == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..n]);
        }
        let response_head = format!(
            "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        // The client may hang up early (the body cap does), so write errors
        // are expected here and are not a test failure.
        let _ = stream.write_all(response_head.as_bytes()).await;
        let _ = stream.write_all(&body).await;
        let _ = stream.shutdown().await;
        let mut drain = [0u8; 256];
        let _ = tokio::time::timeout(Duration::from_secs(5), async {
            while let Ok(n) = stream.read(&mut drain).await {
                if n == 0 {
                    break;
                }
            }
        })
        .await;
        String::from_utf8_lossy(&request).into_owned()
    });
    (format!("http://{addr}"), handle)
}

async fn within<T>(fut: impl std::future::Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(15), fut)
        .await
        .expect("the loopback server answers at once; the provider call must finish")
}

#[tokio::test]
async fn ollama_forwards_the_response_field_as_one_chunk_then_done() {
    let (base, request) =
        serve_once("HTTP/1.1 200 OK", br#"{"response":"hi there"}"#.to_vec()).await;
    let sink = RecordingSink::new();
    let result = within(run_rest_ollama(&sink, &base, "llama3.2", PROMPT, None)).await;
    assert_eq!(result, Ok(()));
    assert_eq!(
        sink.events(),
        vec![SinkEvent::Chunk("hi there".to_string()), SinkEvent::Done]
    );
    let wire = request.await.expect("server task");
    assert!(
        wire.starts_with("POST /api/generate HTTP/1.1\r\n"),
        "sent: {wire}"
    );
}

#[tokio::test]
async fn a_non_2xx_status_is_reported_through_the_sink_with_status_and_body() {
    let (base, _request) =
        serve_once("HTTP/1.1 503 Service Unavailable", b"overloaded".to_vec()).await;
    let sink = RecordingSink::new();
    let result = within(run_rest_ollama(&sink, &base, "llama3.2", PROMPT, None)).await;
    assert_eq!(
        result,
        Ok(()),
        "an HTTP error is a sink event, not a Result error"
    );
    assert_eq!(
        sink.events(),
        vec![SinkEvent::Error(
            "Ollama API error 503 Service Unavailable: overloaded".to_string()
        )]
    );
}

#[tokio::test]
async fn a_body_over_the_5_mb_cap_is_refused_before_parsing() {
    let oversized = vec![b'x'; 5 * 1024 * 1024 + 1];
    let (base, _request) = serve_once("HTTP/1.1 200 OK", oversized).await;
    let sink = RecordingSink::new();
    let result = within(run_rest_ollama(&sink, &base, "llama3.2", PROMPT, None)).await;
    assert_eq!(result, Ok(()));
    assert_eq!(
        sink.events(),
        vec![SinkEvent::Error(
            "Response body exceeded 5 MB cap".to_string()
        )]
    );
}

#[tokio::test]
async fn a_success_without_the_expected_field_is_an_error_not_an_empty_chunk() {
    let (base, _request) = serve_once("HTTP/1.1 200 OK", br#"{"foo": 1}"#.to_vec()).await;
    let sink = RecordingSink::new();
    let result = within(run_rest_ollama(&sink, &base, "llama3.2", PROMPT, None)).await;
    assert_eq!(result, Ok(()));
    assert_eq!(
        sink.events(),
        vec![SinkEvent::Error(
            "No response field in Ollama response".to_string()
        )]
    );
}

#[tokio::test]
async fn an_unparseable_success_body_is_reported_as_a_parse_failure() {
    let (base, _request) = serve_once("HTTP/1.1 200 OK", b"not json".to_vec()).await;
    let sink = RecordingSink::new();
    let result = within(run_rest_ollama(&sink, &base, "llama3.2", PROMPT, None)).await;
    assert_eq!(result, Ok(()));
    let events = sink.events();
    assert_eq!(events.len(), 1, "{events:?}");
    assert!(
        matches!(&events[0], SinkEvent::Error(m) if m.starts_with("Failed to parse Ollama response:")),
        "{events:?}"
    );
}

#[tokio::test]
async fn anthropic_emits_one_chunk_per_text_block_and_sends_its_key_header() {
    let body = br#"{"content":[{"type":"text","text":"Hel"},{"type":"tool_use","id":"t1"},{"type":"text","text":"lo"}]}"#;
    let (base, request) = serve_once("HTTP/1.1 200 OK", body.to_vec()).await;
    let sink = RecordingSink::new();
    let result = within(run_rest_anthropic(
        &sink, &base, KEY, "claude-x", PROMPT, None,
    ))
    .await;
    assert_eq!(result, Ok(()));
    assert_eq!(
        sink.events(),
        vec![
            SinkEvent::Chunk("Hel".to_string()),
            SinkEvent::Chunk("lo".to_string()),
            SinkEvent::Done
        ]
    );
    let wire = request.await.expect("server task").to_ascii_lowercase();
    assert!(
        wire.starts_with("post /v1/messages http/1.1\r\n"),
        "sent: {wire}"
    );
    assert!(
        wire.contains("\r\nx-api-key: sk-leak-canary\r\n"),
        "sent: {wire}"
    );
}

#[tokio::test]
async fn openai_forwards_the_first_choice_message_content() {
    let body = br#"{"choices":[{"message":{"role":"assistant","content":"hello"}}]}"#;
    let (base, request) = serve_once("HTTP/1.1 200 OK", body.to_vec()).await;
    let sink = RecordingSink::new();
    let result = within(run_rest_openai(&sink, &base, KEY, "gpt-x", PROMPT, None)).await;
    assert_eq!(result, Ok(()));
    assert_eq!(
        sink.events(),
        vec![SinkEvent::Chunk("hello".to_string()), SinkEvent::Done]
    );
    let wire = request.await.expect("server task").to_ascii_lowercase();
    assert!(
        wire.starts_with("post /v1/chat/completions http/1.1\r\n"),
        "sent: {wire}"
    );
    assert!(
        wire.contains("\r\nauthorization: bearer sk-leak-canary\r\n"),
        "sent: {wire}"
    );
}
