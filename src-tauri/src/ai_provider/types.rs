//! Shared types and event-emission helpers for the AI provider module.
//!
//! All submodules use `AiResponseChunk` to stream results back to the
//! frontend via Tauri events.  The `emit_*` helpers standardise the
//! event format so every provider (CLI and REST) behaves identically
//! from the frontend's perspective.

use serde::Serialize;
use tauri::{Emitter, WebviewWindow};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct CliProviderEntry {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub name: String,
    pub command: String,
    pub available: bool,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AiResponseChunk {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub chunk: String,
    pub done: bool,
    pub error: Option<String>,
}

// ============================================================================
// Event Helpers
// ============================================================================

/// Validate that an API key is present and non-empty.
///
/// Returns `Some(key)` if valid, or emits an error event and returns `None`.
pub(crate) fn require_api_key<'a>(
    window: &WebviewWindow,
    request_id: &str,
    api_key: &'a Option<String>,
    provider_name: &str,
) -> Option<&'a str> {
    match api_key.as_deref() {
        Some(k) if !k.is_empty() => Some(k),
        _ => {
            emit_error(
                window,
                request_id,
                &format!("{} API key is required", provider_name),
            );
            None
        }
    }
}

pub(crate) fn emit_chunk(window: &WebviewWindow, request_id: &str, text: &str) {
    let _ = window.emit(
        "ai:response",
        AiResponseChunk {
            request_id: request_id.to_string(),
            chunk: text.to_string(),
            done: false,
            error: None,
        },
    );
}

pub(crate) fn emit_done(window: &WebviewWindow, request_id: &str) {
    let _ = window.emit(
        "ai:response",
        AiResponseChunk {
            request_id: request_id.to_string(),
            chunk: String::new(),
            done: true,
            error: None,
        },
    );
}

pub(crate) fn emit_error(window: &WebviewWindow, request_id: &str, msg: &str) {
    let _ = window.emit(
        "ai:response",
        AiResponseChunk {
            request_id: request_id.to_string(),
            chunk: String::new(),
            done: true,
            error: Some(msg.to_string()),
        },
    );
}
