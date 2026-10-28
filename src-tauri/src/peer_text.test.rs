//! #377/#375 — a client cannot forge a log line, and cannot spend the log (or
//! the Settings list) on a value that has no length.
//!
//! WI-RA7.7 — the same rule for text a webview or the command line supplies:
//! `\n`, `\r`, terminal escape sequences and megabyte inputs, for the token
//! form and the wider diagnostic form.

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
fn a_label_loses_its_bidi_formatting_characters_too() {
    // Shown in Settings → Integrations and composed into the display name an
    // MCP edit is attributed to: an override or isolate would reorder it.
    for c in [
        '\u{061C}', '\u{200E}', '\u{200F}', '\u{202A}', '\u{202B}', '\u{202C}', '\u{202D}',
        '\u{202E}', '\u{2066}', '\u{2067}', '\u{2068}', '\u{2069}',
    ] {
        assert_eq!(
            peer_label(&format!("claude{c}edoc")),
            "claudeedoc",
            "U+{:04X}",
            c as u32
        );
    }
    // Right-to-left text itself is kept.
    assert_eq!(peer_label("مراجعة"), "مراجعة");
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

/// Every character that can end a line or drive a terminal, in both log forms.
/// A log viewer that renders ANSI would otherwise let a value recolour, erase
/// or overwrite the lines around it.
#[test]
fn line_breaks_and_terminal_escapes_never_reach_the_log_raw() {
    let hostile = "ok\n[Update] forged\r\x1b[2K\x1b[31mred\x1b[0m\u{85}\u{2028}\u{2029}\0end";
    for logged in [peer_text(hostile), peer_message(hostile)] {
        for raw in ['\n', '\r', '\x1b', '\u{85}', '\u{2028}', '\u{2029}', '\0'] {
            assert!(
                !logged.contains(raw),
                "{raw:?} survived into the log line: {logged}"
            );
        }
        assert!(logged.contains("\\n") && logged.contains("\\r"), "{logged}");
        assert!(logged.contains("\\u{1b}[31m"), "{logged}");
        assert!(logged.starts_with('"') && logged.ends_with('"'), "{logged}");
    }
}

#[test]
fn printable_unicode_is_logged_as_itself() {
    // Escaping is for what a reader cannot see, not for what they can: a CJK
    // path or message has to stay legible in the log.
    assert_eq!(peer_text("文档-main"), "\"文档-main\"");
    assert_eq!(
        peer_message("/Users/a/笔记/日记.md"),
        "\"/Users/a/笔记/日记.md\""
    );
}

#[test]
fn a_megabyte_value_costs_the_log_a_bounded_line_in_either_form() {
    let huge = "A".repeat(1024 * 1024);
    let token = peer_text(&huge);
    let message = peer_message(&huge);
    // Two quotes and the truncation marker around the kept characters.
    assert_eq!(token.chars().count(), MAX_PEER_TEXT + 3);
    assert_eq!(message.chars().count(), MAX_PEER_MESSAGE + 3);
    assert!(token.ends_with("…\"") && message.ends_with("…\""));
}

#[test]
fn a_diagnostic_keeps_what_a_token_bound_would_cut() {
    // The frontend's update and window-close milestones carry error text; a
    // token-sized bound would drop the part of it a reader needs.
    let diagnostic = format!("[check:failed] {}", "e".repeat(MAX_PEER_TEXT * 2));
    assert!(peer_text(&diagnostic).contains('…'));
    assert!(!peer_message(&diagnostic).contains('…'));

    let exact = "m".repeat(MAX_PEER_MESSAGE);
    assert!(!peer_message(&exact).contains('…'));
    assert!(peer_message(&format!("{exact}m")).contains('…'));
}

#[test]
fn an_empty_value_is_an_empty_quoted_token() {
    assert_eq!(peer_text(""), "\"\"");
    assert_eq!(peer_message(""), "\"\"");
    assert_eq!(peer_label(""), "");
}
