//! Ledger storage (ADR-C4 storage tier). Spec §5: per-writer append-only
//! JSONL segments, O_APPEND single-line writes + fsync, torn-tail
//! termination (G1 finding), mkdir-p before every append (S1 finding —
//! git prunes empty dirs), reader with quarantine and idem dedupe.
//!
//! I5: the public API is appends and reads only — there is no rewrite,
//! truncate, or delete operation, and `PUBLIC_API` in this file plus its
//! test lock that surface.

use std::fs;
use std::io::{BufReader, Write};
use std::path::PathBuf;

use super::types::{Envelope, WriterId};

// Line framing/parsing moved to `ledger_lines.rs` for the file-size split.
use super::ledger_lines::{
    file_ends_with_newline, fsync_dir, parse_line, read_capped_line, CappedLine, LineOutcome,
};

/// Spec §5.1 rotation threshold.
const MAX_SEGMENT_BYTES: u64 = 8 * 1024 * 1024;

/// Per-line read cap (re-review #3): `read_all` streams each segment line with
/// this bound, so a single pathological or hostile line — an externally
/// corrupted ledger, or an entry from a build whose field caps this one does not
/// share — is quarantined instead of read whole into memory. The cap sits far
/// above any legal entry this build writes, so it never fires in normal use;
/// it is a memory-safety backstop, not a format rule.
///
/// (It formerly cited the group-commit `MAX_PREPARE_BYTES` prepare as the
/// largest legal line. That subsystem was severed — see
/// dev-docs/plans/20260806-coherence-runtime-landing.md — but the backstop is
/// independent of it and is deliberately unchanged: lowering a read cap because
/// today's writers are smaller would weaken the hostile-input guarantee.)
pub(super) const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

/// I5 tripwire — every public method, mirrored by the test suite.
pub const PUBLIC_API: [&str; 5] = [
    "new",
    "with_max_segment_bytes",
    "append",
    "read_all",
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
    // `pub(super)` because this inherent impl is split across `ledger.rs` and
    // `ledger_segments.rs` — the same pattern `CoherenceIndex` and
    // `WorkspaceKernel` already use. Visibility stops at `coherence`.
    pub(super) dir: PathBuf,
    pub(super) writer: WriterId,
    pub(super) max_segment_bytes: u64,
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

    /// Append one entry: mkdir -p, terminate a torn tail, single write of
    /// one line, fsync (spec §5.2).
    pub fn append(&self, entry: &Envelope) -> Result<(), String> {
        // Durability of the DIRECTORY ENTRY, not just the file bytes (G-B
        // re-review 03 C1): fsyncing the segment file persists its contents, but
        // a brand-new or rotated segment's *link* in its directory — and a
        // freshly (re)created ledger dir's link in its parent — is not durable
        // until the directory itself is fsynced. Without this, a power loss can
        // lose an acknowledged append into a new segment — and every first write
        // after a rotation, or into a freshly created ledger dir, is exactly
        // such an append.
        let dir_is_new = !self.dir.exists();
        fs::create_dir_all(&self.dir).map_err(|e| format!("ledger mkdir failed: {e}"))?;
        let path = self.active_segment();
        let seg_is_new = !path.exists();
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
        // fsync the directory holding a NEWLY created segment so its dir entry is
        // durable; and the parent of a newly created ledger dir. Only on creation
        // — an existing file's link is already durable, so the steady-state append
        // pays no extra fsync (§10 append budget).
        if seg_is_new {
            fsync_dir(&self.dir)?;
        }
        if dir_is_new {
            if let Some(parent) = self.dir.parent() {
                fsync_dir(parent)?;
            }
        }
        Ok(())
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

#[cfg(test)]
#[path = "ledger.test.rs"]
mod tests;
