use super::*;

fn spec(position: Position, format: Format) -> PageNumberSpec {
    PageNumberSpec {
        position,
        format,
        skip_first: false,
        font_size_pt: 9.0,
        bottom_margin_pt: 72.0,
        side_margin_pt: 72.0,
        verbose_template: "Page {n} of {total}".to_string(),
    }
}

// --- label rendering ---

#[test]
fn plain_is_just_the_number() {
    assert_eq!(
        render_label(&spec(Position::BottomCenter, Format::Plain), 7, 12).unwrap(),
        "7"
    );
}

#[test]
fn with_total_reads_as_a_fraction() {
    assert_eq!(
        render_label(&spec(Position::BottomCenter, Format::WithTotal), 7, 12).unwrap(),
        "7 / 12"
    );
}

#[test]
fn verbose_substitutes_both_placeholders() {
    assert_eq!(
        render_label(&spec(Position::BottomCenter, Format::Verbose), 7, 12).unwrap(),
        "Page 7 of 12"
    );
}

#[test]
fn a_label_helvetica_cannot_draw_is_refused_rather_than_mangled() {
    // Base-14 Helvetica is Latin-1 only. Drawing a CJK template would emit
    // blanks or wrong glyphs on EVERY page — worse than leaving those pages
    // unnumbered, and silent.
    let mut s = spec(Position::BottomCenter, Format::Verbose);
    s.verbose_template = "第 {n} 頁，共 {total} 頁".to_string();
    assert_eq!(render_label(&s, 7, 12), None);
}

#[test]
fn a_latin1_accented_template_is_accepted() {
    // Within WinAnsi, so it draws correctly — the guard must not be
    // "ASCII only", which would refuse most European languages.
    let mut s = spec(Position::BottomCenter, Format::Verbose);
    s.verbose_template = "Página {n} de {total}".to_string();
    assert_eq!(render_label(&s, 2, 5).unwrap(), "Página 2 de 5");
}

// --- placement ---

#[test]
fn centred_text_is_actually_centred() {
    let s = spec(Position::BottomCenter, Format::Plain);
    let w = text_width("7", 9.0);
    let (x, _) = baseline(&s, 595.28, w);
    assert!((x - (595.28 - w) / 2.0).abs() < 0.01);
}

#[test]
fn right_aligned_text_sits_inside_the_margin() {
    let s = spec(Position::BottomRight, Format::WithTotal);
    let w = text_width("7 / 12", 9.0);
    let (x, _) = baseline(&s, 595.28, w);
    assert!(
        (x + w - (595.28 - 72.0)).abs() < 0.01,
        "right edge must meet the margin"
    );
}

#[test]
fn the_baseline_sits_within_the_bottom_margin_band() {
    let s = spec(Position::BottomCenter, Format::Plain);
    let (_, y) = baseline(&s, 595.28, 10.0);
    assert!(y > 0.0 && y < 72.0, "y={y} must be inside the 72pt band");
}

#[test]
fn a_zero_margin_export_still_puts_the_number_on_the_paper() {
    // Margins are user-settable and can be 0. Without a floor the baseline
    // computes negative and the number lands off the sheet.
    let mut s = spec(Position::BottomCenter, Format::Plain);
    s.bottom_margin_pt = 0.0;
    let (_, y) = baseline(&s, 595.28, 10.0);
    assert!(y >= 6.0, "y={y} must stay on the page");
}

#[test]
fn a_label_wider_than_the_page_is_clamped_to_the_edge() {
    let s = spec(Position::BottomCenter, Format::Plain);
    let (x, _) = baseline(&s, 100.0, 400.0);
    assert_eq!(x, 0.0);
}

#[test]
fn width_scales_with_font_size() {
    assert!((text_width("12", 18.0) - text_width("12", 9.0) * 2.0).abs() < 0.001);
}

// --- escaping ---

#[test]
fn parentheses_and_backslashes_are_escaped() {
    // Unescaped, a "(" in a localized template terminates the PDF string early
    // and corrupts every stamped page.
    assert_eq!(escape("(7)"), b"\\(7\\)".to_vec());
    assert_eq!(escape("a\\b"), b"a\\\\b".to_vec());
}
