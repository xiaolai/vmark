//! UTF-16 offset slicing over canonical text. The worker reports spans in
//! UTF-16 code units; the writer validates their text hashes in one pass,
//! O(text + spans · log spans), refusing offsets past the end or inside a
//! surrogate pair.

use crate::agent_journal::review::Range;

pub fn utf16_len(text: &str) -> u64 {
    text.encode_utf16().count() as u64
}

/// Slice `text` at every range. Order of `ranges` is preserved in the output.
pub fn utf16_slices<'a>(text: &'a str, ranges: &[Range]) -> Result<Vec<&'a str>, String> {
    let mut points: Vec<u64> = Vec::with_capacity(ranges.len() * 2);
    for r in ranges {
        if r.start > r.end {
            return Err(format!("range {}..{} is reversed", r.start, r.end));
        }
        points.push(r.start);
        points.push(r.end);
    }
    points.sort_unstable();
    points.dedup();
    let mut byte_at = std::collections::HashMap::with_capacity(points.len());
    let mut want = points.iter().peekable();
    let mut units = 0u64;
    for (byte, ch) in text.char_indices() {
        while let Some(&&p) = want.peek() {
            if p == units {
                byte_at.insert(p, byte);
                want.next();
            } else if p < units {
                return Err(format!("offset {p} falls inside a surrogate pair"));
            } else {
                break;
            }
        }
        units += ch.len_utf16() as u64;
    }
    for &p in want {
        if p == units {
            byte_at.insert(p, text.len());
        } else if p < units {
            return Err(format!("offset {p} falls inside a surrogate pair"));
        } else {
            return Err(format!("offset {p} is past the end ({units} UTF-16 units)"));
        }
    }
    Ok(ranges
        .iter()
        .map(|r| &text[byte_at[&r.start]..byte_at[&r.end]])
        .collect())
}
