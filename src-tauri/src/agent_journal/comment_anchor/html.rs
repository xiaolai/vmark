//! HTML blocks, GFM table rows and `<details>` tags, read line by line for
//! the outline scanner.
//!
//! HTML block starts follow CommonMark's seven kinds with micromark's block
//! tag names. `<details>` matching mirrors the production parser's details
//! plugin: the probe that loads it, its opening tag and its closing tag.
//!
//! @module agent_journal/comment_anchor/html

use super::lines::{is_blank, unindented};
use super::work;

/// Where an HTML block ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum HtmlEnd {
    /// On the first line (the start line included) containing this, ASCII case-insensitively.
    Marker(&'static str),
    /// Before the next blank line.
    Blank,
}

const RAW: [(&str, &str); 4] = [
    ("pre", "</pre>"),
    ("script", "</script>"),
    ("style", "</style>"),
    ("textarea", "</textarea>"),
];

const BLOCK_NAMES: [&str; 62] = [
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "search",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
];

/// The start of an HTML block, and how it ends. A complete lone tag (kind 7)
/// cannot interrupt a paragraph, so it is refused `in_paragraph`.
pub(super) fn html_start(s: &str, in_paragraph: bool) -> Option<HtmlEnd> {
    let r = unindented(s)?;
    if !r.starts_with('<') {
        return None;
    }
    let lower = r.to_ascii_lowercase();
    let ends_name =
        |at: usize| matches!(lower.as_bytes().get(at), None | Some(b' ' | b'\t' | b'>'));
    if let Some((_, end)) = RAW
        .iter()
        .find(|(name, _)| lower[1..].starts_with(*name) && ends_name(1 + name.len()))
    {
        return Some(HtmlEnd::Marker(end));
    }
    for (open, end) in [("<!--", "-->"), ("<?", "?>")] {
        if lower.starts_with(open) {
            return Some(HtmlEnd::Marker(end));
        }
    }
    // CommonMark's CDATA opener is case-sensitive, unlike tag names.
    if r.starts_with("<![CDATA[") {
        return Some(HtmlEnd::Marker("]]>"));
    }
    if lower.as_bytes().get(2).is_some_and(u8::is_ascii_alphabetic) && lower.starts_with("<!") {
        return Some(HtmlEnd::Marker(">"));
    }
    let name_at = if lower.starts_with("</") { 2 } else { 1 };
    let name_len = lower[name_at..]
        .bytes()
        .take_while(u8::is_ascii_alphanumeric)
        .count();
    let after = &lower[name_at + name_len..];
    let block_end =
        after.is_empty() || after.starts_with([' ', '\t', '>']) || after.starts_with("/>");
    if block_end && BLOCK_NAMES.contains(&&lower[name_at..name_at + name_len]) {
        return Some(HtmlEnd::Blank);
    }
    (!in_paragraph && complete_tag_line(r.as_bytes())).then_some(HtmlEnd::Blank)
}

/// Whether line `s` holds the end marker of a kind 1–5 HTML block.
pub(super) fn html_ends(s: &str, marker: &str) -> bool {
    s.to_ascii_lowercase().contains(marker)
}

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while b.get(i).is_some_and(|c| matches!(c, b' ' | b'\t')) {
        i += 1;
    }
    i
}

fn name_end(b: &[u8], i: usize, first: fn(&u8) -> bool, rest: fn(&u8) -> bool) -> Option<usize> {
    if !b.get(i).is_some_and(first) {
        return None;
    }
    Some(i + 1 + b[i + 1..].iter().take_while(|c| rest(c)).count())
}

