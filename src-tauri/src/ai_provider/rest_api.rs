//! REST API operations: test keys, list models, validate models.
//!
//! These Tauri commands let the frontend verify provider connectivity,
//! enumerate available models, and confirm that a specific model is
//! usable -- all without streaming a full prompt response.

use std::time::Duration;
use tauri::command;

use super::endpoint::resolve_endpoint;
use super::http_client;

// ============================================================================
// Shared Helpers
// ============================================================================

/// Per-request timeout (in seconds) for short REST checks (key test, model list).
const SHORT_REQUEST_TIMEOUT_SECS: u64 = 10;
/// Per-request timeout (in seconds) for model validation (sends a tiny prompt).
const VALIDATE_REQUEST_TIMEOUT_SECS: u64 = 15;

/// Returns the per-request timeout duration for the given seconds.
fn timeout_secs(secs: u64) -> Duration {
    Duration::from_secs(secs)
}

fn require_key(api_key: Option<String>) -> Result<String, String> {
    api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "API key is required".to_string())
}

/// Resolve a base URL that MUST be user-supplied (no sensible default host).
///
/// The `openai-compatible` provider is generic — there is no vendor default to
/// fall back to — so an empty endpoint is a hard error rather than a silent
/// request to some placeholder host.
fn require_endpoint(endpoint: Option<String>) -> Result<String, String> {
    let base = resolve_endpoint(endpoint, "");
    if base.is_empty() {
        return Err("Endpoint (base URL) is required".to_string());
    }
    Ok(base)
}

async fn check_response(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let text = resp
        .text()
        .await
        .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
    Err(format!("HTTP {}: {}", status.as_u16(), text))
}

mod rest_model_parsers;
use rest_model_parsers::{
    parse_google_models, parse_ollama_models, parse_openai_compatible_models, parse_openai_models,
};

// ============================================================================
// API Key Testing
// ============================================================================

