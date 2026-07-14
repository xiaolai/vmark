//! Window-routed emission for browser events (WI-S0.2 / ADR-6).
//!
//! The nav delegate used to emit via `app.emit`, which BROADCASTS to every window. With
//! two document windows each showing a browser tab, every window's listeners saw every
//! other window's navigation. The frontend filters by `tabId`, so today's chrome is not
//! actually cross-wired — but that is an accident of who happens to be listening, not a
//! property of the transport. Any consumer added without a tab filter (a per-window
//! history view, say) would silently receive another window's browsing, and a browser
//! event is not information a window is entitled to just for existing.
//!
//! So: route to the window that OWNS the tab. The owner comes from the registry, which
//! recorded it at create time from the invoking `WebviewWindow` — never from a caller's
//! claim. The payload carries the label too, as defence in depth for a consumer that
//! forgets to filter.
//!
//! Split from nav_delegate_macos.rs to keep it under the file-size limit; a `#[path]`
//! submodule of `nav_delegate`.

use objc2::DefinedClass;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::NavDelegate;
use crate::browser::surface::BrowserSurface;

impl NavDelegate {
    /// Emit a browser event to the window that owns this delegate's tab. Returns
    /// whether it was delivered — see `emit_to_owner`.
    pub(super) fn emit_owned<P: Serialize + Clone>(&self, event: &str, payload: P) -> bool {
        let ivars = self.ivars();
        emit_to_owner(&ivars.app, &ivars.tab_id, event, payload)
    }
}

/// The window that owns `tab_id`, per the registry.
fn owner_of(app: &AppHandle, tab_id: &str) -> Option<String> {
    let state = app.try_state::<BrowserSurface>()?;
    let registry = state.registry.lock().ok()?;
    registry.window_of(tab_id).map(str::to_string)
}

/// Emit `event` to the window that owns `tab_id`. Returns whether it was delivered.
///
/// If the owner cannot be resolved — the tab was removed mid-teardown, or the lock is
/// poisoned — the event is DROPPED rather than broadcast. A browser event with no known
/// owner has no window it is entitled to reach, and sending it to all of them is how a
/// routing bug becomes a leak.
///
/// The bool matters: a parked `confirm()` is only safe to leave blocking if someone was
/// actually told about it. `did_run_javascript_confirm` releases the page's JS when this
/// returns false, so an undeliverable dialog cancels instead of hanging the page.
#[must_use]
pub(super) fn emit_to_owner<P: Serialize + Clone>(
    app: &AppHandle,
    tab_id: &str,
    event: &str,
    payload: P,
) -> bool {
    match owner_of(app, tab_id) {
        Some(label) => match app.emit_to(label.as_str(), event, payload) {
            Ok(()) => true,
            Err(e) => {
                log::warn!("[browser] {event} for {tab_id} not delivered to {label}: {e}");
                false
            }
        },
        None => {
            log::debug!("[browser] dropping {event} for {tab_id}: no owning window");
            false
        }
    }
}
