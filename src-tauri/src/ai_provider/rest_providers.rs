//! REST provider prompt execution.
//!
//! Each function sends a prompt to a specific REST API (Anthropic,
//! OpenAI, Google AI, Ollama) and emits the response back to the
//! frontend as `ai:response` events.  These are non-streaming
//! implementations -- the full response is fetched and then emitted.

use std::time::Duration;

use tauri::WebviewWindow;

use super::types::{emit_chunk, emit_done, emit_error};

/// Build an HTTP client with standard timeouts.
///
/// * `connect_timeout` — 10 s (TCP handshake).
/// * `timeout` — 120 s (entire request, including body read).
fn make_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

// ============================================================================
// Anthropic
// ============================================================================

pub(super) async fn run_rest_anthropic(
    window: &WebviewWindow,
    request_id: &str,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = make_client()?;
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post(format!("{}/v1/messages", endpoint))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        emit_error(
            window,
            request_id,
            &format!("Anthropic API error {}: {}", status, text),
        );
        return Ok(());
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Extract text from content blocks
    if let Some(content) = json.get("content").and_then(|c| c.as_array()) {
        for block in content {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                emit_chunk(window, request_id, text);
            }
        }
    } else {
        emit_error(
            window,
            request_id,
            "No content blocks in Anthropic response",
        );
        return Ok(());
    }

    emit_done(window, request_id);
    Ok(())
}

// ============================================================================
// OpenAI
// ============================================================================

pub(super) async fn run_rest_openai(
    window: &WebviewWindow,
    request_id: &str,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = make_client()?;
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post(format!("{}/v1/chat/completions", endpoint))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        emit_error(
            window,
            request_id,
            &format!("OpenAI API error {}: {}", status, text),
        );
        return Ok(());
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(text) = json
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
    {
        emit_chunk(window, request_id, text);
    } else {
        emit_error(window, request_id, "No choices in OpenAI response");
        return Ok(());
    }

    emit_done(window, request_id);
    Ok(())
}

// ============================================================================
// Google AI
// ============================================================================

pub(super) async fn run_rest_google(
    window: &WebviewWindow,
    request_id: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = make_client()?;
    let body = serde_json::json!({
        "contents": [{"parts": [{"text": prompt}]}]
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );

    let resp = client
        .post(&url)
        .header("x-goog-api-key", api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Google AI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        emit_error(
            window,
            request_id,
            &format!("Google AI error {}: {}", status, text),
        );
        return Ok(());
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

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
        emit_chunk(window, request_id, text);
    } else {
        emit_error(window, request_id, "No candidates in Google AI response");
        return Ok(());
    }

    emit_done(window, request_id);
    Ok(())
}

// ============================================================================
// Ollama
// ============================================================================

pub(super) async fn run_rest_ollama(
    window: &WebviewWindow,
    request_id: &str,
    endpoint: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = make_client()?;
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false
    });

    let resp = client
        .post(format!("{}/api/generate", endpoint))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        emit_error(
            window,
            request_id,
            &format!("Ollama API error {}: {}", status, text),
        );
        return Ok(());
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(text) = json.get("response").and_then(|r| r.as_str()) {
        emit_chunk(window, request_id, text);
    } else {
        emit_error(
            window,
            request_id,
            "No response field in Ollama response",
        );
        return Ok(());
    }

    emit_done(window, request_id);
    Ok(())
}
