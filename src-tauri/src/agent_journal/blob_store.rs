//! Content-addressed blob pack: an append-only framed file (`blobs.pack`)
//! whose payload is `<hash>\n<utf-8 text>`, plus an in-memory index
//! `hash → (offset, length)`. A blob is appended (and fsynced) before the
//! record that names it, so a durable record never references a missing
//! blob. Compaction keeps exactly the pinned set, and refuses one the pack
//! does not hold.
//!
//! Bounded memory: open streams the pack, hashing each payload in
//! chunks to verify it and keeping only the index; `get` reads one blob by
//! offset; compaction stages the new pack one blob at a time from an
//! independent read handle, and the index is rebuilt from what was staged.

use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;

use sha2_v011::{Digest, Sha256};

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::faults::{Faults, Rewritten};
use crate::agent_journal::frame::{FrameSink, HEADER_LEN};
use crate::agent_journal::ids::{hex, BlobHash};
use crate::agent_journal::journal_file::{JournalFile, SyncPolicy};

pub const BLOB_PACK: &str = "blobs.pack";

/// `sha256-` + 64 hex digits.
const HASH_LINE: usize = 71;

pub struct BlobStore {
    file: JournalFile,
    /// Shared with the writer for blob-specific injections only.
    faults: Arc<Faults>,
    /// hash → (text offset, text length) in the pack.
    index: HashMap<BlobHash, (u64, u64)>,
}

/// Builds the index from streamed payload chunks, verifying each blob's
/// content against its hash line without holding the content.
#[derive(Default)]
struct IndexSink {
    index: HashMap<BlobHash, (u64, u64)>,
    line: Vec<u8>,
    text: Option<Sha256>,
    too_long: bool,
}

impl FrameSink for IndexSink {
    fn chunk(&mut self, mut bytes: &[u8]) -> Result<(), String> {
        if self.text.is_none() {
            let nl = bytes.iter().position(|b| *b == b'\n');
            let head = &bytes[..nl.unwrap_or(bytes.len())];
            self.too_long |= self.line.len() + head.len() > HASH_LINE;
            if !self.too_long {
                self.line.extend_from_slice(head);
            }
            let Some(nl) = nl else { return Ok(()) };
            self.text = Some(Sha256::new());
            bytes = &bytes[nl + 1..];
        }
        if let Some(h) = self.text.as_mut() {
            h.update(bytes);
        }
        Ok(())
    }

    fn frame(&mut self, payload_offset: u64, len: u64) -> Result<(), String> {
        let (line, text) = (std::mem::take(&mut self.line), self.text.take());
        let too_long = std::mem::take(&mut self.too_long);
        let text = text
            .filter(|_| !too_long)
            .ok_or("blob frame has no hash line")?;
        let hash = std::str::from_utf8(&line)
            .ok()
            .and_then(|s| BlobHash::try_from(s.to_string()).ok())
            .ok_or("blob frame hash is malformed")?;
        if hash.digest_hex() != hex(&text.finalize()) {
            return Err(format!("blob {} does not match its content", hash.as_str()));
        }
        let skip = line.len() as u64 + 1;
        self.index.insert(hash, (payload_offset + skip, len - skip));
        Ok(())
    }

    fn discard(&mut self) {
        *self = Self {
            index: std::mem::take(&mut self.index),
            ..Self::default()
        };
    }
}

fn payload(hash: &BlobHash, text: &str) -> Vec<u8> {
    let mut p = Vec::with_capacity(hash.as_str().len() + 1 + text.len());
    p.extend_from_slice(hash.as_str().as_bytes());
    p.push(b'\n');
    p.extend_from_slice(text.as_bytes());
    p
}

fn read_text(f: &mut File, (off, len): (u64, u64)) -> Result<String, TxnError> {
    let mut buf =
        vec![0u8; usize::try_from(len).map_err(|_| TxnError::Corrupt("blob too large".into()))?];
    f.seek(SeekFrom::Start(off))?;
    f.read_exact(&mut buf)?;
    String::from_utf8(buf).map_err(|_| TxnError::Corrupt("blob is not UTF-8".into()))
}

impl BlobStore {
    /// The pack file never sees the journal's injected faults (they target
    /// records); `faults` is consulted only for blob-write and compaction
    /// failures.
    pub fn open(dir: &Path, sync: SyncPolicy, faults: Arc<Faults>) -> Result<Self, TxnError> {
        let mut sink = IndexSink::default();
        let (file, _) = JournalFile::open_stream(
            &dir.join(BLOB_PACK),
            sync,
            Arc::new(Faults::default()),
            &mut sink,
        )?;
        Ok(Self {
            file,
            faults,
            index: sink.index,
        })
    }

