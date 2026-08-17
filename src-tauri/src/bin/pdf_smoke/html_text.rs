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

/// Decode the entities a heading can realistically carry.
///
/// The five predefined XML ones are what a serializer is REQUIRED to escape in
/// text, so they are what the export HTML actually produces — `textContent`
/// emits `©` and `—` as literal UTF-8, not as `&copy;` / `&mdash;`. The handful
/// of named entities below are decoded anyway because hand-written HTML reaches
/// this path too and leaving one literal silently mismatches the heading, and
/// numeric references cover everything else.
///
/// An unknown entity is left as written rather than guessed at: a wrong
/// substitution is worse than a missed one, since both break the match but only
/// one is obvious in the output.
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
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "hellip" => Some('…'),
            "copy" => Some('©'),
            "reg" => Some('®'),
            "trade" => Some('™'),
            "ldquo" => Some('\u{201c}'),
            "rdquo" => Some('\u{201d}'),
            "lsquo" => Some('\u{2018}'),
            "rsquo" => Some('\u{2019}'),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_predefined_entities_round_trip_to_dom_text() {
        // The frontend reads `Element.textContent`, where these are already
        // characters. Leaving them literal made the harness's heading text
        // disagree with the app's, so outline matching missed and the bookmark
        // landed on the wrong page — a harness bug that reads as a product bug.
        assert_eq!(decode_entities("Fish &amp; Chips"), "Fish & Chips");
        assert_eq!(decode_entities("&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_entities("&quot;quoted&quot;"), "\"quoted\"");
        assert_eq!(decode_entities("it&apos;s"), "it's");
    }

    #[test]
    fn numeric_references_decode_in_both_bases() {
        assert_eq!(decode_entities("&#65;&#x42;"), "AB");
        assert_eq!(decode_entities("&#x4E2D;"), "中");
    }

    #[test]
    fn an_unknown_entity_is_left_alone_rather_than_guessed() {
        // A wrong substitution breaks the match just as badly as a missed one,
        // and is harder to see in the output.
        assert_eq!(decode_entities("&notarealentity;"), "&notarealentity;");
        // A bare ampersand is not an entity at all.
        assert_eq!(decode_entities("A & B"), "A & B");
        // An unterminated one must not eat the rest of the heading.
        assert_eq!(decode_entities("A &amp B"), "A &amp B");
    }

    #[test]
    fn text_with_no_ampersand_is_returned_unchanged() {
        assert_eq!(decode_entities("Chapter 1"), "Chapter 1");
    }

    #[test]
    fn headings_are_read_with_their_level_and_inline_markup_stripped() {
        let html = "<body><h1>Intro</h1><p>x</p><h2>Fish &amp; <code>Chips</code></h2></body>";
        let got = headings_of(html);
        assert_eq!(got.len(), 2);
        assert_eq!((got[0].level, got[0].text.as_str()), (1, "Intro"));
        // Nested markup dropped AND the entity decoded — both are needed for
        // this to equal what `textContent` gives the dialog.
        assert_eq!((got[1].level, got[1].text.as_str()), (2, "Fish & Chips"));
    }

    #[test]
    fn an_empty_heading_is_not_reported() {
        // The dialog filters these out too; keeping one would add a bookmark
        // with no title.
        assert!(headings_of("<body><h3>   </h3></body>").is_empty());
    }
}
