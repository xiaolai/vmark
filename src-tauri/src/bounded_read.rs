//! Read a regular file whole, bounded on the bytes actually read.
//!
//! Purpose: the one open-then-check-then-read for every caller that loads a
//! user-writable file into memory (`genies::commands::read_genie`,
//! `workflow::actions`' `read-file` and `read-folder`). Each of them used to
//! `metadata()` a PATH and then open that path again (#148, #253, #254): a
//! check on one inode and a read of whatever the name resolved to a moment
//! later — a file swapped for a FIFO blocked the reader, a file that grew
//! passed its size check.
//!
//! Key decisions:
//!   - The file is opened FIRST, and the type and size come from the open
//!     handle (`fstat`), so what was checked is what is read.
//!   - On Unix the open carries `O_NONBLOCK`: opening a FIFO for reading
//!     blocks until a writer appears, and the type cannot be consulted until
//!     the open returns. With the flag the open returns at once, the handle
//!     says "not a regular file", and the caller refuses. A regular file
//!     ignores the flag entirely.
//!   - The limit is enforced on the bytes CONSUMED, via `take(limit + 1)`,
//!     not on a size read earlier; the `fstat` size is only an early refusal.
//!   - Synchronous by design: every caller runs it on `spawn_blocking`, so
//!     the IPC thread and the async workers never wait on a disk.
//!
//! @coordinates-with genies/commands.rs — `read_genie_in`
//! @coordinates-with workflow/actions.rs — `read_file`, `read_folder`
//! @module bounded_read

use std::fs::{File, OpenOptions};
use std::io::{self, Read};
use std::path::Path;

/// Why a bounded read refused, so each caller can word its own message.
#[derive(Debug)]
pub(crate) enum BoundedReadError {
    /// The opened handle is not a regular file: a directory, a FIFO, a
    /// device, a socket.
    NotRegular,
    /// The file holds more than `limit` bytes — measured on the bytes read.
    TooLarge { limit: u64 },
    /// The open or the read itself failed.
    Io(io::Error),
}

impl From<io::Error> for BoundedReadError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

impl std::fmt::Display for BoundedReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotRegular => write!(f, "not a regular file"),
            Self::TooLarge { limit } => write!(f, "too large (over {limit} bytes)"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

/// Open `path` for reading and confirm, on the open handle, that it is a
/// regular file. Returns the handle and its size as `fstat` reports it.
pub(crate) fn open_regular(path: &Path) -> Result<(File, u64), BoundedReadError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        // Windows refuses to OPEN a directory as a file; Unix opens it and
        // the handle says what it is. Report the same class on both.
        Err(e) if std::fs::metadata(path).is_ok_and(|m| !m.is_file()) => {
            log::debug!("[bounded_read] {path:?} is not a regular file ({e})");
            return Err(BoundedReadError::NotRegular);
        }
        Err(e) => return Err(e.into()),
    };
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(BoundedReadError::NotRegular);
    }
    Ok((file, meta.len()))
}

/// Read `path` whole, refusing a file that holds more than `limit` bytes.
///
/// The refusal is decided on the bytes read: `take(limit + 1)` reads at most
/// one byte past the limit, and one byte past is a refusal. The size the
/// handle reports is consulted first only so an obviously oversized file is
/// refused without reading it.
pub(crate) fn read_regular_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, BoundedReadError> {
    let (file, reported_len) = open_regular(path)?;
    if reported_len > limit {
        return Err(BoundedReadError::TooLarge { limit });
    }
    read_bounded_stream(file, limit)
}

/// Drain `source` into a buffer, refusing once it yields more than `limit`
/// bytes. Separate from `read_regular_bounded` so this branch can be reached
/// at all: it is the defense against a file that GROWS after its `fstat`, and
/// on a real file the only way to observe it is to win that race. Against an
/// in-memory reader that reports one size and yields another, the refusal is
/// deterministic (`bounded_read.test.rs`).
pub(crate) fn read_bounded_stream(
    source: impl Read,
    limit: u64,
) -> Result<Vec<u8>, BoundedReadError> {
    let mut buf = Vec::new();
    source.take(limit.saturating_add(1)).read_to_end(&mut buf)?;
    if buf.len() as u64 > limit {
        return Err(BoundedReadError::TooLarge { limit });
    }
    Ok(buf)
}

#[cfg(test)]
#[path = "bounded_read.test.rs"]
mod tests;
