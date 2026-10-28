//! Identity keys for saved documents: the parse of a window's document key,
//! and (re-exported) the file identity an external rename is checked
//! against.
//!
//! A path key is the directory entry's own spelling
//! (`files/entry_spelling.rs`), never folded: two spellings are one
//! document only when the filesystem says they name one entry. In short:
//!   - Links are followed first, as the save path does, so a symlink and
//!     its target are one key.
//!   - An existing file is keyed by the name its directory stores; a hard
//!     link keeps its own name, and so its own document.
//!   - A missing file is keyed by its nearest existing ancestor's spelling
//!     plus the exact rest, and marked provisional: once it exists the
//!     registry reconciles the provisional key with the stored one
//!     (`aliases`).
//!   - A lookup the filesystem refuses is a refusal (`JOURNAL_IO`), never a
//!     guess from the text.
//!   - File identity is (device, inode) on Unix and (volume serial, file
//!     index) on Windows. Hard links share it, so it is evidence for a
//!     rename only when the old path no longer holds it, never a key.
//!
//! @coordinates-with files/entry_spelling.rs — the entry spelling
//! @coordinates-with agent_journal/doc_index_format.rs — the key policy id
//! @module agent_journal/doc_key

use std::path::{Path, PathBuf};

use crate::agent_journal::errors::TxnError;
use crate::files::entry_spelling::{entry_path, key_text, EntryPath, LookupError};
pub use crate::files::path_identity::{file_id, FileId};

/// Longest accepted document key, in UTF-8 bytes.
pub const DOC_KEY_MAX_BYTES: usize = 4096;

/// A parsed document key: a saved file's entry key, or a session key.
pub(crate) enum Key {
    Path { id: String, entry: EntryPath },
    Session(String),
}

impl Key {
    pub(crate) fn id(&self) -> &str {
        match self {
            Key::Path { id, .. } | Key::Session(id) => id,
        }
    }
}

/// A refused lookup as the journal reports it.
pub(crate) fn lookup_refused(e: &LookupError) -> TxnError {
    TxnError::Io(format!("document identity lookup refused: {e}"))
}

/// The key id of an entry path.
pub(crate) fn path_id(path: &Path) -> Result<String, TxnError> {
    key_text(path)
        .map(|k| format!("path:{k}"))
        .map_err(|e| lookup_refused(&e))
}

/// Parse a window's document key (`INVALID_REQUEST` when empty or too long,
/// `JOURNAL_IO` when the filesystem refuses the lookup).
pub(crate) fn parse(key: &str) -> Result<Key, TxnError> {
    if key.is_empty() || key.len() > DOC_KEY_MAX_BYTES {
        return Err(TxnError::InvalidRequest(format!(
            "document key must be 1..={DOC_KEY_MAX_BYTES} bytes"
        )));
    }
    match key.strip_prefix("path:") {
        Some("") => Err(TxnError::InvalidRequest("a path key names no file".into())),
        Some(raw) => {
            let entry = entry_path(Path::new(raw)).map_err(|e| lookup_refused(&e))?;
            Ok(Key::Path {
                id: path_id(&entry.path)?,
                entry,
            })
        }
        None => Ok(Key::Session(key.to_owned())),
    }
}

/// The entry path a probe of `path` is keyed by, or `None` when the lookup
/// is refused.
pub(crate) fn probe_entry(path: &Path) -> Option<(PathBuf, String)> {
    let entry = entry_path(path).ok()?;
    let id = path_id(&entry.path).ok()?;
    Some((entry.path, id))
}

/// The key text of the document at `path` (no `path:` prefix).
#[cfg(test)]
pub fn path_identity_key(path: &Path) -> String {
    let entry = entry_path(path).expect("lookup");
    key_text(&entry.path).expect("unicode")
}

#[cfg(test)]
#[path = "doc_identity.test.rs"]
mod identity_tests;

#[cfg(test)]
#[path = "doc_identity_alias.test.rs"]
mod identity_alias_tests;
