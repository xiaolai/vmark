//! The durable half of document identity: which document each saved path
//! key belongs to, kept as an operation log beside the journal.
//!
//! Key decisions:
//!   - The first line is a version header (`doc_index_format.rs`), checked
//!     before anything else is done to the file: a log this build cannot
//!     vouch for is refused (`Incompatible`) and left untouched. A new or
//!     empty file is initialized with the header by an atomic rewrite, so a
//!     header is never torn.
//!   - One JSON line per operation, fsynced before it is acknowledged (the
//!     directory too, when open created the file). A rename or Save As is
//!     ONE `move` line, so an interrupted bind reopens wholly old or wholly
//!     new — never two mappings, never none.
//!   - A torn last line (no newline: the write never finished, so it was
//!     never acknowledged) is cut off at open, once every whole line has
//!     been read, before anything is appended after it. An unreadable line
//!     before the last fails loudly, the file untouched: it
//!     was damaged, not interrupted, and guessing would hand a path the wrong
//!     history.
//!   - A failed append is rolled back to the previous length; if even that
//!     fails, the index refuses further appends rather than writing after a
//!     partial line.
//!   - The log is rewritten (atomically) at open once it holds more than
//!     twice its live entries plus `COMPACT_SLACK`, to release a key
//!     (`remove`) and to change several at once (`remap`, an external swap):
//!     header plus one `put` per mapping. A rewrite that cannot reopen the
//!     new file poisons the index rather than append through the old handle.
//!   - Provisional mappings are grouped by path (`doc_index_near.rs`).
//!
//! @coordinates-with agent_journal/doc_index_format.rs — the line format
//! @module agent_journal/doc_index

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::agent_journal::journal_file::open_created;

/// The index file, in the journal's directory.
pub const DOC_INDEX_FILE: &str = "doc-index.jsonl";
/// Dead lines tolerated before a rewrite, beyond twice the live entries.
const COMPACT_SLACK: usize = 64;

#[path = "doc_index_format.rs"]
pub(crate) mod format;
use format::{apply, check_header, header_line, line, Op};

// The index's entry, open report and error types.
#[path = "doc_index_types.rs"]
mod types;
pub use types::{IndexEntry, IndexError, IndexOpen};

#[path = "doc_index_near.rs"]
mod near;
pub(crate) use near::near_key;
use near::Near;

#[path = "doc_index_faults.rs"]
mod faults;
use faults::{append_injected, injected};
#[cfg(test)]
pub(crate) use faults::{APPENDS_BEFORE_FAILURE, REWRITE_FAILS_AFTER_REPLACE};

pub struct DocIndex {
    path: PathBuf,
    /// The read-write handle appends go through; `None` only while a Windows rewrite has released
    /// it, or after a failed reopen (which also poisons the index).
    file: Option<File>,
    entries: BTreeMap<String, IndexEntry>,
    near: Near,
    poisoned: bool,
}

/// Owner-only read-write options, with no creation flag set. Not append
/// mode: on Windows an append handle lacks `FILE_WRITE_DATA`, so the tail
/// repair and the rollback (`set_len`) would be refused; every append seeks
/// to the end instead.
fn append_options() -> OpenOptions {
    let mut o = OpenOptions::new();
    o.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o
}

impl DocIndex {
    /// Open (creating) the index in `dir`: a new or empty file gets its
    /// header; an existing log's header and every whole line are checked
    /// first, then a torn tail is repaired.
    ///
    /// # Errors
    /// `Incompatible` (the file untouched), I/O failures, or an unreadable
    /// line before the last.
    pub fn open(dir: &Path) -> Result<(Self, IndexOpen), IndexError> {
        let path = dir.join(DOC_INDEX_FILE);
        let mut file = open_created(&path, append_options, true)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        let body = if bytes.is_empty() {
            0
        } else {
            check_header(&bytes)?
        };
        let whole = bytes.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
        let report = IndexOpen {
            repaired_tail_bytes: (bytes.len() - whole) as u64,
        };
        let mut entries = BTreeMap::new();
        let mut ops = 0usize;
        for (n, raw) in bytes[body..whole].split(|&b| b == b'\n').enumerate() {
            if raw.is_empty() {
                continue;
            }
            let op: Op = serde_json::from_slice(raw).map_err(|e| IndexError::Corrupt {
                line: n + 2,
                reason: e.to_string(),
            })?;
            apply(&mut entries, op);
            ops += 1;
        }
        // Only a log read whole is repaired: damage anywhere refuses it
        // byte-for-byte as it was.
        if whole < bytes.len() {
            file.set_len(whole as u64)?;
            file.sync_all()?;
            log::warn!(
                "agent journal: identity index tail repaired ({} byte(s))",
                report.repaired_tail_bytes
            );
        }
        let mut index = Self {
            path,
            file: Some(file),
            near: Near::of(&entries),
            entries,
            poisoned: false,
        };
        if bytes.is_empty() || ops > index.entries.len() * 2 + COMPACT_SLACK {
            index.rewrite(index.entries.clone())?;
            if index.poisoned {
                return Err(IndexError::Poisoned);
            }
        }
        Ok((index, report))
    }

