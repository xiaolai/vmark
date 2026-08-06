//! Prompt formatting primitives for the semantic checker: bounded truncation and
//! nonce-fenced blocks.
//!
//! Split out of `checker.rs` for size. The fence nonce is a prompt-injection
//! boundary, not decoration — document text goes inside a delimiter the document
//! cannot itself contain.
//!
//! @coordinates-with checker.rs — the module this was split from
//! @module coherence/checker_format

use super::checker::MAX_TEXT_CHARS;

pub(super) fn truncate(text: &str, limit: usize) -> String {
    const MARKER: &str = "\n[truncated]";
    if text.len() <= limit {
        return text.to_string();
    }
    // The marker lives INSIDE the budget so callers can rely on `limit`.
    let mut cut = limit.saturating_sub(MARKER.len());
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}{MARKER}", &text[..cut])
}

pub(super) fn fenced(nonce: &str, label: &str, body: &str) -> String {
    format!(
        "<data-{nonce} label=\"{label}\">\n{}\n</data-{nonce}>",
        truncate(body, MAX_TEXT_CHARS)
    )
}
