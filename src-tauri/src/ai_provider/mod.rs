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
use tauri::{command, WebviewWindow};
use tokio_util::sync::CancellationToken;

use sink::{AiSink, ChannelEvent, ChannelSink, WindowSink};
use types::require_api_key;

/// Maximum bytes the in-process collector will accumulate from a provider.
/// A runaway provider will be aborted with an explicit error rather than
/// allowed to OOM the runner. Aligns with the runner's IPC truncation policy
/// (`runner::MAX_OUTPUT_SIZE_BYTES`).
const MAX_COLLECT_BYTES: usize = 5 * 1024 * 1024;

// ============================================================================
// Internal Dispatch
// ============================================================================

/// Provider dispatch shared between `run_ai_prompt` (window streaming) and
/// `run_ai_prompt_collect` (channel-collect for the workflow runner).
///
/// The `cancel` token is forwarded to providers that support cooperative
/// cancellation (today: every CLI provider; REST providers honor the token
/// via `tokio::select!` at call sites that wrap them).
async fn dispatch_to_provider(
    sink: Arc<dyn AiSink>,
    cancel: CancellationToken,
    provider: &str,
    prompt: &str,
    model: Option<String>,
    api_key: Option<String>,
    endpoint: Option<String>,
    cli_path: Option<String>,
) -> Result<(), String> {
    match provider {
        // CLI providers — run on tokio::process so kill() works from another task.
        "claude" => {
            cli::run_cli_blocking(
                sink,
                cancel,
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
                cancel,
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
                cancel,
                "gemini",
                vec!["-p".into(), prompt.to_string()],
                None,
                cli_path,
            )
            .await
        }

        // REST providers — cooperative cancellation via tokio::select!. If
        // the caller cancels, we drop the in-flight request and emit Cancelled.
        "anthropic" => {
            let Some(key) = require_api_key(sink.as_ref(), &api_key, "Anthropic") else {
                return Ok(());
            };
            let endpoint =
                endpoint.unwrap_or_else(|| "https://api.anthropic.com".to_string());
            let model = model.unwrap_or_else(|| "claude-sonnet-4-5-20250929".to_string());
            run_rest_with_cancel(sink, cancel, |s| async move {
                rest_providers::run_rest_anthropic(s.as_ref(), &endpoint, key, &model, prompt).await
            })
            .await
        }
        "openai" => {
            let Some(key) = require_api_key(sink.as_ref(), &api_key, "OpenAI") else {
                return Ok(());
            };
            let endpoint = endpoint.unwrap_or_else(|| "https://api.openai.com".to_string());
            let model = model.unwrap_or_else(|| "gpt-4o".to_string());
            run_rest_with_cancel(sink, cancel, |s| async move {
                rest_providers::run_rest_openai(s.as_ref(), &endpoint, key, &model, prompt).await
            })
            .await
        }
        "google-ai" => {
            let Some(key) = require_api_key(sink.as_ref(), &api_key, "Google AI") else {
                return Ok(());
            };
            let model = model.unwrap_or_else(|| "gemini-2.0-flash".to_string());
            run_rest_with_cancel(sink, cancel, |s| async move {
                rest_providers::run_rest_google(s.as_ref(), key, &model, prompt).await
            })
            .await
        }
        "ollama-api" => {
            let endpoint = endpoint.unwrap_or_else(|| "http://localhost:11434".to_string());
            let model = model.unwrap_or_else(|| "llama3.2".to_string());
            run_rest_with_cancel(sink, cancel, |s| async move {
                rest_providers::run_rest_ollama(s.as_ref(), &endpoint, &model, prompt).await
            })
            .await
        }

        _ => {
            sink.error(&format!("Unknown provider: {}", provider));
            Err(format!("Unknown provider: {}", provider))
        }
    }
}

/// Wrap a REST provider call with cooperative cancellation. If the cancel
/// token fires while the request is in flight, we drop the request future,
/// emit "Cancelled" through the sink, and return Ok (the runner treats
/// cancellation as an upstream signal, not a provider error).
async fn run_rest_with_cancel<F, Fut>(
    sink: Arc<dyn AiSink>,
    cancel: CancellationToken,
    f: F,
) -> Result<(), String>
where
    F: FnOnce(Arc<dyn AiSink>) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let sink_for_call = Arc::clone(&sink);
    tokio::select! {
        _ = cancel.cancelled() => {
            sink.error("Cancelled");
            Ok(())
        }
        result = f(sink_for_call) => result,
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
    // The streaming editor path doesn't currently expose a per-request cancel
    // token; the legacy `aiInvocationStore.cancel` flow drops the listener
    // instead. Wire a fresh, never-fired token here. (When the editor path
    // gains real cancellation, a token from the caller can replace this.)
    let cancel = CancellationToken::new();
    dispatch_to_provider(
        sink, cancel, &provider, &prompt, model, api_key, endpoint, cli_path,
    )
    .await
}

