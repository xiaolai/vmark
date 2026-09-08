//! #271 — the bundled sample workflow, EXECUTED.
//!
//! `examples.rs` proves the sample parses, resolves and names real genies.
//! None of that is a run: the shipped sample once passed `content:` to a
//! step whose executor demands `input`, and every structural test stayed
//! green while the last step failed at run time. Here the sample goes
//! through `run_workflow_sequential` — the real runner, on a mock Tauri
//! runtime — with a fake OpenAI-compatible provider answering on loopback
//! and the two bundled genies installed in a temp genies directory. The
//! assertions are on what a user would see: the file the `save` step
//! wrote, the prompts the provider received (the seed text reached the
//! first genie, the first genie's answer reached the second), and the
//! `workflow:complete` event.
//!
//! The runner needs no Wry-specific handle — every `app` use is an event
//! emit — and the REST provider needs no app at all, only an endpoint. That
//! is why this runs under `cargo test` rather than in the e2e tier.

// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// `test` feature off it); gated like every mock-runtime suite in this crate.
#![cfg(not(target_os = "windows"))]

use super::{GENIE_REWRITE, GENIE_TRANSLATE, SAMPLE_WORKFLOW};
use crate::workflow::approval::ApprovalRegistry;
use crate::workflow::genie_step::ProviderConfig;
use crate::workflow::runner::run_workflow_sequential;
use crate::workflow::types::RawWorkflow;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Listener;

/// A one-thread HTTP/1.1 server answering `POST /v1/chat/completions` with one
/// canned completion per request, in order, recording every prompt it saw.
struct FakeProvider {
    endpoint: String,
    prompts: Arc<Mutex<Vec<String>>>,
}

fn fake_provider(replies: &'static [&'static str]) -> FakeProvider {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let endpoint = format!("http://{}", listener.local_addr().expect("addr"));
    let prompts = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&prompts);
    std::thread::spawn(move || {
        for reply in replies {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let body = read_request_body(&mut stream);
            let prompt = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v["messages"][0]["content"].as_str().map(str::to_string))
                .unwrap_or(body);
            seen.lock().expect("prompts lock").push(prompt);
            let json = serde_json::json!({
                "choices": [{ "message": { "role": "assistant", "content": reply } }]
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                json.len(),
                json
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    FakeProvider { endpoint, prompts }
}

/// Read one request's headers and body. `Content-Length` is what reqwest
/// sends for a JSON body, so that is all the server needs to understand.
fn read_request_body(stream: &mut TcpStream) -> String {
    let mut reader = BufReader::new(stream);
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).expect("header line") == 0 || line == "\r\n" {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body).expect("body");
    String::from_utf8_lossy(&body).into_owned()
}

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// The two bundled genies the sample chains, installed where the runner
/// looks for them (`<genies>/<category>/<name>.md`).
fn genies_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("genies dir");
    let tools = dir.path().join("tools");
    std::fs::create_dir_all(&tools).expect("mkdir tools");
    std::fs::write(tools.join("rewrite-in-english.md"), GENIE_REWRITE).expect("write");
    std::fs::write(tools.join("translate.md"), GENIE_TRANSLATE).expect("write");
    dir
}

#[tokio::test]
async fn the_bundled_sample_runs_end_to_end_and_saves_the_translation() {
    const REWRITTEN: &str = "REWRITTEN BY THE FAKE PROVIDER";
    const TRANSLATED: &str = "TRANSLATED BY THE FAKE PROVIDER";

    let app = mock_app();
    let provider = fake_provider(&[REWRITTEN, TRANSLATED]);
    let genies = genies_dir();
    let workspace = tempfile::tempdir().expect("workspace");
    let (complete_tx, complete_rx) = std::sync::mpsc::channel();
    app.listen_any("workflow:complete", move |event| {
        let _ = complete_tx.send(event.payload().to_string());
    });

    let mut workflow: RawWorkflow =
        serde_yaml_ng::from_str(SAMPLE_WORKFLOW).expect("the bundled sample parses");
    // The OpenAI-compatible provider has no default model; a real run takes
    // it from the step, the genie or the workflow defaults. The sample sets
    // none, so it is supplied the way a user's `defaults.model` would be.
    workflow.defaults.model = Some("fake-model".to_string());

    let cancel = Arc::new(AtomicBool::new(false));
    let result = run_workflow_sequential(
        app.handle(),
        workflow,
        HashMap::new(),
        workspace.path(),
        "exec-sample",
        &cancel,
        Some(ProviderConfig {
            provider: "openai-compatible".to_string(),
            api_key: Some("test-key".to_string()),
            endpoint: Some(provider.endpoint.clone()),
            cli_path: None,
        }),
        Some(genies.path().to_path_buf()),
        Arc::new(ApprovalRegistry::new()),
    )
    .await;
    assert_eq!(result, Ok("exec-sample".to_string()));

    // The last step's output, on disk, in the workspace.
    let saved = std::fs::read_to_string(workspace.path().join("triage-and-translate.out.md"))
        .expect("the save step wrote its file into the workspace");
    assert_eq!(saved, TRANSLATED);

    // The wiring between steps, as the provider saw it.
    let prompts = provider.prompts.lock().expect("prompts lock").clone();
    assert_eq!(prompts.len(), 2, "two genie steps, two provider calls");
    assert!(
        prompts[0].contains("Replace this seed text"),
        "the seed `input` reached the first genie's `{{{{content}}}}`: {}",
        prompts[0]
    );
    assert!(
        prompts[1].contains(REWRITTEN),
        "`${{{{ steps.rewrite.outputs.text }}}}` carried the first answer into the second genie: {}",
        prompts[1]
    );

    // And the completion the frontend subscribes to.
    let complete: serde_json::Value = serde_json::from_str(
        &complete_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("a workflow:complete event"),
    )
    .expect("JSON payload");
    assert_eq!(complete["executionId"], "exec-sample");
    assert_eq!(complete["status"], "completed");
}

#[tokio::test]
async fn a_provider_failure_fails_the_genie_step_and_the_run_and_saves_nothing() {
    // The same runner, a provider that never answers well: the first genie
    // step errors, the dependents are skipped, no file is written.
    let app = mock_app();
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let endpoint = format!("http://{}", listener.local_addr().expect("addr"));
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = read_request_body(&mut stream);
            let _ = stream.write_all(
                b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
    });
    let genies = genies_dir();
    let workspace = tempfile::tempdir().expect("workspace");
    let mut workflow: RawWorkflow = serde_yaml_ng::from_str(SAMPLE_WORKFLOW).expect("parses");
    workflow.defaults.model = Some("fake-model".to_string());

    let result = run_workflow_sequential(
        app.handle(),
        workflow,
        HashMap::new(),
        workspace.path(),
        "exec-failing",
        &Arc::new(AtomicBool::new(false)),
        Some(ProviderConfig {
            provider: "openai-compatible".to_string(),
            api_key: Some("test-key".to_string()),
            endpoint: Some(endpoint),
            cli_path: None,
        }),
        Some(genies.path().to_path_buf()),
        Arc::new(ApprovalRegistry::new()),
    )
    .await;
    let err = result.expect_err("a failed provider fails the run");
    assert!(err.contains("rewrite"), "names the failed step: {err}");
    assert!(
        !workspace
            .path()
            .join("triage-and-translate.out.md")
            .exists(),
        "a skipped save step writes nothing"
    );
}
