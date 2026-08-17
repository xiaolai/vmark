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
//! mojibake, so a label that will not encode is refused here rather than drawn
//! wrong. See `render_label`.
//!
//! @coordinates-with page_numbers.rs — the stamping that consumes all of this
//! @module pdf_export/page_numbers_label

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

/// The label for one page, and whether it can be drawn at all.
///
/// Returns `None` for a label Helvetica cannot represent. WinAnsi covers
/// Latin-1; anything beyond it — a CJK or Cyrillic template — would draw as
/// blanks or wrong glyphs, and a silently wrong footer on every page is worse
/// than leaving those pages unnumbered, which the caller reports.
pub(super) fn render_label(spec: &PageNumberSpec, n: usize, total: usize) -> Option<String> {
    let label = match spec.format {
        Format::Plain => n.to_string(),
        Format::WithTotal => format!("{n} / {total}"),
        Format::Verbose => spec
            .verbose_template
            .replace("{n}", &n.to_string())
            .replace("{total}", &total.to_string()),
    };
    if label.chars().all(|c| (c as u32) <= 0xFF) {
        Some(label)
    } else {
        None
    }
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
