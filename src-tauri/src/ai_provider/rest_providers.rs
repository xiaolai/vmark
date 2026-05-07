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

/// POST `/v1/messages` against the Anthropic API and forward the response.
///
/// Body fields:
///   - `model` — caller-resolved (no defaulting here).
///   - `max_tokens` — REQUIRED by the Anthropic API; defaults to 4096 when
///     `max_tokens` arg is `None`. Anthropic is the only provider where
///     `max_tokens` is mandatory; the other three treat it as optional.
///   - `messages` — single user message with `prompt` as content.
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
    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens.unwrap_or(4096),
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

/// POST `/v1/chat/completions` against the OpenAI API and forward the response.
///
/// Body fields:
///   - `model` — caller-resolved.
///   - `messages` — single user message with `prompt` as content.
///   - `max_tokens` — OPTIONAL. Only inserted when the arg is `Some`. (Newer
///     OpenAI models prefer `max_completion_tokens`; for compatibility with
///     OpenAI-API-compatible endpoints we use the legacy field name.)
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
    let mut body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    });
    if let Some(n) = max_tokens {
        body["max_tokens"] = serde_json::json!(n);
    }

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

/// POST `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
/// against the Google AI Gemini API and forward the response.
///
/// Asymmetry vs. the other REST providers: there is no `endpoint`
/// parameter — the URL is hard-coded to the public Google API host. Custom
/// endpoints (e.g. Vertex AI proxies) are out of scope; users with that
/// requirement should fall back to a CLI provider.
///
/// Body fields:
///   - `contents` — single-turn user message wrapping `prompt`.
///   - `generationConfig.maxOutputTokens` — Google's name for `max_tokens`.
///     Only inserted when the arg is `Some`.
///
/// Model strings prefixed with `models/` are stripped; the URL's `:generateContent`
/// suffix expects a bare model id. Sink contract identical to the others.
pub(super) async fn run_rest_google(
    sink: &dyn AiSink,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let mut body = serde_json::json!({
        "contents": [{"parts": [{"text": prompt}]}]
    });
    if let Some(n) = max_tokens {
        body["generationConfig"] = serde_json::json!({
            "maxOutputTokens": n,
        });
    }

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

/// POST `/api/generate` against an Ollama-compatible endpoint (default
/// `http://localhost:11434`) and forward the response.
///
/// Asymmetry vs. the other REST providers: there is no `api_key` — Ollama
/// runs locally by convention.
///
/// Body fields:
///   - `model` — caller-resolved.
///   - `prompt` — raw text (Ollama uses a flat `prompt` field rather than
///     a chat `messages` array).
///   - `stream: false` — VMark always pulls the whole response and
///     forwards it as a single chunk; live token streaming is not wired
///     through the sink layer for any provider.
///   - `options.num_predict` — Ollama's name for `max_tokens`. Only
///     inserted when the arg is `Some`.
///
/// Sink contract identical to the other REST providers.
pub(super) async fn run_rest_ollama(
    sink: &dyn AiSink,
    endpoint: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let mut body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false
    });
    if let Some(n) = max_tokens {
        body["options"] = serde_json::json!({
            "num_predict": n,
        });
    }

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
