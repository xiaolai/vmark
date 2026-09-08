//! Request construction for the REST AI providers.
//!
//! Split from `rest_providers.rs`, which SENDS these and forwards the
//! response. Each `*_request` returns a `reqwest::RequestBuilder` that has not
//! been sent, so the URL, headers, JSON body and per-request timeout can be
//! inspected in a test without a server. Google's endpoint is a hard-coded
//! public host, so this is the only place its request shape can be checked.
//!
//! @coordinates-with ai_provider/rest_providers.rs — sends these
//! @coordinates-with ai_provider/dispatch.rs — resolves endpoint/model/key first

use std::time::Duration;

/// Per-request timeout (entire request, including body read) for prompt calls.
pub(super) const PROMPT_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// `POST {endpoint}/v1/messages` against the Anthropic API.
///
/// Body fields:
///   - `model` — caller-resolved (no defaulting here).
///   - `max_tokens` — REQUIRED by the Anthropic API; defaults to 4096 when
///     `max_tokens` arg is `None`. Anthropic is the only provider where
///     `max_tokens` is mandatory; the other three treat it as optional.
///   - `messages` — single user message with `prompt` as content.
pub(super) fn anthropic_request(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> reqwest::RequestBuilder {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens.unwrap_or(4096),
        "messages": [{"role": "user", "content": prompt}]
    });

    client
        .post(format!("{}/v1/messages", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
}

/// `POST {endpoint}/v1/chat/completions` against the OpenAI API (and any
/// OpenAI-compatible endpoint — `dispatch.rs` routes both here).
///
/// Body fields:
///   - `model` — caller-resolved.
///   - `messages` — single user message with `prompt` as content.
///   - `max_tokens` — OPTIONAL. Only inserted when the arg is `Some`. (Newer
///     OpenAI models prefer `max_completion_tokens`; for compatibility with
///     OpenAI-API-compatible endpoints we use the legacy field name.)
pub(super) fn openai_request(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> reqwest::RequestBuilder {
    let mut body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    });
    if let Some(n) = max_tokens {
        body["max_tokens"] = serde_json::json!(n);
    }

    client
        .post(format!("{}/v1/chat/completions", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
}

/// `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
/// against the Google AI Gemini API.
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
/// Model strings prefixed with `models/` are stripped; the URL's
/// `:generateContent` suffix expects a bare model id.
pub(super) fn google_request(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> reqwest::RequestBuilder {
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

    client
        .post(&url)
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("x-goog-api-key", api_key)
        .header("content-type", "application/json")
        .json(&body)
}

/// `POST {endpoint}/api/generate` against an Ollama-compatible endpoint
/// (default `http://localhost:11434`).
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
pub(super) fn ollama_request(
    client: &reqwest::Client,
    endpoint: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> reqwest::RequestBuilder {
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

    client
        .post(format!("{}/api/generate", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("content-type", "application/json")
        .json(&body)
}