// ============================================================================
// Public Helper — collect into a String (for the workflow runner)
// ============================================================================

/// Run an AI prompt and collect the full response into a String.
///
/// Drives a `ChannelSink` and a tokio mpsc receiver. Drops the dispatch
/// future as soon as the receiver sees a terminal event (`Done`/`Error`/
/// channel-close), and signals the cancellation token so any downstream
/// provider work (CLI children, REST requests) is aborted promptly.
///
/// Returns:
///   - `Ok(text)` on `Done` — `text` is the concatenation of all chunks.
///   - `Err(msg)` on `Error` — `msg` is the error from the sink.
///   - `Err("Cancelled")` if the caller signals `cancel` first.
///   - `Err("Provider output exceeded N MB cap")` if collected text grows
///     past `MAX_COLLECT_BYTES`.
///   - `Err("stream ended without done signal")` if the channel closes
///     without a terminal event (provider crash, etc.).
pub async fn run_ai_prompt_collect(
    cancel: CancellationToken,
    provider: &str,
    prompt: &str,
    model: Option<&str>,
    api_key: Option<&str>,
    endpoint: Option<&str>,
    cli_path: Option<&str>,
) -> Result<String, String> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ChannelEvent>();
    let sink: Arc<dyn AiSink> = Arc::new(ChannelSink::new(tx));

    let dispatch_cancel = cancel.clone();
    let dispatch_fut = dispatch_to_provider(
        sink,
        dispatch_cancel,
        provider,
        prompt,
        model.map(String::from),
        api_key.map(String::from),
        endpoint.map(String::from),
        cli_path.map(String::from),
    );
    tokio::pin!(dispatch_fut);

    let mut text = String::new();
    let mut dispatch_done = false;

    loop {
        tokio::select! {
            // Caller cancelled — abort dispatch and return.
            _ = cancel.cancelled() => {
                // Drop the dispatch future implicitly when the loop exits.
                return Err("Cancelled".to_string());
            }
            // Dispatch finished. The sink will already have emitted Done/Error
            // (which the recv arm picks up); just remember and let the recv
            // arm produce the verdict.
            res = &mut dispatch_fut, if !dispatch_done => {
                dispatch_done = true;
                if let Err(e) = res {
                    // Provider returned Err without emitting through sink —
                    // surface that as the result.
                    return Err(e);
                }
            }
            event = rx.recv() => {
                match event {
                    Some(ChannelEvent::Chunk(s)) => {
                        if text.len().saturating_add(s.len()) > MAX_COLLECT_BYTES {
                            cancel.cancel();
                            return Err(format!(
                                "Provider output exceeded {} MB cap",
                                MAX_COLLECT_BYTES / (1024 * 1024)
                            ));
                        }
                        text.push_str(&s);
                    }
                    Some(ChannelEvent::Done) => return Ok(text),
                    Some(ChannelEvent::Error(msg)) => return Err(msg),
                    None => {
                        // Sender dropped without a terminal event. If dispatch
                        // returned Ok already, treat as orderly close; else
                        // surface as crash.
                        if dispatch_done {
                            return Ok(text);
                        }
                        return Err("stream ended without done signal".to_string());
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A successful CLI provider completion returns the collected text.
    #[tokio::test]
    async fn collect_returns_text_on_done() {
        let cancel = CancellationToken::new();
        let result = run_ai_prompt_collect(
            cancel,
            "claude",
            "ignored",
            None,
            None,
            None,
            // Force the cli_path to /bin/echo. The args list emitted by
            // dispatch_to_provider for "claude" is not what `echo` expects,
            // but it WILL print them. We assert "ignored" appears.
            Some("/bin/echo"),
        )
        .await;

        assert!(result.is_ok(), "expected Ok got {:?}", result);
        let text = result.unwrap();
        assert!(text.contains("ignored"), "expected echoed prompt in {}", text);
    }

    /// Cancellation aborts the collect with the canonical error.
    #[tokio::test]
    async fn collect_cancellation_returns_cancelled() {
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();

        let task = tokio::spawn(async move {
            run_ai_prompt_collect(
                cancel_clone,
                "claude",
                "ignored",
                None,
                None,
                None,
                // /bin/sleep ignores claude args; sleeps for "30" (first arg).
                Some("/bin/sleep"),
            )
            .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        cancel.cancel();

        let outcome = tokio::time::timeout(std::time::Duration::from_secs(3), task)
            .await
            .expect("task did not return within 3s of cancel");
        let result = outcome.unwrap();
        assert!(
            matches!(result, Err(ref e) if e == "Cancelled"),
            "expected Err(Cancelled), got {:?}",
            result
        );
    }

    /// Unknown provider yields an error path through the sink.
    #[tokio::test]
    async fn collect_unknown_provider_errors() {
        let cancel = CancellationToken::new();
        let result = run_ai_prompt_collect(
            cancel,
            "no-such-provider",
            "anything",
            None,
            None,
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(ref msg) if msg.contains("Unknown provider")));
    }
}
