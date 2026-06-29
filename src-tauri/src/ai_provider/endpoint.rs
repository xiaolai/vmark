//! Endpoint URL normalization for OpenAI-/Anthropic-compatible REST providers.
//!
//! Purpose: build the version-qualified request URL from a user-configured
//! base URL without doubling the `/v1` segment.
//!
//! VMark appends a version-qualified path (`/v1/chat/completions`,
//! `/v1/models`, `/v1/messages`) to whatever base URL the user enters in
//! Settings. Most OpenAI-/Anthropic-compatible providers publish their base
//! URL WITH the `/v1` segment already included (the OpenAI SDK treats
//! `base_url` as version-qualified), so users very commonly paste
//! `https://host/v1`. Naively appending then yields `…/v1/v1/…`, which the
//! server rejects with `404 page not found`.
//!
//! `join_v1` strips a single trailing `/v1` (plus surrounding whitespace and
//! trailing slashes) before appending, so BOTH conventions work: a base with
//! `/v1` and a base without it resolve to the same correct URL. The default
//! endpoints (`https://api.openai.com`, `https://api.anthropic.com`, which
//! carry no `/v1`) and existing user configs are unaffected.

/// Join a provider base URL with a `v1/<suffix>` path, tolerating a base that
/// already ends in `/v1` (and any surrounding whitespace or trailing slashes).
///
/// `suffix` is the path AFTER the version segment, without a leading slash —
/// e.g. `"chat/completions"`, `"models"`, `"messages"`.
///
/// Examples:
/// - `join_v1("https://api.openai.com", "models")` → `https://api.openai.com/v1/models`
/// - `join_v1("https://host/v1", "chat/completions")` → `https://host/v1/chat/completions`
/// - `join_v1("https://host/v1/", "messages")` → `https://host/v1/messages`
pub(super) fn join_v1(base: &str, suffix: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    if base.ends_with("/v1") {
        format!("{base}/{suffix}")
    } else {
        format!("{base}/v1/{suffix}")
    }
}

#[cfg(test)]
mod tests {
    use super::join_v1;

    #[test]
    fn appends_v1_when_base_has_none() {
        assert_eq!(
            join_v1("https://api.openai.com", "chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn does_not_double_v1_when_base_already_has_it() {
        // The reported bug: user pasted `…/v1`, VMark produced `…/v1/v1/…` → 404.
        assert_eq!(
            join_v1("https://api-sg.umodelverse.ai/v1", "chat/completions"),
            "https://api-sg.umodelverse.ai/v1/chat/completions"
        );
    }

    #[test]
    fn strips_trailing_slash_without_v1() {
        assert_eq!(join_v1("https://host/", "models"), "https://host/v1/models");
    }

    #[test]
    fn strips_trailing_slash_after_v1() {
        assert_eq!(
            join_v1("https://host/v1/", "models"),
            "https://host/v1/models"
        );
    }

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(
            join_v1("  https://host/v1  ", "messages"),
            "https://host/v1/messages"
        );
    }

    #[test]
    fn preserves_subpath_mounted_gateways() {
        // A gateway that mounts the API under a subpath, without `/v1`.
        assert_eq!(
            join_v1("https://gw.example.com/openai", "chat/completions"),
            "https://gw.example.com/openai/v1/chat/completions"
        );
        // Same gateway, base already including `/v1`.
        assert_eq!(
            join_v1("https://gw.example.com/openai/v1", "chat/completions"),
            "https://gw.example.com/openai/v1/chat/completions"
        );
    }

    #[test]
    fn does_not_strip_lookalike_segments() {
        // `/v1beta` is NOT `/v1` — must not be treated as a version segment.
        assert_eq!(
            join_v1("https://host/v1beta", "models"),
            "https://host/v1beta/v1/models"
        );
    }

    #[test]
    fn works_for_models_and_messages_suffixes() {
        assert_eq!(join_v1("https://host", "models"), "https://host/v1/models");
        assert_eq!(
            join_v1("https://host/v1", "messages"),
            "https://host/v1/messages"
        );
    }
}
