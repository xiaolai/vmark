//! Fault injection for the crash and failure tests.
//!
//! The struct is always compiled because the journal, the blob pack and the
//! writer read it on their failure paths; every setter is `#[cfg(test)]`, so
//! a production build can only ever hold the all-zero default, where every
//! `take_*` check is a no-op.

use std::io;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::agent_journal::record::Envelope;

/// Compaction protocol steps; a crash is injected right AFTER the step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactionStep {
    TempWritten,
    TempSynced,
    Renamed,
    /// After the directory fsync, before the new file is reopened.
    DirSynced,
}

/// Which file an atomic rewrite replaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rewritten {
    Journal,
    BlobPack,
}

/// A step after a rewrite's rename that can fail without killing the
/// process: the instance lives on with its old handle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AfterRename {
    SyncDir,
    Reopen,
}

type Hook = Arc<dyn Fn(&Envelope) + Send + Sync>;
/// Runs once, with the writer lock NOT held.
pub type LockHook = Box<dyn FnOnce() + Send>;

#[derive(Default)]
pub struct Faults {
    fail_appends: AtomicU32,
    fail_fsyncs: AtomicU32,
    fail_truncates: AtomicU32,
    fail_rollback_syncs: AtomicU32,
    fail_blob_writes: AtomicU32,
    fail_blob_compactions: AtomicU32,
    /// `0` = off; otherwise the next append writes one byte fewer than
    /// this and then fails (stored plus one, so a tear after 0 bytes is on).
    tear_after: AtomicUsize,
    /// `0` = off; otherwise one past the largest replay frame buffer that
    /// can be reserved.
    replay_reserve_cap: AtomicUsize,
    drop_broadcasts: AtomicU32,
    /// The next journal write fails with this OS error, before any byte.
    write_error: Mutex<Option<io::ErrorKind>>,
    compaction_crash: Mutex<Option<CompactionStep>>,
    after_rename: Mutex<Option<(Rewritten, AfterRename)>>,
    append_hook: Mutex<Option<Hook>>,
    /// `0` = off; otherwise the writer-lock acquisition that fires `lock_hook`.
    lock_countdown: AtomicU32,
    lock_hook: Mutex<Option<LockHook>>,
}

impl Faults {
    #[cfg(test)]
    pub fn fail_next_appends(&self, n: u32) {
        self.fail_appends.store(n, Ordering::SeqCst);
    }
    #[cfg(test)]
    /// The next `n` post-write fsyncs of a journal append fail.
    pub fn fail_next_fsyncs(&self, n: u32) {
        self.fail_fsyncs.store(n, Ordering::SeqCst);
    }
    #[cfg(test)]
    /// The next `n` truncate-backs after a failed journal write fail.
    pub fn fail_next_truncates(&self, n: u32) {
        self.fail_truncates.store(n, Ordering::SeqCst);
    }
    #[cfg(test)]
    /// The next `n` syncs after a journal append's truncate-back fail.
    pub fn fail_next_rollback_syncs(&self, n: u32) {
        self.fail_rollback_syncs.store(n, Ordering::SeqCst);
    }
    #[cfg(test)]
    /// The next `n` blob-pack writes fail cleanly, before any byte.
    pub fn fail_next_blob_writes(&self, n: u32) {
        self.fail_blob_writes.store(n, Ordering::SeqCst);
    }
    #[cfg(test)]
    /// The next `n` blob-pack compactions fail, before any byte.
    pub fn fail_next_blob_compactions(&self, n: u32) {
        self.fail_blob_compactions.store(n, Ordering::SeqCst);
    }
    #[cfg(test)]
    /// The next journal append writes `bytes` bytes, then fails.
    pub fn tear_next_append_after(&self, bytes: usize) {
        let stored = bytes
            .checked_add(1)
            .expect("a tear offset below usize::MAX");
        self.tear_after.store(stored, Ordering::SeqCst);
    }
    #[cfg(test)]
    /// Every replay frame-buffer reservation past `bytes` fails, as an
    /// allocator refusal would.
    pub fn fail_replay_reserve_beyond(&self, bytes: usize) {
        let stored = bytes.checked_add(1).expect("a cap below usize::MAX");
        self.replay_reserve_cap.store(stored, Ordering::SeqCst);
    }
    #[cfg(test)]
    /// The next journal append write fails as the OS would report `kind`
    /// (`StorageFull`, `PermissionDenied`).
    pub fn fail_next_write_with(&self, kind: io::ErrorKind) {
        *self.write_error.lock().expect("faults lock") = Some(kind);
    }
    #[cfg(test)]
    pub fn drop_next_broadcasts(&self, n: u32) {
        self.drop_broadcasts.store(n, Ordering::SeqCst);
    }
    #[cfg(test)]
    pub fn crash_compaction_after(&self, step: CompactionStep) {
        *self.compaction_crash.lock().expect("faults lock") = Some(step);
    }
    #[cfg(test)]
    /// The next rewrite of `file` fails at `step`, after its rename, with
    /// a plain I/O error that leaves the instance alive.
    pub fn fail_after_rename(&self, file: Rewritten, step: AfterRename) {
        *self.after_rename.lock().expect("faults lock") = Some((file, step));
    }
    #[cfg(test)]
    /// Runs inside the writer lock just before an envelope is appended.
    pub fn set_append_hook(&self, hook: Option<Hook>) {
        *self.append_hook.lock().expect("faults lock") = hook;
    }
    #[cfg(test)]
    /// Runs `hook` once, on the acquiring thread, just before the `n`-th
    /// next writer-lock acquisition (`n >= 1`), while that thread does not
    /// hold the lock: a deterministic point between two critical sections.
    /// `n = 0` disarms, dropping any hook that never fired.
    pub fn before_nth_lock(&self, n: u32, hook: Option<LockHook>) {
        let mut slot = self.lock_hook.lock().expect("faults lock");
        *slot = hook;
        self.lock_countdown.store(n, Ordering::SeqCst);
    }

