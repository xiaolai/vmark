//! WI-FL5.3 — `dispatch_to_provider`'s routing arms.
//!
//! Every arm is exercised with no server and no real provider: the refusals
//! are pure; a REST arm is identified by the "<Provider> request failed"
//! prefix it produces when its endpoint is a loopback port nothing listens
//! on; the CLI arms run a `/bin/sh` shim that prints its argv — the POSIX-shim
//! technique `cli.test.rs` already uses. Google has no endpoint parameter
//! (its public host is hard-coded), so its arm is covered here only up to the
//! API-key refusal; its request shape is pinned in `rest_providers.test.rs`.

use super::{dispatch_to_provider, run_rest_with_cancel, ProviderRequest};
use crate::ai_provider::sink::testing::{RecordingSink, SinkEvent};
use crate::ai_provider::sink::AiSink;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

fn request<'a>(provider: &'a str, prompt: &'a str) -> ProviderRequest<'a> {
    ProviderRequest {
        provider,
        prompt,
        model: None,
        api_key: None,
        endpoint: None,
        cli_path: None,
        max_tokens: None,
    }
}

async fn dispatch(sink: &Arc<RecordingSink>, request: ProviderRequest<'_>) -> Result<(), String> {
    let dyn_sink: Arc<dyn AiSink> = sink.clone();
    tokio::time::timeout(
        Duration::from_secs(30),
        dispatch_to_provider(dyn_sink, CancellationToken::new(), request),
    )
    .await
    .expect("dispatch must finish: nothing here waits on a real provider")
}

/// A loopback port with nothing listening. A REST arm that reaches its
/// request builder fails at connect, immediately, with the provider's own
/// "<Name> request failed" prefix — no server needed to see which arm ran.
async fn dead_endpoint() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    drop(listener);
    format!("http://{addr}")
}

// ── refusals (pure) ─────────────────────────────────────────────────────────

#[tokio::test]
async fn an_unknown_provider_is_refused_on_both_channels() {
    let sink = Arc::new(RecordingSink::new());
    let result = dispatch(&sink, request("nope", "hi")).await;
    assert_eq!(result, Err("Unknown provider: nope".to_string()));
    assert_eq!(
        sink.events(),
        vec![SinkEvent::Error("Unknown provider: nope".to_string())]
    );
}

#[tokio::test]
async fn rest_providers_refuse_to_start_without_an_api_key() {
    let named = [
        ("anthropic", "Anthropic"),
        ("openai", "OpenAI"),
        ("openai-compatible", "OpenAI-compatible"),
        ("google-ai", "Google AI"),
    ];
    for (provider, name) in named {
        for key in [None, Some(String::new())] {
            let sink = Arc::new(RecordingSink::new());
            let mut req = request(provider, "hi");
            req.api_key = key.clone();
            let result = dispatch(&sink, req).await;
            assert_eq!(result, Ok(()), "{provider} with key {key:?}");
            assert_eq!(
                sink.events(),
                vec![SinkEvent::Error(format!("{name} API key is required"))],
                "{provider} with key {key:?}"
            );
        }
    }
}

#[tokio::test]
async fn openai_compatible_requires_an_endpoint_and_then_a_model() {
    let sink = Arc::new(RecordingSink::new());
    let mut req = request("openai-compatible", "hi");
    req.api_key = Some("k".to_string());
    assert_eq!(dispatch(&sink, req).await, Ok(()));
    assert_eq!(
        sink.events(),
        vec![SinkEvent::Error(
            "Endpoint (base URL) is required for the OpenAI-compatible provider".to_string()
        )]
    );

    for model in [None, Some(String::new())] {
        let sink = Arc::new(RecordingSink::new());
        let mut req = request("openai-compatible", "hi");
        req.api_key = Some("k".to_string());
        req.endpoint = Some("https://compat.example.test".to_string());
        req.model = model.clone();
        assert_eq!(dispatch(&sink, req).await, Ok(()), "model {model:?}");
        assert_eq!(
            sink.events(),
            vec![SinkEvent::Error(
                "Model is required for the OpenAI-compatible provider".to_string()
            )],
            "model {model:?}"
        );
    }
}

// ── REST arms reach their own request builder ───────────────────────────────

