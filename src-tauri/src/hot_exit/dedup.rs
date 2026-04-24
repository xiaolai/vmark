//! Hot-exit write deduplication.
//!
//! `write_session_atomic` is called frequently (often multiple times per second
//! during editing). When the captured session is identical to the last write
//! (no content/cursor/tab change since last capture) re-writing pays a full
//! tmp-file + fsync + rename + parent-dir-fsync cost for nothing.
//!
//! This module hashes the serialized payload and tracks the last-written hash
//! per process so subsequent identical captures short-circuit.
//!
//! @module hot_exit/dedup

use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::sync::OnceLock;

/// 32-byte SHA-256 digest type used to identify a serialized session payload.
pub type SessionHash = [u8; 32];

/// Tracks the last-written session hash for the current process. `None` means
/// no successful write has happened yet, so the first call always writes.
static LAST_WRITTEN_HASH: OnceLock<Mutex<Option<SessionHash>>> = OnceLock::new();

fn hash_state() -> &'static Mutex<Option<SessionHash>> {
    LAST_WRITTEN_HASH.get_or_init(|| Mutex::new(None))
}

/// Compute the SHA-256 hash of a serialized session payload.
pub fn hash_payload(json: &str) -> SessionHash {
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Returns `true` if the current payload differs from the last successfully
/// written one (so a write should proceed). Returns `false` when the payload
/// is identical to the last write — caller must skip the write entirely.
///
/// Holding the lock for the whole check is safe because the operation is
/// O(1) (a 32-byte comparison).
pub fn payload_differs_from_last(current: &SessionHash) -> bool {
    let guard = hash_state().lock().expect("hot-exit dedup lock poisoned");
    match guard.as_ref() {
        Some(last) => last != current,
        None => true,
    }
}

/// Record `hash` as the most recently written payload. Call this only after
/// the atomic write succeeds — recording before would risk silently losing a
/// real change if the write later fails.
pub fn record_written(hash: SessionHash) {
    let mut guard = hash_state().lock().expect("hot-exit dedup lock poisoned");
    *guard = Some(hash);
}

/// Reset the cached hash. Call this whenever the on-disk session file is
/// deleted (or known to be missing) so that the next identical capture is
/// not skipped — otherwise a "skip then deleted file" sequence would leave
/// the user without any persisted hot-exit state.
pub fn reset() {
    let mut guard = hash_state().lock().expect("hot-exit dedup lock poisoned");
    *guard = None;
}

/// Same as `reset()`, kept as a separate name for tests so behavior intent
/// stays explicit at call sites.
#[cfg(test)]
pub fn reset_for_test() {
    reset();
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cache is process-global; serialize tests on it to avoid interleaving.
    fn run_serial<F: FnOnce()>(f: F) {
        static MUTEX: Mutex<()> = Mutex::new(());
        let _g = MUTEX.lock().unwrap();
        reset_for_test();
        f();
    }

    #[test]
    fn hash_payload_is_deterministic() {
        let a = hash_payload("hello");
        let b = hash_payload("hello");
        assert_eq!(a, b);
    }

    #[test]
    fn hash_payload_differs_for_different_inputs() {
        let a = hash_payload("hello");
        let b = hash_payload("world");
        assert_ne!(a, b);
    }

    #[test]
    fn first_call_always_writes() {
        run_serial(|| {
            let h = hash_payload("first");
            assert!(payload_differs_from_last(&h), "first call must write");
        });
    }

    #[test]
    fn identical_payload_is_skipped_after_record() {
        run_serial(|| {
            let h = hash_payload("payload-A");
            assert!(payload_differs_from_last(&h));
            record_written(h);
            assert!(
                !payload_differs_from_last(&h),
                "identical payload must be skipped after recording"
            );
        });
    }

    #[test]
    fn changed_payload_writes_again() {
        run_serial(|| {
            let h1 = hash_payload("payload-A");
            record_written(h1);
            let h2 = hash_payload("payload-B");
            assert!(
                payload_differs_from_last(&h2),
                "changed payload must trigger write"
            );
        });
    }

    #[test]
    fn whitespace_difference_counts_as_change() {
        run_serial(|| {
            let h1 = hash_payload("a");
            record_written(h1);
            let h2 = hash_payload("a ");
            assert!(payload_differs_from_last(&h2));
        });
    }

    #[test]
    fn reset_invalidates_cache_so_identical_payload_writes_again() {
        // After a delete / external invalidation, identical content MUST be
        // re-written or the on-disk file will never come back.
        run_serial(|| {
            let h = hash_payload("payload");
            record_written(h);
            assert!(!payload_differs_from_last(&h), "sanity: cached after record");
            reset();
            assert!(
                payload_differs_from_last(&h),
                "reset must invalidate the cached hash"
            );
        });
    }
}