    pub fn is_poisoned(&self) -> bool {
        self.file.is_poisoned()
    }

    #[cfg(test)]
    pub(crate) fn poison(&mut self) {
        self.file.poison();
    }

    /// Whether the pack durably holds `hash`. `false` while poisoned: after
    /// a failed rewrite past its rename the index may list a blob the file
    /// on disk no longer holds, so presence proves nothing.
    pub fn contains(&self, hash: &BlobHash) -> bool {
        !self.is_poisoned() && self.index.contains_key(hash)
    }

    /// Whether `get` can read `hash` through the current handle. Unlike
    /// `contains` it holds while poisoned: the old handle still names the
    /// file the index describes, valid for reads until reopen.
    pub fn readable(&self, hash: &BlobHash) -> bool {
        self.index.contains_key(hash)
    }

    /// Whether the pack stores a blob outside `keep` (a compaction to
    /// `keep` would remove something).
    pub fn holds_beyond(&self, keep: &BTreeSet<BlobHash>) -> bool {
        self.index.keys().any(|h| !keep.contains(h))
    }

    /// The stored UTF-8 byte length of a blob, if the pack holds it.
    pub fn size_of(&self, hash: &BlobHash) -> Option<u64> {
        self.index.get(hash).map(|&(_, len)| len)
    }

    /// Idempotent. Refused while poisoned, before the index is consulted.
    pub fn put(&mut self, hash: &BlobHash, text: &str) -> Result<(), TxnError> {
        if self.is_poisoned() {
            return Err(TxnError::Io(
                "blob pack poisoned by an earlier ambiguous failure".into(),
            ));
        }
        if self.contains(hash) {
            return Ok(());
        }
        debug_assert_eq!(&BlobHash::of_text(text), hash);
        if self.faults.take_blob_write_failure() {
            return Err(TxnError::Io("injected blob write failure".into()));
        }
        let off = self.file.append(&payload(hash, text))?;
        let skip = hash.as_str().len() as u64 + 1;
        self.index
            .insert(hash.clone(), (off + skip, text.len() as u64));
        Ok(())
    }

    pub fn get(&mut self, hash: &BlobHash) -> Result<String, TxnError> {
        let (off, len) = *self.index.get(hash).ok_or_else(|| {
            TxnError::InvalidRequest(format!("blob {} is not stored", hash.as_str()))
        })?;
        let bytes = self.file.read_at(off, len)?;
        String::from_utf8(bytes).map_err(|_| TxnError::Corrupt("blob is not UTF-8".into()))
    }

    /// Keep exactly `keep`, one blob in memory at a time.
    ///
    /// # Errors
    /// `Corrupt`, before anything is written, when the pack does not hold
    /// a member of `keep`: a reachable blob is missing, and compacting
    /// around it would report success over a broken journal.
    pub fn compact(&mut self, keep: &BTreeSet<BlobHash>) -> Result<(), TxnError> {
        if self.faults.take_blob_compaction_failure() {
            return Err(TxnError::Io("injected blob compaction failure".into()));
        }
        let present = keep
            .iter()
            .map(|h| match self.index.get(h) {
                Some(at) => Ok((h.clone(), *at)),
                None => Err(TxnError::Corrupt(format!(
                    "blob {} is reachable but not stored",
                    h.as_str()
                ))),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut old = self.file.open_reader()?;
        let mut index = HashMap::with_capacity(present.len());
        let (mut pos, mut items) = (0u64, present.into_iter());
        let faults = self.faults.clone();
        let fail = |step| faults.take_after_rename_failure(Rewritten::BlobPack, step);
        self.file.rewrite_each_faulted(
            &mut || {
                let Some((hash, at)) = items.next() else {
                    return Ok(None);
                };
                let text = read_text(&mut old, at)?;
                let p = payload(&hash, &text);
                let skip = hash.as_str().len() as u64 + 1;
                index.insert(hash, (pos + HEADER_LEN as u64 + skip, text.len() as u64));
                pos += (HEADER_LEN + p.len()) as u64;
                Ok(Some(p))
            },
            &fail,
        )?;
        self.index = index;
        Ok(())
    }
}

#[cfg(test)]
#[path = "blob_poison.test.rs"]
mod blob_poison_tests;
