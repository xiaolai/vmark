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
pub const PUBLIC_API: [&str; 6] = [
    "new",
    "with_max_segment_bytes",
    "append",
    "read_all",
    "raw_entry_count",
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

    /// Cheap upper-bound entry count: non-empty newline-terminated lines across
    /// all segments, WITHOUT JSON parse / dedupe / sort. `raw_entry_count() >=`
    /// the index's applied idem count always holds (dupes, quarantine,
    /// future-format, and un-applied torn tails only *add* lines), so equality
    /// with `applied_count()` proves the index is caught up — the heal-on-open
    /// fast path (design-accept-consistency Fix A). Read-only (I5): counts
    /// bytes, never mutates history.
    pub fn raw_entry_count(&self) -> Result<usize, String> {
        let dir_entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(format!("ledger dir unreadable: {e}")),
        };
        let mut count = 0usize;
        for entry in dir_entries {
            let entry = entry.map_err(|e| format!("ledger dir entry unreadable: {e}"))?;
            let path = entry.path();
            if path.extension().is_some_and(|x| x == "jsonl") {
                let bytes = fs::read(&path).map_err(|e| format!("segment read failed: {e}"))?;
                count += bytes
                    .split(|b| *b == b'\n')
                    .filter(|l| !l.is_empty())
                    .count();
            }
        }
        Ok(count)
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
            let bytes =
                fs::read(&seg).map_err(|e| format!("segment read failed ({seg_name}): {e}"))?;
            for (i, line) in bytes.split(|b| *b == b'\n').enumerate() {
                if line.is_empty() {
                    continue;
                }
                match parse_line(line) {
                    LineOutcome::Entry(env) => raw.push(env),
                    LineOutcome::FutureFormat => read.future_format += 1,
                    LineOutcome::Malformed(reason) => {
                        self.quarantine(&seg_name, i + 1, line, &reason);
                        read.quarantined.push(QuarantineRecord {
                            segment: seg_name.clone(),
                            line: i + 1,
                            reason,
                        });
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
