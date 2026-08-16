//! `PageSpec` — the page geometry the frontend sends, in points.
//!
//! Purpose: Windows and Linux ignore `@page { size }` entirely (ADR-PDF1), so
//! the size the user chose has to arrive as data. Measured with no API
//! geometry supplied at all, Windows emits US Letter and Linux emits A4 —
//! neither reads the stylesheet.
//!
//! Key decisions:
//!   - **Orientation is already applied.** Landscape is a width/height swap
//!     performed by the caller, not a flag: Windows ignored
//!     `COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE` while explicit width and
//!     height were set (ADR-PDF1a).
//!   - **No margins.** Measured as CSS-driven on both platforms; a margin
//!     field here would read as authoritative and change nothing.
//!   - **Validated at the boundary.** A non-finite or absurd value reaching a
//!     native print API is a crash or a silently wrong document, and this is
//!     an IPC edge — zero trust applies.
//!
//! @coordinates-with src/export/pageSpec.ts — builds this
//! @module pdf_export/page_spec

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

/// Smallest sane page: below this nothing renders usefully.
const MIN_PT: f64 = 72.0; // 1 inch
/// Largest sane page. PDF's own ceiling is 14 400pt (200in); anything near it
/// is a bad unit conversion rather than a real page.
const MAX_PT: f64 = 14_400.0;

/// Page geometry in PostScript points, orientation already applied.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSpec {
    pub width_pt: f64,
    pub height_pt: f64,
}

impl PageSpec {
    /// Reject geometry a native print API cannot honour.
    ///
    /// `is_finite` is the load-bearing check: `NaN` fails every comparison, so
    /// a range test alone would let it through and hand `NaN` to WebView2.
    pub fn validate(&self) -> Result<(), CommandError> {
        for (name, v) in [("width", self.width_pt), ("height", self.height_pt)] {
            if !v.is_finite() || !(MIN_PT..=MAX_PT).contains(&v) {
                return Err(localized_error!(
                    ErrorCode::InvalidInput,
                    "errors.pdf.invalidPageSize",
                    axis = name,
                    value = format!("{v}")
                ));
            }
        }
        Ok(())
    }

    /// Width and height in inches — the unit WebView2's print settings take.
    ///
    /// Unused in the library build until WI-PDF2.1 calls it; the conversion is
    /// written and tested now because it is where a wrong page size would come
    /// from, and a units bug is far cheaper to catch here than through a
    /// remote render loop. `page_spec.test.rs` exercises it.
    #[allow(dead_code)]
    pub fn inches(&self) -> (f64, f64) {
        (self.width_pt / 72.0, self.height_pt / 72.0)
    }
}

#[cfg(test)]
#[path = "page_spec.test.rs"]
mod tests;
