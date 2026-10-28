//! CommonMark link reference definitions, read the way the production
//! parser (micromark) reads them from the start of a paragraph's text.
//!
//! The input is the paragraph's lines joined by `\n`; it never holds a
//! blank line. A definition is a label of at most 999 UTF-16 units (no
//! unescaped bracket, some non-space character, line endings allowed), a
//! `:`, a destination (`<…>` on one line, or a raw run with balanced
//! unescaped parentheses), and an optional title (`"…"`, `'…'` or `(…)`,
//! which may span lines), separated by whitespace holding at most one line
//! ending, then nothing but spaces to the line's end. A title that fails on
//! the line after the destination leaves the definition ending at the
//! destination's line.
//!
//! @module agent_journal/comment_anchor/definition

/// The most UTF-16 units a definition label may hold.
const MAX_LABEL_UNITS: usize = 999;

const fn is_space_or_tab(b: u8) -> bool {
    b == b' ' || b == b'\t'
}

fn skip_spaces(b: &[u8], mut i: usize) -> usize {
    while b.get(i).copied().is_some_and(is_space_or_tab) {
        i += 1;
    }
    i
}

/// Spaces and tabs holding at most one line ending.
fn skip_whitespace(b: &[u8], i: usize) -> usize {
    let i = skip_spaces(b, i);
    if b.get(i) == Some(&b'\n') {
        skip_spaces(b, i + 1)
    } else {
        i
    }
}

/// Where the definition starting at `s`'s first byte ends: the index of
/// the line ending after it, or `s.len()`.
pub(super) fn definition_end(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let open = skip_spaces(b, 0);
    if b.get(open) != Some(&b'[') {
        return None;
    }
    let colon = label_end(s, open + 1)?;
    if b.get(colon) != Some(&b':') {
        return None;
    }
    let dest = destination_end(b, skip_whitespace(b, colon + 1))?;
    title_end(b, dest).or_else(|| line_end(b, dest))
}

/// The index just past a label's closing `]`; `at` is just past its `[`.
fn label_end(s: &str, at: usize) -> Option<usize> {
    let (mut units, mut seen, mut escaped) = (0, false, false);
    for (i, ch) in s[at..].char_indices() {
        if escaped {
            escaped = false;
        } else {
            match ch {
                '[' => return None,
                ']' => return seen.then_some(at + i + 1),
                '\\' => escaped = true,
                _ => {}
            }
        }
        if ch != '\n' {
            units += ch.len_utf16();
            seen |= ch != ' ' && ch != '\t';
        }
        if units > MAX_LABEL_UNITS {
            return None;
        }
    }
    None
}

/// The index just past a destination starting at `i`.
fn destination_end(b: &[u8], i: usize) -> Option<usize> {
    if b.get(i) == Some(&b'<') {
        let mut j = i + 1;
        loop {
            match *b.get(j)? {
                b'>' => return Some(j + 1),
                b'\n' | b'<' => return None,
                b'\\' if matches!(b.get(j + 1), Some(b'<' | b'>' | b'\\')) => j += 2,
                _ => j += 1,
            }
        }
    }
    match b.get(i) {
        None | Some(b' ' | b')') => return None,
        Some(&c) if c < 0x20 || c == 0x7f => return None,
        _ => {}
    }
    let (mut j, mut balance) = (i, 0usize);
    loop {
        match b.get(j).copied() {
            None | Some(b' ' | b'\t' | b'\n') if balance == 0 => return Some(j),
            Some(b')') if balance == 0 => return Some(j),
            None => return None,
            Some(b'(') => balance += 1,
            Some(b')') => balance -= 1,
            Some(c) if c < 0x20 || c == 0x7f || c == b' ' => return None,
            Some(b'\\') if matches!(b.get(j + 1), Some(b'(' | b')' | b'\\')) => j += 1,
            Some(_) => {}
        }
        j += 1;
    }
}

/// The end of the definition when a title follows the destination ending
/// at `dest`; `None` when there is no well-formed title there.
fn title_end(b: &[u8], dest: usize) -> Option<usize> {
    let open = skip_whitespace(b, dest);
    if open == dest {
        return None;
    }
    let close = match *b.get(open)? {
        b'"' => b'"',
        b'\'' => b'\'',
        b'(' => b')',
        _ => return None,
    };
    let mut j = open + 1;
    loop {
        match *b.get(j)? {
            c if c == close => return line_end(b, j + 1),
            b'\\' if b.get(j + 1).is_some_and(|&n| n == close || n == b'\\') => j += 2,
            _ => j += 1,
        }
    }
}

/// `i` past trailing spaces when the line ends there.
fn line_end(b: &[u8], i: usize) -> Option<usize> {
    let i = skip_spaces(b, i);
    matches!(b.get(i), None | Some(b'\n')).then_some(i)
}
