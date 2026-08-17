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

use vmark_lib::pdf_export::page_numbers::{Format, PageNumberSpec, Position};
use vmark_lib::pdf_export::page_spec::PageSpec;

use super::fixtures::doc_for;
use super::verify::{check, check_stamped};

/// A4 with the dialog's default 25.4mm margins, so the number has a band to sit
/// in rather than landing on the content.
fn a4_with_margins() -> PageSpec {
    let mut page = PageSpec::new(595.28, 841.89);
    page.margin_top_pt = Some(72.0);
    page.margin_right_pt = Some(72.0);
    page.margin_bottom_pt = Some(72.0);
    page.margin_left_pt = Some(72.0);
    page
}

fn spec(position: Position, format: Format, skip_first: bool) -> PageNumberSpec {
    PageNumberSpec {
        position,
        format,
        skip_first,
        font_size_pt: 9.35, // the dialog's default: max(7, 11 * 0.85)
        bottom_margin_pt: 72.0,
        side_margin_pt: 72.0,
        verbose_template: "Page {n} of {total}".to_string(),
    }
}

/// Render a multi-page document, stamp it, and read the numbers back.
/// Returns the failure count.
pub async fn run(app: &tauri::AppHandle, out: &Path) -> usize {
    // Four `.b` blocks at 180mm force several pages, so "every page is
    // stamped" is a claim with something to fail on. A one-page fixture would
    // pass even if the loop stamped only the first.
    let body = "<div class='b'>one</div><div class='b'>two</div>\
                <div class='b'>three</div><div class='b'>four</div>";
    let page = a4_with_margins();

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