    pub(crate) fn take_append_failure(&self) -> bool {
        take_one(&self.fail_appends)
    }
    pub(crate) fn take_fsync_failure(&self) -> bool {
        take_one(&self.fail_fsyncs)
    }
    pub(crate) fn take_truncate_failure(&self) -> bool {
        take_one(&self.fail_truncates)
    }
    pub(crate) fn take_rollback_sync_failure(&self) -> bool {
        take_one(&self.fail_rollback_syncs)
    }
    pub(crate) fn take_after_rename_failure(&self, file: Rewritten, step: AfterRename) -> bool {
        let mut slot = self.after_rename.lock().expect("faults lock");
        if *slot == Some((file, step)) {
            *slot = None;
            return true;
        }
        false
    }
    pub(crate) fn take_blob_write_failure(&self) -> bool {
        take_one(&self.fail_blob_writes)
    }
    pub(crate) fn take_blob_compaction_failure(&self) -> bool {
        take_one(&self.fail_blob_compactions)
    }
    pub(crate) fn take_tear(&self) -> Option<usize> {
        let v = self.tear_after.swap(0, Ordering::SeqCst);
        (v > 0).then(|| v - 1)
    }
    pub(crate) fn replay_reserve_cap(&self) -> Option<usize> {
        let v = self.replay_reserve_cap.load(Ordering::SeqCst);
        (v > 0).then(|| v - 1)
    }
    pub(crate) fn take_write_error(&self) -> Option<io::Error> {
        let kind = self.write_error.lock().expect("faults lock").take();
        kind.map(io::Error::from)
    }
    pub(crate) fn take_broadcast_drop(&self) -> bool {
        take_one(&self.drop_broadcasts)
    }
    pub(crate) fn compaction_crash(&self, step: CompactionStep) -> bool {
        let mut slot = self.compaction_crash.lock().expect("faults lock");
        if *slot == Some(step) {
            *slot = None;
            return true;
        }
        false
    }
    /// Called before every writer-lock acquisition; a no-op unless a test
    /// armed `before_nth_lock`.
    pub(crate) fn before_lock(&self) {
        if self.lock_countdown.load(Ordering::SeqCst) == 0 || !count_down(&self.lock_countdown) {
            return;
        }
        let hook = self.lock_hook.lock().expect("faults lock").take();
        if let Some(h) = hook {
            h();
        }
    }
    pub(crate) fn run_hook(&self, env: &Envelope) {
        let hook = self.append_hook.lock().expect("faults lock").clone();
        if let Some(h) = hook {
            h(env);
        }
    }
}

/// Decrement a non-zero `counter`; `true` when this call reached zero.
fn count_down(counter: &AtomicU32) -> bool {
    decrement_nonzero(counter) == 1
}

/// Decrement a non-zero `counter`; `true` when it was non-zero.
fn take_one(counter: &AtomicU32) -> bool {
    decrement_nonzero(counter) > 0
}

/// Decrement `counter` unless it is zero; returns the value it held.
fn decrement_nonzero(counter: &AtomicU32) -> u32 {
    // A compare-exchange loop rather than `fetch_update`/`try_update`: the
    // crate's minimum toolchain predates the rename, and the newest one
    // deprecates the old name.
    let mut n = counter.load(Ordering::SeqCst);
    while n > 0 {
        match counter.compare_exchange_weak(n, n - 1, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return n,
            Err(current) => n = current,
        }
    }
    0
}
