//! Startup replay in bounded memory: `JournalFile::open_stream` hands each
//! checksummed frame to this sink, which decodes it and folds it into the
//! projection at once. Only one payload is buffered at a time, so a large
//! journal never sits in memory whole before startup GC can run.
//!
//! The payload buffer grows by checked arithmetic and `try_reserve`: an
//! allocation the system refuses stops replay with a typed I/O error before
//! the scan can truncate anything, so the journal stays as it was. This is
//! partial hardening, not a memory bound: there is no cap on a frame (a
//! valid record's strings have none), decoding allocates without this
//! check, and an overcommitting OS (macOS) can still end the process.
//!
//! Every record's `seq` must extend the order before it (`replay_seq`):
//! a repeated or backward `seq` is corruption.
//!
//! A record newer than the reader stops replay as `FUTURE_FORMAT` at that
//! frame: the scan then neither truncates a torn tail nor completes the
//! projection, and the writer is never built, so nothing is repaired or
//! appended on top of a history this build cannot read.

use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::frame::FrameSink;
use crate::agent_journal::projection::Projection;

#[path = "replay_seq.rs"]
mod replay_seq;
use replay_seq::SeqOrder;

/// What replay built: the projection.
pub(super) struct Replay {
    pub proj: Projection,
    max: u32,
    order: SeqOrder,
    /// Test-injected allocator refusal past this many buffered bytes.
    reserve_cap: Option<usize>,
    cur: Vec<u8>,
    /// The first decode/apply error, kept typed (the sink can only stop
    /// the scan with a string).
    failed: Option<TxnError>,
}

impl Replay {
    pub fn new(max: u32, faults: &Faults) -> Self {
        Replay {
            proj: Projection::default(),
            max,
            order: SeqOrder::default(),
            reserve_cap: faults.replay_reserve_cap(),
            cur: Vec::new(),
            failed: None,
        }
    }

    /// The scan's own result, with a replay error taking precedence: it is
    /// the cause the scan stopped on. A whole scan must also leave the
    /// projection whole (`Projection::finish_replay`).
    pub fn finish<T>(&mut self, scanned: Result<T, TxnError>) -> Result<T, TxnError> {
        match self.failed.take() {
            Some(e) => Err(e),
            None => scanned.and_then(|v| self.proj.finish_replay().map(|()| v)),
        }
    }

    /// Room for `more` payload bytes, or the typed reason there is none.
    fn reserve(&mut self, more: usize) -> Result<(), TxnError> {
        let need = self.cur.len().checked_add(more).ok_or_else(|| {
            TxnError::Io("a journal record is too large to buffer for replay".into())
        })?;
        let refused = |why: String| {
            TxnError::Io(format!(
                "cannot buffer a {need}-byte journal record for replay: {why}"
            ))
        };
        if self.reserve_cap.is_some_and(|cap| need > cap) {
            return Err(refused("injected allocation failure".into()));
        }
        self.cur
            .try_reserve(more)
            .map_err(|e| refused(e.to_string()))
    }

    fn fold(&mut self, payload: &[u8]) -> Result<(), TxnError> {
        match codec::decode_with_max(payload, self.max)? {
            Decoded::Known(env) => {
                self.order.check(&env)?;
                self.proj.apply(&env)
            }
            Decoded::Future { version, .. } => Err(TxnError::FutureFormat { version }),
        }
    }
}

impl FrameSink for Replay {
    fn chunk(&mut self, bytes: &[u8]) -> Result<(), String> {
        if let Err(e) = self.reserve(bytes.len()) {
            self.cur = Vec::new();
            let msg = e.to_string();
            self.failed = Some(e);
            return Err(msg);
        }
        self.cur.extend_from_slice(bytes);
        Ok(())
    }

    fn frame(&mut self, _payload_offset: u64, _len: u64) -> Result<(), String> {
        let payload = std::mem::take(&mut self.cur);
        self.fold(&payload).map_err(|e| {
            let msg = e.to_string();
            self.failed = Some(e);
            msg
        })
    }

    fn discard(&mut self) {
        self.cur.clear();
    }
}

#[cfg(test)]
#[path = "writer_replay.test.rs"]
mod tests;

#[cfg(test)]
#[path = "future_format.test.rs"]
mod future_format;

#[cfg(test)]
#[path = "replay_seq.test.rs"]
mod seq_order_tests;
