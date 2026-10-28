//! Whether a taken archive name already holds the original log, byte for
//! byte, so retiring can drop the original instead of trying the next name.
//!
//! Only a regular file can be that copy: a symlink (to the original or
//! anywhere) or a directory never is. The candidate is opened without
//! following a symlink, and on Unix the file opened must be the entry
//! examined, so a symlink swapped in between is refused too.
//! Sizes are compared first, so an archive of another size is never
//! opened. The original is hashed once per retirement and each same-size
//! candidate streamed through the same hash, so memory stays bounded
//! whatever an archive's size.
//!
//! @module agent_journal/legacy_archive

use std::fs::{File, Metadata};
use std::io::{self, Read};
use std::path::Path;

use sha2_v011::{Digest, Sha256};

/// The original log being retired, hashed on first need.
pub(super) struct Original<'a> {
    path: &'a Path,
    len: u64,
    digest: Option<Vec<u8>>,
}

impl<'a> Original<'a> {
    pub(super) fn new(path: &'a Path) -> io::Result<Self> {
        Ok(Self {
            path,
            len: std::fs::metadata(path)?.len(),
            digest: None,
        })
    }

    /// `target` is a regular file holding exactly the original's bytes.
    pub(super) fn is_copy_at(&mut self, target: &Path) -> io::Result<bool> {
        let entry = match std::fs::symlink_metadata(target) {
            Ok(m) => m,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e),
        };
        if !entry.file_type().is_file() || entry.len() != self.len {
            return Ok(false);
        }
        let file = match open_no_follow(target) {
            Ok(f) => f,
            Err(e) if is_link_refusal(&e) => return Ok(false),
            Err(e) => return Err(e),
        };
        if !same_entry(&entry, &file.metadata()?) {
            return Ok(false);
        }
        let theirs = digest(file)?;
        let ours = match &self.digest {
            Some(d) => d,
            None => self.digest.insert(digest(File::open(self.path)?)?),
        };
        Ok(&theirs == ours)
    }
}

/// Open `path` for reading without following a final symlink: Unix
/// refuses one (`O_NOFOLLOW`, `ELOOP`); Windows opens the link itself
/// (`FILE_FLAG_OPEN_REPARSE_POINT`), whose handle is then not a regular
/// file, so `same_entry` refuses it.
#[cfg(unix)]
fn open_no_follow(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(windows)]
fn open_no_follow(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

/// The no-follow open met a symlink.
#[cfg(unix)]
fn is_link_refusal(e: &io::Error) -> bool {
    e.raw_os_error() == Some(libc::ELOOP)
}

#[cfg(windows)]
fn is_link_refusal(_e: &io::Error) -> bool {
    false
}

/// The opened file is the entry `symlink_metadata` examined.
#[cfg(unix)]
fn same_entry(entry: &Metadata, opened: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    entry.dev() == opened.dev() && entry.ino() == opened.ino()
}

/// Windows has no stable file identity in `std`: the handle must be a
/// regular file. `open_no_follow` opened a swapped-in symlink as itself,
/// so that link is refused here rather than read through.
#[cfg(not(unix))]
fn same_entry(_entry: &Metadata, opened: &Metadata) -> bool {
    opened.is_file()
}

fn digest(mut file: File) -> io::Result<Vec<u8>> {
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            return Ok(hash.finalize().to_vec());
        }
        hash.update(&buf[..n]);
    }
}

#[cfg(test)]
#[path = "legacy_archive.test.rs"]
mod tests;
