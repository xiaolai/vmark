//! One-shot mode: render a SUPPLIED HTML file at six page geometries (three
//! paper sizes, portrait and landscape), with the dialog's default margins, for
//! visual QA.
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

/// The dialog's default margin, 25.4mm in points.
const MARGIN_PT: f64 = 72.0;

/// Portrait geometries in points, matching the dialog's page-size list.
const SIZES: [(&str, f64, f64); 3] = [
    ("a4", 595.28, 841.89),
    ("letter", 612.0, 792.0),
    ("a5", 419.53, 595.28),
];

/// Rewrite the export's `max-height` bound to match `page`.
///
/// Production computes that bound from the SAME options that build the
/// `PageSpec`, so it is always right there. A captured document carries the
/// bound for the size it was exported at, and reusing it at another geometry
/// leaves an A4 bound on an A5 sheet — which is not a harmless mismatch: the
/// image then exceeds the content area and spans three or four pages, making
/// the harness look like a product bug. Observed exactly that before this
/// existed.
fn retarget_fit(html: &str, page: PageSpec) -> String {
    // Both spellings: WebKit honours max-block-size and ignores max-height, so
    // rewriting only the physical one leaves the logical bound at the captured
    // geometry and the figure overflows a smaller sheet.
    let html = &retarget_prop(html, page, "max-block-size: ");
    retarget_prop(html, page, "max-height: ")
}

fn retarget_prop(html: &str, page: PageSpec, prop: &str) -> String {
    let usable_mm = (page.height_pt * 25.4 / 72.0)
        - (page.margin_top_pt.unwrap_or(0.0) + page.margin_bottom_pt.unwrap_or(0.0)) * 25.4 / 72.0
        - 4.0;
    let usable_mm = (usable_mm * 0.92).max(20.0);
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.find(prop) {
        let after = &rest[i + prop.len()..];
        let Some(end) = after.find("mm") else {
            out.push_str(&rest[..i + prop.len()]);
            rest = after;
            continue;
        };
        if after[..end].parse::<f64>().is_ok() {
            out.push_str(&rest[..i]);
            out.push_str(&format!("{prop}{usable_mm:.2}mm"));
            rest = &after[end + 2..];
        } else {
            out.push_str(&rest[..i + prop.len()]);
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// Rewrite the captured document's `@page { size: ... }` to match `page`.
///
/// Production regenerates that rule and the `PageSpec` from the SAME options
/// (`PdfExportDialog`), so the two always agree. A captured document carries
/// whatever it was exported as — reusing it at another geometry without this
/// creates a disagreement the app cannot produce.
///
/// That disagreement is not benign, which is why this is a rewrite and not a
/// convenience: measured on Windows, a document declaring `size: A4 portrait`
/// rendered 595x842 even though the API was given 842x595. The CSS page box
/// owns ORIENTATION (Chromium documents `landscape` as ignored whenever `@page`
/// is present); the API owns the paper. Explicit `pt` lengths encode both, so
/// after this the two cannot disagree.
fn retarget(html: &str, page: PageSpec) -> String {
    let html = &retarget_fit(html, page);
    let Some(start) = html.find("@page") else {
        return html.to_string();
    };
    let Some(open) = html[start..].find('{').map(|i| start + i) else {
        return html.to_string();
    };
    let Some(close) = html[open..].find('}').map(|i| open + i) else {
        return html.to_string();
    };
    let block = &html[open + 1..close];
    let rewritten: Vec<String> = block
        .split(';')
        .filter(|d| !d.trim().is_empty())
        .map(|d| {
            if d.trim_start().starts_with("size") {
                format!("size: {}pt {}pt", page.width_pt, page.height_pt)
            } else {
                d.trim().to_string()
            }
        })
        .collect();
    format!(
        "{}{{{}}}{}",
        &html[..open],
        rewritten.join("; "),
        &html[close + 1..]
    )
}

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
            // Match the captured document's CSS margins (25.4mm = 72pt), so
            // the artifact shows what a real export produces on each platform.
            let mut page = if landscape {
                PageSpec::new(h, w)
            } else {
                PageSpec::new(w, h)
            };
            page.margin_top_pt = Some(MARGIN_PT);
            page.margin_right_pt = Some(MARGIN_PT);
            page.margin_bottom_pt = Some(MARGIN_PT);
            page.margin_left_pt = Some(MARGIN_PT);
            let label = format!("{name}{}", if landscape { "-landscape" } else { "" });
            let path = out.join(format!("showcase-{label}.pdf"));
            let result = super::render(app, &retarget(&html, page), &path, page).await;
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
