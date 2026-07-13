//! Unit tests for the browser command layer's pure guards (WI-1.2).
//!
//! The commands themselves need a live `AppHandle` + main run loop, so they are
//! exercised in the Tauri E2E loop. What IS pure — and what a malformed IPC call
//! reaches first — is validated here.

use super::*;

// ---------------------------------------------------------------------------
// browser_set_bounds geometry. The rect arrives straight from a JS
// `getBoundingClientRect()`, which yields NaN/∞/negative extents for detached,
// collapsed, or transformed nodes. Handed to CGRect unchecked, AppKit lays the
// native view out at an undefined position — the page ends up invisible or
// unclickable with no error anywhere.
// ---------------------------------------------------------------------------

#[test]
fn ordinary_rects_are_accepted() {
    assert!(validate_bounds(0.0, 0.0, 800.0, 600.0).is_ok());
    // Negative origins are legitimate: a scrolled-out pane sits off-screen.
    assert!(validate_bounds(-120.5, -40.0, 800.0, 600.0).is_ok());
    // A collapsed pane is a real state (0×0), not an error.
    assert!(validate_bounds(10.0, 10.0, 0.0, 0.0).is_ok());
}

#[test]
fn non_finite_coordinates_are_rejected() {
    for (x, y, w, h) in [
        (f64::NAN, 0.0, 800.0, 600.0),
        (0.0, f64::NAN, 800.0, 600.0),
        (0.0, 0.0, f64::NAN, 600.0),
        (0.0, 0.0, 800.0, f64::NAN),
        (f64::INFINITY, 0.0, 800.0, 600.0),
        (0.0, f64::NEG_INFINITY, 800.0, 600.0),
        (0.0, 0.0, f64::INFINITY, 600.0),
        (0.0, 0.0, 800.0, f64::INFINITY),
    ] {
        assert!(
            validate_bounds(x, y, w, h).is_err(),
            "expected non-finite rect ({x},{y},{w},{h}) to be rejected"
        );
    }
}

#[test]
fn negative_extents_are_rejected() {
    assert!(validate_bounds(0.0, 0.0, -1.0, 600.0).is_err());
    assert!(validate_bounds(0.0, 0.0, 800.0, -1.0).is_err());
}
