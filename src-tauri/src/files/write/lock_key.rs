//! The write lock's key text: conservative, broad folding.
//!
//! Purpose: the per-target write lock (`target_lock.rs`) must give every
//! spelling one volume could treat as the same file the same key. A false
//! merge here only serializes two writes; a false distinction lets two
//! writes to one file overlap. So this folds more than any one volume does,
//! and is deliberately NOT the agent journal's identity, which keys a
//! document by the directory entry's stored spelling instead
//! (`files/entry_spelling.rs`) because a false merge there is the costly
//! direction.
//!
//! Key decisions:
//!   - Every platform gets the union of the foldings its volumes apply:
//!     the code points HFS+ ignores are dropped, the text is NFC, each
//!     character goes through NTFS's simple-uppercase mapping (so dotless
//!     `ı` meets `I`, as on NTFS), then Unicode default full case folding
//!     (so `ß` meets `SS`, as on APFS), then NFC again.
//!   - On Windows, `target_key` locks the canonical referent's text; Unix
//!     writes lock on the held folder's identity plus the folded name.
//!
//! @coordinates-with files/write/target_lock.rs — takes the lock by this key
//! @coordinates-with files/path_identity.rs — separator cleanup
//! @module files/write/lock_key

use unicode_normalization::UnicodeNormalization;

use crate::files::path_identity::path_text;

/// The code points HFS+ ignores when it compares names (zero-width
/// joiners and non-joiners, directional marks and overrides, the
/// deprecated format characters, the byte order mark).
fn ignorable(c: char) -> bool {
    matches!(c,
        '\u{200C}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{206A}'..='\u{206F}' | '\u{FEFF}')
}

/// Fold a path's (or a name's) text into its lock key. Pure.
pub(crate) fn fold(raw: &str, windows: bool) -> String {
    let text: String = path_text(raw, windows)
        .chars()
        .filter(|c| !ignorable(*c))
        .nfc()
        .map(simple_fold)
        .collect();
    icu_casemap::CaseMapperBorrowed::new()
        .fold_string(&text)
        .nfc()
        .collect()
}

/// NTFS's comparison, one UTF-16 unit at a time through a simple-uppercase
/// table: a character with a one-unit uppercase is that uppercase (spelled
/// as its lowercase when that maps back, so keys read naturally), anything
/// else (`ß`, the Kelvin sign, a supplementary character) is itself.
fn simple_fold(c: char) -> char {
    let Some(upper) = single(c.to_uppercase()).filter(|u| u.len_utf16() == 1 && c.len_utf16() == 1)
    else {
        return c;
    };
    match single(upper.to_lowercase()) {
        Some(lower) if single(lower.to_uppercase()) == Some(upper) => lower,
        _ => upper,
    }
}

/// The only character of a case mapping, or `None` for a multi-character one.
fn single(mut chars: impl Iterator<Item = char>) -> Option<char> {
    let first = chars.next()?;
    chars.next().is_none().then_some(first)
}

/// The lock key of the file `path` names: its canonical referent (links
/// followed, `.`/`..` resolved, the stored spelling where it exists),
/// folded. Only Windows writes lock on it.
#[cfg(any(windows, test))]
pub(crate) fn target_key(path: &std::path::Path) -> String {
    use crate::link_target::resolve_link_target;
    let resolved = resolve_link_target(path).unwrap_or_else(|_| lexical(path));
    let canonical = std::fs::canonicalize(&resolved).unwrap_or(resolved);
    fold(&canonical.to_string_lossy(), cfg!(windows))
}

/// `.` and `..` removed without touching the filesystem.
#[cfg(any(windows, test))]
fn lexical(path: &std::path::Path) -> std::path::PathBuf {
    use std::path::{Component, PathBuf};
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
#[path = "lock_key.test.rs"]
mod tests;
