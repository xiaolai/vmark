//! What a page number says, and where on the sheet it goes.
//!
//! Purpose: the half of page numbering that involves no PDF at all — the
//! request the dialog sends, the text for one page, its measured width, and the
//! baseline coordinate. Split from the stamping so the arithmetic is testable
//! without building a document, the same way `outline_match`/`outline_tree` sit
//! beneath `outline.rs`.
//!
//! **Base-14 fonts are Latin-1 only.** Helvetica is guaranteed present in every
//! PDF viewer with no embedding, which is what keeps this cheap — but it cannot
//! render CJK at all. A localized "第 7 頁，共 12 頁" would come out blank or as
//! mojibake, so a label that will not encode falls back to the numeric form,
//! which is ASCII and always drawable. See `render_label`.
//!
//! @coordinates-with page_numbers.rs — the stamping that consumes all of this
//! @module pdf_export/page_numbers_label

use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

/// Where the number sits on the page.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Position {
    None,
    BottomCenter,
    BottomRight,
}

/// How the number reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Format {
    /// `7`
    Plain,
    /// `7 / 12`
    WithTotal,
    /// The caller's localized template, e.g. `Page 7 of 12`.
    Verbose,
}

/// What the export dialog asked for.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageNumberSpec {
    pub position: Position,
    pub format: Format,
    /// Leave the first page unnumbered — title pages conventionally are.
    pub skip_first: bool,
    pub font_size_pt: f64,
    /// The page's bottom margin, so the number sits inside it rather than over
    /// the text.
    pub bottom_margin_pt: f64,
    /// The page's right margin, used to place `BottomRight`.
    pub side_margin_pt: f64,
    /// Localized template for `Format::Verbose`, with `{n}` and `{total}`.
    /// Substituted here rather than per-page in the frontend, which cannot know
    /// the page count until the render is done.
    pub verbose_template: String,
    /// Ink colour as three 0–1 components.
    ///
    /// Sent by the frontend rather than assumed here: `useEditorTheme` lets a
    /// dark theme reach the PDF, and a hardcoded black number on a dark page is
    /// invisible. Defaults to black so an older caller — or a test — that omits
    /// it keeps the previous behaviour.
    #[serde(default)]
    pub ink_rgb: InkRgb,
}

/// Three 0–1 colour components.
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize)]
pub struct InkRgb(pub [f64; 3]);

impl Default for InkRgb {
    fn default() -> Self {
        InkRgb([0.0, 0.0, 0.0])
    }
}

impl PageNumberSpec {
    /// Reject a spec that cannot produce a sane stamp.
    ///
    /// This crosses the IPC boundary as JSON, so the values are whatever the
    /// caller sent — `PageSpec` beside it is validated for exactly that reason.
    /// A NaN font size formats as the literal `NaN` in the `Tf` operator and
    /// yields a corrupt content stream; a negative one is accepted by some
    /// viewers and mirrors the text. The upper bounds are generous — this is a
    /// guard against nonsense, not a style policy.
    pub fn validate(&self) -> Result<(), CommandError> {
        if !self.font_size_pt.is_finite() || !(1.0..=200.0).contains(&self.font_size_pt) {
            return Err(localized_error!(
                ErrorCode::InvalidInput,
                "errors.pdf.invalidPageNumberSpec",
                field = "fontSizePt",
                value = format!("{}", self.font_size_pt)
            ));
        }
        for (i, c) in self.ink_rgb.0.iter().enumerate() {
            if !c.is_finite() || !(0.0..=1.0).contains(c) {
                return Err(localized_error!(
                    ErrorCode::InvalidInput,
                    "errors.pdf.invalidPageNumberSpec",
                    field = format!("inkRgb[{i}]"),
                    value = format!("{c}")
                ));
            }
        }
        for (field, v) in [
            ("bottomMarginPt", self.bottom_margin_pt),
            ("sideMarginPt", self.side_margin_pt),
        ] {
            // Zero is legitimate — `baseline` has a floor for exactly that — but
            // negative or non-finite is not.
            if !v.is_finite() || !(0.0..=10_000.0).contains(&v) {
                return Err(localized_error!(
                    ErrorCode::InvalidInput,
                    "errors.pdf.invalidPageNumberSpec",
                    field = field,
                    value = format!("{v}")
                ));
            }
        }
        Ok(())
    }
}

