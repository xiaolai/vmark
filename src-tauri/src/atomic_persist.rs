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
//! (audit 20260906 B1) left the other live for a year. One rule, one place.
//!
//! @coordinates-with atomic_replace.rs — the document writer
//! @coordinates-with mcp_bridge/token_file.rs — the credential writer
//! @module atomic_persist

use std::path::Path;
use tempfile::NamedTempFile;

use crate::atomic_replace::AtomicReplaceError;

/// How many times a replacement is attempted before the error is returned.
/// The delays below sum to ~127ms, which is the window a transient sharing
/// conflict clears in; a real permission failure simply costs that long.
#[cfg(windows)]
const PERSIST_ATTEMPTS: u32 = 8;

/// Atomically replace `target`, retrying a TRANSIENT Windows sharing refusal.
///
/// `MoveFileExW` needs delete access to the file it replaces, and returns
/// `ERROR_ACCESS_DENIED` while any other handle holds it — an antivirus
/// scanner mid-scan, a backup agent, or simply another thread reading the
/// document. That is a moment's contention, not a failure of the write.
///
/// The old code survived this by accident: its remove-then-retry got a second
/// attempt, which usually landed in the gap. Deleting that fallback (audit
/// 20260906, B1) removed the accident along with the data loss, and CI's
/// Windows leg found it immediately — `app_paths::test_atomic_write_no_partial_content`
/// races 200 writes against 200 reads of one file and hit os error 5.
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
pub(crate) fn persist_with_retry(
    temp: NamedTempFile,
    target: &Path,
) -> Result<(), AtomicReplaceError> {
    use std::io::ErrorKind;

    let mut candidate = temp;
    let mut backoff = std::time::Duration::from_millis(1);

    for attempt in 1..=PERSIST_ATTEMPTS {
        match candidate.persist(target) {
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
pub(crate) fn persist_with_retry(
    temp: NamedTempFile,
    target: &Path,
) -> Result<(), AtomicReplaceError> {
    temp.persist(target)
        .map(|_| ())
        .map_err(AtomicReplaceError::Persist)
}
