//! #377/#375 — a client cannot forge a log line, and cannot spend the log (or
//! the Settings list) on a value that has no length.

use super::*;

#[test]
fn a_newline_in_a_logged_value_cannot_start_a_line_of_its_own() {
    // The shape of the attack: a client `type` that reads, in the log, like a
    // second bridge log line reporting something that never happened.
    let forged = "session.get\n[MCP Bridge] Client 1 identified as trusted-admin";
    let logged = peer_text(forged);
    assert!(
        !logged.contains('\n'),
        "an escaped value must be one line: {logged}"
    );
    assert!(logged.contains("\\n"), "{logged}");
    assert!(logged.starts_with('"') && logged.ends_with('"'), "{logged}");
}

#[test]
fn a_carriage_return_and_a_quote_are_escaped_too() {
    let logged = peer_text("a\r\"b\u{7}");
    assert!(!logged.contains('\r'), "{logged}");
    assert_eq!(logged, "\"a\\r\\\"b\\u{7}\"");
}

#[test]
fn an_unbounded_value_is_cut_and_says_so() {
    let long = "x".repeat(MAX_PEER_TEXT * 4);
    let logged = peer_text(&long);
    // Bounded, and visibly bounded: a value cut short must not read as a
    // short value.
    assert!(logged.contains('…'), "{logged}");
    assert_eq!(logged.chars().filter(|c| *c == 'x').count(), MAX_PEER_TEXT);

    let exact = "y".repeat(MAX_PEER_TEXT);
    assert!(
        !peer_text(&exact).contains('…'),
        "a value at the bound was not cut"
    );
}

#[test]
fn a_label_keeps_its_text_unquoted_but_loses_its_control_characters() {
    // Settings → Integrations shows this one, so quoting would be wrong; the
    // newline still must not survive into the log line it is written to.
    assert_eq!(peer_label("claude-code"), "claude-code");
    assert_eq!(peer_label("claude\ncode\u{7}"), "claudecode");
    assert_eq!(
        peer_label(&"z".repeat(MAX_PEER_TEXT + 1)).chars().count(),
        MAX_PEER_TEXT + 1
    );
}

#[test]
fn a_multibyte_value_is_bounded_by_characters_not_by_bytes() {
    // A byte-wise cut inside a UTF-8 sequence panics; every field here can be
    // any Unicode the client sends.
    let cjk = "字".repeat(MAX_PEER_TEXT + 10);
    let label = peer_label(&cjk);
    assert_eq!(label.chars().filter(|c| *c == '字').count(), MAX_PEER_TEXT);
    assert!(peer_text(&cjk).contains('…'));
}
