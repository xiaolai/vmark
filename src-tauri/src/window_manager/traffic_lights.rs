//! # Traffic lights
//!
//! Purpose: keep the macOS window controls where this app puts them, against an
//! AppKit that keeps putting them back.
//!
//! Lives in its own module because it is three things that must agree — the
//! position, the repair, and the list of moments worth repairing at — and
//! because `mod.rs` is a module map, not a place for thirty lines of objc2.
//!
//! @coordinates-with src-tauri/tauri.conf.json — the main window's position
//! @coordinates-with src/shell/trafficLights.ts — the app's own derived clearances
//! @coordinates-with macos_menu.rs — rebuilding the menu is what moves them

/// Where macOS draws this app's window controls.
///
/// A window built at runtime does NOT inherit `tauri.conf.json`'s window entry,
/// so setting `trafficLightPosition` there moves the main window's buttons and
/// nothing else. Every builder that asks for the overlay title bar has to place
/// them itself, from this one constant — miss one and that window's lights sit
/// 10pt away from the main window's, in the same app on the same screen.
///
/// The value matches Finder, measured: 19pt in from the window's left and top
/// edges. `y` carries the standard titlebar inset AppKit applies before this
/// value is used, so `19 + 9 = 28`; `x` is one to one. See
/// `src/shell/trafficLights.ts`, which derives the app's own clearances from
/// the same numbers and has the test that keeps all three declarations equal.
///
/// Needs the `macos-private-api` cargo feature — see `Cargo.toml`.
#[cfg(target_os = "macos")]
pub(crate) const TRAFFIC_LIGHT_POSITION: tauri::LogicalPosition<f64> =
    tauri::LogicalPosition { x: 19.0, y: 28.0 };

/// Make the window controls actually take `TRAFFIC_LIGHT_POSITION`.
///
/// **There are two implementations of `trafficLightPosition` and they do not
/// behave the same.** A window built by a `WebviewWindowBuilder` sets it on the
/// WEBVIEW, and wry's `WryWebViewParent::set_traffic_light_inset` applies it
/// immediately. A window declared in `tauri.conf.json` sets it on the tao
/// WINDOW instead, and tao only STORES it — the value is applied nowhere but
/// inside `TaoView`'s `drawRect:`. Nothing in Tauri maps the config value onto
/// the webview attributes, so the two paths never meet.
///
/// A WKWebView covers the tao view, so that `drawRect:` does not run during the
/// first paint and the buttons stay wherever AppKit put them. The first window
/// resize marks the view dirty, `drawRect:` finally runs, and they jump into
/// place — which is exactly how this shipped in 0.9.47: right after a resize,
/// wrong on launch.
///
/// Running that `drawRect:` is therefore the whole fix, and it must run
/// SYNCHRONOUSLY. `setNeedsDisplay:` only marks the view dirty and lets AppKit
/// choose when; the window was already on screen by then, so the buttons sat in
/// AppKit's default spot for about half a second and then jumped. `display()`
/// draws inside this call.
///
/// **Once is not enough, and that is why this is called again on every window
/// event that can re-lay the title bar out.** A probe over startup showed the
/// real sequence: setup applies the inset at the config's 800x600, then the
/// window-state plugin restores the saved size. Whether the inset survives that
/// depends on whether the resize happens to redraw the tao view — a race, and
/// the losing side is visible as buttons in the wrong place. Which side loses
/// varies by machine and by saved window size, which is exactly why fixing it
/// by argument rather than by re-checking kept producing a different symptom.
/// Re-checking afterwards does not care who won.
///
/// Deliberately NOT a second copy of the geometry. tao's `inset_traffic_lights`
/// resizes the title-bar container and derives the button spacing from the
/// buttons' own current frames; a hand-written copy here would place them on
/// frame 1 and tao would place them again on every redraw after, so any
/// difference between the two would flicker forever. The check is a PREDICATE
/// only — it compares the container's height against the one value tao's
/// routine sets it to, and on a mismatch asks tao to run its own code again. So
/// the geometry keeps exactly one author, and the common case costs one frame
/// read, which is what makes it safe on a live resize drag.
///
/// Applied to every window, not just the main one. The others are built through
/// wry's path and start correct, but leaving fullscreen is a documented way to
/// lose a repositioned button set on any of them.
///
/// Takes the raw `NSWindow` rather than a Tauri type because the two callers
/// hold different ones — setup a `WebviewWindow`, the event handler a `Window`
/// — and neither converts to the other. Both expose `ns_window()`, which is all
/// this needs.
#[cfg(target_os = "macos")]
pub(crate) fn apply_traffic_light_position(ns_window: *mut std::ffi::c_void) {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton};

    if ns_window.is_null() {
        log::warn!("traffic lights: null ns_window; leaving them where AppKit put them");
        return;
    }
    let ptr = ns_window;
    // SAFETY: `ns_window()` hands back the window's own `NSWindow`, and every
    // caller is on the main thread, which is the only thread allowed to touch it.
    unsafe {
        let ns_window: &NSWindow = &*(ptr as *const NSWindow);

        // tao sets the container's height to `close.height + position.y`. Any
        // other value means AppKit has re-laid it out since, and the buttons
        // have ridden it back to where AppKit wants them.
        if let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) {
            let wanted = NSView::frame(&close).size.height + TRAFFIC_LIGHT_POSITION.y;
            let container = close.superview().and_then(|v| v.superview());
            if let Some(container) = container {
                if (NSView::frame(&container).size.height - wanted).abs() < 0.5 {
                    return;
                }
            }
        }

        if let Some(view) = ns_window.contentView() {
            view.display();
        }
    }
}

/// Repair every window's controls. Called after any pass over the main menu.
///
/// Menu work is what actually moved them: `menu/dynamic.rs` rebuilds the Genies
/// submenu once the frontend knows the user's shortcuts, and ends by re-applying
/// the SF Symbol icons. Touching the main menu makes AppKit re-lay out window
/// chrome — about half a second after launch, which is exactly when the buttons
/// were seen jumping back. It fires no window event at all, so an event-driven
/// repair alone never sees it.
#[cfg(target_os = "macos")]
pub(crate) fn repair_traffic_lights(app: &tauri::AppHandle) {
    for (_, window) in tauri::Manager::webview_windows(app) {
        if let Ok(ns) = window.ns_window() {
            apply_traffic_light_position(ns);
        }
    }
}

/// The window events that can re-lay the title bar out.
///
/// Separate from the menu path above, and both are needed: leaving fullscreen is
/// a documented way to lose a repositioned button set, and it fires an event but
/// touches no menu.
#[cfg(target_os = "macos")]
pub(crate) fn repair_traffic_lights_on_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if !matches!(
        event,
        tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::Moved(_)
            | tauri::WindowEvent::Focused(true)
            | tauri::WindowEvent::ScaleFactorChanged { .. }
    ) {
        return;
    }
    if let Ok(ns) = window.ns_window() {
        apply_traffic_light_position(ns);
    }
}
