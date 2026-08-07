//! Which file a ledger append lands in: active-segment selection and segment
//! path construction.
//!
//! Split out of `ledger.rs` for size. Rotation policy is the one thing here —
//! `ledger.rs` keeps append/read, and `ledger_lines.rs` keeps byte framing.
//!
//! @coordinates-with ledger.rs — the append/read API that calls these
//! @module coherence/ledger_segments

use std::fs;
use std::path::PathBuf;

use super::ledger::{writer_file_stem, Ledger};

impl Ledger {
    /// The segment the next append lands in: the HIGHEST existing suffix
    /// (never an earlier gap — a branch merge can leave holes, and
    /// reusing one would interleave old and new history in odd file
    /// order; audit R18), advancing once the size threshold is crossed.
    pub(super) fn active_segment(&self) -> PathBuf {
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
    pub(super) fn segment_path(&self, stem: &str, n: u32) -> PathBuf {
        if n == 0 {
            self.dir.join(format!("{stem}.jsonl"))
        } else {
            self.dir.join(format!("{stem}-{n:03}.jsonl"))
        }
    }
    pub fn active_segment_path_for_test(&self) -> PathBuf {
        self.active_segment()
    }
}