/// Helvetica advance widths, in 1/1000 em, for the characters a page number can
/// contain. Exact for the numeric formats, which is what centring needs.
fn advance(c: char) -> f64 {
    match c {
        '0'..='9' => 556.0,
        ' ' => 278.0,
        '/' => 278.0,
        '-' | '\u{2013}' => 556.0,
        '.' | ',' => 278.0,
        'i' | 'l' | 'j' | 'I' => 222.0,
        'f' | 't' | 'r' => 278.0,
        'm' | 'M' | 'W' | 'w' => 833.0,
        'A'..='Z' => 667.0,
        _ => 556.0,
    }
}

/// Text width in points at `size`.
pub(super) fn text_width(s: &str, size: f64) -> f64 {
    s.chars().map(advance).sum::<f64>() / 1000.0 * size
}

/// The label for one page, and whether the requested form had to be replaced.
///
/// WinAnsi covers Latin-1; anything beyond it — a CJK or Cyrillic verbose
/// template — would draw as blanks or wrong glyphs. Such a label is replaced by
/// the numeric form, which is ASCII and therefore always drawable, so a reader
/// in those languages still gets page numbers.
///
/// Leaving the page BARE was the first attempt and it was worse: a Chinese,
/// Japanese or Korean user who chose the verbose format got a PDF with no page
/// numbers anywhere and an export that reported success. Numbers in a plainer
/// form beat no numbers.
pub(super) fn render_label(spec: &PageNumberSpec, n: usize, total: usize) -> (String, bool) {
    let numeric = format!("{n} / {total}");
    let label = match spec.format {
        Format::Plain => n.to_string(),
        Format::WithTotal => numeric.clone(),
        // A template with no `{n}` cannot produce a page NUMBER — it would
        // stamp the same static text on all of them, or nothing at all if it is
        // empty. Treated as unusable for the same reason a CJK one is, rather
        // than rejected: refusing the whole export over a translation typo
        // would lose the document the user just waited for.
        Format::Verbose if spec.verbose_template.contains("{n}") => spec
            .verbose_template
            .replace("{n}", &n.to_string())
            .replace("{total}", &total.to_string()),
        Format::Verbose => return (numeric, true),
    };
    if is_winansi(&label) {
        (label, false)
    } else {
        // Only the verbose form can reach here — the other two are digits,
        // spaces and a slash.
        (numeric, true)
    }
}

/// Can the base-14 Helvetica WinAnsi encoding represent every character?
fn is_winansi(s: &str) -> bool {
    s.chars().all(|c| (c as u32) <= 0xFF)
}

/// Escape a PDF literal string.
pub(super) fn escape(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() + 4);
    for c in s.chars() {
        match c {
            '(' | ')' | '\\' => {
                out.push(b'\\');
                out.push(c as u8);
            }
            // Already filtered to Latin-1 by render_label.
            c => out.push(c as u8),
        }
    }
    out
}

/// Baseline position for a label of `width` on a page of `page_width`.
///
/// Vertically centred within the bottom margin band, with a floor so a
/// zero-margin export still puts the number on the paper rather than off it.
pub(super) fn baseline(spec: &PageNumberSpec, page_width: f64, width: f64) -> (f64, f64) {
    let y = (spec.bottom_margin_pt / 2.0 - spec.font_size_pt / 2.0).max(6.0);
    let x = match spec.position {
        Position::BottomRight => (page_width - spec.side_margin_pt - width).max(0.0),
        // None never reaches here; centre is the sane default if it does.
        _ => ((page_width - width) / 2.0).max(0.0),
    };
    (x, y)
}

#[cfg(test)]
#[path = "page_numbers_label.test.rs"]
mod tests;
