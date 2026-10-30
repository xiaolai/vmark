//! What a scan remembers about the markdown files it already read.
//!
//! Purpose: every `fs:changed` burst runs a reconciliation scan, and a scan
//! used to read and hash every `.md` in the workspace (up to 20k files) to
//! learn that almost all of them had not changed. The kernel keeps, per
//! workspace-relative path, the facts a scan derived from the file's content
//! — its frontmatter identity and, once computed, its content hash — keyed by
//! a stamp of the file's metadata. A file whose stamp is unchanged is not
//! read again; its facts are reused.
//!
//! Key decisions:
//!   - The stamp is size + modification time, plus on Unix the inode and the
//!     status-change time. The ctime cannot be set from user space, so a tool
//!     that restores an old mtime after rewriting a file still changes the
//!     stamp; the inode catches a replace-by-rename. Windows has neither, so
//!     there a rewrite that keeps the size and restores the mtime is not
//!     re-read or re-hashed.
//!   - When in doubt, read. A file modified within `MTIME_SLACK` of the moment
//!     it was stamped is never remembered: another write in the same
//!     timestamp tick would leave the stamp unchanged (filesystems with 1-2 s
//!     mtime granularity), so such a file is read on every scan until it has
//!     been quiet for a while.
//!   - Facts are purely a function of the file's bytes, so nothing about the
//!     ledger or the index invalidates them. Paths the walk no longer sees
//!     (deleted, renamed away, now excluded) are dropped after each walk.
//!   - In memory only, per kernel: a restart starts from nothing.
//!
//! @coordinates-with scan_walk.rs — consults and fills the cache while walking
//! @coordinates-with scan.rs — fills in content hashes as reconciliation computes them
//! @module coherence/scan_cache

use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime};

use super::frontmatter::FileIdentity;
use super::types::ContentHash;

/// How long a file must have been unmodified, at the moment it was stamped,
/// for its stamp to be trusted. Covers the 2 s mtime granularity of FAT and
/// the coarse clocks of network filesystems.
pub(super) const MTIME_SLACK: Duration = Duration::from_secs(2);

/// The metadata a file's content is assumed unchanged under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FileStamp {
    len: u64,
    modified: SystemTime,
    #[cfg(unix)]
    changed: (i64, i64),
    #[cfg(unix)]
    inode: (u64, u64),
}

impl FileStamp {
    /// `None` when the platform cannot report a modification time — such a
    /// file is simply always read.
    pub(super) fn of(meta: &std::fs::Metadata) -> Option<Self> {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Some(Self {
            len: meta.len(),
            modified: meta.modified().ok()?,
            #[cfg(unix)]
            changed: (meta.ctime(), meta.ctime_nsec()),
            #[cfg(unix)]
            inode: (meta.dev(), meta.ino()),
        })
    }

    /// The latest moment the stamp says the file changed.
    fn last_change(&self) -> SystemTime {
        #[cfg(unix)]
        {
            let (secs, nanos) = self.changed;
            let changed = u64::try_from(secs)
                .ok()
                .and_then(|s| {
                    SystemTime::UNIX_EPOCH
                        .checked_add(Duration::new(s, nanos.clamp(0, 999_999_999) as u32))
                })
                .unwrap_or(self.modified);
            changed.max(self.modified)
        }
        #[cfg(not(unix))]
        {
            self.modified
        }
    }

    /// True when the file had been quiet for `slack` when it was stamped at
    /// `stamped_at`. A clock running backwards is not settled.
    fn settled_at(&self, stamped_at: SystemTime, slack: Duration) -> bool {
        stamped_at
            .duration_since(self.last_change())
            .is_ok_and(|quiet| quiet >= slack)
    }
}

/// What a scan derived from one file's content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FileFacts {
    /// The identity read from the file's own frontmatter (not the registry's).
    pub identity: Option<FileIdentity>,
    /// The content hash, when reconciliation needed it. A file that is not
    /// an object is never hashed.
    pub hash: Option<ContentHash>,
}

#[derive(Debug, Clone)]
struct Entry {
    stamp: FileStamp,
    facts: FileFacts,
}

/// Per-kernel memory of the files scans have read. See the module doc.
#[derive(Debug)]
pub struct ScanCache {
    entries: HashMap<String, Entry>,
    /// `MTIME_SLACK`, except in tests that cannot wait it out.
    slack: Duration,
    #[cfg(test)]
    reads: usize,
}

impl Default for ScanCache {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            slack: MTIME_SLACK,
            #[cfg(test)]
            reads: 0,
        }
    }
}

impl ScanCache {
    /// The facts recorded for `rel` under exactly this stamp.
    pub(super) fn unchanged(&self, rel: &str, stamp: &FileStamp) -> Option<&FileFacts> {
        self.entries
            .get(rel)
            .filter(|entry| entry.stamp == *stamp)
            .map(|entry| &entry.facts)
    }

    /// Record the facts of a file just read. `stamp` is the metadata taken
    /// at `stamped_at`, BEFORE the read; a file that was not quiet then, or
    /// has no stamp, is forgotten instead, so the next scan reads it again.
    pub(super) fn remember(
        &mut self,
        rel: &str,
        stamp: Option<FileStamp>,
        stamped_at: SystemTime,
        facts: FileFacts,
    ) {
        match stamp.filter(|stamp| stamp.settled_at(stamped_at, self.slack)) {
            Some(stamp) => {
                self.entries.insert(rel.to_string(), Entry { stamp, facts });
            }
            None => self.forget(rel),
        }
    }

    /// Fill in the content hash reconciliation computed for a remembered file.
    pub(super) fn record_hash(&mut self, rel: &str, hash: &ContentHash) {
        if let Some(entry) = self.entries.get_mut(rel) {
            entry.facts.hash = Some(hash.clone());
        }
    }

    pub(super) fn forget(&mut self, rel: &str) {
        self.entries.remove(rel);
    }

    /// Drop every path the last walk did not see.
    pub(super) fn keep_only(&mut self, seen: &HashSet<&str>) {
        self.entries.retain(|rel, _| seen.contains(rel.as_str()));
    }

    /// Count one file read from disk (observable in tests only).
    pub(super) fn note_read(&mut self) {
        #[cfg(test)]
        {
            self.reads += 1;
        }
    }

    /// Test-only: files read from disk since the kernel opened.
    #[cfg(test)]
    pub(crate) fn reads(&self) -> usize {
        self.reads
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    /// Test-only: trust a stamp however recent, so a test need not wait out
    /// `MTIME_SLACK` between writing a file and scanning it twice.
    #[cfg(test)]
    pub(crate) fn trust_recent_stamps(&mut self) {
        self.slack = Duration::ZERO;
    }
}

#[cfg(test)]
#[path = "scan_cache.test.rs"]
mod tests;
