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
//! - `spawn`          -- Process-spawn platform utilities (no-console-window)
//! - `rest_providers` -- REST provider prompt execution
//! - `dispatch`       -- `ProviderRequest` + provider dispatch shared by both entry points

mod cli;
mod cli_path_guard;
mod detection;
mod dispatch;
mod endpoint;
mod http_client;
mod rest_api;
mod rest_providers;
pub mod sink;
pub(crate) mod spawn;
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
pub(crate) use {
    detection::login_shell_path, spawn::build_command, spawn::capture_stdout_with_timeout,
    spawn::which_command,
};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{command, WebviewWindow};
use tokio_util::sync::CancellationToken;

use dispatch::{dispatch_to_provider, ProviderRequest};
use sink::{AiSink, ChannelEvent, ChannelSink, WindowSink};

/// Maximum bytes the in-process collector will accumulate from a provider.
/// A runaway provider will be aborted with an explicit error rather than
/// allowed to OOM the runner. Aligns with the runner's IPC truncation policy
/// (`runner::MAX_OUTPUT_SIZE_BYTES`).
const MAX_COLLECT_BYTES: usize = 5 * 1024 * 1024;

/// Bound on the collect channel's in-flight message depth.
///
/// The precise memory bound is the sink-side byte-gate (`ChannelSink` stops
/// forwarding once cumulative output reaches `MAX_COLLECT_BYTES`), so this
/// count is a coarse secondary backstop, not the primary limit. It is sized
/// well above any realistic single-scheduler-poll burst — tokio's cooperative
/// budget forces the dispatch task to yield (letting the collector drain) long
/// before this many chunks queue up — so legitimate streaming never trips it.
/// A `Full` send is treated as the cap being hit, same as the byte-gate.
const COLLECT_CHANNEL_CAPACITY: usize = 1024;

// ===== Public Tauri Command — streaming to a webview ========================

/// Run an AI prompt and stream results back via `ai:response` events.
///
/// For CLI providers: pipes prompt to stdin of the CLI tool.
/// For REST providers: sends HTTP request via reqwest.
/// `cli_path` is the resolved absolute path from detection (used on
/// Windows where bare command names may not find `.cmd`/`.bat` shims).
// The parameter list is the frontend `invoke()` IPC contract.
#[allow(clippy::too_many_arguments)]
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
    // WI-0B.2: `cli_path` is untrusted webview input and previously overrode the
    // spawned binary outright (`cli_path="/bin/sh"` → RCE). Validate at the
    // boundary; internal callers stay injectable.
    cli_path_guard::validate_cli_path(&provider, cli_path.as_deref())?;

    let sink: Arc<dyn AiSink> = Arc::new(WindowSink::new(window, request_id));
    // The streaming editor path doesn't currently expose a per-request cancel
    // token; the legacy `aiInvocationStore.cancel` flow drops the listener
    // instead. Wire a fresh, never-fired token here. (When the editor path
    // gains real cancellation, a token from the caller can replace this.)
    let cancel = CancellationToken::new();
    dispatch_to_provider(
        sink,
        cancel,
        ProviderRequest {
            provider: &provider,
            prompt: &prompt,
            model,
            api_key,
            endpoint,
            cli_path,
            max_tokens: None,
        },
    )
    .await
}

// ===== Public Helper — collect into a String (for the workflow runner) ======

/// Run an AI prompt and collect the full response into a String.
///
/// Drives a `ChannelSink` and a *bounded* tokio mpsc receiver. Drops the
/// dispatch future as soon as the receiver sees a terminal event
/// (`Done`/`Error`/channel-close), and signals the cancellation token so any
/// downstream provider work (CLI children, REST requests) is aborted promptly.
/// The sink's cumulative byte-gate keeps peak buffered output bounded by
/// `MAX_COLLECT_BYTES`; when it trips it fires `cancel` and sets `overflowed`
/// so the collector surfaces the cap error rather than a plain cancellation.
///
/// Returns:
///   - `Ok(text)` on `Done` — `text` is the concatenation of all chunks.
///   - `Err(msg)` on `Error` — `msg` is the error from the sink.
///   - `Err("Cancelled")` if the caller signals `cancel` first.
///   - `Err("Provider output exceeded N MB cap")` if collected text grows
///     past `MAX_COLLECT_BYTES`.
///   - `Err("stream ended without done signal")` if the channel closes
///     without a terminal event (provider crash, contract violation, etc.).
#[allow(clippy::too_many_arguments)]
pub async fn run_ai_prompt_collect(
    cancel: CancellationToken,
    provider: &str,
    prompt: &str,
    model: Option<&str>,
    api_key: Option<&str>,
    endpoint: Option<&str>,
    cli_path: Option<&str>,
    max_tokens: Option<u64>,
) -> Result<String, String> {
    let (tx, rx) = tokio::sync::mpsc::channel::<ChannelEvent>(COLLECT_CHANNEL_CAPACITY);
    let overflowed = Arc::new(AtomicBool::new(false));
    let sink: Arc<dyn AiSink> = Arc::new(ChannelSink::new(
        tx,
        cancel.clone(),
        Arc::clone(&overflowed),
    ));

    let dispatch_cancel = cancel.clone();
    let dispatch_fut = dispatch_to_provider(
        sink,
        dispatch_cancel,
        ProviderRequest {
            provider,
            prompt,
            model: model.map(String::from),
            api_key: api_key.map(String::from),
            endpoint: endpoint.map(String::from),
            cli_path: cli_path.map(String::from),
            max_tokens,
        },
    );

    collect_from_channel(cancel, overflowed, rx, dispatch_fut).await
}

