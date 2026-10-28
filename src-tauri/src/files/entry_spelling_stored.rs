//! The name a directory stores for an existing entry, as the filesystem
//! itself matches it: never by folding the request's text.
//!
//! Key decisions:
//!   - Unix: the requested name when an entry is spelled exactly so;
//!     otherwise the entry with the leaf's identity (its inode, confirmed by
//!     `lstat`). Hard links share an identity, so when several in one
//!     folder do and none is spelled exactly as asked, the lookup is refused
//!     (`Ambiguous`): telling them apart would mean asking the volume by
//!     creating names, and a lookup never writes into the user's folder.
//!   - Windows: `FindFirstFileW` on the requested name reports the stored
//!     name of the entry the lookup reached, a hard link's own included.
//!   - Every answer is checked against a second look at the request (its
//!     identity and its file type: an inode freed by the replaced entry can
//!     be reused at once), and the first look against what following the links saw (`same_entry`):
//!     an entry replaced meanwhile (by a link, say) is `Changed`, never
//!     keyed by a name it no longer holds.
//!
//! A child module of `entry_spelling` (split for size).
//!
//! @coordinates-with files/entry_spelling.rs — keys the entry by this name
//! @module files/entry_spelling_stored

use std::ffi::{OsStr, OsString};
use std::fs::Metadata;
use std::path::Path;

use super::{io_err, LookupError};

#[cfg(test)]
thread_local! {
    /// Runs once, between the leaf's lookup and its directory listing.
    pub(crate) static BEFORE_LISTING: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
thread_local! {
    /// Runs once, between following the links and the referent's lookup.
    pub(crate) static AFTER_FOLLOW: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
}

pub(super) fn after_follow() {
    #[cfg(test)]
    if let Some(hook) = AFTER_FOLLOW.with(|h| h.borrow_mut().take()) {
        hook();
    }
}

fn before_listing() {
    #[cfg(test)]
    if let Some(hook) = BEFORE_LISTING.with(|h| h.borrow_mut().take()) {
        hook();
    }
}

/// Whether `now` (not followed) is still the entry following the links
/// ended at (`seen`; `None` when nothing was there yet). Following never
/// ends at a link, so a link now was put there since; on Unix the file
/// identity must match too.
pub(super) fn same_entry(seen: Option<&Metadata>, now: &Metadata) -> bool {
    if now.file_type().is_symlink() {
        return false;
    }
    match seen {
        None => true,
        Some(seen) => platform::same_file(seen, now),
    }
}

/// The name `dir` stores for the entry `name` reached (`meta`, not
/// followed), confirmed to still be that entry.
pub(super) fn stored_name(
    dir: &Path,
    name: &OsStr,
    meta: &Metadata,
) -> Result<OsString, LookupError> {
    let asked = dir.join(name);
    let target = platform::identity(meta, &asked).map_err(|e| io_err(dir, e))?;
    before_listing();
    let pick = platform::lookup(dir, name, target)?;
    let now = std::fs::symlink_metadata(&asked).map_err(|e| io_err(dir, e))?;
    // The type too: a file system may hand a freed inode straight to the
    // link that replaced the entry (ext4 does), so the identity alone can
    // match a replacement.
    if now.file_type() != meta.file_type()
        || platform::identity(&now, &asked).map_err(|e| io_err(dir, e))? != target
    {
        return Err(LookupError::Changed(asked));
    }
    Ok(pick)
}

#[cfg(unix)]
mod platform {
    use std::ffi::{OsStr, OsString};
    use std::fs::Metadata;
    use std::io;
    use std::os::unix::fs::{DirEntryExt, MetadataExt};
    use std::path::Path;

    use super::super::{absent, io_err, LookupError};

    pub(super) type Id = (u64, u64);

    pub(super) fn identity(meta: &Metadata, _path: &Path) -> io::Result<Id> {
        Ok((meta.dev(), meta.ino()))
    }

    pub(super) fn same_file(a: &Metadata, b: &Metadata) -> bool {
        (a.dev(), a.ino()) == (b.dev(), b.ino())
    }

    fn entry_identity(path: &Path) -> io::Result<Id> {
        let meta = std::fs::symlink_metadata(path)?;
        Ok((meta.dev(), meta.ino()))
    }

    /// The exact name if listed; else the one entry with `target`'s
    /// identity. Several (hard links), none spelled as asked: `Ambiguous`.
    pub(super) fn lookup(dir: &Path, name: &OsStr, target: Id) -> Result<OsString, LookupError> {
        let mut listed = Vec::new();
        for item in std::fs::read_dir(dir).map_err(|e| io_err(dir, e))? {
            let item = item.map_err(|e| io_err(dir, e))?;
            let stored = item.file_name();
            if stored == name {
                return Ok(stored);
            }
            // A mount point's listed inode may differ: `lstat` confirms.
            if item.ino() != 0 {
                listed.push(stored);
            }
        }
        let mut hits = Vec::new();
        for stored in listed {
            match entry_identity(&dir.join(&stored)) {
                Ok(id) if id == target => hits.push(stored),
                Ok(_) => {}
                Err(e) if absent(&e) => {}
                Err(e) => return Err(io_err(dir, e)),
            }
        }
        if hits.len() > 1 {
            return Err(LookupError::Ambiguous(dir.join(name)));
        }
        hits.pop()
            .ok_or_else(|| LookupError::Changed(dir.join(name)))
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::{OsStr, OsString};
    use std::fs::Metadata;
    use std::io;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::Path;

    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{FindClose, FindFirstFileW, WIN32_FIND_DATAW};

    use super::super::{io_err, LookupError};
    use crate::files::path_identity::{file_id, FileId};

    pub(super) type Id = FileId;

    pub(super) fn identity(_meta: &Metadata, path: &Path) -> io::Result<Id> {
        file_id(path).ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
    }

    /// `Metadata` carries no stable file identity here; the identity is
    /// checked by `stored_name` around the lookup instead.
    pub(super) fn same_file(_a: &Metadata, _b: &Metadata) -> bool {
        true
    }

    /// The stored name of the entry a lookup of `name` reaches.
    pub(super) fn lookup(dir: &Path, name: &OsStr, _target: Id) -> Result<OsString, LookupError> {
        find_first(dir, name).map_err(|e| io_err(dir, e))
    }

    fn find_first(dir: &Path, name: &OsStr) -> io::Result<OsString> {
        // `"*<>?` would make the lookup a pattern; no stored name holds one.
        if name
            .encode_wide()
            .any(|u| matches!(u, 0x22 | 0x2A | 0x3C | 0x3E | 0x3F))
        {
            return Err(io::Error::from(io::ErrorKind::InvalidInput));
        }
        let wide: Vec<u16> = dir
            .join(name)
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect();
        let mut data = WIN32_FIND_DATAW::default();
        // SAFETY: `wide` is NUL-terminated UTF-16 that outlives the call, and
        // `data` is a valid, writable out-parameter.
        let handle = unsafe { FindFirstFileW(PCWSTR(wide.as_ptr()), &mut data) }
            .map_err(|e| io::Error::from_raw_os_error(e.code().0 & 0xFFFF))?;
        // SAFETY: `handle` came from the successful FindFirstFileW above and
        // is closed exactly once.
        let _ = unsafe { FindClose(handle) };
        let len = data
            .cFileName
            .iter()
            .position(|&u| u == 0)
            .unwrap_or(data.cFileName.len());
        Ok(OsString::from_wide(&data.cFileName[..len]))
    }
}
