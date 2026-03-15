//! REST API operations: test keys, list models, validate models.
//!
//! These Tauri commands let the frontend verify provider connectivity,
//! enumerate available models, and confirm that a specific model is
//! usable -- all without streaming a full prompt response.

use tauri::command;

// ============================================================================
// Shared Helpers
// ============================================================================

fn make_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
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
    let text = resp.text().await.unwrap_or_default();
    Err(format!("HTTP {}: {}", status.as_u16(), text))
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
    let client = make_client(10)?;

    match provider.as_str() {
        "openai" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.openai.com");
            let resp = client
                .get(format!("{}/v1/models", base))
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
    let client = make_client(10)?;

    match provider.as_str() {
        "ollama-api" => {
            let base = resolve_endpoint(endpoint, "http://localhost:11434");
            let resp = client
                .get(format!("{}/api/tags", base))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            let models = json
                .get("models")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_else(|| {
                    eprintln!("[AI Provider] Unexpected model list response shape from Ollama (missing \"models\" key)");
                    Vec::new()
                });
            Ok(models)
        }

        "openai" => {
            let key = require_key(api_key)?;
            let base = resolve_endpoint(endpoint, "https://api.openai.com");
            let resp = client
                .get(format!("{}/v1/models", base))
                .header("Authorization", format!("Bearer {}", key))
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            // Use dash-suffixed prefixes to avoid false matches (e.g. "o1" matching "o100-*")
            let prefixes = ["gpt-", "o1-", "o3-", "o4-", "chatgpt-"];
            let exact = ["o1", "o3", "o4"];
            let mut models: Vec<String> = json
                .get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                        .filter(|id| {
                            prefixes.iter().any(|p| id.starts_with(p))
                                || exact.iter().any(|e| id.as_str() == *e)
                        })
                        .collect()
                })
                .unwrap_or_else(|| {
                    eprintln!("[AI Provider] Unexpected model list response shape from OpenAI (missing \"data\" key)");
                    Vec::new()
                });
            models.sort();
            Ok(models)
        }

        "google-ai" => {
            let key = require_key(api_key)?;
            let resp = client
                .get("https://generativelanguage.googleapis.com/v1beta/models")
                .header("x-goog-api-key", &key)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;
            let resp = check_response(resp).await?;
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            let mut models: Vec<String> = json
                .get("models")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            m.get("name")
                                .and_then(|n| n.as_str())
                                .map(|n| n.strip_prefix("models/").unwrap_or(n).to_string())
                        })
                        .collect()
                })
                .unwrap_or_else(|| {
                    eprintln!("[AI Provider] Unexpected model list response shape from Google AI (missing \"models\" key)");
                    Vec::new()
                });
            models.sort();
            Ok(models)
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
    let client = make_client(15)?;

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
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                model
            );
            let resp = client
                .post(&url)
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
