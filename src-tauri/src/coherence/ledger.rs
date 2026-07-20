//! Ledger storage (ADR-C4 storage tier). Spec §5: per-writer append-only
//! JSONL segments, O_APPEND single-line writes + fsync, torn-tail
//! termination (G1 finding), mkdir-p before every append (S1 finding —
//! git prunes empty dirs), reader with quarantine and idem dedupe.
//!
//! I5: the public API is appends and reads only — there is no rewrite,
//! truncate, or delete operation, and `PUBLIC_API` in this file plus its
//! test lock that surface.

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use super::types::{Envelope, WriterId, FORMAT_VERSION};

/// Spec §5.1 rotation threshold.
const MAX_SEGMENT_BYTES: u64 = 8 * 1024 * 1024;

/// Per-line read cap (re-review #3): `read_all` streams each segment line with
/// this bound, so a single pathological or hostile line (a group-prepare grown
/// past every field cap, or an externally-corrupted ledger) is quarantined
/// instead of read whole into memory. Above the largest legal line (a
/// `MAX_PREPARE_BYTES` 4 MiB prepare plus envelope overhead), with margin.
const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

/// A ledger's on-disk identity: sorted `(segment, byte-len, mtime-nanos)`.
pub type LedgerFingerprint = Vec<(String, u64, u128)>;

/// I5 tripwire — every public method, mirrored by the test suite.
pub const PUBLIC_API: [&str; 6] = [
    "new",
    "with_max_segment_bytes",
    "append",
    "read_all",
    "fingerprint",
    "active_segment_path_for_test",
];

