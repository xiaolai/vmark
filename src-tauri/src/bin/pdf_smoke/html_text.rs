//! Reading heading text out of the export HTML the way the DOM would.
//!
//! Purpose: the one-shot harness calls the renderer directly, below the command
//! layer that injects the outline — so it has to recover the headings itself to
//! show whether the sidebar works. That is exactly how the macOS-only outline
//! gap went unnoticed for months.
//!
//! Split from `render_one.rs` for the size limit, and because this is text
//! extraction rather than render flow.
//!
//! @coordinates-with render_one.rs — the only consumer
//! @coordinates-with pdf_export/outline_match.rs — matches against this text
//! @module bin/pdf_smoke/html_text

use vmark_lib::pdf_export::heading::Heading;

/// Pull headings out of the export HTML, the way the dialog does from the DOM.
///
/// The harness calls the renderer directly, below the command layer where the
/// outline is injected — so without this the artifacts could never show whether
/// the sidebar works, which is exactly how the macOS-only gap went unnoticed.
pub fn headings_of(html: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    let body = html.find("<body").map(|i| &html[i..]).unwrap_or(html);
    let mut rest = body;
    while let Some(i) = rest.find("<h") {
        let after = &rest[i + 2..];
        let level = match after.as_bytes().first() {
            Some(c @ b'1'..=b'6') => u32::from(c - b'0'),
            _ => {
                rest = &rest[i + 2..];
                continue;
            }
        };
        let Some(open_end) = after.find('>') else {
            break;
        };
        let tail = &after[open_end + 1..];
        let Some(close) = tail.find("</h") else { break };
        let text: String = strip_tags(&tail[..close]);
        if !text.trim().is_empty() {
            out.push(Heading {
                level,
                text: text.trim().to_string(),
            });
        }
        rest = &tail[close..];
    }
    out
}

/// Drop nested markup so a heading with inline code or a link still matches the
/// plain text the PDF carries.
///
/// Entities are DECODED, because the production path this imitates reads
/// `Element.textContent` from a parsed DOM — where `Fish &amp; Chips` is
/// `Fish & Chips`. Leaving the entity literal made the harness's heading text
/// disagree with the app's for any heading containing `&`, `<`, `>` or a quote,
/// so outline matching missed and the bookmark landed on the wrong page — a
/// harness bug that reads exactly like a product bug.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for ch in s.chars() {
        match ch {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            c if depth == 0 => out.push(c),
            _ => {}
        }
    }
    decode_entities(&out)
}

/// Decode the five predefined XML entities plus numeric character references.
///
/// Those five are what an HTML serializer is required to escape in text, so they
/// are what a round trip through the export HTML can produce. Anything else is
/// left as written rather than guessed at.
fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        let Some(semi) = after.find(';').filter(|n| *n <= 10) else {
            out.push('&');
            rest = &after[1..];
            continue;
        };
        let entity = &after[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some('\u{00a0}'),
            e if e.starts_with("#x") || e.starts_with("#X") => u32::from_str_radix(&e[2..], 16)
                .ok()
                .and_then(char::from_u32),
            e if e.starts_with('#') => e[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &after[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &after[1..];
            }
        }
    }
    out.push_str(rest);
    out
}
