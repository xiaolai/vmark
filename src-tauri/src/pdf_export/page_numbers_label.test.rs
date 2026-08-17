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
        ink_rgb: Default::default(),
    }
}

// --- label rendering ---

#[test]
fn plain_is_just_the_number() {
    assert_eq!(
        render_label(&spec(Position::BottomCenter, Format::Plain), 7, 12),
        ("7".to_string(), false)
    );
}

#[test]
fn with_total_reads_as_a_fraction() {
    assert_eq!(
        render_label(&spec(Position::BottomCenter, Format::WithTotal), 7, 12),
        ("7 / 12".to_string(), false)
    );
}

#[test]
fn verbose_substitutes_both_placeholders() {
    assert_eq!(
        render_label(&spec(Position::BottomCenter, Format::Verbose), 7, 12),
        ("Page 7 of 12".to_string(), false)
    );
}

#[test]
fn a_label_helvetica_cannot_draw_falls_back_to_numbers() {
    // Base-14 Helvetica is Latin-1 only, so a CJK template would draw as
    // blanks or wrong glyphs. Leaving the page bare was the first attempt and
    // it was worse: a CJK reader who picked the verbose format got a PDF with
    // NO page numbers at all and a success message. The numeric form is ASCII,
    // so it always draws.
    let mut s = spec(Position::BottomCenter, Format::Verbose);
    s.verbose_template = "第 {n} 頁，共 {total} 頁".to_string();
    assert_eq!(render_label(&s, 7, 12), ("7 / 12".to_string(), true));
}

#[test]
fn the_numeric_forms_can_never_need_a_fallback() {
    // They are digits, spaces and a slash whatever the locale, so the fallback
    // flag must stay false — otherwise every export would log a warning.
    let mut s = spec(Position::BottomCenter, Format::Plain);
    s.verbose_template = "第 {n} 頁".to_string();
    assert!(!render_label(&s, 3, 9).1, "plain must never fall back");
    s.format = Format::WithTotal;
    assert!(!render_label(&s, 3, 9).1, "with-total must never fall back");
}

#[test]
fn a_latin1_accented_template_is_accepted() {
    // Within WinAnsi, so it draws correctly — the guard must not be
    // "ASCII only", which would downgrade most European languages.
    let mut s = spec(Position::BottomCenter, Format::Verbose);
    s.verbose_template = "Página {n} de {total}".to_string();
    assert_eq!(render_label(&s, 2, 5), ("Página 2 de 5".to_string(), false));
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

// --- validation ---

#[test]
fn a_sane_spec_is_accepted() {
    assert!(spec(Position::BottomCenter, Format::Plain)
        .validate()
        .is_ok());
}

#[test]
fn a_non_finite_font_size_is_refused() {
    // This arrives as JSON over IPC. NaN formats as the literal "NaN" in the
    // `Tf` operator, producing a content stream no viewer can parse — so it has
    // to be caught here, not discovered in the artifact.
    for bad in [f64::NAN, f64::INFINITY, -12.0, 0.0, 5000.0] {
        let mut s = spec(Position::BottomCenter, Format::Plain);
        s.font_size_pt = bad;
        let err = s.validate().expect_err("must refuse fontSizePt {bad}");
        assert_eq!(err.code(), crate::command_error::ErrorCode::InvalidInput);
    }
}

#[test]
fn a_negative_or_non_finite_margin_is_refused_but_zero_is_fine() {
    for bad in [f64::NAN, -1.0, f64::NEG_INFINITY] {
        let mut s = spec(Position::BottomCenter, Format::Plain);
        s.bottom_margin_pt = bad;
        assert!(s.validate().is_err(), "must refuse bottomMarginPt {bad}");
        let mut s = spec(Position::BottomCenter, Format::Plain);
        s.side_margin_pt = bad;
        assert!(s.validate().is_err(), "must refuse sideMarginPt {bad}");
    }
    // Zero is a legitimate edge-to-edge export; `baseline` has a floor for it.
    let mut s = spec(Position::BottomCenter, Format::Plain);
    s.bottom_margin_pt = 0.0;
    s.side_margin_pt = 0.0;
    assert!(s.validate().is_ok());
}

#[test]
fn an_out_of_gamut_ink_component_is_refused() {
    // PDF `rg` takes 0–1. A 255-style value silently clamps in some viewers and
    // renders black in others, so the disagreement is caught here instead.
    for bad in [-0.1, 1.5, f64::NAN] {
        let mut s = spec(Position::BottomCenter, Format::Plain);
        s.ink_rgb = InkRgb([0.0, bad, 0.0]);
        assert!(s.validate().is_err(), "must refuse ink component {bad}");
    }
    let mut s = spec(Position::BottomCenter, Format::Plain);
    s.ink_rgb = InkRgb([0.78, 0.78, 0.78]);
    assert!(
        s.validate().is_ok(),
        "a light grey is a normal dark-theme ink"
    );
}

// --- escaping ---

#[test]
fn parentheses_and_backslashes_are_escaped() {
    // Unescaped, a "(" in a localized template terminates the PDF string early
    // and corrupts every stamped page.
    assert_eq!(escape("(7)"), b"\\(7\\)".to_vec());
    assert_eq!(escape("a\\b"), b"a\\\\b".to_vec());
}
