// WI-PDF1.3 — PageSpec deserializes from the EXACT frontend payload and
// refuses geometry a native API cannot honour.

use super::PageSpec;
use crate::command_error::ErrorCode;

/// Parse the literal JSON `src/export/pageSpec.ts` produces. A hand-written
/// snake_case fixture would pass while the real camelCase payload failed.
fn parse(json: &str) -> Result<PageSpec, serde_json::Error> {
    serde_json::from_str(json)
}

#[test]
fn it_deserializes_the_camel_case_payload_the_frontend_sends() {
    let spec = parse(r#"{"widthPt":595.28,"heightPt":841.89}"#).expect("A4 portrait");
    assert_eq!(spec.width_pt, 595.28);
    assert_eq!(spec.height_pt, 841.89);
}

#[test]
fn snake_case_is_rejected_so_a_casing_regression_cannot_pass_silently() {
    assert!(parse(r#"{"width_pt":595.28,"height_pt":841.89}"#).is_err());
}

#[test]
fn landscape_arrives_already_swapped() {
    let spec = parse(r#"{"widthPt":841.89,"heightPt":595.28}"#).expect("A4 landscape");
    assert!(spec.width_pt > spec.height_pt);
    spec.validate().expect("landscape A4 is valid");
}

#[test]
fn every_shipped_page_size_validates() {
    // The four sizes PAGE_SIZE_PT offers, portrait and landscape.
    for (w, h) in [
        (595.28, 841.89),
        (612.0, 792.0),
        (841.89, 1190.55),
        (612.0, 1008.0),
    ] {
        PageSpec {
            width_pt: w,
            height_pt: h,
        }
        .validate()
        .expect("portrait");
        PageSpec {
            width_pt: h,
            height_pt: w,
        }
        .validate()
        .expect("landscape");
    }
}

#[test]
fn non_finite_values_are_refused() {
    // The load-bearing case: NaN fails every comparison, so a range test that
    // forgot `is_finite` would pass it straight through to the print API.
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let err = PageSpec {
            width_pt: bad,
            height_pt: 841.89,
        }
        .validate()
        .expect_err("non-finite width");
        assert_eq!(err.code(), ErrorCode::InvalidInput);
        assert!(PageSpec {
            width_pt: 595.28,
            height_pt: bad
        }
        .validate()
        .is_err());
    }
}

#[test]
fn absurd_dimensions_are_refused_at_both_ends() {
    for (w, h) in [
        (0.0, 841.89),
        (-595.28, 841.89),
        (1.0, 841.89),
        (100_000.0, 841.89),
    ] {
        let err = PageSpec {
            width_pt: w,
            height_pt: h,
        }
        .validate()
        .expect_err(&format!("{w}x{h} must be refused"));
        assert_eq!(err.code(), ErrorCode::InvalidInput);
    }
}

#[test]
fn inches_converts_from_points() {
    let (w, h) = PageSpec {
        width_pt: 612.0,
        height_pt: 792.0,
    }
    .inches();
    assert!((w - 8.5).abs() < 1e-9, "612pt = 8.5in, got {w}");
    assert!((h - 11.0).abs() < 1e-9, "792pt = 11in, got {h}");
}
