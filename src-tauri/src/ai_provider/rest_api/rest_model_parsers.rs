//! Pure parsers for provider `list_models` responses.
//!
//! Split out of `rest_api.rs` (which orchestrates the HTTP commands) so the
//! shape-parsing logic — and its exhaustive unit tests — live on their own.
//! Each function takes an already-decoded `serde_json::Value` and returns the
//! chat-capable model ids, or a descriptive error when the response shape is
//! unexpected.

pub(super) fn parse_ollama_models(json: &serde_json::Value) -> Result<Vec<String>, String> {
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

pub(super) fn parse_openai_models(json: &serde_json::Value) -> Result<Vec<String>, String> {
    let arr = json.get("data").and_then(|d| d.as_array()).ok_or_else(|| {
        "Unexpected model list response shape from OpenAI (missing \"data\" key)".to_string()
    })?;
    // Use dash-suffixed prefixes to avoid false matches (e.g. "o1" matching "o100-*")
    let prefixes = ["gpt-", "o1-", "o3-", "o4-", "chatgpt-"];
    let exact = ["o1", "o3", "o4"];
    let mut models: Vec<String> = arr
        .iter()
        .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
        .filter(|id| prefixes.iter().any(|p| id.starts_with(p)) || exact.contains(&id.as_str()))
        .collect();
    models.sort();
    Ok(models)
}

/// Parse an OpenAI-compatible `/v1/models` response WITHOUT the chat-model
/// prefix filter. Third-party OpenAI-compatible servers (DeepSeek, Groq,
/// OpenRouter, Together, …) name their models freely (`deepseek-chat`,
/// `llama-3.1-70b`, …), so the `gpt-/o1-` allow-list used for the first-party
/// OpenAI endpoint would wrongly drop every one of them. Returns all `data[].id`
/// strings, sorted.
pub(super) fn parse_openai_compatible_models(
    json: &serde_json::Value,
) -> Result<Vec<String>, String> {
    let arr = json
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| "Unexpected model list response shape (missing \"data\" key)".to_string())?;
    let mut models: Vec<String> = arr
        .iter()
        .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
        .collect();
    models.sort();
    Ok(models)
}

pub(super) fn parse_google_models(json: &serde_json::Value) -> Result<Vec<String>, String> {
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
    fn openai_compatible_parser_keeps_all_ids_unfiltered() {
        // The whole point of the openai-compatible path: DeepSeek/Groq/etc.
        // model ids that the first-party OpenAI prefix filter would drop must
        // survive here.
        let v = json!({
            "data": [
                {"id": "deepseek-reasoner"},
                {"id": "deepseek-chat"},
                {"id": "llama-3.1-70b"},
            ]
        });
        assert_eq!(
            parse_openai_compatible_models(&v).unwrap(),
            vec!["deepseek-chat", "deepseek-reasoner", "llama-3.1-70b"]
        );
    }

    #[test]
    fn openai_compatible_parser_errors_on_missing_data_key() {
        let err = parse_openai_compatible_models(&json!({})).unwrap_err();
        assert!(err.contains("data"));
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
