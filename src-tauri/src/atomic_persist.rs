//! The atomic publication step, and the ONE Windows replacement rule.
//!
//! Purpose: split out of `atomic_replace.rs` when it gained a second consumer
//! (audit 20260907 #389). `mcp_bridge::token_file` publishes the bridge's
//! discovery credential the same way but cannot use `atomic_write_file` — that
//! writer preserves the TARGET's permissions, which is right for a user
//! document and wrong for a secret. Reaching into `atomic_replace` for the
//! helper would have made a document writer the home of a credential writer's
//! rule; a neutral module is what both can share.
//!
//! Sharing it is not tidiness. Both call sites carried the same DESTRUCTIVE
//! Windows fallback — `remove_file(target)` then retry, on the false premise
//! that Windows `rename` refuses an existing target — and fixing one copy
//! left the other live for a year. One rule, one place.
//!
//! Publication is two steps, and both live here: the rename that swaps the
//! new file in, and the sync of the parent directory that makes the rename
//! survive a crash (see `persist_with_retry`). A writer whose file is not a
//! `NamedTempFile` — the PDF renderer's staging file — does its own rename and
//! takes the second step from [`sync_parent_directory`].
//!
//! @coordinates-with atomic_replace.rs — the document writer
//! @coordinates-with mcp_bridge/token_file.rs — the credential writer
//! @coordinates-with pdf_export/renderer/staging.rs — syncs the output's directory
//! @module atomic_persist

use std::path::Path;
use tempfile::NamedTempFile;

use crate::atomic_replace::AtomicReplaceError;

/// How many times a replacement is attempted before the error is returned.
/// The delays below sum to ~127ms, which is the window a transient sharing
/// conflict clears in; a real permission failure simply costs that long.
#[cfg(windows)]
const PERSIST_ATTEMPTS: u32 = 8;

