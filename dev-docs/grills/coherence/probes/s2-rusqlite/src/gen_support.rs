// Support types for the generator: stats, rotating segment writer,
// and the synthetic distributions (revision counts, input fan-in).

use crate::model::*;
use crate::rng::Rng;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

pub struct GenStats {
    pub gen_ms: u128,
    pub entries: usize,
    pub txf: usize,
    pub root_txf: usize,
    pub edges_total: usize,
    pub edges_direct: usize,
    pub nav: usize,
    pub ratifications: usize,
    pub waivers: usize,
    pub check_results: usize,
    pub segments: usize,
    pub ledger_bytes: u64,
    pub rev_p50: u64,
    pub rev_p95: u64,
    pub rev_max: u64,
    pub multi_head_objects: usize,
}

/// Per-writer JSONL segment with spec §5.1 8 MiB rotation
/// (`<writer>.jsonl`, then `<writer>-NNN.jsonl`).
pub struct SegWriter {
    dir: PathBuf,
    writer_id: String,
    part: u32,
    pub out: BufWriter<File>,
    part_bytes: u64,
    pub total_bytes: u64,
    pub files: usize,
}

impl SegWriter {
    pub fn new(dir: &Path, writer_id: String) -> Self {
        let path = dir.join(format!("{writer_id}.jsonl"));
        let out = BufWriter::new(File::create(&path).unwrap());
        SegWriter { dir: dir.to_path_buf(), writer_id, part: 0, out, part_bytes: 0, total_bytes: 0, files: 1 }
    }

    pub fn append(&mut self, line: &str) {
        if self.part_bytes >= SEG_ROTATE_BYTES {
            self.out.flush().unwrap();
            self.part += 1;
            let path = self.dir.join(format!("{}-{:03}.jsonl", self.writer_id, self.part));
            self.out = BufWriter::new(File::create(&path).unwrap());
            self.part_bytes = 0;
            self.files += 1;
        }
        self.out.write_all(line.as_bytes()).unwrap();
        self.out.write_all(b"\n").unwrap();
        let n = line.len() as u64 + 1;
        self.part_bytes += n;
        self.total_bytes += n;
    }
}

pub fn ensure_dir(p: &Path) {
    fs::create_dir_all(p).unwrap();
}

/// Capped power-law revision counts summing exactly to N_TXF (p95 <= REV_CAP).
pub fn revision_counts() -> Vec<u64> {
    let target = N_TXF as u64;
    let weight = |i: usize, c: f64| -> u64 {
        ((c * ((i + 1) as f64).powf(-ZIPF_REV_EXP)).round() as u64).clamp(1, REV_CAP)
    };
    let sum_for = |c: f64| -> u64 { (0..N_OBJECTS).map(|i| weight(i, c)).sum() };
    let (mut lo, mut hi) = (1.0f64, 1e9f64);
    for _ in 0..80 {
        let mid = (lo + hi) / 2.0;
        if sum_for(mid) < target { lo = mid } else { hi = mid }
    }
    let mut counts: Vec<u64> = (0..N_OBJECTS).map(|i| weight(i, hi)).collect();
    let mut sum: u64 = counts.iter().sum();
    let mut i = N_OBJECTS - 1;
    while sum != target {
        if sum < target && counts[i] < REV_CAP {
            counts[i] += 1;
            sum += 1;
        } else if sum > target && counts[i] > 1 {
            counts[i] -= 1;
            sum -= 1;
        }
        i = if i == 0 { N_OBJECTS - 1 } else { i - 1 };
    }
    counts
}

/// Total inputs per non-root transformation; mean ~2.57 -> ~500k edges.
pub fn sample_k(rng: &mut Rng) -> usize {
    let r = rng.f64();
    if r < 0.20 { 1 } else if r < 0.52 { 2 } else if r < 0.79 { 3 } else if r < 0.92 { 4 } else { 5 }
}
