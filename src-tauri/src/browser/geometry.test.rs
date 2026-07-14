//! WI-S0.3a — DOM→AppKit coordinate conversion for the native browser view.
//!
//! Found by the Codex cross-model review (v3, D3#3). The bug it caught is subtle:
//! `set_bounds` passed `getBoundingClientRect()` values straight into
//! `NSView.setFrame`. DOM rects use a TOP-left origin with y growing DOWN; an
//! unflipped AppKit `NSView` uses a BOTTOM-left origin with y growing UP. The
//! layout happened to hide it — VMark's titlebar (40px) and status bar (40px) are
//! the same height, so inverting y against the window is a no-op. Any asymmetric
//! layout (terminal open, status bar hidden) would have put the page in the wrong
//! place. `symmetric_layout_hides_the_bug` pins that trap so it cannot come back.

use super::appkit_origin_y;

#[test]
fn unflipped_parent_inverts_y_against_its_height() {
    // Parent 1000 tall; DOM rect 40 from the top, 900 tall (so 60 from the bottom).
    // AppKit measures from the bottom → origin.y must be 60.
    assert_eq!(appkit_origin_y(1000.0, false, 40.0, 900.0), 60.0);
}

#[test]
fn flipped_parent_passes_dom_y_through_unchanged() {
    // A flipped parent already uses a top-left origin — no conversion.
    assert_eq!(appkit_origin_y(1000.0, true, 40.0, 900.0), 40.0);
}

#[test]
fn symmetric_layout_hides_the_bug() {
    // THE TRAP. Window 1044; titlebar 40 above, status bar 40 below; the browser
    // fills 40..1004 (964 tall). Inverting gives 1044 - 40 - 964 = 40 — identical
    // to the un-converted DOM y. This is why the un-converted code *looked* right
    // in a live check, and why "it renders fine" was never evidence.
    assert_eq!(appkit_origin_y(1044.0, false, 40.0, 964.0), 40.0);
}

#[test]
fn asymmetric_layout_exposes_the_bug() {
    // Same window, but the terminal takes 240px at the bottom: the browser now
    // occupies DOM y 40..764 (724 tall). Correct AppKit origin is
    // 1044 - 40 - 724 = 280 — NOT the DOM's 40. Passing 40 through would shove the
    // page 240px too low, straight over the terminal.
    assert_eq!(appkit_origin_y(1044.0, false, 40.0, 724.0), 280.0);
}

#[test]
fn a_view_flush_to_the_bottom_has_origin_zero() {
    assert_eq!(appkit_origin_y(1000.0, false, 200.0, 800.0), 0.0);
}

#[test]
fn a_view_flush_to_the_top_has_origin_equal_to_the_remaining_gap() {
    assert_eq!(appkit_origin_y(1000.0, false, 0.0, 300.0), 700.0);
}

#[test]
fn a_view_taller_than_its_parent_yields_a_negative_origin_rather_than_panicking() {
    // Degenerate, but must not panic or wrap: a transient layout can report a rect
    // larger than the parent mid-resize.
    assert_eq!(appkit_origin_y(500.0, false, 0.0, 800.0), -300.0);
}
