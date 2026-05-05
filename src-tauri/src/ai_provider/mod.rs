//! AI Provider Router
//!
//! Detects available CLI AI providers and executes prompts via shell commands
//! or REST APIs. Forwards output through `&dyn AiSink` (see `sink.rs`) so
//! both the streaming editor path and the headless workflow runner share one
//! provider implementation.
//!
//! # Submodules
//!
//! - `types`          -- Shared types (`CliProviderEntry`, `AiResponseChunk`)
//! - `sink`           -- `AiSink` trait + `WindowSink` / `ChannelSink` impls
//! - `detection`      -- CLI provider detection, login-shell PATH, env API keys
//! - `rest_api`       -- API key testing, model listing, model validation
//! - `cli`            -- CLI provider spawning and stdout streaming
//! - `rest_providers` -- REST provider prompt execution

mod cli;
mod detection;
mod http_client;
mod rest_api;
mod rest_providers;
pub mod sink;
mod types;

// Re-export everything from submodules that define Tauri `#[command]`s.
// Wildcard re-exports are required because `generate_handler!` resolves
// hidden `__cmd__*` companion items at the same module path.
#[allow(unused_imports)]
pub use detection::*;
#[allow(unused_imports)]
pub use rest_api::*;

// Re-export crate-internal helpers used by other modules (e.g. mcp/).
#[allow(unused_imports)]
pub(crate) use cli::build_command;
#[allow(unused_imports)]
pub(crate) use detection::login_shell_path;

use std::sync::Arc;
use tauri::{command, AppHandle, WebviewWindow};

use sink::{AiSink, ChannelEvent, ChannelSink, WindowSink};
use types::require_api_key;

// ============================================================================
// Internal Dispatch
// ============================================================================

/// Provider dispatch shared between `run_ai_prompt` (window streaming) and
/// `run_ai_prompt_collect` (channel-collect for the workflow runner).
async fn dispatch_to_provider(
    sink: Arc<dyn AiSink>,
    provider: &str,
    prompt: &str,
    model: Option<String>,
    api_key: Option<String>,
    endpoint: Option<String>,
    cli_path: Option<String>,
) -> Result<(), String> {
    match provider {
        // CLI providers -- run on blocking thread pool to avoid starving tokio
        "claude" => {
            cli::run_cli_blocking(
                sink,
                "claude",
                vec![
                    "-p".into(),
                    prompt.to_string(),
                    "--output-format".into(),
                    "text".into(),
                ],
                None,
                cli_path,
            )
            .await
        }
        "codex" => {
            cli::run_cli_blocking(
                sink,
                "codex",
                vec![
                    "exec".into(),
                    "--skip-git-repo-check".into(),
                    prompt.to_string(),
                ],
                None,
                cli_path,
            )
            .await
        }
        "gemini" => {
            cli::run_cli_blocking(
                sink,
                "gemini",
                vec!["-p".into(), prompt.to_string()],
                None,
                cli_path,
            )
            .await
        }

        // REST providers
        "anthropic" => {
            let Some(key) = require_api_key(sink.as_ref(), &api_key, "Anthropic") else {
                return Ok(());
            };
            rest_providers::run_rest_anthropic(
                sink.as_ref(),
                &endpoint.unwrap_or_else(|| "https://api.anthropic.com".to_string()),
                key,
                &model.unwrap_or_else(|| "claude-sonnet-4-5-20250929".to_string()),
                prompt,
            )
            .await
        }
        "openai" => {
            let Some(key) = require_api_key(sink.as_ref(), &api_key, "OpenAI") else {
                return Ok(());
            };
            rest_providers::run_rest_openai(
                sink.as_ref(),
                &endpoint.unwrap_or_else(|| "https://api.openai.com".to_string()),
                key,
                &model.unwrap_or_else(|| "gpt-4o".to_string()),
                prompt,
            )
            .await
        }
        "google-ai" => {
            let Some(key) = require_api_key(sink.as_ref(), &api_key, "Google AI") else {
                return Ok(());
            };
            rest_providers::run_rest_google(
                sink.as_ref(),
                key,
                &model.unwrap_or_else(|| "gemini-2.0-flash".to_string()),
                prompt,
            )
            .await
        }
        "ollama-api" => {
            rest_providers::run_rest_ollama(
                sink.as_ref(),
                &endpoint.unwrap_or_else(|| "http://localhost:11434".to_string()),
                &model.unwrap_or_else(|| "llama3.2".to_string()),
                prompt,
            )
            .await
        }

        _ => {
            sink.error(&format!("Unknown provider: {}", provider));
            Err(format!("Unknown provider: {}", provider))
        }
    }
}

// ============================================================================
// Public Tauri Command — streaming to a webview
// ============================================================================

/// Run an AI prompt and stream results back via `ai:response` events.
///
/// For CLI providers: pipes prompt to stdin of the CLI tool.
/// For REST providers: sends HTTP request via reqwest.
/// `cli_path` is the resolved absolute path from detection (used on
/// Windows where bare command names may not find `.cmd`/`.bat` shims).
#[command]
pub async fn run_ai_prompt(
    window: WebviewWindow,
    request_id: String,
    provider: String,
    prompt: String,
    model: Option<String>,
    api_key: Option<String>,
    endpoint: Option<String>,
    cli_path: Option<String>,
) -> Result<(), String> {
    let sink: Arc<dyn AiSink> = Arc::new(WindowSink::new(window, request_id));
    dispatch_to_provider(sink, &provider, &prompt, model, api_key, endpoint, cli_path).await
}

// ============================================================================
// Public Helper — collect into a String (for the workflow runner)
// ============================================================================

/// Run an AI prompt and collect the full response into a String.
///
/// Drives a `ChannelSink` and a tokio mpsc receiver concurrently from the same
/// task. Returns:
///   - `Ok(text)` on `done` — `text` is the concatenation of all chunks.
///   - `Err(msg)` on `error` — `msg` is the error from the sink.
///   - `Err("stream ended without done signal")` if the sender drops without
///     a terminal event (provider crash, etc.).
///
/// `app` is currently unused but reserved for future cancellation hooks.
pub async fn run_ai_prompt_collect(
    _app: &AppHandle,
    provider: &str,
    prompt: &str,
    model: Option<&str>,
    api_key: Option<&str>,
    endpoint: Option<&str>,
    cli_path: Option<&str>,
) -> Result<String, String> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ChannelEvent>();
    let sink: Arc<dyn AiSink> = Arc::new(ChannelSink::new(tx));

    let dispatch = dispatch_to_provider(
        sink,
        provider,
        prompt,
        model.map(String::from),
        api_key.map(String::from),
        endpoint.map(String::from),
        cli_path.map(String::from),
    );

    let collect = async move {
        let mut text = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                ChannelEvent::Chunk(s) => text.push_str(&s),
                ChannelEvent::Done => return Ok(text),
                ChannelEvent::Error(msg) => return Err(msg),
            }
        }
        Err("stream ended without done signal".to_string())
    };

    let (_dispatch_res, collect_res) = tokio::join!(dispatch, collect);
    collect_res
}
