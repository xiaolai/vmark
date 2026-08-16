//! PDF artifact verification for the smoke harness.
//!
//! Purpose: split from `main.rs` to stay under the size limit, and because
//! this is the part that decides pass/fail — it reads the produced PDF rather
//! than trusting the renderer's return value.
//!
//! A backend that ignores `PageSpec` still returns `Ok` and still writes a
//! valid `%PDF`, just at the platform default size. That is why every check
//! here extracts the MediaBox instead of asserting on magic bytes.
//!
//! @coordinates-with main.rs — the only consumer
//! @module bin/pdf_smoke/verify

use std::path::Path;

/// Verify the artifact, not the return value. Page size is extracted from the
/// PDF because a backend that ignores `PageSpec` still returns `Ok`.
pub fn check(
    name: &str,
    result: Result<(), String>,
    path: &Path,
    expect_pt: Option<(u32, u32)>,
) -> usize {
    if let Err(e) = result {
        println!("SMOKE {name} FAIL render error: {e}");
        return 1;
    }
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            println!("SMOKE {name} FAIL no artifact: {e}");
            return 1;
        }
    };
    if !bytes.starts_with(b"%PDF") {
        println!("SMOKE {name} FAIL not a PDF ({} bytes)", bytes.len());
        return 1;
    }
    let pages = count(&bytes, b"/Type /Page").max(count(&bytes, b"/Type/Page"));
    let size = media_box(&bytes);
    match (expect_pt, size) {
        (Some((w, h)), Some((gw, gh))) if gw.abs_diff(w) <= 2 && gh.abs_diff(h) <= 2 => {
            println!(
                "SMOKE {name} PASS {} bytes, pages~{pages}, {gw}x{gh}pt",
                bytes.len()
            );
            0
        }
        (Some((w, h)), Some((gw, gh))) => {
            println!("SMOKE {name} FAIL page size {gw}x{gh}pt, expected {w}x{h}pt");
            1
        }
        (Some(_), None) => {
            println!("SMOKE {name} FAIL no MediaBox found");
            1
        }
        (None, _) => {
            println!("SMOKE {name} PASS {} bytes", bytes.len());
            0
        }
    }
}

pub fn count(hay: &[u8], needle: &[u8]) -> usize {
    hay.windows(needle.len()).filter(|w| *w == needle).count()
}

/// First `/MediaBox [a b c d]`, rounded to whole points.
pub fn media_box(bytes: &[u8]) -> Option<(u32, u32)> {
    let tag = b"/MediaBox";
    let at = bytes.windows(tag.len()).position(|w| w == tag)?;
    let open = bytes[at..].iter().position(|&c| c == b'[')? + at + 1;
    let close = bytes[open..].iter().position(|&c| c == b']')? + open;
    let text = std::str::from_utf8(&bytes[open..close]).ok()?;
    let v: Vec<f64> = text
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    if v.len() != 4 {
        return None;
    }
    Some((
        ((v[2] - v[0]).round()) as u32,
        ((v[3] - v[1]).round()) as u32,
    ))
}