/// One complete open or closing tag, then only whitespace (CommonMark kind 7).
fn complete_tag_line(b: &[u8]) -> bool {
    let closing = b.get(1) == Some(&b'/');
    let tag_char = |c: &u8| c.is_ascii_alphanumeric() || *c == b'-';
    let Some(mut i) = name_end(
        b,
        1 + usize::from(closing),
        u8::is_ascii_alphabetic,
        tag_char,
    ) else {
        return false;
    };
    if closing {
        i = skip_ws(b, i);
    } else {
        loop {
            let at = skip_ws(b, i);
            if matches!(b.get(at), Some(b'>' | b'/') | None) || at == i {
                i = at;
                break;
            }
            let attr_first = |c: &u8| c.is_ascii_alphabetic() || matches!(c, b'_' | b':');
            let attr_rest =
                |c: &u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b':' | b'-');
            let Some(end) = name_end(b, at, attr_first, attr_rest) else {
                return false;
            };
            i = end;
            let eq = skip_ws(b, i);
            if b.get(eq) != Some(&b'=') {
                continue;
            }
            let v = skip_ws(b, eq + 1);
            i = match b.get(v) {
                Some(q @ (b'"' | b'\'')) => match b[v + 1..].iter().position(|c| c == q) {
                    Some(len) => v + len + 2,
                    None => return false,
                },
                _ => {
                    let n = b[v..]
                        .iter()
                        .take_while(|c| !b" \t\"'=<>`".contains(*c))
                        .count();
                    if n == 0 {
                        return false;
                    }
                    v + n
                }
            };
        }
        if b.get(i) == Some(&b'/') {
            i += 1;
        }
    }
    b.get(i) == Some(&b'>') && std::str::from_utf8(&b[i + 1..]).is_ok_and(is_blank)
}

/// Cells in a table row: pipes not escaped, without one leading and one trailing pipe.
pub(super) fn table_cells(s: &str) -> usize {
    let row = s.trim_matches([' ', '\t']);
    let row = row.strip_prefix('|').unwrap_or(row);
    let mut cells = 1;
    let mut escaped = false;
    let mut trailing = false;
    for b in row.bytes() {
        trailing = false;
        match b {
            _ if escaped => escaped = false,
            b'\\' => escaped = true,
            b'|' => {
                cells += 1;
                trailing = true;
            }
            _ => {}
        }
    }
    if trailing {
        cells -= 1;
    }
    cells
}

/// A table delimiter row's cell count: it holds a pipe and every cell is `:?-+:?`.
pub(super) fn delimiter_cells(s: &str) -> Option<usize> {
    let row = unindented(s)?.trim_matches([' ', '\t']);
    if !row.contains('|') {
        return None;
    }
    let row = row.strip_prefix('|').unwrap_or(row);
    let row = row.strip_suffix('|').unwrap_or(row);
    let mut cells = 0;
    for cell in row.split('|') {
        let c = cell.trim_matches([' ', '\t']);
        let c = c.strip_prefix(':').unwrap_or(c);
        let c = c.strip_suffix(':').unwrap_or(c);
        if c.is_empty() || !c.bytes().all(|b| b == b'-') {
            return None;
        }
        cells += 1;
    }
    Some(cells)
}

/// The details plugin loads only when the document holds `<details` then whitespace, `>` or its end.
pub(super) fn details_probe(text: &str) -> bool {
    work::add(text.len());
    let lower = text.to_ascii_lowercase();
    lower.match_indices("<details").any(|(at, m)| {
        lower[at + m.len()..]
            .chars()
            .next()
            .is_none_or(|c| c.is_whitespace() || c == '>')
    })
}

/// Where the first opening `<details …>` tag starts (a word boundary after the name, then a `>`).
pub(super) fn details_open_at(value: &str) -> Option<usize> {
    let lower = value.to_ascii_lowercase();
    let first = lower.match_indices("<details").find(|(at, m)| {
        let next = lower.as_bytes().get(at + m.len());
        !next.is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
    })?;
    lower[first.0 + 8..].contains('>').then_some(first.0)
}

/// Where the first `</details>` starts.
pub(super) fn details_close_at(value: &str) -> Option<usize> {
    value.to_ascii_lowercase().find("</details>")
}
