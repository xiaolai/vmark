//! The agent journal's path identity: a path spelled as the directory
//! entry it names is stored, never folded.
//!
//! Purpose: the journal keys a document by its file's path. A false merge
//! (two files, one key) hands one file another's history and cannot be
//! undone; a false split only starts a new history. So no generic case
//! folding or Unicode normalization is applied: two spellings meet only
//! when the filesystem itself says they name one directory entry.
//!
//! Key decisions:
//!   - Links are followed first (`follow_links`, as the save path does),
//!     and the referent's parent directory is spelled by `fs::canonicalize`,
//!     so `..` is resolved by the filesystem, after any link before it,
//!     never by removing text.
//!   - An EXISTING leaf is spelled by the name its directory stores for it
//!     (`entry_spelling_stored.rs`). The path a handle reports is never
//!     used: for a hard link it may name another link.
//!   - A MISSING leaf keeps the requested suffix exactly under the nearest
//!     existing ancestor's canonical spelling. Which spellings the volume
//!     will treat as one once the file exists is not guessed: the registry
//!     looks each provisional key up again once it might exist. A link
//!     whose referent's folder is missing is keyed by that referent, so the
//!     key is the same before and after the referent is created; a `..`
//!     that steps out of a folder that does not resolve is refused, as the
//!     filesystem refuses it.
//!   - A lookup the filesystem refuses (permission, a link loop, a name
//!     that is not Unicode, an entry replaced while it was read) is an
//!     error, never a fallback to the text the caller sent.
//!
//! @coordinates-with agent_journal/doc_key.rs — parses a document key with it
//! @coordinates-with files/path_identity.rs — separators and file identity
//! @coordinates-with link_target.rs — follows links as the save path does
//! @module files/entry_spelling

use std::ffi::OsStr;
use std::io;
use std::path::{Component, Path, PathBuf};

use crate::files::path_identity::path_text;
use crate::link_target::{follow_links, normalize_parent, LinkResolveError};

// The name a directory stores for an existing entry.
#[path = "entry_spelling_stored.rs"]
mod stored;
#[cfg(all(test, unix))]
pub(crate) use stored::{AFTER_FOLLOW, BEFORE_LISTING};

/// A path as the journal keys it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryPath {
    /// The resolved path, leaf spelled as stored (existing) or as asked.
    pub path: PathBuf,
    /// Whether the leaf existed when it was looked up.
    pub exists: bool,
}

/// Why the filesystem could not say which entry a path names.
#[derive(Debug, thiserror::Error)]
pub enum LookupError {
    #[error("{}: {source}", path.display())]
    Io { path: PathBuf, source: io::Error },
    #[error("too many levels of symbolic links")]
    TooManyLinks,
    #[error("{} is not valid Unicode", .0.display())]
    NotUnicode(PathBuf),
    /// Several hard links in one folder, none spelled as asked (Unix; a
    /// Windows lookup names the entry it reached).
    #[cfg(unix)]
    #[error("{} matches several directory entries", .0.display())]
    Ambiguous(PathBuf),
    #[error("{} changed while it was looked up", .0.display())]
    Changed(PathBuf),
}

fn io_err(path: &Path, source: io::Error) -> LookupError {
    LookupError::Io {
        path: path.to_path_buf(),
        source,
    }
}

/// Absent, as opposed to unreadable.
fn absent(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
    )
}

fn link_err(path: &Path, e: LinkResolveError) -> LookupError {
    match e {
        LinkResolveError::TooManyLinks => LookupError::TooManyLinks,
        LinkResolveError::ReadLink(e) => io_err(path, e),
        LinkResolveError::ReferentParentMissing(dir) => {
            io_err(&dir, io::Error::from(io::ErrorKind::NotFound))
        }
    }
}

/// The entry `path` names, spelled as the journal keys it.
///
/// # Errors
/// The filesystem refused the lookup (see [`LookupError`]).
pub fn entry_path(path: &Path) -> Result<EntryPath, LookupError> {
    let (referent, seen) = follow_links(path).map_err(|e| link_err(path, e))?;
    stored::after_follow();
    let resolved = match normalize_parent(&referent) {
        Ok(p) => p,
        // The referent's folder is missing: the referent, keyed provisionally.
        Err(LinkResolveError::ReferentParentMissing(_)) => physical(&referent)?,
        Err(e) => return Err(link_err(path, e)),
    };
    match std::fs::symlink_metadata(&resolved) {
        // Not the entry the links led to (a link now, or another file):
        // replaced since they were followed.
        Ok(meta) if !stored::same_entry(seen.as_ref(), &meta) => {
            Err(LookupError::Changed(resolved))
        }
        Ok(meta) => {
            let (Some(dir), Some(name)) = (resolved.parent(), resolved.file_name()) else {
                let real = std::fs::canonicalize(&resolved).map_err(|e| io_err(&resolved, e))?;
                return Ok(EntryPath {
                    path: real,
                    exists: true,
                });
            };
            let name = stored::stored_name(dir, name, &meta)?;
            Ok(EntryPath {
                path: dir.join(name),
                exists: true,
            })
        }
        Err(e) if absent(&e) => Ok(EntryPath {
            path: under_existing(&resolved)?,
            exists: false,
        }),
        Err(e) => Err(io_err(&resolved, e)),
    }
}

/// The key text of an entry path: its text with separators cleaned up,
/// nothing folded. A path that is not Unicode is refused, never keyed
/// lossily (two byte strings could share one lossy text).
///
/// # Errors
/// `NotUnicode` for a path that is not valid Unicode.
pub fn key_text(path: &Path) -> Result<String, LookupError> {
    let raw = path
        .to_str()
        .ok_or_else(|| LookupError::NotUnicode(path.to_path_buf()))?;
    Ok(path_text(raw, cfg!(windows)))
}

/// `path` under its nearest existing ancestor's canonical spelling, the
/// missing rest exactly as asked.
fn under_existing(path: &Path) -> Result<PathBuf, LookupError> {
    let mut suffix = Vec::<&OsStr>::new();
    let mut at = path;
    while let (Some(parent), Some(name)) = (at.parent(), at.file_name()) {
        suffix.push(name);
        at = parent;
        match std::fs::canonicalize(at) {
            Ok(base) => return Ok(suffix.iter().rev().fold(base, |p, n| p.join(n))),
            Err(e) if absent(&e) => {}
            Err(e) => return Err(io_err(at, e)),
        }
    }
    Ok(path.to_path_buf())
}

/// `path` with `.` dropped and each `..` resolved as the filesystem does:
/// against the real folder before it, links followed. A `..` after a
/// folder that does not resolve (missing, a dangling link, a file) is
/// refused: where it would land is not known.
fn physical(path: &Path) -> Result<PathBuf, LookupError> {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                let real = std::fs::canonicalize(&out).map_err(|e| io_err(&out, e))?;
                if !real.is_dir() {
                    return Err(io_err(&out, io::Error::from(io::ErrorKind::NotADirectory)));
                }
                out = real;
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    Ok(out)
}
