//! The live journal read back one record at a time, for a rewrite (the
//! collector, forgetting checkpoints): frames are scanned from an
//! independent read handle (`JournalFile::open_reader`) and decoded as each
//! ends, so one payload is buffered at once — the bound startup replay
//! keeps (`writer_replay`), with the same typed refusal when a buffer
//! cannot grow. A second pass re-reads a record by its frame position.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};

use crate::agent_journal::codec::{self, Decoded};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::frame::{self, FrameSink, Tail};
use crate::agent_journal::record::Envelope;
use crate::agent_journal::writer::Inner;

/// Where one record's payload sits in the journal file.
pub(super) type Position = (u64, u64);

/// A payload buffer of `need` bytes, or the typed reason there is none.
/// `cap` is the test-injected allocator refusal (`Faults`).
fn reserve(buf: &mut Vec<u8>, more: usize, cap: Option<usize>) -> Result<(), TxnError> {
    let need = buf.len().checked_add(more).ok_or_else(|| {
        TxnError::Io("a journal record is too large to buffer for a rewrite".into())
    })?;
    let refused = |why: String| {
        TxnError::Io(format!(
            "cannot buffer a {need}-byte journal record for a rewrite: {why}"
        ))
    };
    if cap.is_some_and(|cap| need > cap) {
        return Err(refused("injected allocation failure".into()));
    }
    buf.try_reserve(more).map_err(|e| refused(e.to_string()))
}

pub(super) fn decode(payload: &[u8]) -> Result<Envelope, TxnError> {
    match codec::decode(payload)? {
        Decoded::Known(env) => Ok(*env),
        Decoded::Future { version, .. } => Err(TxnError::FutureFormat { version }),
    }
}

struct Records<'a> {
    cur: Vec<u8>,
    cap: Option<usize>,
    each: &'a mut dyn FnMut(Envelope) -> Result<(), TxnError>,
    positions: Vec<Position>,
    /// The first error, kept typed (the sink can only stop with a string).
    failed: Option<TxnError>,
}

impl Records<'_> {
    fn fail(&mut self, e: TxnError) -> String {
        self.cur = Vec::new();
        let msg = e.to_string();
        self.failed = Some(e);
        msg
    }
}

impl FrameSink for Records<'_> {
    fn chunk(&mut self, bytes: &[u8]) -> Result<(), String> {
        match reserve(&mut self.cur, bytes.len(), self.cap) {
            Ok(()) => {
                self.cur.extend_from_slice(bytes);
                Ok(())
            }
            Err(e) => Err(self.fail(e)),
        }
    }

    fn frame(&mut self, payload_offset: u64, len: u64) -> Result<(), String> {
        let payload = std::mem::take(&mut self.cur);
        match decode(&payload).and_then(|env| (self.each)(env)) {
            Ok(()) => {
                self.positions.push((payload_offset, len));
                Ok(())
            }
            Err(e) => Err(self.fail(e)),
        }
    }

    fn discard(&mut self) {
        self.cur.clear();
    }
}

/// Hand every record of the live journal to `each`, in order; returns
/// their positions for `read_at`. A torn or damaged frame is corruption:
/// a healthy writer's file ends on a whole frame.
pub(super) fn each_record(
    g: &Inner,
    cap: Option<usize>,
    each: &mut dyn FnMut(Envelope) -> Result<(), TxnError>,
) -> Result<Vec<Position>, TxnError> {
    let file = g.journal.open_reader()?;
    let file_len = file.metadata()?.len();
    let mut sink = Records {
        cur: Vec::new(),
        cap,
        each,
        positions: Vec::new(),
        failed: None,
    };
    let scanned = frame::scan_stream(&mut BufReader::new(&file), file_len, &mut sink);
    if let Some(e) = sink.failed.take() {
        return Err(e);
    }
    match scanned.map_err(TxnError::Corrupt)?.tail {
        Tail::Clean => Ok(sink.positions),
        Tail::Torn { at, .. } => Err(TxnError::Corrupt(format!(
            "the journal ends in a partial frame at byte {at}"
        ))),
    }
}

/// The record at `at`, read again from `file`.
pub(super) fn read_at(
    file: &mut File,
    (offset, len): Position,
    cap: Option<usize>,
) -> Result<Envelope, TxnError> {
    let len = usize::try_from(len)
        .map_err(|_| TxnError::Io("a journal record is too large to buffer".into()))?;
    let mut buf = Vec::new();
    reserve(&mut buf, len, cap)?;
    buf.resize(len, 0);
    file.seek(SeekFrom::Start(offset))?;
    file.read_exact(&mut buf)?;
    decode(&buf)
}