    pub fn get(&self, key: &str) -> Option<&IndexEntry> {
        self.entries.get(key)
    }

    pub fn entries(&self) -> impl Iterator<Item = (&String, &IndexEntry)> {
        self.entries.iter()
    }

    /// The provisional keys whose path is in `path`'s group (`near_key`):
    /// the only mappings that may be another spelling of it.
    pub fn provisional_near(&self, path: &str) -> impl Iterator<Item = &String> {
        self.near.keys(&near_key(path))
    }

    /// Map `key` to `entry`, durably.
    ///
    /// # Errors
    /// The append failed; nothing changed.
    pub fn put(&mut self, key: &str, entry: IndexEntry) -> Result<(), IndexError> {
        self.append(Op::Put {
            key: key.to_owned(),
            entry,
        })
    }

    /// Move `from`'s mapping to `to` as `entry`, replacing whatever `to` held,
    /// in one durable operation. A missing `from` is not an error.
    ///
    /// # Errors
    /// The append failed; nothing changed.
    pub fn move_key(&mut self, from: &str, to: &str, entry: IndexEntry) -> Result<(), IndexError> {
        self.append(Op::Move {
            from: from.to_owned(),
            to: to.to_owned(),
            entry,
        })
    }

    /// Release `key` durably (`remap`); a missing key writes nothing.
    ///
    /// # Errors
    /// As [`DocIndex::remap`].
    pub fn remove(&mut self, key: &str) -> Result<(), IndexError> {
        self.remap(|entries| {
            entries.remove(key);
        })
    }

    /// Change any number of mappings at once (`edit` applied to a copy) in
    /// one atomic rewrite, so a crash leaves all of them old or all new; an
    /// edit that changes nothing writes nothing.
    ///
    /// # Errors
    /// The rewrite failed; nothing changed. A failed reopen after it is not
    /// an error: the new mappings stand and the index is poisoned (`rewrite`).
    pub fn remap(
        &mut self,
        edit: impl FnOnce(&mut BTreeMap<String, IndexEntry>),
    ) -> Result<(), IndexError> {
        if self.poisoned {
            return Err(IndexError::Poisoned);
        }
        let mut entries = self.entries.clone();
        edit(&mut entries);
        if entries == self.entries {
            return Ok(());
        }
        self.rewrite(entries)
    }

    fn append(&mut self, op: Op) -> Result<(), IndexError> {
        if self.poisoned {
            return Err(IndexError::Poisoned);
        }
        append_injected()?;
        let Some(file) = self.file.as_mut() else {
            return Err(IndexError::Poisoned);
        };
        let before = file.metadata()?.len();
        let written = file
            .seek(SeekFrom::Start(before))
            .and_then(|_| file.write_all(&line(&op)))
            .and_then(|()| file.sync_data());
        if let Err(e) = written {
            if file.set_len(before).and_then(|()| file.sync_all()).is_err() {
                self.poisoned = true;
            }
            return Err(e.into());
        }
        self.near.apply(&mut self.entries, op);
        Ok(())
    }

    /// Atomically replace the log with the header and one `put` line per
    /// `entries` mapping, then adopt them. A failed replacement changes nothing
    /// on disk or in memory (on Windows it still reopens the released handle).
    /// After a replacement the open handle names the replaced file: a failed
    /// reopen poisons the index so no append lands there (logged; the new
    /// mappings stand).
    fn rewrite(&mut self, entries: BTreeMap<String, IndexEntry>) -> Result<(), IndexError> {
        let mut out = header_line().into_bytes();
        for (key, entry) in &entries {
            out.extend(line(&Op::Put {
                key: key.clone(),
                entry: entry.clone(),
            }));
        }
        let dir = self.path.parent().unwrap_or(Path::new("."));
        injected(false)?;
        // Windows: the replacement is `MoveFileExW`, which refuses to replace
        // a file while any handle holds it open — this index's own append
        // handle included — so it is released first. A failed replacement
        // then reaches the reopen below, which restores it on the old file.
        #[cfg(windows)]
        drop(self.file.take());
        let replaced = crate::atomic_replace::atomic_replace(&self.path, dir, &out)
            .map_err(|e| IndexError::Io(std::io::Error::other(format!("{e:?}"))));
        if replaced.is_ok() {
            self.near = Near::of(&entries);
            self.entries = entries;
        } else if self.file.is_some() {
            return replaced;
        }
        match injected(true).and_then(|()| append_options().create(true).open(&self.path)) {
            Ok(file) => self.file = Some(file),
            Err(e) => {
                log::error!("agent journal: identity index reopen after a rewrite failed: {e}");
                self.poisoned = true;
            }
        }
        replaced
    }
}

#[cfg(test)]
#[path = "doc_index_header.test.rs"]
mod header_tests;

#[cfg(test)]
#[path = "doc_index_policy.test.rs"]
mod policy_tests;
