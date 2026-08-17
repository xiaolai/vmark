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
//!   - **Margins: CSS on macOS and Windows, DATA on Linux.** The original
//!     "no margins" decision came from a probe that measured margins by PAGE
//!     COUNT — a signal blind to the horizontal axis, since left/right margins
//!     do not change how many pages a document needs. Rendering the real
//!     document and measuring the ink box showed Linux printing edge to edge
//!     on all four sides (0/4/4/0 pt against an expected 72). WebKitGTK's print
//!     path takes its page box from `GtkPageSetup`, which `linux.rs` was
//!     setting to zero on the strength of that probe. So margins now travel as
//!     data, and Linux is the only backend that reads them.
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
    /// Margins in points. `None` on a caller that predates them, which keeps
    /// the previous edge-to-edge behaviour rather than inventing a default.
    #[serde(default)]
    pub margin_top_pt: Option<f64>,
    #[serde(default)]
    pub margin_right_pt: Option<f64>,
    #[serde(default)]
    pub margin_bottom_pt: Option<f64>,
    #[serde(default)]
    pub margin_left_pt: Option<f64>,
}

impl PageSpec {
    /// Geometry with no margins — the shape every caller used before margins
    /// existed, and what the smoke fixtures still want.
    #[allow(dead_code)]
    pub const fn new(width_pt: f64, height_pt: f64) -> Self {
        Self {
            width_pt,
            height_pt,
            margin_top_pt: None,
            margin_right_pt: None,
            margin_bottom_pt: None,
            margin_left_pt: None,
        }
    }

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
        // Margins are optional, but a supplied one must be sane: negative or
        // non-finite reaches GTK directly, and a pair wider than the page
        // leaves no content area at all.
        for (name, m, extent) in [
            ("top", self.margin_top_pt, self.height_pt),
            ("bottom", self.margin_bottom_pt, self.height_pt),
            ("left", self.margin_left_pt, self.width_pt),
            ("right", self.margin_right_pt, self.width_pt),
        ] {
            if let Some(v) = m {
                if !v.is_finite() || v < 0.0 || v >= extent {
                    return Err(localized_error!(
                        ErrorCode::InvalidInput,
                        "errors.pdf.invalidPageSize",
                        axis = name,
                        value = format!("{v}")
                    ));
                }
            }
        }
        if self.margin_left_pt.unwrap_or(0.0) + self.margin_right_pt.unwrap_or(0.0) >= self.width_pt
            || self.margin_top_pt.unwrap_or(0.0) + self.margin_bottom_pt.unwrap_or(0.0)
                >= self.height_pt
        {
            return Err(localized_error!(
                ErrorCode::InvalidInput,
                "errors.pdf.invalidPageSize",
                axis = "margins",
                value = "exceed page".to_string()
            ));
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