pub fn writer_file_stem(writer: &WriterId) -> String {
    writer.0.to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuarantineRecord {
    pub segment: String,
    pub line: usize,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct LedgerRead {
    /// Deduped by `idem` (smallest (time, id) wins), sorted by (time, id).
    pub entries: Vec<Envelope>,
    pub quarantined: Vec<QuarantineRecord>,
    /// Entries with a format newer than this reader — skipped and counted,
    /// never quarantined (they are not corruption; spec §1).
    pub future_format: usize,
}

pub struct Ledger {
    dir: PathBuf,
    writer: WriterId,
    max_segment_bytes: u64,
}

impl Ledger {
    pub fn new(dir: PathBuf, writer: WriterId) -> Self {
        Self {
            dir,
            writer,
            max_segment_bytes: MAX_SEGMENT_BYTES,
        }
    }

    pub fn with_max_segment_bytes(dir: PathBuf, writer: WriterId, max: u64) -> Self {
        Self {
            dir,
            writer,
            max_segment_bytes: max,
        }
    }

    /// The segment the next append lands in: the HIGHEST existing suffix
    /// (never an earlier gap — a branch merge can leave holes, and
    /// reusing one would interleave old and new history in odd file
    /// order; audit R18), advancing once the size threshold is crossed.
    fn active_segment(&self) -> PathBuf {
        let stem = writer_file_stem(&self.writer);
        // True max-suffix discovery by LISTING (audit A-M8): gaps of any
        // width (branch-pruned segments) can never cause suffix reuse.
        let mut highest = 0u32;
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let Some(rest) = name.strip_prefix(&stem) else {
                    continue;
                };
                let n = match rest
                    .strip_prefix('-')
                    .and_then(|r| r.strip_suffix(".jsonl"))
                {
                    Some(num) => num.parse::<u32>().ok(),
                    None if rest == ".jsonl" => Some(0),
                    None => None,
                };
                if let Some(n) = n {
                    highest = highest.max(n);
                }
            }
        }
        let path = self.segment_path(&stem, highest);
        match fs::metadata(&path) {
            Ok(meta) if meta.len() >= self.max_segment_bytes => {
                self.segment_path(&stem, highest + 1)
            }
            _ => path,
        }
    }

    fn segment_path(&self, stem: &str, n: u32) -> PathBuf {
        if n == 0 {
            self.dir.join(format!("{stem}.jsonl"))
        } else {
            self.dir.join(format!("{stem}-{n:03}.jsonl"))
        }
    }

    pub fn active_segment_path_for_test(&self) -> PathBuf {
        self.active_segment()
    }

    /// Append one entry: mkdir -p, terminate a torn tail, single write of
    /// one line, fsync (spec §5.2).
    pub fn append(&self, entry: &Envelope) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| format!("ledger mkdir failed: {e}"))?;
        let path = self.active_segment();
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > 0 && !file_ends_with_newline(&path)? {
                let mut f = fs::OpenOptions::new()
                    .append(true)
                    .open(&path)
                    .map_err(|e| format!("ledger open failed: {e}"))?;
                f.write_all(b"\n")
                    .map_err(|e| format!("tail termination failed: {e}"))?;
            }
        }
        let mut line =
            serde_json::to_string(entry).map_err(|e| format!("serialize failed: {e}"))?;
        line.push('\n');
        // Writer cap matched to the reader cap (7th-review): `read_all` quarantines
        // any line over MAX_LINE_BYTES, so writing one would silently lose an entry
        // the caller was told succeeded. Refuse loudly instead. The reader accepts
        // exactly-MAX (it compares with `>`), so nothing writable is unreadable.
        if line.len() > MAX_LINE_BYTES {
            return Err(format!(
                "entry is {} bytes, over the {MAX_LINE_BYTES}-byte ledger line cap — refusing to write an entry the reader would quarantine",
                line.len()
            ));
        }
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("ledger open failed: {e}"))?;
        f.write_all(line.as_bytes())
            .map_err(|e| format!("ledger append failed: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("ledger fsync failed: {e}"))?;
        Ok(())
    }

    /// A cheap identity of the ledger's on-disk state (R1 O(1) reconcile): the
    /// sorted `(segment, byte-len, mtime-nanos)` of every segment. It changes on
    /// any append (len grows), rotation/new writer (new name), or a git checkout
    /// that swaps history (mtime moves — git never preserves mtime). `with_write_lock`
    /// compares it to what the index last reflected and rebuilds ONLY on a change,
    /// so a single-process accept stays O(1) instead of rebuilding the whole index
    /// on every acquire (7th-review 6R-5). A missing dir is the empty fingerprint.
    pub fn fingerprint(&self) -> Result<LedgerFingerprint, String> {
        let mut fp: LedgerFingerprint = Vec::new();
        let entries = match fs::read_dir(&self.dir) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(fp),
            Err(e) => return Err(format!("ledger dir unreadable: {e}")),
        };
        for entry in entries {
            let entry = entry.map_err(|e| format!("ledger dir entry unreadable: {e}"))?;
            let path = entry.path();
            if path.extension().is_some_and(|x| x == "jsonl") {
                let meta = entry
                    .metadata()
                    .map_err(|e| format!("segment stat failed: {e}"))?;
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                let name = entry.file_name().to_string_lossy().into_owned();
                fp.push((name, meta.len(), mtime));
            }
        }
        fp.sort();
        Ok(fp)
    }

    /// Merge every segment in the ledger directory (spec §5.1/§5.6).
    pub fn read_all(&self) -> Result<LedgerRead, String> {
        let mut read = LedgerRead::default();
        let dir_entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            // Only a MISSING ledger dir is an empty history; permission
            // or IO failures must surface, or a rebuild could wipe the
            // derived index of visible history (audit R8).
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(read),
            Err(e) => return Err(format!("ledger dir unreadable: {e}")),
        };
        let mut raw: Vec<Envelope> = Vec::new();
        let mut segments: Vec<PathBuf> = Vec::new();
        for entry in dir_entries {
            // Iterator errors surface (audit A13): silently skipping a
            // segment would let a rebuild wipe its visible history.
            let entry = entry.map_err(|e| format!("ledger dir entry unreadable: {e}"))?;
            let path = entry.path();
            if path.extension().is_some_and(|x| x == "jsonl") {
                segments.push(path);
            }
        }
        segments.sort();
        for seg in segments {
            let seg_name = seg
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Stream the segment line-by-line with a per-line memory cap (#3), so
            // no single line — however large or hostile — is read whole into RAM.
            let file = match fs::File::open(&seg) {
                Ok(f) => f,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(format!("segment read failed ({seg_name}): {e}")),
            };
            let mut reader = BufReader::new(file);
            let mut buf = Vec::new();
            let mut line_no = 0usize;
            loop {
                line_no += 1;
                match read_capped_line(&mut reader, &mut buf, MAX_LINE_BYTES)
                    .map_err(|e| format!("segment read failed ({seg_name}): {e}"))?
                {
                    CappedLine::Eof => break,
                    CappedLine::Oversized => {
                        let reason = format!("line exceeds the {MAX_LINE_BYTES}-byte cap");
                        self.quarantine(&seg_name, line_no, b"<oversized line elided>", &reason);
                        read.quarantined.push(QuarantineRecord {
                            segment: seg_name.clone(),
                            line: line_no,
                            reason,
                        });
                    }
                    CappedLine::Line => {
                        if buf.is_empty() {
                            continue;
                        }
                        match parse_line(&buf) {
                            LineOutcome::Entry(env) => raw.push(env),
                            LineOutcome::FutureFormat => read.future_format += 1,
                            LineOutcome::Malformed(reason) => {
                                self.quarantine(&seg_name, line_no, &buf, &reason);
                                read.quarantined.push(QuarantineRecord {
                                    segment: seg_name.clone(),
                                    line: line_no,
                                    reason,
                                });
                            }
                        }
                    }
                }
            }
        }
        // Dedupe by idem: smallest (time, id) wins (spec §5.1).
        raw.sort_by_key(|a| a.sort_key());
        let mut seen = std::collections::HashSet::new();
        read.entries = raw.into_iter().filter(|e| seen.insert(e.idem)).collect();
        Ok(read)
    }

    /// Copy a malformed line to quarantine, once per identical line.
    /// Failure here never fails the read (spec §5.6).
    fn quarantine(&self, segment: &str, line_no: usize, line: &[u8], reason: &str) {
        let qdir = self.dir.join("quarantine");
        if fs::create_dir_all(&qdir).is_err() {
            return;
        }
        let bad = qdir.join(format!("{segment}.bad"));
        let line_str = String::from_utf8_lossy(line);
        if let Ok(existing) = fs::read_to_string(&bad) {
            // Exact-line match (audit R24): substring containment could
            // conflate a line with a superset line.
            if existing.lines().any(|l| l == line_str.as_ref()) {
                return;
            }
        }
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&bad)
            .and_then(|mut f| {
                f.write_all(format!("# line {line_no}, {reason}\n{line_str}\n").as_bytes())
            });
    }
}

/// Outcome of one bounded line read.
enum CappedLine {
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
fn read_capped_line<R: BufRead>(
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

enum LineOutcome {
    Entry(Envelope),
    FutureFormat,
    Malformed(String),
}

fn parse_line(line: &[u8]) -> LineOutcome {
    let Ok(text) = std::str::from_utf8(line) else {
        return LineOutcome::Malformed("invalid UTF-8".into());
    };
    let env: Envelope = match serde_json::from_str(text) {
        Ok(e) => e,
        Err(e) => return LineOutcome::Malformed(format!("invalid entry: {e}")),
    };
    if env.format > FORMAT_VERSION {
        return LineOutcome::FutureFormat;
    }
    if env.sort_key().is_none() {
        return LineOutcome::Malformed("unparseable time".into());
    }
    match env.typed() {
        Ok(_) => LineOutcome::Entry(env),
        Err(e) => LineOutcome::Malformed(e),
    }
}

fn file_ends_with_newline(path: &Path) -> Result<bool, String> {
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

#[cfg(test)]
#[path = "ledger.test.rs"]
mod tests;
