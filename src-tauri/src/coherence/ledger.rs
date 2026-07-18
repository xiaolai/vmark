//! Ledger storage (ADR-C4 storage tier). Spec §5: per-writer append-only
//! JSONL segments, O_APPEND single-line writes + fsync, torn-tail
//! termination (G1 finding), mkdir-p before every append (S1 finding —
//! git prunes empty dirs), reader with quarantine and idem dedupe.
//!
//! I5: the public API is appends and reads only — there is no rewrite,
//! truncate, or delete operation, and `PUBLIC_API` in this file plus its
//! test lock that surface.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::types::{Envelope, WriterId, FORMAT_VERSION};

/// Spec §5.1 rotation threshold.
const MAX_SEGMENT_BYTES: u64 = 8 * 1024 * 1024;

/// I5 tripwire — every public method, mirrored by the test suite.
pub const PUBLIC_API: [&str; 5] =
    ["new", "with_max_segment_bytes", "append", "read_all", "active_segment_path_for_test"];

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
        Self { dir, writer, max_segment_bytes: MAX_SEGMENT_BYTES }
    }

    pub fn with_max_segment_bytes(dir: PathBuf, writer: WriterId, max: u64) -> Self {
        Self { dir, writer, max_segment_bytes: max }
    }

    /// The segment the next append lands in: highest existing suffix for
    /// this writer, advancing when the size threshold is crossed.
    fn active_segment(&self) -> PathBuf {
        let stem = writer_file_stem(&self.writer);
        let mut n = 0u32;
        loop {
            let path = self.segment_path(&stem, n);
            match fs::metadata(&path) {
                Ok(meta) if meta.len() >= self.max_segment_bytes => n += 1,
                _ => return path,
            }
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
                f.write_all(b"\n").map_err(|e| format!("tail termination failed: {e}"))?;
            }
        }
        let mut line = serde_json::to_string(entry).map_err(|e| format!("serialize failed: {e}"))?;
        line.push('\n');
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("ledger open failed: {e}"))?;
        f.write_all(line.as_bytes()).map_err(|e| format!("ledger append failed: {e}"))?;
        f.sync_all().map_err(|e| format!("ledger fsync failed: {e}"))?;
        Ok(())
    }

    /// Merge every segment in the ledger directory (spec §5.1/§5.6).
    pub fn read_all(&self) -> Result<LedgerRead, String> {
        let mut read = LedgerRead::default();
        let Ok(dir_entries) = fs::read_dir(&self.dir) else {
            return Ok(read); // no ledger yet = empty history
        };
        let mut raw: Vec<Envelope> = Vec::new();
        let mut segments: Vec<PathBuf> = dir_entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
            .collect();
        segments.sort();
        for seg in segments {
            let seg_name = seg.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let bytes = fs::read(&seg).map_err(|e| format!("segment read failed ({seg_name}): {e}"))?;
            for (i, line) in bytes.split(|b| *b == b'\n').enumerate() {
                if line.is_empty() {
                    continue;
                }
                match parse_line(line) {
                    LineOutcome::Entry(env) => raw.push(env),
                    LineOutcome::FutureFormat => read.future_format += 1,
                    LineOutcome::Malformed(reason) => {
                        self.quarantine(&seg_name, i + 1, line, &reason);
                        read.quarantined.push(QuarantineRecord { segment: seg_name.clone(), line: i + 1, reason });
                    }
                }
            }
        }
        // Dedupe by idem: smallest (time, id) wins (spec §5.1).
        raw.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
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
            if existing.contains(line_str.as_ref()) {
                return;
            }
        }
        let _ = fs::OpenOptions::new().create(true).append(true).open(&bad).and_then(|mut f| {
            f.write_all(format!("# line {line_no}, {reason}\n{line_str}\n").as_bytes())
        });
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
    f.seek(SeekFrom::End(-1)).map_err(|e| format!("seek failed: {e}"))?;
    let mut buf = [0u8; 1];
    f.read_exact(&mut buf).map_err(|e| format!("read failed: {e}"))?;
    Ok(buf[0] == b'\n')
}

#[cfg(test)]
#[path = "ledger.test.rs"]
mod tests;
