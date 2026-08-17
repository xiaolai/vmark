//! Does the page-number stamp survive each platform's own PDF?
//!
//! Purpose: `stamp_page_numbers` is pure lopdf and its unit tests run
//! identically everywhere, so they prove the arithmetic and nothing about the
//! documents it has to edit. The three engines emit different page trees —
//! `/Contents` as a lone stream or an array, `/Resources` direct, indirect, or
//! inherited from the `/Pages` node — and the stamp has a branch for each. A
//! branch that is wrong still produces a loadable PDF at the right size with an
//! empty footer, which is invisible to every other assertion in this harness.
//!
//! So this renders through the REAL backend and then reads the result back.
//!
//! @coordinates-with pdf_export::page_numbers — the code under test
//! @coordinates-with verify.rs — `check_stamped` does the reading back
//! @module bin/pdf_smoke/page_numbers_case

use std::path::Path;

use vmark_lib::pdf_export::page_numbers::{Format, Position};

use super::fixtures::doc_for;
use super::page_number_fixture::{spec, with_default_margins};
use super::verify::{check, check_stamped};

/// Render a multi-page document, stamp it, and read the numbers back.
/// Returns the failure count.
pub async fn run(app: &tauri::AppHandle, out: &Path) -> usize {
    // Four `.b` blocks at 180mm force several pages, so "every page is
    // stamped" is a claim with something to fail on. A one-page fixture would
    // pass even if the loop stamped only the first.
    let body = "<div class='b'>one</div><div class='b'>two</div>\
                <div class='b'>three</div><div class='b'>four</div>";
    let page = with_default_margins(595.28, 841.89);

    let mut failures = 0usize;
    for (label, position, format, skip_first) in [
        (
            "pageno-center",
            Position::BottomCenter,
            Format::WithTotal,
            false,
        ),
        // The other position, the other format, and the skip — one more render
        // for the branches a single case cannot reach.
        (
            "pageno-right-skip",
            Position::BottomRight,
            Format::Plain,
            true,
        ),
    ] {
        let path = out.join(format!("{label}.pdf"));
        let mut result = super::render(app, &doc_for("A4", body), &path, page).await;
        if result.is_ok() {
            if let Err(e) = vmark_lib::pdf_export::page_numbers::stamp_page_numbers(
                &path.to_string_lossy(),
                &spec(position, format, skip_first),
            ) {
                result = Err(format!("stamp: {e}"));
            }
        }
        let rendered = result.is_ok();
        failures += check(label, result, &path, Some((595, 842)));
        if rendered {
            failures += check_stamped(label, &path, skip_first);
        }
    }
    failures
}
