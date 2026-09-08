//! REST provider prompt execution.
//!
//! Each function sends a prompt to a specific REST API (Anthropic, OpenAI,
//! Google AI, Ollama) and forwards the response through a sink.  These are
//! non-streaming implementations: the full response is fetched and then
//! emitted as a single chunk. The requests themselves are built in
//! `rest_request.rs`; this module owns sending them and the response contract.

use super::http_client;
use super::rest_request;
use super::sink::AiSink;

/// Cap on REST response body size before JSON parse. Mirrors the runner-side
/// 5 MB output cap so a runaway provider can't OOM the process by returning
/// a multi-GB body that gets fully buffered + parsed before the post-parse
/// limit is checked. Aligns with `MAX_COLLECT_BYTES` in `ai_provider/mod.rs`.
const MAX_REST_BODY_BYTES: usize = 5 * 1024 * 1024;

/// Read a response body with a hard byte cap. Returns Err if the body
/// exceeds the cap before fully reading. Uses byte-level reading rather than
/// `resp.json()` so we can short-circuit on size.
async fn read_body_capped(mut resp: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if buf.len().saturating_add(chunk.len()) > MAX_REST_BODY_BYTES {
                    return Err(format!(
                        "Response body exceeded {} MB cap",
                        MAX_REST_BODY_BYTES / (1024 * 1024)
                    ));
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(buf),
            Err(e) => return Err(format!("Failed to read response body: {}", e)),
        }
    }
}

// ============================================================================
// Anthropic
// ============================================================================

/// Send `rest_request::anthropic_request` and forward the response.
///
/// On non-2xx response: drains the body for the error message, calls
/// `sink.error(...)`, returns `Ok(())`. On parse failure: same shape.
/// On success: emits one `sink.chunk(...)` per text block in `content`,
/// then `sink.done()`. Bodies above `MAX_REST_BODY_BYTES` are rejected
/// before parse via `read_body_capped`.
pub(super) async fn run_rest_anthropic(
    sink: &dyn AiSink,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let resp =
        rest_request::anthropic_request(client, endpoint, api_key, model, prompt, max_tokens)
            .send()
            .await
            .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
        sink.error(&format!("Anthropic API error {}: {}", status, text));
        return Ok(());
    }

    let bytes = match read_body_capped(resp).await {
        Ok(b) => b,
        Err(e) => {
            sink.error(&e);
            return Ok(());
        }
    };
    let json: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            sink.error(&format!("Failed to parse Anthropic response: {}", e));
            return Ok(());
        }
    };

    // Extract text from content blocks
    if let Some(content) = json.get("content").and_then(|c| c.as_array()) {
        for block in content {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                sink.chunk(text);
            }
        }
    } else {
        sink.error("No content blocks in Anthropic response");
        return Ok(());
    }

    sink.done();
    Ok(())
}

// ============================================================================
// OpenAI
// ============================================================================

/// Send `rest_request::openai_request` and forward the response.
///
/// Sink contract identical to `run_rest_anthropic`: error event on non-2xx /
/// parse failure / missing choices, otherwise one chunk + `done()`.
pub(super) async fn run_rest_openai(
    sink: &dyn AiSink,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let resp = rest_request::openai_request(client, endpoint, api_key, model, prompt, max_tokens)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
        sink.error(&format!("OpenAI API error {}: {}", status, text));
        return Ok(());
    }

    let bytes = match read_body_capped(resp).await {
        Ok(b) => b,
        Err(e) => {
            sink.error(&e);
            return Ok(());
        }
    };
    let json: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            sink.error(&format!("Failed to parse OpenAI response: {}", e));
            return Ok(());
        }
    };

    if let Some(text) = json
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
    {
        sink.chunk(text);
    } else {
        sink.error("No choices in OpenAI response");
        return Ok(());
    }

    sink.done();
    Ok(())
}

// ============================================================================
// Google AI
// ============================================================================

/// Send `rest_request::google_request` and forward the response.
///
/// No `endpoint` parameter — the request builder targets the public Google
/// API host. Sink contract identical to the others.
pub(super) async fn run_rest_google(
    sink: &dyn AiSink,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let resp = rest_request::google_request(client, api_key, model, prompt, max_tokens)
        .send()
        .await
        .map_err(|e| format!("Google AI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
        sink.error(&format!("Google AI error {}: {}", status, text));
        return Ok(());
    }

    let bytes = match read_body_capped(resp).await {
        Ok(b) => b,
        Err(e) => {
            sink.error(&e);
            return Ok(());
        }
    };
    let json: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            sink.error(&format!("Failed to parse Google AI response: {}", e));
            return Ok(());
        }
    };

    if let Some(text) = json
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|candidates| candidates.first())
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .and_then(|parts| parts.first())
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
    {
        sink.chunk(text);
    } else {
        sink.error("No candidates in Google AI response");
        return Ok(());
    }

    sink.done();
    Ok(())
}

// ============================================================================
// Ollama
// ============================================================================

/// Send `rest_request::ollama_request` and forward the response.
///
/// No `api_key` — Ollama runs locally by convention. Sink contract identical
/// to the other REST providers.
pub(super) async fn run_rest_ollama(
    sink: &dyn AiSink,
    endpoint: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let resp = rest_request::ollama_request(client, endpoint, model, prompt, max_tokens)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
        sink.error(&format!("Ollama API error {}: {}", status, text));
        return Ok(());
    }

    let bytes = match read_body_capped(resp).await {
        Ok(b) => b,
        Err(e) => {
            sink.error(&e);
            return Ok(());
        }
    };
    let json: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            sink.error(&format!("Failed to parse Ollama response: {}", e));
            return Ok(());
        }
    };

    if let Some(text) = json.get("response").and_then(|r| r.as_str()) {
        sink.chunk(text);
    } else {
        sink.error("No response field in Ollama response");
        return Ok(());
    }

    sink.done();
    Ok(())
}

#[cfg(test)]
#[path = "rest_providers.test.rs"]
mod tests;
