//! Bounded, cancellable file copy for workflow snapshots (#267).
//!
//! `create_snapshot` used to `tokio::fs::copy` each file it was asked to
//! preserve: one call, unbounded by size, and blind to a cancel that arrived
//! while it ran — so a `cancel_workflow` during a large snapshot waited for
//! the whole copy before it meant anything. This copies in chunks, asks
//! `should_stop` before every one, and stops the moment the copied bytes
//! pass the limit. The limit is on bytes COPIED, not on a size read first:
//! a source that grows during the copy is still refused (the lesson of
//! #254). A refused or cancelled copy removes what it wrote.
//!
//! @coordinates-with snapshots.rs — the only caller
//! @module workflow::snapshot_copy

use crate::bounded_read::{open_regular, BoundedReadError};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Largest single file a snapshot will preserve. The workflow's `save-file`
/// steps overwrite documents; a document past this is not one a workflow
/// undo needs to hold, and refusing keeps the pre-run wait bounded.
pub(super) const MAX_SNAPSHOT_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// Largest snapshot as a whole.
pub(super) const MAX_SNAPSHOT_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

/// Copy granularity, and therefore how often a cancel is observed.
const CHUNK_BYTES: usize = 1024 * 1024;

/// Why a copy stopped short.
#[derive(Debug)]
pub(super) enum CopyRefusal {
    /// `should_stop` said so.
    Cancelled,
    /// More than `limit` bytes were copied.
    TooLarge { limit: u64 },
    /// The source is not a regular file, or an I/O call failed.
    Io(std::io::Error),
}

impl std::fmt::Display for CopyRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "cancelled"),
            Self::TooLarge { limit } => write!(f, "over {limit} bytes"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

/// Copy `src` to `dst` in chunks, at most `limit` bytes, giving up as soon
/// as `should_stop` returns true. Returns the bytes copied. `dst`'s parent
/// must exist; on any refusal `dst` is removed.
pub(super) async fn copy_bounded(
    src: &Path,
    dst: &Path,
    limit: u64,
    should_stop: &(dyn Fn() -> bool + Sync),
) -> Result<u64, CopyRefusal> {
    let src_path = src.to_path_buf();
    let opened = tokio::task::spawn_blocking(move || open_regular(&src_path))
        .await
        .map_err(|e| CopyRefusal::Io(std::io::Error::other(e)))?;
    let (file, reported_len) = match opened {
        Ok(pair) => pair,
        Err(BoundedReadError::NotRegular) => {
            return Err(CopyRefusal::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "not a regular file",
            )))
        }
        Err(BoundedReadError::TooLarge { limit }) => return Err(CopyRefusal::TooLarge { limit }),
        Err(BoundedReadError::Io(e)) => return Err(CopyRefusal::Io(e)),
    };
    if reported_len > limit {
        return Err(CopyRefusal::TooLarge { limit });
    }

    let mut reader = tokio::fs::File::from_std(file);
    let mut writer = tokio::fs::File::create(dst)
        .await
        .map_err(CopyRefusal::Io)?;
    let outcome = copy_chunks(&mut reader, &mut writer, limit, should_stop).await;
    drop(writer);
    if outcome.is_err() {
        let _ = tokio::fs::remove_file(dst).await;
    }
    outcome
}

async fn copy_chunks(
    reader: &mut tokio::fs::File,
    writer: &mut tokio::fs::File,
    limit: u64,
    should_stop: &(dyn Fn() -> bool + Sync),
) -> Result<u64, CopyRefusal> {
    let mut buf = vec![0u8; CHUNK_BYTES];
    let mut copied: u64 = 0;
    loop {
        if should_stop() {
            return Err(CopyRefusal::Cancelled);
        }
        let n = reader.read(&mut buf).await.map_err(CopyRefusal::Io)?;
        if n == 0 {
            break;
        }
        copied += n as u64;
        if copied > limit {
            return Err(CopyRefusal::TooLarge { limit });
        }
        writer.write_all(&buf[..n]).await.map_err(CopyRefusal::Io)?;
    }
    writer.flush().await.map_err(CopyRefusal::Io)?;
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn never() -> &'static (dyn Fn() -> bool + Sync) {
        &|| false
    }

    #[tokio::test]
    async fn copies_a_file_within_the_limit_byte_for_byte() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.md");
        let dst = dir.path().join("a.copy");
        let bytes: Vec<u8> = (0..(CHUNK_BYTES * 2 + 123))
            .map(|i| (i % 251) as u8)
            .collect();
        std::fs::write(&src, &bytes).unwrap();
        let copied = copy_bounded(&src, &dst, bytes.len() as u64, never())
            .await
            .expect("fits");
        assert_eq!(copied, bytes.len() as u64);
        assert_eq!(std::fs::read(&dst).unwrap(), bytes);
    }

    #[tokio::test]
    async fn refuses_past_the_limit_and_removes_the_partial_copy() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("big.md");
        let dst = dir.path().join("big.copy");
        std::fs::write(&src, vec![b'x'; 1025]).unwrap();
        let err = copy_bounded(&src, &dst, 1024, never())
            .await
            .expect_err("1025 > 1024");
        assert!(
            matches!(err, CopyRefusal::TooLarge { limit: 1024 }),
            "{err:?}"
        );
        assert!(!dst.exists(), "nothing partial is left behind");
    }

    #[tokio::test]
    async fn a_cancel_is_observed_between_chunks_not_only_at_the_end() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("many.md");
        let dst = dir.path().join("many.copy");
        std::fs::write(&src, vec![b'y'; CHUNK_BYTES * 4]).unwrap();
        // Stop on the third look: two chunks are copied, the third is not.
        let looks = AtomicUsize::new(0);
        let stop = move || looks.fetch_add(1, Ordering::SeqCst) >= 2;
        let err = copy_bounded(&src, &dst, u64::MAX, &stop)
            .await
            .expect_err("cancelled mid-copy");
        assert!(matches!(err, CopyRefusal::Cancelled), "{err:?}");
        assert!(!dst.exists(), "a cancelled copy is removed");
    }

    #[tokio::test]
    async fn a_directory_is_not_copied() {
        let dir = tempfile::tempdir().unwrap();
        let dst = dir.path().join("dir.copy");
        let err = copy_bounded(dir.path(), &dst, u64::MAX, never())
            .await
            .expect_err("a directory");
        assert!(matches!(err, CopyRefusal::Io(_)), "{err:?}");
        assert!(!dst.exists());
    }
}
