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
//! @coordinates-with main.rs — the only consumer
//! @module bin/pdf_smoke/fixtures

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
