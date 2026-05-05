//! REST provider prompt execution.
//!
//! Each function sends a prompt to a specific REST API (Anthropic, OpenAI,
//! Google AI, Ollama) and forwards the response through a sink.  These are
//! non-streaming implementations: the full response is fetched and then
//! emitted as a single chunk.

use std::time::Duration;

use super::http_client;
use super::sink::AiSink;

/// Per-request timeout (entire request, including body read) for prompt calls.
const PROMPT_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

// ============================================================================
// Anthropic
// ============================================================================

pub(super) async fn run_rest_anthropic(
    sink: &dyn AiSink,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post(format!("{}/v1/messages", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
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

    let json: serde_json::Value = match resp.json().await {
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

pub(super) async fn run_rest_openai(
    sink: &dyn AiSink,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post(format!("{}/v1/chat/completions", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
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

    let json: serde_json::Value = match resp.json().await {
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

pub(super) async fn run_rest_google(
    sink: &dyn AiSink,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let body = serde_json::json!({
        "contents": [{"parts": [{"text": prompt}]}]
    });

    let model_id = model.strip_prefix("models/").unwrap_or(model);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model_id
    );

    let resp = client
        .post(&url)
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("x-goog-api-key", api_key)
        .header("content-type", "application/json")
        .json(&body)
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

    let json: serde_json::Value = match resp.json().await {
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

pub(super) async fn run_rest_ollama(
    sink: &dyn AiSink,
    endpoint: &str,
    model: &str,
    prompt: &str,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false
    });

    let resp = client
        .post(format!("{}/api/generate", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("content-type", "application/json")
        .json(&body)
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

    let json: serde_json::Value = match resp.json().await {
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
