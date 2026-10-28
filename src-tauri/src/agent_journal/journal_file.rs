//! Durable framed append file with atomic rewrite. Used for the journal and
//! for the blob pack.
//!
//! - Append: write the frame at the known end, then fsync (policy). On any
//!   failure the file is truncated back to the last good length, so a torn
//!   frame is never left in front of a later append. If that truncation or
//!   the fsync fails, the instance is poisoned: after a failed fsync the page
//!   cache can no longer be trusted, so nothing more is written until restart.
//! - Open: the torn tail (see `frame`) is truncated and reported; damage
//!   before the tail is `JOURNAL_CORRUPT` and the file is left untouched.
//!   Creating the file fsyncs its directory before the first append.
//! - Rewrite (compaction): temp file → fsync → rename → directory fsync. A
//!   crash at any step leaves either the old or the new file whole; a stale
//!   temp file is removed at the next open.
//! - Exclusive: open first takes an advisory lock on a `<file>.lock` sidecar
//!   and holds it for the instance's life, so a second VMark process (one the
//!   single-instance guard let through) is refused before it cleans up,
//!   reads or appends. The sidecar, not the file, carries the lock because
//!   compaction replaces the file. The OS releases it when the process dies.

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::frame::{self, FrameSink, Tail, HEADER_LEN};

#[path = "journal_file_open.rs"]
mod open_support;

use open_support::lock_exclusive;
#[cfg(test)]
pub(crate) use open_support::DIR_SYNCS;
pub(super) use open_support::{
    create_dir_durable, open_created, open_rw, rw_options, sync_dir, tmp_path,
};

pub const JOURNAL_FILE: &str = "journal.alj";

/// `None` exists for heavy tests only; production is always `Full`
/// (`sync_all`, which is `F_FULLFSYNC` on macOS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncPolicy {
    Full,
    None,
}

pub struct JournalFile {
    pub(super) file: File,
    pub(super) path: PathBuf,
    pub(super) len: u64,
    pub(super) sync: SyncPolicy,
    pub(super) faults: Arc<Faults>,
    pub(super) poisoned: bool,
    /// The held `<file>.lock` (see the module docs); released on drop.
    _lock: File,
}

/// Result of `JournalFile::open` (tests only: production replays through
/// `open_stream`, in bounded memory).
#[cfg(test)]
pub struct Opened {
    pub file: JournalFile,
    pub payloads: Vec<Vec<u8>>,
    /// Byte offset of each payload, parallel to `payloads`.
    pub offsets: Vec<u64>,
    pub truncated_tail_bytes: u64,
}

/// Lock, remove a stale compaction temp file, then open for read and write
/// (`open_created`).
fn open_clean(path: &Path, sync: SyncPolicy) -> Result<(File, File), TxnError> {
    let lock = lock_exclusive(path)?;
    let tmp = tmp_path(path);
    if tmp.exists() {
        std::fs::remove_file(&tmp)?;
    }
    let file = open_created(path, rw_options, sync == SyncPolicy::Full)?;
    Ok((file, lock))
}

fn truncate_tail(file: &File, valid_len: u64, tail: Tail) -> Result<u64, TxnError> {
    match tail {
        Tail::Clean => Ok(0),
        Tail::Torn { bytes, .. } => {
            file.set_len(valid_len)?;
            file.sync_all()?;
            Ok(bytes)
        }
    }
}

impl JournalFile {
    /// The whole file in memory; tests only (see `Opened`).
    #[cfg(test)]
    pub fn open(path: &Path, sync: SyncPolicy, faults: Arc<Faults>) -> Result<Opened, TxnError> {
        let (mut file, lock) = open_clean(path, sync)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        let scan = frame::scan(&bytes).map_err(TxnError::Corrupt)?;
        let truncated_tail_bytes = truncate_tail(&file, scan.valid_len, scan.tail)?;
        let offsets = scan.frames.iter().map(|f| f.payload_offset).collect();
        let payloads = scan.frames.into_iter().map(|f| f.payload).collect();
        let jf = JournalFile {
            file,
            path: path.to_path_buf(),
            len: scan.valid_len,
            sync,
            faults,
            poisoned: false,
            _lock: lock,
        };
        Ok(Opened {
            file: jf,
            payloads,
            offsets,
            truncated_tail_bytes,
        })
    }

    /// `open` in bounded memory: payloads stream through `sink`
    /// instead of being returned. Returns the file and the torn-tail bytes.
    pub fn open_stream(
        path: &Path,
        sync: SyncPolicy,
        faults: Arc<Faults>,
        sink: &mut dyn FrameSink,
    ) -> Result<(Self, u64), TxnError> {
        let (file, lock) = open_clean(path, sync)?;
        let file_len = file.metadata()?.len();
        let scan = frame::scan_stream(&mut BufReader::new(&file), file_len, sink)
            .map_err(TxnError::Corrupt)?;
        let truncated = truncate_tail(&file, scan.valid_len, scan.tail)?;
        let jf = JournalFile {
            file,
            path: path.to_path_buf(),
            len: scan.valid_len,
            sync,
            faults,
            poisoned: false,
            _lock: lock,
        };
        Ok((jf, truncated))
    }

