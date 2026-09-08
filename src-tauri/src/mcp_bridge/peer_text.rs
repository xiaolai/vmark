//! How text a CLIENT chose is allowed to reach a log line or the UI.
//!
//! Everything on this bridge arrives from a sidecar over a socket: the
//! envelope's `type` and `id`, the `identify` name and version. Interpolating
//! one into a log with `{}` lets it carry NEWLINES — so a client can write log
//! lines of its own, in VMark's own format, and a reader cannot tell them from
//! the app's (#377). Nothing bounds them either, so a megabyte `type` is a
//! megabyte of log. `server.rs`'s privacy comment said the debug line logs
//! "shape and size, never text", which was true of the document and not of
//! these two fields.
//!
//! Two answers, because the two destinations want different things:
//!
//!   - [`peer_text`] is for a LOG. `{:?}` on a `str` escapes a newline to
//!     `\n`, a quote to `\"` and anything unprintable to `\u{…}`, so the value
//!     can only ever be one token on one line.
//!   - [`peer_label`] is for a value VMark stores and shows (the client name in
//!     Settings → Integrations). Quoting would be wrong there, so control
//!     characters are removed instead.
//!
//! Both bound the length, with a marker, so a truncated value cannot be
//! mistaken for a short one.
//!
//! @coordinates-with mcp_bridge/server.rs — the envelope log
//! @coordinates-with mcp_bridge/identify.rs — the client-supplied identity
//! @module mcp_bridge::peer_text

/// Characters of a peer-supplied value kept. A client name is a token
/// (`claude-code`, `codex-cli`), a message id a uuid, a message type a dotted
/// operation — none of them approach this, so the bound only ever fires on a
/// value that was never one of those.
pub(super) const MAX_PEER_TEXT: usize = 120;

/// Marks a value the bound cut short, so `"aaa…"` cannot be read as the whole
/// thing.
const TRUNCATED: char = '…';

/// Bound `value` to [`MAX_PEER_TEXT`] characters (never bytes — a cut inside a
/// UTF-8 sequence would panic), appending [`TRUNCATED`] when it cut.
fn bounded(value: &str) -> String {
    let mut out: String = value.chars().take(MAX_PEER_TEXT).collect();
    if value.chars().nth(MAX_PEER_TEXT).is_some() {
        out.push(TRUNCATED);
    }
    out
}

/// A peer-supplied value as it may appear in a LOG: escaped and bounded.
///
/// The result carries its own quotes — `peer_text` is what goes after the
/// `{}`, not inside another pair of them.
pub(super) fn peer_text(value: &str) -> String {
    format!("{:?}", bounded(value))
}

/// A peer-supplied value as it may be STORED and shown: control characters
/// removed and bounded, with no quoting, since this one is rendered as a
/// label rather than as a token in a log line.
pub(super) fn peer_label(value: &str) -> String {
    bounded(
        &value
            .chars()
            .filter(|c| !c.is_control())
            .collect::<String>(),
    )
}

#[cfg(test)]
#[path = "peer_text.test.rs"]
mod tests;
