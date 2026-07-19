// Shared constants and identity/hash helpers.
// Constants mirror the spec §10 target scale (coherence-format-v0.md).

use sha2::{Digest, Sha256};

pub const N_OBJECTS: usize = 5_000;
pub const TOTAL_ENTRIES: usize = 200_000;
pub const N_NAV: usize = 400;
pub const N_RATIFY: usize = 200;
pub const N_WAIVE: usize = 150;
pub const N_CHECK: usize = 50;
/// Transformations = everything that is not one of the other kinds.
pub const N_TXF: usize = TOTAL_ENTRIES - N_NAV - N_RATIFY - N_WAIVE - N_CHECK;
/// Hard cap on revisions per object so p95 <= 500 holds by construction.
pub const REV_CAP: u64 = 500;
/// Zipf-ish exponent for revisions-per-object (most objects few, some hundreds).
pub const ZIPF_REV_EXP: f64 = 1.3;
/// Zipf-ish exponent for upstream-reference popularity.
pub const ZIPF_REF_EXP: f64 = 1.1;
pub const N_WRITERS: usize = 4;
/// Spec §5.1 segment rotation threshold.
pub const SEG_ROTATE_BYTES: u64 = 8 * 1024 * 1024;
/// Probability a non-root revision branches from an arbitrary earlier revision.
pub const P_BRANCH: f64 = 0.02;
/// Probability a multi-head object merges two heads.
pub const P_MERGE: f64 = 0.01;
/// Probability a non-self input is contextual rather than direct.
pub const P_CONTEXTUAL: f64 = 0.30;
/// §9.3: naive BFS is allowed up to this revision count; the index
/// materializes head-ancestry above it.
pub const ANC_MATERIALIZE_ABOVE: i64 = 64;

const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";

pub fn hex(bytes: &[u8]) -> String {
    let mut out = Vec::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX_CHARS[(b >> 4) as usize]);
        out.push(HEX_CHARS[(b & 15) as usize]);
    }
    String::from_utf8(out).unwrap()
}

pub fn sha256_hex(parts: &[&[u8]]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    hex(&h.finalize())
}

pub fn content_hash(seed: &[u8]) -> String {
    format!("sha256:{}", sha256_hex(&[seed]))
}

/// Spec §2.3: revision_id = "rev1:" + hex(SHA-256("vmark-rev\n" + content_hash
/// + "\n" + parent_1 + "\n" + ...)), parents sorted lexicographically.
pub fn revision_id(content_hash: &str, parents: &[String]) -> String {
    let mut sorted: Vec<&str> = parents.iter().map(|s| s.as_str()).collect();
    sorted.sort_unstable();
    let mut h = Sha256::new();
    h.update(b"vmark-rev\n");
    h.update(content_hash.as_bytes());
    h.update(b"\n");
    for p in &sorted {
        h.update(p.as_bytes());
        h.update(b"\n");
    }
    format!("rev1:{}", hex(&h.finalize()))
}

/// RFC 3339 UTC timestamp on a fixed synthetic day (all entries fit in one day).
pub fn rfc3339(ms_of_day: u64) -> String {
    let ms = ms_of_day % 1000;
    let s = (ms_of_day / 1000) % 60;
    let m = (ms_of_day / 60_000) % 60;
    let h = ms_of_day / 3_600_000;
    assert!(h < 24, "synthetic clock overflowed the day");
    format!("2026-07-18T{h:02}:{m:02}:{s:02}.{ms:03}Z")
}

/// Real UUIDv7 (time-ordered) as the spec requires for entry/object ids.
pub fn uuid_v7(ms_of_day: u64) -> String {
    let secs = 1_784_000_000u64 + ms_of_day / 1000;
    let nanos = ((ms_of_day % 1000) * 1_000_000) as u32;
    uuid::Uuid::new_v7(uuid::Timestamp::from_unix(uuid::NoContext, secs, nanos)).to_string()
}
