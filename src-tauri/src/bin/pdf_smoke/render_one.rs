//! One-shot mode: render a SUPPLIED HTML file at the four page geometries the
//! export dialog offers, for visual QA.
//!
//! Purpose: the matrix cases in `main.rs` assert geometry on trivial documents,
//! which proves the plumbing and says nothing about how a real document LOOKS.
//! This mode takes the exact HTML a real export produced — fonts and images
//! already inlined — and renders it unchanged on each platform, so the only
//! variable left is the engine.
//!
//! Run:
//!   cargo run --bin pdf_smoke --features pdf-smoke -- --html <file> <out-dir>
//!
//! Feeding it a reconstructed document is the trap this exists to avoid: a
//! rebuild that drops the embedded KaTeX woff2 fonts still renders, just with
//! fallback glyphs, and the artifact looks plausible while testing nothing.
//!
//! @coordinates-with main.rs — shares the `render` helper and the out-dir arg
//! @module bin/pdf_smoke/render_one

use std::path::{Path, PathBuf};

use vmark_lib::pdf_export::page_spec::PageSpec;

/// Split argv into the optional `--html <file>` source and the out-dir.
///
/// The out-dir is the first positional that is neither a flag nor the value
/// consumed by `--html`; without that second condition `--html x.html out/`
/// would take `x.html` as the out-dir and silently render into a directory
/// named after the source.
pub fn parse_args(args: Vec<String>) -> (Option<PathBuf>, PathBuf) {
    let html_idx = args.iter().position(|a| a == "--html").map(|i| i + 1);
    let one_shot = html_idx.and_then(|i| args.get(i)).map(PathBuf::from);
    let out_dir = args
        .iter()
        .enumerate()
        .skip(1)
        .find(|(i, a)| !a.starts_with("--") && Some(*i) != html_idx)
        .map(|(_, a)| PathBuf::from(a))
        .unwrap_or_else(std::env::temp_dir);
    (one_shot, out_dir)
}

/// Portrait geometries in points, matching the dialog's page-size list.
const SIZES: [(&str, f64, f64); 3] = [
    ("a4", 595.28, 841.89),
    ("letter", 612.0, 792.0),
    ("a5", 419.53, 595.28),
];

/// Render `html_path` once per geometry into `out`. Returns the failure count.
pub async fn run(app: &tauri::AppHandle, html_path: &Path, out: &Path) -> usize {
    let html = match std::fs::read_to_string(html_path) {
        Ok(h) => h,
        Err(e) => {
            println!("ONE read FAIL {} — {e}", html_path.display());
            return 1;
        }
    };
    println!("ONE source {} ({} bytes)", html_path.display(), html.len());

    let mut failures = 0usize;
    for (name, w, h) in SIZES {
        for landscape in [false, true] {
            // Landscape is a width/height swap, never a flag — ADR-PDF1a.
            let page = if landscape {
                PageSpec {
                    width_pt: h,
                    height_pt: w,
                }
            } else {
                PageSpec {
                    width_pt: w,
                    height_pt: h,
                }
            };
            let label = format!("{name}{}", if landscape { "-landscape" } else { "" });
            let path = out.join(format!("showcase-{label}.pdf"));
            let result = super::render(app, &html, &path, page).await;
            failures += super::verify::check(
                &label,
                result,
                &path,
                Some((page.width_pt.round() as u32, page.height_pt.round() as u32)),
            );
        }
    }
    failures
}
