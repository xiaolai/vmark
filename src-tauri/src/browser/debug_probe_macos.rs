//! Debug-only introspection of the native browser layer (macOS).
//!
//! Split from `surface_macos.rs` because it is a genuinely separate concern:
//! everything else there exists to DRIVE the native surface, while this only
//! observes it. Compiled out of release builds — it enumerates internal state and
//! has no product use.
//!
//! WHY IT EXISTS. The `WKWebView` is a sibling native view, so it appears in no
//! DOM snapshot and nothing in the webview can see it. Two invariants are
//! therefore unobservable from an E2E journey without help from inside the app:
//! whether a native view was really released on close (B11), and whether freezing
//! really stops it occluding the DOM (B14).
//!
//! @coordinates-with e2e/lib/browser.mjs — the only consumer

use objc2_app_kit::NSView;
use objc2_foundation::NSPoint;
use tauri::AppHandle;

/// Tab ids that currently hold a LIVE native webview, sorted for stable diffing.
pub fn debug_native_tab_ids(app: &AppHandle) -> Result<Vec<String>, String> {
    super::on_main(app, move |_mtm| {
        Ok(super::WEBVIEWS.with(|m| {
            let mut ids: Vec<String> = m.borrow().keys().cloned().collect();
            ids.sort();
            ids
        }))
    })
}

/// Does the tab's native webview OCCLUDE the given window point?
///
/// This is the occlusion oracle (B14), and it is deliberately not a read-back of
/// the flag `browser_freeze` sets — `setHidden(true)` then `isHidden() == true` is
/// very nearly a tautology and would be an assertion that cannot fail.
///
/// Instead it asks AppKit the question the invariant is actually about: *which
/// view is on top at this point?* `hitTest:` walks the real view hierarchy in
/// z-order and **skips hidden views**, which is the same visibility rule the
/// compositor uses to decide what paints. So a webview that is present, framed
/// over the point, and visible answers `true`; one that is hidden (or gone, or
/// moved) answers `false` — and it answers via a code path independent of the one
/// that set the flag.
///
/// A pixel oracle would be stronger still, but no capture API available here
/// composites native subviews: the debug bridge's window capture returns blank
/// where the `WKWebView` paints, while WebKit's own `takeSnapshot` renders the
/// view directly and so reports content whether or not it is composited. Hit
/// testing is the strongest oracle actually reachable from inside the process.
///
/// Returns `(occludes, found_class)` — the class name makes a failure legible
/// ("the point resolved to NSView, not WKWebView") instead of a bare false.
pub fn debug_hit_test(
    app: &AppHandle,
    tab_id: String,
    window_label: String,
    x: f64,
    y: f64,
) -> Result<(bool, String), String> {
    let app_for_closure = app.clone();
    super::on_main(app, move |mtm| {
        let webview = super::WEBVIEWS
            .with(|m| m.borrow().get(&tab_id).cloned())
            .ok_or_else(|| format!("no webview: {tab_id}"))?;
        let content = super::view::content_view(&app_for_closure, &window_label, mtm)?;

        // Point is given in the content view's own (flipped-origin) coordinates.
        let hit = content.hitTest(NSPoint::new(x, y));
        let Some(hit) = hit else {
            return Ok((false, "<none>".to_string()));
        };

        // The hit may be a DESCENDANT of the webview (WebKit nests its own layers),
        // so walk up: occlusion by a child is occlusion by the webview.
        let target: &NSView = &webview;
        let mut cursor = Some(hit.clone());
        while let Some(v) = cursor {
            if std::ptr::eq(&*v as *const NSView, target as *const NSView) {
                return Ok((true, class_name(&hit)));
            }
            cursor = unsafe { v.superview() };
        }
        Ok((false, class_name(&hit)))
    })
}

fn class_name(view: &NSView) -> String {
    use objc2::runtime::AnyObject;
    let obj: &AnyObject = view;
    obj.class().name().to_string_lossy().into_owned()
}
