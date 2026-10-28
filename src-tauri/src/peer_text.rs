//! How text chosen OUTSIDE this process is allowed to reach a log line or the UI.
//!
//! Purpose: one rule for every string Rust did not write itself — an MCP
//! client's envelope `type`/`id` and `identify` name, a webview's command
//! arguments and event payloads, a path handed over by Finder or argv.
//! Interpolating one into a log with `{}` lets it carry NEWLINES — so its
//! author can write log lines of their own, in VMark's own format, and a
//! reader cannot tell them from the app's. Nothing bounds them either,
//! so a megabyte value is a megabyte of log.
//!
//! Three answers, because the destinations want different things:
//!
//!   - [`peer_text`] is for a short TOKEN in a log (a label, an id, a type).
//!     `{:?}` on a `str` escapes a newline to `\n`, a quote to `\"` and
//!     anything unprintable — a carriage return, the `ESC` that starts a
//!     terminal colour sequence — to `\u{…}`, so the value can only ever be
//!     one token on one line.
//!   - [`peer_message`] is the same escaping for free-form DIAGNOSTIC text
//!     (a frontend milestone line, an error message, a path). Its bound is
//!     wider, because cutting a diagnostic at token length would throw away
//!     the part a reader needs.
//!   - [`peer_label`] is for a value VMark stores and shows (the client name in
//!     Settings → Integrations). Quoting would be wrong there, so control
//!     characters and bidirectional formatting characters
//!     ([`is_bidi_formatting`]) are removed instead.
//!
//! [`is_bidi_formatting`] is the one definition of that set: every rule that
//! refuses or strips them for a label (`mcp_bridge/attribution.rs`,
//! `agent_journal/actor.rs`, `genies/scanning.rs`) asks it.
//!
//! All three bound the length, with a marker, so a truncated value cannot be
//! mistaken for a short one.
//!
//! A path is the same kind of text — a file name may hold a newline — and is
//! logged with `{:?}`, which quotes and escapes it; its length is the
//! filesystem's to bound. `log_escaping.test.rs` is the gate: no log call in
//! the production tree passes `path.display()` or wraps a `{}` in quotes of
//! its own.
//!
//! @coordinates-with mcp_bridge/server.rs — the envelope log
//! @coordinates-with mcp_bridge/identify.rs — the client-supplied identity
//! @coordinates-with app_setup.rs — the frontend's log commands
//! @module peer_text

/// Characters of a peer-supplied token kept. A client name is a token
/// (`claude-code`, `codex-cli`), a message id a uuid, a message type a dotted
/// operation, a window label `doc-12` — none of them approach this, so the
/// bound only ever fires on a value that was never one of those.
pub(crate) const MAX_PEER_TEXT: usize = 120;

/// Characters of a peer-supplied diagnostic kept. Sized for an error message
/// with its context or the longest path a filesystem allows; far below the
/// megabytes an unbounded argument could carry.
pub(crate) const MAX_PEER_MESSAGE: usize = 2048;

/// Marks a value the bound cut short, so `"aaa…"` cannot be read as the whole
/// thing.
const TRUNCATED: char = '…';

/// Bound `value` to `max` characters (never bytes — a cut inside a UTF-8
/// sequence would panic), appending [`TRUNCATED`] when it cut.
fn bounded(value: &str, max: usize) -> String {
    let mut out: String = value.chars().take(max).collect();
    if value.chars().nth(max).is_some() {
        out.push(TRUNCATED);
    }
    out
}

/// A peer-supplied token as it may appear in a LOG: escaped and bounded.
///
/// The result carries its own quotes — `peer_text` is what goes after the
/// `{}`, not inside another pair of them.
pub(crate) fn peer_text(value: &str) -> String {
    format!("{:?}", bounded(value, MAX_PEER_TEXT))
}

/// Peer-supplied diagnostic text as it may appear in a LOG: escaped exactly as
/// [`peer_text`] is, bounded at [`MAX_PEER_MESSAGE`].
pub(crate) fn peer_message(value: &str) -> String {
    format!("{:?}", bounded(value, MAX_PEER_MESSAGE))
}

/// A peer-supplied value as it may be STORED and shown: control and
/// bidirectional formatting characters removed and bounded, with no quoting,
/// since this one is rendered as a label rather than as a token in a log line.
pub(crate) fn peer_label(value: &str) -> String {
    bounded(
        &value
            .chars()
            .filter(|c| !c.is_control() && !is_bidi_formatting(*c))
            .collect::<String>(),
        MAX_PEER_TEXT,
    )
}

/// Unicode's bidirectional formatting characters (UAX #9): the Arabic letter
/// mark, the left-to-right and right-to-left marks, the embeddings, overrides
/// and their pop, and the isolates and theirs. None is `char::is_control`
/// (they are `Cf`, not `Cc`), yet each reorders how a label and the text
/// after it render — the Trojan-Source class.
pub(crate) fn is_bidi_formatting(c: char) -> bool {
    matches!(
        c,
        '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'
    )
}

#[cfg(test)]
#[path = "log_capture.test.rs"]
pub(crate) mod log_capture;

#[cfg(test)]
#[path = "peer_text.test.rs"]
mod tests;

#[cfg(test)]
#[path = "log_escaping.test.rs"]
mod log_escaping_gate;
