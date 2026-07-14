//! Pure geometry for the native browser view (WI-S0.3).
//!
//! The frontend measures the reserved viewport with `getBoundingClientRect()`,
//! which is a **DOM** rect: top-left origin, y growing **down**. AppKit's `NSView`
//! is bottom-left with y growing **up** — unless the parent view reports
//! `isFlipped == true`. Converting between them is arithmetic, not objc2, so it
//! lives here where it can actually be tested.
//!
//! @coordinates-with browser/surface_macos.rs — set_bounds applies this
//! @module browser/geometry

/// The AppKit `origin.y` for a child whose DOM-space top edge is `dom_y` and whose
/// height is `height`, inside a parent of height `parent_height`.
///
/// - `parent_is_flipped == true`  → the parent already uses a top-left origin, so
///   the DOM value passes through unchanged.
/// - `parent_is_flipped == false` (AppKit's default) → y is measured from the
///   **bottom**, so it must be inverted: `parent_height - dom_y - height`.
///
/// Beware the symmetric-layout trap: when the space above and below the child are
/// equal, the inversion is a no-op and an un-converted implementation looks correct.
/// See `geometry.test.rs`.
pub fn appkit_origin_y(
    parent_height: f64,
    parent_is_flipped: bool,
    dom_y: f64,
    height: f64,
) -> f64 {
    if parent_is_flipped {
        dom_y
    } else {
        parent_height - dom_y - height
    }
}

#[cfg(test)]
#[path = "geometry.test.rs"]
mod tests;
