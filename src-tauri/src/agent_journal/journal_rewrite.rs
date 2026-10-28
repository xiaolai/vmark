//! Atomic rewrite (compaction) of a `JournalFile`: temp file → fsync →
//! rename → directory fsync. A crash at any step leaves either the old or
//! the new file whole; a stale temp file is removed at the next open.
//!
//! @module agent_journal/journal_rewrite

use std::fs::File;
use std::io::{BufWriter, Write};

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::faults::{AfterRename, CompactionStep, Rewritten};
use crate::agent_journal::frame;
use crate::agent_journal::journal_file::{open_rw, sync_dir, tmp_path, JournalFile, SyncPolicy};

fn crash(step: CompactionStep) -> TxnError {
    TxnError::Io(format!("injected crash after {step:?}"))
}

impl JournalFile {
    /// Replace the whole file with `payloads`, atomically.
    pub fn rewrite(&mut self, payloads: &[Vec<u8>]) -> Result<(), TxnError> {
        let mut it = payloads.iter();
        self.rewrite_each(&mut || Ok(it.next().cloned()))
    }

    /// `rewrite` from a source yielding one payload at a time, so the new
    /// file is staged in bounded memory.
    pub fn rewrite_each(
        &mut self,
        next: &mut dyn FnMut() -> Result<Option<Vec<u8>>, TxnError>,
    ) -> Result<(), TxnError> {
        let faults = self.faults.clone();
        self.rewrite_each_faulted(next, &|step| {
            faults.take_after_rename_failure(Rewritten::Journal, step)
        })
    }

    /// `rewrite_each` with the caller's post-rename fault check (the blob
    /// pack keeps its injections apart from the journal's). A failure past
    /// the rename returns with the instance poisoned and its old handle.
    pub(crate) fn rewrite_each_faulted(
        &mut self,
        next: &mut dyn FnMut() -> Result<Option<Vec<u8>>, TxnError>,
        fail_after_rename: &dyn Fn(AfterRename) -> bool,
    ) -> Result<(), TxnError> {
        if self.poisoned {
            return Err(TxnError::Io(
                "journal poisoned by an earlier ambiguous failure".into(),
            ));
        }
        let tmp = tmp_path(&self.path);
        let mut written = 0u64;
        let mut stage = || -> Result<File, TxnError> {
            let f = open_rw(&tmp)?;
            f.set_len(0)?;
            let mut out = BufWriter::new(f);
            while let Some(p) = next()? {
                let framed = frame::encode(&p);
                out.write_all(&framed)?;
                written += framed.len() as u64;
            }
            out.into_inner().map_err(|e| TxnError::Io(e.to_string()))
        };
        let f = match stage() {
            Ok(f) => f,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
        };
        // Simulated crashes model process death: the instance is unusable.
        if self.faults.compaction_crash(CompactionStep::TempWritten) {
            self.poisoned = true;
            return Err(crash(CompactionStep::TempWritten));
        }
        if let Err(e) = self.sync_file(&f) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
        if self.faults.compaction_crash(CompactionStep::TempSynced) {
            self.poisoned = true;
            return Err(crash(CompactionStep::TempSynced));
        }
        drop(f);
        std::fs::rename(&tmp, &self.path)?;
        // From here the old handle names an unlinked file.
        self.poisoned = true;
        if self.faults.compaction_crash(CompactionStep::Renamed) {
            return Err(crash(CompactionStep::Renamed));
        }
        if fail_after_rename(AfterRename::SyncDir) {
            return Err(TxnError::Io("injected directory sync failure".into()));
        }
        if self.sync == SyncPolicy::Full {
            sync_dir(&self.path)?;
        }
        if self.faults.compaction_crash(CompactionStep::DirSynced) {
            return Err(crash(CompactionStep::DirSynced));
        }
        if fail_after_rename(AfterRename::Reopen) {
            return Err(TxnError::Io("injected reopen failure".into()));
        }
        self.file = open_rw(&self.path)?;
        self.len = written;
        self.poisoned = false;
        Ok(())
    }
}

#[cfg(test)]
#[path = "post_rename.test.rs"]
mod post_rename_tests;