#[cfg(test)]
thread_local! {
    /// Every directory `sync_directory` was asked to sync on this thread, so a
    /// test of ANY writer built on this module can see that its rename was
    /// made durable. Per thread: tests run in parallel and must not see each
    /// other's writes.
    pub(crate) static SYNCED_DIRECTORIES: std::cell::RefCell<Vec<std::path::PathBuf>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Atomically replace `target` with `temp` and make the replacement durable.
///
/// A rename is an edit of the PARENT DIRECTORY, not of the file. The temp
/// file's own `sync_all` makes its contents durable, but until the directory
/// is synced a crash can come back with the old entry — the previous file, or
/// no file at all for a first write. So the directory is synced after the
/// rename, which is what the document save path (`files::write::anchored`) and
/// hot-exit already do for their own renames.
///
/// The sync is best-effort: by the time it runs the new file IS in place, and
/// reporting the write as failed would be a lie the caller acts on. Some
/// filesystems refuse a directory sync outright; that is logged, not returned.
///
/// Unix only. On Windows a directory cannot be opened as a plain file handle
/// to flush, so nothing is done there and the rename's durability is whatever
/// `MoveFileExW` and the filesystem journal provide.
pub(crate) fn persist_with_retry(
    temp: NamedTempFile,
    target: &Path,
) -> Result<(), AtomicReplaceError> {
    persist_durably(temp, target, sync_directory)
}

/// Publish `temp` at `target` only if nothing is there, and make it durable.
///
/// The no-replace twin of `persist_with_retry`: `persist_noclobber` is
/// `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` on Windows, so an
/// existing target fails the move with `AlreadyExists` and keeps its bytes.
/// The same transient-sharing retry applies; `AlreadyExists` is not transient.
#[cfg(any(not(unix), test))]
pub(crate) fn persist_new_with_retry(
    temp: NamedTempFile,
    target: &Path,
) -> Result<(), AtomicReplaceError> {
    retry_persist(temp, target, |t, to| t.persist_noclobber(to))?;
    sync_parent_with(target, sync_directory);
    Ok(())
}

/// `persist_with_retry` with the directory sync injected, so a test can see
/// that it runs, when, and on which directory.
fn persist_durably(
    temp: NamedTempFile,
    target: &Path,
    sync_dir: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<(), AtomicReplaceError> {
    retry_persist(temp, target, |t, to| t.persist(to))?;
    sync_parent_with(target, sync_dir);
    Ok(())
}

/// Make a rename onto `target` durable: sync the directory that holds it.
/// Best-effort for the reason `persist_with_retry` gives — the file IS in
/// place by now — so a refusal is logged, not returned.
pub(crate) fn sync_parent_directory(target: &Path) {
    sync_parent_with(target, sync_directory);
}

fn sync_parent_with(target: &Path, sync_dir: impl FnOnce(&Path) -> std::io::Result<()>) {
    let parent = parent_directory(target);
    if let Err(e) = sync_dir(parent) {
        log::warn!(
            "Failed to sync directory {:?} after replacing {:?}: {}",
            parent,
            target,
            e
        );
    }
}

/// The directory whose entry a rename of `target` changes. A bare file name
/// has an empty parent, which names the current directory.
fn parent_directory(target: &Path) -> &Path {
    match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    }
}

/// Flush a directory's entries to disk.
#[cfg(unix)]
fn sync_directory(dir: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    SYNCED_DIRECTORIES.with(|synced| synced.borrow_mut().push(dir.to_path_buf()));
    std::fs::File::open(dir)?.sync_all()
}

/// Windows has no way to flush a directory through a plain file handle.
#[cfg(not(unix))]
fn sync_directory(_dir: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Publish `temp` at `target` through `persist` (replacing or not), retrying
/// a TRANSIENT Windows sharing refusal.
///
/// `MoveFileExW` needs delete access to the file it replaces, and returns
/// `ERROR_ACCESS_DENIED` while any other handle holds it — an antivirus
/// scanner mid-scan, a backup agent, or simply another thread reading the
/// document. That is a moment's contention, not a failure of the write.
///
/// The old code survived this by accident: its remove-then-retry got a second
/// attempt, which usually landed in the gap. Deleting that fallback removed the
/// accident along with the data loss, and CI's Windows leg found it immediately
/// — `app_paths::test_atomic_write_no_partial_content` races 200 writes against
/// 200 reads of one file and hit os error 5.
///
/// So the retry comes back, on the ONE property that made the old one
/// dangerous: this retries `persist` itself, which is atomic and replaces in
/// place. The target holds its previous bytes until a move succeeds, and if
/// every attempt fails the file is exactly as it was. The old path removed the
/// target first, so a subsequent failure left nothing behind at all.
///
/// Windows-only: `rename(2)` has no sharing concept, so a retry on Unix could
/// only delay a real error.
///
#[cfg(windows)]
fn retry_persist(
    temp: NamedTempFile,
    target: &Path,
    persist: impl Fn(NamedTempFile, &Path) -> Result<std::fs::File, tempfile::PersistError>,
) -> Result<(), AtomicReplaceError> {
    use std::io::ErrorKind;

    let mut candidate = temp;
    let mut backoff = std::time::Duration::from_millis(1);

    for attempt in 1..=PERSIST_ATTEMPTS {
        match persist(candidate, target) {
            Ok(_) => return Ok(()),
            Err(err) => {
                let transient = matches!(
                    err.error.kind(),
                    ErrorKind::PermissionDenied | ErrorKind::Interrupted
                );
                if attempt == PERSIST_ATTEMPTS || !transient {
                    return Err(AtomicReplaceError::Persist(err));
                }
                // `persist` hands the temp file back so the next attempt can
                // use it; without this the content would be gone.
                candidate = err.file;
                std::thread::sleep(backoff);
                backoff *= 2;
            }
        }
    }

    unreachable!("the loop returns on the final attempt")
}

#[cfg(not(windows))]
fn retry_persist(
    temp: NamedTempFile,
    target: &Path,
    persist: impl Fn(NamedTempFile, &Path) -> Result<std::fs::File, tempfile::PersistError>,
) -> Result<(), AtomicReplaceError> {
    persist(temp, target)
        .map(|_| ())
        .map_err(AtomicReplaceError::Persist)
}

#[cfg(test)]
#[path = "atomic_persist.test.rs"]
mod tests;