    /// An independent read handle (its own cursor), for reading the old
    /// file while `rewrite_each` stages the new one.
    pub fn open_reader(&self) -> io::Result<File> {
        File::open(&self.path)
    }

    /// The valid length in bytes (the end the next append writes at).
    #[cfg(test)]
    pub(crate) fn len(&self) -> u64 {
        self.len
    }

    pub fn is_poisoned(&self) -> bool {
        self.poisoned
    }

    pub(crate) fn poison(&mut self) {
        self.poisoned = true;
    }

    pub(super) fn sync_file(&self, f: &File) -> io::Result<()> {
        match self.sync {
            SyncPolicy::Full => f.sync_all(),
            SyncPolicy::None => Ok(()),
        }
    }

    /// Append one framed payload. Returns the payload's byte offset.
    pub fn append(&mut self, payload: &[u8]) -> Result<u64, TxnError> {
        if self.poisoned {
            return Err(TxnError::Io(
                "journal poisoned by an earlier ambiguous failure".into(),
            ));
        }
        let framed = frame::encode(payload);
        if self.faults.take_append_failure() {
            return Err(TxnError::Io("injected append failure".into()));
        }
        let written = match self.faults.take_tear() {
            Some(k) => self
                .write_at_end(&framed[..k.min(framed.len())])
                .and_then(|_| Err(io::Error::other("injected torn append"))),
            None => self.write_at_end(&framed),
        };
        if let Err(e) = written {
            if self
                .truncate_back()
                .and_then(|_| self.sync_rollback())
                .is_err()
            {
                self.poisoned = true;
            }
            return Err(e.into());
        }
        let synced = if self.faults.take_fsync_failure() {
            Err(io::Error::other("injected fsync failure"))
        } else {
            self.sync_file(&self.file)
        };
        if let Err(e) = synced {
            // The bytes may or may not be durable: refuse further writes.
            let _ = self.file.set_len(self.len);
            self.poisoned = true;
            return Err(e.into());
        }
        let offset = self.len + HEADER_LEN as u64;
        self.len += framed.len() as u64;
        Ok(offset)
    }

    /// `append` for a record frame. A failure that poisons the file may
    /// have left the frame durable, so a reopen may replay it: that is
    /// `Indeterminate`, never the `Io` whose contract is that nothing changed.
    pub fn append_record(&mut self, payload: &[u8]) -> Result<u64, TxnError> {
        let was_poisoned = self.poisoned;
        self.append(payload).map_err(|e| match e {
            TxnError::Io(m) if self.poisoned && !was_poisoned => TxnError::Indeterminate(m),
            e => e,
        })
    }

    fn truncate_back(&self) -> io::Result<()> {
        if self.faults.take_truncate_failure() {
            return Err(io::Error::other("injected truncate failure"));
        }
        self.file.set_len(self.len)
    }

    fn sync_rollback(&self) -> io::Result<()> {
        if self.faults.take_rollback_sync_failure() {
            return Err(io::Error::other("injected rollback sync failure"));
        }
        self.sync_file(&self.file)
    }

    fn write_at_end(&mut self, bytes: &[u8]) -> io::Result<()> {
        if let Some(e) = self.faults.take_write_error() {
            return Err(e);
        }
        self.file.seek(SeekFrom::Start(self.len))?;
        self.file.write_all(bytes)
    }

    pub fn read_at(&mut self, offset: u64, len: u64) -> Result<Vec<u8>, TxnError> {
        let mut buf = vec![
            0u8;
            usize::try_from(len)
                .map_err(|_| TxnError::Corrupt("blob too large".into()))?
        ];
        self.file.seek(SeekFrom::Start(offset))?;
        self.file.read_exact(&mut buf)?;
        Ok(buf)
    }

    /// Every whole payload currently in the file, held at once: tests only
    /// (a rewrite streams the file, `writer_gc_stream`).
    #[cfg(test)]
    pub fn read_all(&mut self) -> Result<Vec<Vec<u8>>, TxnError> {
        let bytes = self.read_at(0, self.len)?;
        let scan = frame::scan(&bytes).map_err(TxnError::Corrupt)?;
        Ok(scan.frames.into_iter().map(|f| f.payload).collect())
    }
}

#[cfg(test)]
#[path = "ambiguous_append.test.rs"]
mod ambiguous_append_tests;
