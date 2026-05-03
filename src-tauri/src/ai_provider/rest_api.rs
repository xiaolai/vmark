//! REST API operations: test keys, list models, validate models.
//!
//! These Tauri commands let the frontend verify provider connectivity,
//! enumerate available models, and confirm that a specific model is
//! usable -- all without streaming a full prompt response.

use std::time::Duration;
use tauri::command;

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

fn resolve_endpoint(endpoint: Option<String>, default: &str) -> String {
    endpoint
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn require_key(api_key: Option<String>) -> Result<String, String> {
    api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "API key is required".to_string())
}

async fn check_response(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let text = resp.text().await.unwrap_or_else(|e| format!("<failed to read body: {}>", e));
    Err(format!("HTTP {}: {}", status.as_u16(), text))
}

fn parse_ollama_models(json: &serde_json::Value) -> Result<Vec<String>, String> {
    let arr = json
        .get("models")
        .and_then(|m| m.as_array())
        .ok_or_else(|| {
            "Unexpected model list response shape from Ollama (missing \"models\" key)".to_string()
        })?;
    Ok(arr
        .iter()
        .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
        .collect())
}

fn parse_openai_models(json: &serde_json::Value) -> Result<Vec<String>, String> {
    let arr = json.get("data").and_then(|d| d.as_array()).ok_or_else(|| {
        "Unexpected model list response shape from OpenAI (missing \"data\" key)".to_string()
    })?;
    // Use dash-suffixed prefixes to avoid false matches (e.g. "o1" matching "o100-*")
    let prefixes = ["gpt-", "o1-", "o3-", "o4-", "chatgpt-"];
    let exact = ["o1", "o3", "o4"];
    let mut models: Vec<String> = arr
        .iter()
        .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
        .filter(|id| {
            prefixes.iter().any(|p| id.starts_with(p)) || exact.iter().any(|e| id.as_str() == *e)
        })
        .collect();
    models.sort();
    Ok(models)
}

fn parse_google_models(json: &serde_json::Value) -> Result<Vec<String>, String> {
    let arr = json
        .get("models")
        .and_then(|m| m.as_array())
        .ok_or_else(|| {
            "Unexpected model list response shape from Google AI (missing \"models\" key)"
                .to_string()
        })?;
    let mut models: Vec<String> = arr
        .iter()
        .filter_map(|m| {
            // Only include models that support generateContent
            let supports = m
                .get("supportedGenerationMethods")
                .and_then(|s| s.as_array())
                .map(|arr| arr.iter().any(|v| v.as_str() == Some("generateContent")))
                .unwrap_or(false);
            if !supports {
                return None;
            }
            m.get("name")
                .and_then(|n| n.as_str())
                .map(|n| n.strip_prefix("models/").unwrap_or(n).to_string())
        })
        .collect();
    models.sort();
    Ok(models)
}

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
    use serde_json::json;

    #[test]
    fn ollama_parser_errors_on_missing_models_key() {
        let err = parse_ollama_models(&json!({})).unwrap_err();
        assert!(err.contains("Ollama"));
        assert!(err.contains("models"));
    }

    #[test]
    fn ollama_parser_collects_names() {
        let v = json!({
            "models": [
                {"name": "llama3.2"},
                {"name": "qwen2.5"},
            ]
        });
        assert_eq!(
            parse_ollama_models(&v).unwrap(),
            vec!["llama3.2", "qwen2.5"]
        );
    }

    #[test]
    fn openai_parser_errors_on_missing_data_key() {
        let err = parse_openai_models(&json!({})).unwrap_err();
        assert!(err.contains("OpenAI"));
        assert!(err.contains("data"));
    }

    #[test]
    fn openai_parser_filters_and_sorts() {
        let v = json!({
            "data": [
                {"id": "gpt-4o"},
                {"id": "text-embedding-3-small"},
                {"id": "o1"},
                {"id": "o100-foo"},
                {"id": "chatgpt-4"},
            ]
        });
        assert_eq!(
            parse_openai_models(&v).unwrap(),
            vec!["chatgpt-4", "gpt-4o", "o1"]
        );
    }

    #[test]
    fn google_parser_errors_on_missing_models_key() {
        let err = parse_google_models(&json!({})).unwrap_err();
        assert!(err.contains("Google AI"));
        assert!(err.contains("models"));
    }

    #[test]
    fn google_parser_keeps_only_generate_content_models() {
        let v = json!({
            "models": [
                {
                    "name": "models/gemini-2.0-flash",
                    "supportedGenerationMethods": ["generateContent", "countTokens"]
                },
                {
                    "name": "models/embedding-001",
                    "supportedGenerationMethods": ["embedContent"]
                },
                {
                    "name": "models/gemini-1.5-pro",
                    "supportedGenerationMethods": ["generateContent"]
                }
            ]
        });
        assert_eq!(
            parse_google_models(&v).unwrap(),
            vec!["gemini-1.5-pro", "gemini-2.0-flash"]
        );
    }
}