/// Collect loop shared by `run_ai_prompt_collect` — generic over the dispatch
/// future so the terminal-event contract can be unit-tested with injected
/// producers.
async fn collect_from_channel<F>(
    cancel: CancellationToken,
    overflowed: Arc<AtomicBool>,
    mut rx: tokio::sync::mpsc::Receiver<ChannelEvent>,
    dispatch_fut: F,
) -> Result<String, String>
where
    F: std::future::Future<Output = Result<(), String>>,
{
    tokio::pin!(dispatch_fut);

    let mut text = String::new();
    let mut dispatch_done = false;

    // The overflow (cap) verdict must win over EVERY other terminal outcome.
    // When the sink's byte-gate trips it stores `overflowed` (SeqCst) *before*
    // firing `cancel`, which kills the provider and closes the channel. That
    // makes several terminal arms race: the cancel arm, the channel-closed
    // (`recv` → `None`) arm, and any late Done/Error. `select!` picks a ready
    // arm at random, so gating the cap check on only one arm is flaky — an
    // over-cap run could otherwise surface "Cancelled" or "stream ended
    // without done signal". `finalize` funnels every terminal return through a
    // single check: if `overflowed` is set, the cap error always wins.
    let cap_message = || {
        format!(
            "Provider output exceeded {} MB cap",
            MAX_COLLECT_BYTES / (1024 * 1024)
        )
    };
    let finalize = |outcome: Result<String, String>| -> Result<String, String> {
        if overflowed.load(Ordering::SeqCst) {
            return Err(cap_message());
        }
        outcome
    };

    loop {
        tokio::select! {
            // Cancelled — abort dispatch and return. Fires for both a
            // caller-initiated cancel and the sink's byte-gate; `finalize`
            // maps the byte-gate case to the cap error.
            _ = cancel.cancelled() => {
                return finalize(Err("Cancelled".to_string()));
            }
            // Dispatch finished. The sink will already have emitted Done/Error
            // (which the recv arm picks up); just remember and let the recv
            // arm produce the verdict. A genuine dispatch error still defers to
            // an overflow verdict via `finalize`.
            res = &mut dispatch_fut, if !dispatch_done => {
                dispatch_done = true;
                if let Err(e) = res {
                    return finalize(Err(e));
                }
            }
            event = rx.recv() => {
                // Drain everything already queued before re-polling dispatch:
                // one dispatch poll can enqueue many chunks, so consuming a
                // single event per select iteration would waste wakeups. Peak
                // buffered bytes are bounded upstream by the sink's byte-gate
                // (it stops the producer at MAX_COLLECT_BYTES), so the queue
                // this drains can never hold more than the cap plus one chunk;
                // the receiver-side check below is a second, independent cap on
                // the accumulated `text`.
                let mut next = event;
                loop {
                    match next {
                        Some(ChannelEvent::Chunk(s)) => {
                            if text.len().saturating_add(s.len()) > MAX_COLLECT_BYTES {
                                cancel.cancel();
                                return Err(cap_message());
                            }
                            text.push_str(&s);
                        }
                        Some(ChannelEvent::Done) => return finalize(Ok(text)),
                        Some(ChannelEvent::Error(msg)) => return finalize(Err(msg)),
                        // Sender dropped without a terminal event. If the sink
                        // overflowed, `finalize` reports the cap error; else the
                        // sink contract (exactly one Done/Error per run) was
                        // violated and `text` may be truncated, so surface
                        // loudly rather than returning partial output as success.
                        None => {
                            return finalize(Err(
                                "stream ended without done signal".to_string(),
                            ));
                        }
                    }
                    use tokio::sync::mpsc::error::TryRecvError;
                    match rx.try_recv() {
                        Ok(e) => next = Some(e),
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Disconnected) => next = None,
                    }
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "collect.test.rs"]
mod tests;
