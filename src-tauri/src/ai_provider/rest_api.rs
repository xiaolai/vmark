//! REST API operations: test keys, list models, validate models.
//!
//! These Tauri commands let the frontend verify provider connectivity,
//! enumerate available models, and confirm that a specific model is
//! usable -- all without streaming a full prompt response.
//!
//! Which host, which key and which header a provider takes is decided once,
//! by `provider_endpoint::ProviderEndpoint::resolve`; each command asks the
//! resolved endpoint for the one request it needs and sends it.

use std::time::Duration;
use tauri::command;

use super::http_client;

mod provider_endpoint;
mod rest_model_parsers;

use provider_endpoint::{Probe, ProviderEndpoint, RestProvider};
use rest_model_parsers::{
    parse_google_models, parse_ollama_models, parse_openai_compatible_models, parse_openai_models,
};

/// Per-request timeout for short REST checks (key test, model list).
const SHORT_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Per-request timeout for model validation (sends a tiny prompt).
const VALIDATE_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// The models offered for Anthropic, which has no listing endpoint to ask.
const ANTHROPIC_MODELS: [&str; 2] = ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"];

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

/// Send `probe` to `endpoint` and return the response if its status is 2xx.
async fn send(
    endpoint: &ProviderEndpoint,
    probe: Probe,
    timeout: Duration,
) -> Result<reqwest::Response, String> {
    let resp = endpoint
        .request(http_client::shared()?, probe)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    check_response(resp).await
}

/// Test an API key by hitting the cheapest possible endpoint per provider.
///
/// Returns a short success message or an error string.
#[command]
pub async fn test_api_key(
    provider: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<String, String> {
    let resolved = ProviderEndpoint::resolve(RestProvider::parse(&provider)?, api_key, endpoint)?;
    send(&resolved, resolved.key_probe(), SHORT_REQUEST_TIMEOUT).await?;
    Ok("Connected".to_string())
}

/// List available models for a REST provider.
///
/// - Ollama: fetches from local `/api/tags`
/// - OpenAI: fetches `/v1/models`, filters to chat-capable prefixes
/// - Google AI: fetches `/v1beta/models`, strips `models/` prefix
/// - Anthropic: returns curated list (no listing endpoint), without needing a key
#[command]
pub async fn list_models(
    provider: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<Vec<String>, String> {
    let curated = || Ok(ANTHROPIC_MODELS.iter().map(|m| m.to_string()).collect());
    let provider = RestProvider::parse(&provider)?;
    let parse: fn(&serde_json::Value) -> Result<Vec<String>, String> = match provider {
        RestProvider::Anthropic => return curated(),
        RestProvider::OllamaApi => parse_ollama_models,
        RestProvider::OpenAi => parse_openai_models,
        RestProvider::OpenAiCompatible => parse_openai_compatible_models,
        RestProvider::GoogleAi => parse_google_models,
    };
    let resolved = ProviderEndpoint::resolve(provider, api_key, endpoint)?;
    let Some(probe) = resolved.models_probe() else {
        return curated();
    };
    let json: serde_json::Value = send(&resolved, probe, SHORT_REQUEST_TIMEOUT)
        .await?
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    parse(&json)
}

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
    let resolved = ProviderEndpoint::resolve(RestProvider::parse(&provider)?, api_key, endpoint)?;
    send(
        &resolved,
        resolved.model_probe(&model),
        VALIDATE_REQUEST_TIMEOUT,
    )
    .await?;
    Ok("Model OK".to_string())
}

#[cfg(test)]
#[path = "rest_api.test.rs"]
mod tests;
