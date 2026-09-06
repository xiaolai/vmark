//! Resolving a save target through symlinks.
//!
//! Split out of `atomic_replace.rs` to keep that file under the size gate; it
//! is the DOCUMENT-save half of the policy and is deliberately not called by
//! the replacement core, so an app-private write cannot be redirected by a
//! planted link.
//!
//! @coordinates-with atomic_replace.rs — the replacement core
//! @coordinates-with file_write.rs — the only caller

use std::fs;
use std::path::{Path, PathBuf};

/// How far a chain of symlinks is followed before it is treated as a loop.
/// Matches the conventional `SYMLOOP_MAX`-ish bound; deep chains are not a
/// legitimate document layout.
const MAX_LINK_DEPTH: usize = 32;

/// Why a save target could not be resolved to a real referent.
#[derive(Debug)]
pub(crate) enum LinkResolveError {
    /// The chain exceeded [`MAX_LINK_DEPTH`] — a loop, or absurdly deep.
    TooManyLinks,
    /// Reading a link in the chain failed.
    ReadLink(std::io::Error),
    /// The final referent's parent directory does not exist, so the referent
    /// cannot be created. Refuse rather than silently replacing the link.
    ReferentParentMissing(PathBuf),
}

/// Resolve a document-save target through any symlinks to the file the user
/// actually means to write.
///
/// Saving is a temp-file + rename, and a rename onto a symlink REPLACES the
/// link with a regular file: the alias stops being an alias and the real
/// document keeps its old bytes, while the save reports success (audit
/// 20260906, B2). Resolving first means the replacement lands on the referent
/// and the link survives.
///
/// Deliberately NOT applied to internal writes (`app_paths`, the MCP token
/// file). Those own their directories, and following a link planted there
/// would let it redirect an app-private write somewhere else.
///
/// A dangling link resolves to the path it NAMES, so saving through it creates
/// the referent — the alias keeps pointing somewhere real. A path that does not
/// exist at all resolves to itself, which is the ordinary Save As case.
pub(crate) fn resolve_link_target(path: &Path) -> Result<PathBuf, LinkResolveError> {
    let mut current = path.to_path_buf();

    for _ in 0..MAX_LINK_DEPTH {
        match fs::symlink_metadata(&current) {
            // Not a link (or does not exist yet): this is the referent.
            Ok(meta) if !meta.file_type().is_symlink() => return normalize_parent(&current),
            // NotFound is the ordinary Save-As-to-a-new-name case.
            // NotADirectory means a component of the path is a FILE — also not
            // a link, and the caller's own parent check reports it with the
            // right error class. Treating it as an I/O failure here would
            // reclassify "the folder was replaced by a file" from `not-found`
            // (which routes the user into Save As) into a generic write error.
            Err(e)
                if e.kind() == std::io::ErrorKind::NotFound
                    || e.kind() == std::io::ErrorKind::NotADirectory =>
            {
                return normalize_parent(&current)
            }
            Err(e) => return Err(LinkResolveError::ReadLink(e)),
            Ok(_) => {}
        }

        let dest = fs::read_link(&current).map_err(LinkResolveError::ReadLink)?;
        // A relative link is relative to the LINK's own directory, never to
        // the process working directory.
        current = if dest.is_absolute() {
            dest
        } else {
            match current.parent() {
                Some(parent) => parent.join(dest),
                None => dest,
            }
        };
    }

    Err(LinkResolveError::TooManyLinks)
}

/// Canonicalize the resolved path's PARENT and re-attach the file name.
///
/// The parent is a real directory, so the OS resolves any `..`/`.` and
/// intermediate links in it correctly — which lexical normalization cannot do
/// across symlinks. The file name is left alone because the referent itself may
/// not exist yet (a dangling link, or a fresh Save As).
fn normalize_parent(path: &Path) -> Result<PathBuf, LinkResolveError> {
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Ok(path.to_path_buf());
    };

    match fs::canonicalize(parent) {
        Ok(real_parent) => Ok(real_parent.join(name)),
        // Gone, or itself sitting under a file — either way the referent's
        // directory does not exist, which is the caller's `parentMissing`.
        Err(e)
            if e.kind() == std::io::ErrorKind::NotFound
                || e.kind() == std::io::ErrorKind::NotADirectory =>
        {
            Err(LinkResolveError::ReferentParentMissing(
                parent.to_path_buf(),
            ))
        }
        Err(e) => Err(LinkResolveError::ReadLink(e)),
    }
}

#[cfg(test)]
#[path = "link_target.test.rs"]
mod tests;
