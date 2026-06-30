//! REST endpoint URL resolution + normalization for AI providers.
//!
//! OpenAI-/Anthropic-compatible request paths are built as `{base}/v1/...`.
//! Most providers publish their base URL with `/v1` already included, so a
//! URL entered as `https://host/v1` would otherwise become
//! `https://host/v1/v1/chat/completions` (404). Normalizing the base fixes
//! that without breaking configs that omit `/v1`. See issue #1084.

/// Strip a trailing slash and a trailing `/v1` segment from a base URL.
/// `https://host/v1`, `https://host/v1/`, and `https://host` all normalize to
/// `https://host`, which then yields a correct `https://host/v1/chat/completions`.
pub(super) fn normalize_rest_base(base: &str) -> &str {
    let trimmed = base.trim_end_matches('/');
    trimmed.strip_suffix("/v1").unwrap_or(trimmed)
}

/// Resolve a user-supplied endpoint (falling back to `default` when absent or
/// empty), normalized so the hardcoded `/v1/...` paths are never doubled.
pub(super) fn resolve_endpoint(endpoint: Option<String>, default: &str) -> String {
    let raw = endpoint
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| default.to_string());
    normalize_rest_base(&raw).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_trailing_slash_and_v1() {
        assert_eq!(normalize_rest_base("https://h/v1"), "https://h");
        assert_eq!(normalize_rest_base("https://h/v1/"), "https://h");
        assert_eq!(normalize_rest_base("https://h/"), "https://h");
        assert_eq!(normalize_rest_base("https://h"), "https://h");
        // Only a trailing `/v1` is stripped; a deeper path is preserved.
        assert_eq!(normalize_rest_base("https://h/openai/v1"), "https://h/openai");
        // `/v1` mid-path (not trailing) is left alone.
        assert_eq!(normalize_rest_base("https://h/v1/foo"), "https://h/v1/foo");
    }

    #[test]
    fn resolve_falls_back_to_default_when_absent_or_empty() {
        assert_eq!(resolve_endpoint(None, "https://api.openai.com"), "https://api.openai.com");
        assert_eq!(resolve_endpoint(Some(String::new()), "https://api.openai.com"), "https://api.openai.com");
    }

    #[test]
    fn resolve_does_not_double_v1_when_user_includes_it() {
        // The #1084 bug: base + "/v1/chat/completions" must not double `/v1`.
        let base = resolve_endpoint(Some("https://api.example.com/v1".into()), "x");
        assert_eq!(
            format!("{}/v1/chat/completions", base),
            "https://api.example.com/v1/chat/completions"
        );
        // A base without `/v1` still resolves to the same correct URL.
        let base = resolve_endpoint(Some("https://api.example.com".into()), "x");
        assert_eq!(
            format!("{}/v1/chat/completions", base),
            "https://api.example.com/v1/chat/completions"
        );
    }
}
