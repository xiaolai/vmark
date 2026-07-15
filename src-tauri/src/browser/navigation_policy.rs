//! Strict top-level navigation target validation.

use super::canonicalize_origin;
use crate::browser::registry::BrowserError;

/// Return the exact trimmed HTTP(S) URL that passed the navigation gate.
pub fn validate_navigation_url(url: &str) -> Result<String, BrowserError> {
    let trimmed = url.trim();
    let invalid = || BrowserError::InvalidUrl(url.to_string());
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) || trimmed.contains('\\') {
        return Err(invalid());
    }
    if trimmed
        .split_once("://")
        .map(|(_, rest)| rest.starts_with('/'))
        .unwrap_or(false)
    {
        return Err(invalid());
    }
    canonicalize_origin(trimmed)
        .map(|_| trimmed.to_string())
        .ok_or_else(invalid)
}
