//! Test documents for the smoke harness.
//!
//! Purpose: split from `main.rs` for the size limit. These are fixtures, not
//! flow — keeping them apart makes the harness read as a list of assertions.
//!
//! Both an `@page` rule AND a `PageSpec` are produced, because the three
//! platforms read different ones: macOS took its geometry from CSS until
//! WI-PDF1.4, while Windows and Linux ignore CSS and read the API. A fixture
//! carrying only one passes on some platforms and fails on others for reasons
//! that have nothing to do with the code — which is exactly what the first
//! run of this harness did.
//!
//! @coordinates-with scenarios.rs, progress_case.rs — the consumers
//! @module bin/pdf_smoke/fixtures

use vmark_lib::pdf_export::page_spec::PageSpec;

/// Every page size the harness renders, in points, portrait — each defined
/// ONCE, here (#108). Landscape is the swap, never a second constant
/// (ADR-PDF1a). `scenarios.rs` used to carry its own copy of A4's numbers
/// in its size matrix; two definitions of one fixture drift.
pub const A4: PageSpec = PageSpec::new(595.28, 841.89);
pub const A5: PageSpec = PageSpec::new(419.53, 595.28);
pub const A3: PageSpec = PageSpec::new(841.89, 1190.55);
pub const LETTER: PageSpec = PageSpec::new(612.0, 792.0);
pub const LEGAL: PageSpec = PageSpec::new(612.0, 1008.0);

/// The rounded point dimensions a `PageSpec` should show up as in the PDF's
/// MediaBox — DERIVED, never written out beside the spec (#108, audit 20260907
/// #258).
///
/// `geometry_matrix` already computed them this way; every other case wrote the
/// integers by hand, so A4's `(595, 842)` appeared at four sites and A5's at a
/// fifth. Retuning a constant here would have left those five asserting the old
/// paper and passing — the exact drift `A4` was made a single constant to end.
pub fn expected_pt(spec: PageSpec) -> Option<(u32, u32)> {
    Some((spec.width_pt.round() as u32, spec.height_pt.round() as u32))
}

/// Build the document the way production does: an `@page` rule carrying the
/// geometry AND the same geometry sent as `PageSpec`.
///
/// Both are required because the three platforms read different ones. macOS is
/// CSS-driven and ignores the spec; Windows and Linux ignore the CSS and read
/// the spec (ADR-PDF1a). A fixture with only one of them passes on some
/// platforms and fails on others for reasons that have nothing to do with the
/// code — which is exactly what the first run of this harness did.
pub fn doc_for(css_size: &str, body: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>\
         @page{{size:{css_size};margin:0}}\
         body{{font-family:serif;margin:0}}.b{{height:180mm}}</style></head>\
         <body>{body}</body></html>"
    )
}

/// A document guaranteed to exceed 2 MiB, with a sentinel AFTER the boundary
/// so a truncated load is distinguishable from a short one.
pub fn large_doc(css_size: &str) -> String {
    let filler = "x".repeat(2 * 1024 * 1024 + 64 * 1024);
    doc_for(
        css_size,
        &format!(
            "<p>start</p><div style=\"display:none\">{filler}</div><h1>SENTINEL-PAST-2MIB</h1>"
        ),
    )
}