/// Test an API key by hitting the cheapest possible endpoint per provider.
///
/// Returns a short success message or an error string.
#[command]
pub async fn test_api_key(
    provider: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<String, String> {
    let client = http_client::shared()?;
    let req_timeout = timeout_secs(SHORT_REQUEST_TIMEOUT_SECS);

    match provider.as_str() {
        "openai" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.openai.com");
            let resp = client
                .get(format!("{}/v1/models", base))
                .timeout(req_timeout)
                .header("Authorization", format!("Bearer {}", key))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        "openai-compatible" => {
            let key = require_key(api_key)?;
            let base = require_endpoint(endpoint)?;
            let resp = client
                .get(format!("{}/v1/models", base))
                .timeout(req_timeout)
                .header("Authorization", format!("Bearer {}", key))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        "google-ai" => {
            let key = require_key(api_key)?;
            let resp = client
                .get("https://generativelanguage.googleapis.com/v1beta/models")
                .timeout(req_timeout)
                .header("x-goog-api-key", &key)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        "ollama-api" => {
            let base = resolve_endpoint(endpoint, "http://localhost:11434");
            let resp = client
                .get(format!("{}/api/tags", base))
                .timeout(req_timeout)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        "anthropic" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.anthropic.com");
            let body = serde_json::json!({
                "model": "claude-sonnet-4-5-20250929",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "Hi"}]
            });
            let resp = client
                .post(format!("{}/v1/messages", base))
                .timeout(req_timeout)
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Connected".to_string())
        }

        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// ============================================================================
// Model Listing
// ============================================================================

/// List available models for a REST provider.
///
/// - Ollama: fetches from local `/api/tags`
/// - OpenAI: fetches `/v1/models`, filters to chat-capable prefixes
/// - Google AI: fetches `/v1beta/models`, strips `models/` prefix
/// - Anthropic: returns curated list (no listing endpoint)
#[command]
pub async fn list_models(
    provider: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<Vec<String>, String> {
    let client = http_client::shared()?;
    let req_timeout = timeout_secs(SHORT_REQUEST_TIMEOUT_SECS);

    match provider.as_str() {
        "ollama-api" => {
            let base = resolve_endpoint(endpoint, "http://localhost:11434");
            let resp = client
                .get(format!("{}/api/tags", base))
                .timeout(req_timeout)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            parse_ollama_models(&json)
        }

        "openai" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.openai.com");
            let resp = client
                .get(format!("{}/v1/models", base))
                .timeout(req_timeout)
                .header("Authorization", format!("Bearer {}", key))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            parse_openai_models(&json)
        }

        "openai-compatible" => {
            let key = require_key(api_key)?;
            let base = require_endpoint(endpoint)?;
            let resp = client
                .get(format!("{}/v1/models", base))
                .timeout(req_timeout)
                .header("Authorization", format!("Bearer {}", key))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            parse_openai_compatible_models(&json)
        }

        "google-ai" => {
            let key = require_key(api_key)?;
            let resp = client
                .get("https://generativelanguage.googleapis.com/v1beta/models")
                .timeout(req_timeout)
                .header("x-goog-api-key", &key)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            parse_google_models(&json)
        }

        "anthropic" => Ok(vec![
            "claude-sonnet-4-5-20250929".to_string(),
            "claude-haiku-4-5-20251001".to_string(),
        ]),

        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// ============================================================================
// Model Validation
// ============================================================================

/// Validate that a specific model works by sending a minimal request.
///
/// - OpenAI: POST /v1/chat/completions with max_tokens=1
/// - Anthropic: POST /v1/messages with max_tokens=1
/// - Google AI: POST generateContent with minimal content
/// - Ollama: POST /api/show to check model existence
#[command]
pub async fn validate_model(
    provider: String,
    model: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<String, String> {
    let client = http_client::shared()?;
    let req_timeout = timeout_secs(VALIDATE_REQUEST_TIMEOUT_SECS);

    match provider.as_str() {
        "openai" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.openai.com");
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "Hi"}]
            });
            let resp = client
                .post(format!("{}/v1/chat/completions", base))
                .timeout(req_timeout)
                .header("Authorization", format!("Bearer {}", key))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        "openai-compatible" => {
            let key = require_key(api_key)?;
            let base = require_endpoint(endpoint)?;
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "Hi"}]
            });
            let resp = client
                .post(format!("{}/v1/chat/completions", base))
                .timeout(req_timeout)
                .header("Authorization", format!("Bearer {}", key))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        "anthropic" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.anthropic.com");
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "Hi"}]
            });
            let resp = client
                .post(format!("{}/v1/messages", base))
                .timeout(req_timeout)
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        "google-ai" => {
            let key = require_key(api_key)?;
            let body = serde_json::json!({
                "contents": [{"parts": [{"text": "Hi"}]}]
            });
            let model_id = model.strip_prefix("models/").unwrap_or(&model);
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                model_id
            );
            let resp = client
                .post(&url)
                .timeout(req_timeout)
                .header("x-goog-api-key", &key)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        "ollama-api" => {
            let base = resolve_endpoint(endpoint, "http://localhost:11434");
            let body = serde_json::json!({ "name": model });
            let resp = client
                .post(format!("{}/api/show", base))
                .timeout(req_timeout)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            check_response(resp).await?;
            Ok("Model OK".to_string())
        }

        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_endpoint_rejects_absent_or_empty() {
        assert!(require_endpoint(None).is_err());
        assert!(require_endpoint(Some(String::new())).is_err());
    }

    #[test]
    fn require_endpoint_accepts_and_normalizes_v1_suffix() {
        // A user who pastes `https://api.deepseek.com/v1` must not get a
        // doubled `/v1/v1/...` path.
        assert_eq!(
            require_endpoint(Some("https://api.deepseek.com/v1".into())).unwrap(),
            "https://api.deepseek.com"
        );
    }
}
