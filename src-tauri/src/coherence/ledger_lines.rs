//! Byte-level framing for the ledger file: bounded line reads, line parsing
//! into accepted/quarantined outcomes, directory fsync, and the trailing-newline
//! probe.
//!
//! Split out of `ledger.rs` for size. The seam is the level of abstraction:
//! this file deals in BYTES and never in envelopes, while `ledger.rs` owns the
//! append/read API above it.
//!
//! The line cap is a trust boundary, not tuning: the ledger is an append-only
//! file other tools can write to, so an unbounded read is a memory DoS against
//! opening a workspace.
//!
//! @coordinates-with ledger.rs — the append/read API over these primitives
//! @module coherence/ledger_lines

use std::fs;
use std::io::BufRead;
use std::path::Path;

use super::types::{Envelope, FORMAT_VERSION};

/// Outcome of one bounded line read.
pub(super) enum CappedLine {
    /// A within-cap line (may be empty); its bytes are in `buf` (no trailing `\n`).
    Line,
    /// A line exceeded the cap — it was drained to the next boundary, not buffered.
    Oversized,
    /// Clean end of file.
    Eof,
}

/// Read one newline-terminated line from `reader` into `buf`, bounding memory to
/// `max` bytes (re-review #3). A line with no early newline is drained to its
/// boundary WITHOUT being buffered once it passes `max`, so a single huge or
/// hostile line can never OOM the reader. Consumes the BufReader's own buffer via
/// `fill_buf`/`consume`, so at most one fill's worth (plus the capped `buf`) is
/// resident at a time.
pub(super) fn read_capped_line<R: BufRead>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    max: usize,
) -> Result<CappedLine, String> {
    buf.clear();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf().map_err(|e| format!("read failed: {e}"))?;
        if available.is_empty() {
            if !buf.is_empty() {
                return Ok(CappedLine::Line); // final line, no trailing newline
            }
            return Ok(if oversized {
                CappedLine::Oversized
            } else {
                CappedLine::Eof
            });
        }
        match available.iter().position(|&b| b == b'\n') {
            Some(pos) => {
                if !oversized && buf.len() + pos > max {
                    oversized = true;
                    buf.clear();
                }
                if !oversized {
                    buf.extend_from_slice(&available[..pos]);
                }
                reader.consume(pos + 1);
                return Ok(if oversized {
                    CappedLine::Oversized
                } else {
                    CappedLine::Line
                });
            }
            None => {
                let n = available.len();
                if !oversized && buf.len() + n > max {
                    oversized = true;
                    buf.clear();
                }
                if !oversized {
                    buf.extend_from_slice(available);
                }
                reader.consume(n);
            }
        }
    }
}

pub(super) enum LineOutcome {
    Entry(Envelope),
    FutureFormat,
    Malformed(String),
}

pub(super) fn parse_line(line: &[u8]) -> LineOutcome {
    let Ok(text) = std::str::from_utf8(line) else {
        return LineOutcome::Malformed("invalid UTF-8".into());
    };
    // Probe the VERSION before typing the record. Deserializing into this
    // build's `Envelope` first meant a newer format that renames, removes or
    // retypes any required field failed to parse and was reported as
    // `Malformed` — quarantined, with `future_format` left at zero, so the
    // WI-2.2 write gate saw a fully-read ledger and let the write through. The
    // version field is the one thing a format bump must keep readable, so it is
    // read from the untyped value.
    let value: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => return LineOutcome::Malformed(format!("invalid entry: {e}")),
    };
    if value
        .get("format")
        .and_then(serde_json::Value::as_u64)
        .is_some_and(|f| f > u64::from(FORMAT_VERSION))
    {
        return LineOutcome::FutureFormat;
    }
    let env: Envelope = match serde_json::from_value(value) {
        Ok(e) => e,
        Err(e) => return LineOutcome::Malformed(format!("invalid entry: {e}")),
    };
    if env.sort_key().is_none() {
        return LineOutcome::Malformed("unparseable time".into());
    }
    match env.typed() {
        Ok(_) => LineOutcome::Entry(env),
        Err(e) => LineOutcome::Malformed(e),
    }
}

/// fsync a directory so a create/rename within it is durable (matches the
/// `state.rs` 8R-6/9R-5 idiom). A directory `File` opened read-only and
/// `sync_all()`'d persists its entries; not observable in a unit test, so it is
/// durability hardening rather than tested behaviour (as with the state.rs
/// dir-fsyncs). A missing directory is not an error here — the caller only
/// fsyncs a dir it just created or wrote into.
pub(super) fn fsync_dir(dir: &Path) -> Result<(), String> {
    match fs::File::open(dir) {
        Ok(d) => d
            .sync_all()
            .map_err(|e| format!("ledger dir fsync failed ({}): {e}", dir.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!(
            "ledger dir open for fsync failed ({}): {e}",
            dir.display()
        )),
    }
}

pub(super) fn file_ends_with_newline(path: &Path) -> Result<bool, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = fs::File::open(path).map_err(|e| format!("open failed: {e}"))?;
    let len = f.metadata().map_err(|e| format!("stat failed: {e}"))?.len();
    if len == 0 {
        return Ok(true);
    }
    f.seek(SeekFrom::End(-1))
        .map_err(|e| format!("seek failed: {e}"))?;
    let mut buf = [0u8; 1];
    f.read_exact(&mut buf)
        .map_err(|e| format!("read failed: {e}"))?;
    Ok(buf[0] == b'\n')
}
