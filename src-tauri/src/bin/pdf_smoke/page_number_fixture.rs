//! The page-number request both harness modes send, in one place.
//!
//! Purpose: `page_numbers_case` (fixture matrix) and `render_one` (real
//! document) each built their own `PageNumberSpec`, repeating the dialog's
//! `9.35` default font size, the 72pt margins and the verbose template. Two
//! copies of a default is how one harness quietly stops testing what the app
//! actually sends — and neither copy is wrong-looking on its own.
//!
//! These MIRROR the dialog (`buildPageNumberSpec` in `src/export/pdfOptions.ts`).
//! Change one and change the other; the numbers are stated here so the mirror is
//! visible rather than scattered.
//!
//! @coordinates-with src/export/pdfOptions.ts — the values this mirrors
//! @coordinates-with page_numbers_case.rs, render_one.rs — the two consumers
//! @module bin/pdf_smoke/page_number_fixture

use vmark_lib::pdf_export::page_numbers::{Format, PageNumberSpec, Position};
use vmark_lib::pdf_export::page_spec::PageSpec;

/// The dialog's default margin, 25.4mm in points.
pub const MARGIN_PT: f64 = 72.0;

/// The dialog's default page-number size: `max(7, fontSize 11 * 0.85)`.
const FONT_SIZE_PT: f64 = 9.35;

/// A page geometry carrying the dialog's default margins on all four sides.
pub fn with_default_margins(width_pt: f64, height_pt: f64) -> PageSpec {
    let mut page = PageSpec::new(width_pt, height_pt);
    page.margin_top_pt = Some(MARGIN_PT);
    page.margin_right_pt = Some(MARGIN_PT);
    page.margin_bottom_pt = Some(MARGIN_PT);
    page.margin_left_pt = Some(MARGIN_PT);
    page
}

/// A spec matching what the export dialog sends for these three choices.
pub fn spec(position: Position, format: Format, skip_first: bool) -> PageNumberSpec {
    PageNumberSpec {
        position,
        format,
        skip_first,
        font_size_pt: FONT_SIZE_PT,
        bottom_margin_pt: MARGIN_PT,
        side_margin_pt: MARGIN_PT,
        verbose_template: "Page {n} of {total}".to_string(),
        // Black: these fixtures render the light theme, which is also what the
        // dialog sends unless the export carries a dark editor theme.
        ink_rgb: Default::default(),
    }
}
