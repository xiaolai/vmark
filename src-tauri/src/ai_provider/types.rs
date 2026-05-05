//! Shared types for the AI provider module.
//!
//! All providers stream their output through `&dyn AiSink` (see `sink.rs`).
//! `AiResponseChunk` is the on-the-wire shape that `WindowSink` emits as
//! `ai:response` Tauri events; it's also serialized for unit-test assertions.

use serde::Serialize;

use super::sink::AiSink;

/// Detected CLI AI provider with availability and resolved path.
#[derive(Debug, Serialize)]
pub struct CliProviderEntry {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub name: String,
    pub command: String,
    pub available: bool,
    pub path: Option<String>,
}

/// Streaming AI response chunk emitted via `ai:response` events.
///
/// Constructed by `WindowSink` and consumed by the frontend listener.
#[derive(Debug, Serialize, Clone)]
pub struct AiResponseChunk {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub chunk: String,
    pub done: bool,
    pub error: Option<String>,
}

/// Validate that an API key is present and non-empty.
///
/// Returns `Some(key)` if valid, or emits an error event through the sink and
/// returns `None`.
pub(crate) fn require_api_key<'a>(
    sink: &dyn AiSink,
    api_key: &'a Option<String>,
    provider_name: &str,
) -> Option<&'a str> {
    match api_key.as_deref() {
        Some(k) if !k.is_empty() => Some(k),
        _ => {
            sink.error(&format!("{} API key is required", provider_name));
            None
        }
    }
}