#[tokio::test]
async fn each_rest_arm_reaches_its_own_request_builder_and_surfaces_transport_errors_to_the_caller()
{
    let endpoint = dead_endpoint().await;
    // (provider, api key, model, expected error prefix). Ollama needs no key;
    // openai-compatible shares OpenAI's builder, so it carries OpenAI's prefix.
    let arms = [
        ("anthropic", Some("k"), None, "Anthropic request failed:"),
        ("openai", Some("k"), None, "OpenAI request failed:"),
        (
            "openai-compatible",
            Some("k"),
            Some("m"),
            "OpenAI request failed:",
        ),
        ("ollama-api", None, None, "Ollama request failed:"),
    ];
    for (provider, key, model, prefix) in arms {
        let sink = Arc::new(RecordingSink::new());
        let mut req = request(provider, "hi");
        req.api_key = key.map(String::from);
        req.model = model.map(String::from);
        req.endpoint = Some(endpoint.clone());
        let err = dispatch(&sink, req).await.expect_err(provider);
        assert!(err.starts_with(prefix), "{provider}: {err}");
        assert_eq!(
            sink.events(),
            vec![],
            "{provider}: a transport failure is returned to the caller, not doubled into the sink"
        );
    }
}

// ── CLI arms ────────────────────────────────────────────────────────────────

/// A stand-in CLI binary that prints each argv entry on its own line.
#[cfg(unix)]
fn argv_shim() -> (tempfile::TempDir, String) {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("fake-cli");
    std::fs::write(
        &path,
        "#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done\n",
    )
    .expect("write shim");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    (dir, path.to_str().expect("utf-8 path").to_string())
}

#[cfg(unix)]
#[tokio::test]
async fn cli_arms_spawn_their_binary_with_the_provider_argv_and_need_no_api_key() {
    let (_dir, shim) = argv_shim();
    let cases: [(&str, Vec<&str>); 3] = [
        (
            "claude",
            vec!["-p", "hello world", "--output-format", "text"],
        ),
        (
            "codex",
            vec!["exec", "--skip-git-repo-check", "hello world"],
        ),
        ("gemini", vec!["-p", "hello world"]),
    ];
    for (provider, expected) in cases {
        let sink = Arc::new(RecordingSink::new());
        let mut req = request(provider, "hello world");
        req.cli_path = Some(shim.clone());
        assert_eq!(dispatch(&sink, req).await, Ok(()), "{provider}");
        let text = sink.collected_text();
        assert_eq!(
            text.lines().collect::<Vec<_>>(),
            expected,
            "{provider} argv"
        );
        assert_eq!(
            sink.events().last(),
            Some(&SinkEvent::Done),
            "{provider} must end with Done"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn max_tokens_neither_constrains_nor_blocks_a_cli_provider() {
    let (_dir, shim) = argv_shim();
    let sink = Arc::new(RecordingSink::new());
    let mut req = request("claude", "hello world");
    req.cli_path = Some(shim);
    req.max_tokens = Some(10);
    assert_eq!(dispatch(&sink, req).await, Ok(()));
    assert_eq!(
        sink.collected_text().lines().collect::<Vec<_>>(),
        vec!["-p", "hello world", "--output-format", "text"],
        "the cap is only logged (D8): no flag reaches the CLI"
    );
}

// ── cooperative cancellation around a REST call ─────────────────────────────

#[tokio::test]
async fn a_cancelled_token_short_circuits_a_rest_call_as_cancelled_not_an_error() {
    let sink = Arc::new(RecordingSink::new());
    let dyn_sink: Arc<dyn AiSink> = sink.clone();
    let cancel = CancellationToken::new();
    cancel.cancel();
    let result = run_rest_with_cancel(dyn_sink, cancel, |_sink: Arc<dyn AiSink>| {
        std::future::pending::<Result<(), String>>()
    })
    .await;
    assert_eq!(
        result,
        Ok(()),
        "cancellation is an upstream signal, not a provider error"
    );
    assert_eq!(
        sink.events(),
        vec![SinkEvent::Error("Cancelled".to_string())]
    );
}

#[tokio::test]
async fn an_uncancelled_rest_call_result_passes_through_unchanged() {
    let sink = Arc::new(RecordingSink::new());
    let dyn_sink: Arc<dyn AiSink> = sink.clone();
    let ok = run_rest_with_cancel(
        dyn_sink,
        CancellationToken::new(),
        |s: Arc<dyn AiSink>| async move {
            s.done();
            Ok(())
        },
    )
    .await;
    assert_eq!(ok, Ok(()));
    assert_eq!(sink.events(), vec![SinkEvent::Done]);

    let sink = Arc::new(RecordingSink::new());
    let dyn_sink: Arc<dyn AiSink> = sink.clone();
    let err = run_rest_with_cancel(
        dyn_sink,
        CancellationToken::new(),
        |_s: Arc<dyn AiSink>| async { Err("boom".to_string()) },
    )
    .await;
    assert_eq!(err, Err("boom".to_string()));
    assert_eq!(
        sink.events(),
        vec![],
        "a provider error is not re-emitted as Cancelled"
    );
}
