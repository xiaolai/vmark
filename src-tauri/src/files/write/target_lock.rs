//! One document write at a time per FILE, whatever path names it.
//!
//! Purpose: the frontend queues saves per path string, but an alias (a
//! symlink, another case spelling on a case-insensitive volume) and its
//! referent are two strings and one file. Two saves through them would each
//! stage a temp file and rename it in, interleaving with nothing to order
//! them. The write core takes this lock and holds it through publication,
//! so the second write starts only after the first has renamed.
//!
//! Key decisions:
//! - On Unix the key is the HELD folder's (device, inode) and the entry name
//!   (`held_entry_key`), taken after the folder is opened: the folder the
//!   rename lands in, not a path resolved earlier, which a folder swapped
//!   for a link in between would make name another file. The name is always
//!   folded broadly (`lock_key::fold`): over-folding on a case-sensitive
//!   volume only serializes two files' writes; under-folding would let one
//!   file's writes overlap.
//! - On Windows (path-based writes) the key is `lock_key::target_key`, the
//!   canonical referent folded the same way. This is not the agent
//!   journal's document identity, which never folds.
//! - Bounded and reclaimable: the set holds only keys whose write is in
//!   flight (at most one per blocking write task); the guard removes its key
//!   on drop, during unwinding too, and a poisoned mutex is recovered rather
//!   than wedging every later save.
//! - Order between two waiting writes is the order Rust admits them, not the
//!   order the frontend submitted them.
//!
//! @coordinates-with files/write/lock_key.rs — the key folding
//! @coordinates-with files/write.rs — `write_ordered` holds the guard
//! @module files/write/target_lock

use std::collections::HashSet;
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};

/// Keys with a write in flight, and the signal a finished write gives.
#[derive(Default)]
struct Busy {
    keys: Mutex<HashSet<String>>,
    released: Condvar,
}

/// A static, not managed state: the write core is reached from
/// `atomic_write_file_sync` and other callers that hold no `AppHandle`, and
/// every writer of a file must meet at the same lock.
static BUSY: OnceLock<Busy> = OnceLock::new();

fn busy() -> &'static Busy {
    BUSY.get_or_init(Busy::default)
}

fn keys(busy: &Busy) -> MutexGuard<'_, HashSet<String>> {
    busy.keys.lock().unwrap_or_else(|e| e.into_inner())
}

/// Held while one write to a file runs; dropping it lets the next one in.
#[must_use = "the lock is released when the guard is dropped"]
pub(crate) struct TargetGuard {
    key: String,
}

/// The Unix lock key of entry `name` in the held folder `folder`
/// ((device, inode)). A name that is not UTF-8 is keyed lossily, which can
/// only merge keys, never split one file's.
#[cfg(unix)]
pub(crate) fn held_entry_key(folder: (u64, u64), name: &std::ffi::OsStr) -> String {
    let (device, inode) = folder;
    let name = super::lock_key::fold(&name.to_string_lossy(), false);
    format!("held:{device}:{inode}/{name}")
}

/// Wait until no other write holds `key`, then hold it.
pub(crate) fn lock(key: String) -> TargetGuard {
    let busy = busy();
    let mut held = keys(busy);
    while held.contains(&key) {
        held = busy.released.wait(held).unwrap_or_else(|e| e.into_inner());
    }
    held.insert(key.clone());
    TargetGuard { key }
}

impl Drop for TargetGuard {
    fn drop(&mut self) {
        let busy = busy();
        keys(busy).remove(&self.key);
        busy.released.notify_all();
    }
}

#[cfg(test)]
pub(crate) fn in_flight(key: &str) -> bool {
    keys(busy()).contains(key)
}

#[cfg(test)]
#[path = "target_lock.test.rs"]
mod tests;
