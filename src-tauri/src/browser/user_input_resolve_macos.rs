//! Window-point and responder → tab-id resolution for the native user-input
//! monitor (WI-NB5.2). Split from `surface_macos.rs` for the file-size gate.
//! Reads the parent module's `WEBVIEWS` map, so it is a `#[path]` include of
//! that module rather than a free-standing `mod` — `super::` here is
//! `surface_macos`.

use objc2::rc::Retained;
use objc2::Message as _;

/// Which live, visible browser webview in `window` contains `point` (window
/// base coordinates)? Main thread only (WI-NB5.2). A hidden view never matches:
/// the occlusion policy hides browser views under overlays, which is what keeps
/// an approval-dialog click from reading as a page takeover.
pub(super) fn tab_id_at_window_point(
    window: &objc2_app_kit::NSWindow,
    point: objc2_foundation::NSPoint,
) -> Option<String> {
    super::WEBVIEWS.with(|cell| {
        let map = cell.borrow();
        for (tab_id, wv) in map.iter() {
            let view: &objc2_app_kit::NSView = wv.as_ref();
            let Some(host) = view.window() else { continue };
            if !std::ptr::eq(
                Retained::as_ptr(&host).cast::<objc2_app_kit::NSWindow>(),
                window as *const objc2_app_kit::NSWindow,
            ) {
                continue;
            }
            if view.isHiddenOrHasHiddenAncestor() {
                continue;
            }
            let local = view.convertPoint_fromView(point, None);
            let bounds = view.bounds();
            if local.x >= bounds.origin.x
                && local.x <= bounds.origin.x + bounds.size.width
                && local.y >= bounds.origin.y
                && local.y <= bounds.origin.y + bounds.size.height
            {
                return Some(tab_id.clone());
            }
        }
        None
    })
}

/// Which live browser webview owns `responder` (a first responder during a key
/// event)? Walks the superview chain: WKWebView's real key view is an internal
/// content view, so identity is found by ancestry, not equality with the
/// responder itself. Main thread only (WI-NB5.2).
pub(super) fn tab_id_for_responder(responder: &objc2_app_kit::NSResponder) -> Option<String> {
    let view = responder.downcast_ref::<objc2_app_kit::NSView>()?;
    super::WEBVIEWS.with(|cell| {
        let map = cell.borrow();
        let mut current: Option<Retained<objc2_app_kit::NSView>> = Some(view.retain());
        while let Some(v) = current {
            for (tab_id, wv) in map.iter() {
                let wv_view: &objc2_app_kit::NSView = wv.as_ref();
                if std::ptr::eq(
                    wv_view as *const objc2_app_kit::NSView,
                    Retained::as_ptr(&v),
                ) {
                    return Some(tab_id.clone());
                }
            }
            current = unsafe { v.superview() };
        }
        None
    })
}
