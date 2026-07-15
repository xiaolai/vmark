//! Native browser surface — a VMark-owned WKWebView (WI-1.2, macOS).
//!
//! VMark constructs the `WKWebView` itself (fresh `WKWebViewConfiguration`,
//! ADR-B2) and adds it as an `NSView` subview of the Tauri window's content
//! view. Because Tauri did not create it, Tauri's IPC bridge is never injected —
//! the `assert_no_bridge` command exists to prove that as a live regression
//! check (R3 / SPIKE-1).
//!
//! Threading + ownership: all AppKit/WebKit calls run on the main thread via
//! `run_on_main_thread`. A `Retained<WKWebView>` is not `Send`, so the live
//! handles live in a **main-thread-local** map (`WEBVIEWS`), reached only from
//! inside main-thread closures. The `Send` lifecycle/identity registry
//! (`browser/registry.rs`) lives in Tauri-managed state; the two are kept
//! consistent by the command layer.
//!
//! The macOS objc2 recipe is the productionized form of the validated Phase-0
//! spike (git cd162e02:src-tauri/src/spike_embed.rs).

use crate::browser::one_shot::OneShot;
use crate::browser::ai_policy::AiBrowserPolicy;
use crate::browser::origin_guard::StandingGrant;
use crate::browser::recovery::CrashTracker;
use crate::browser::registry::BrowserRegistry;
use std::collections::HashMap;
use std::sync::Mutex;

/// Tauri-managed browser state: the platform-independent lifecycle/identity
/// registry (Send). Native handles are held per-platform, off this struct.
#[derive(Default)]
pub struct BrowserSurface {
    pub registry: Mutex<BrowserRegistry>,
    /// Per-tab consecutive-crash state (WI-1.8). The navigation delegate records
    /// crashes/clean-loads here to decide auto-reload vs. manual (recovery.rs).
    pub crash_trackers: Mutex<HashMap<String, CrashTracker>>,
    /// Standing origin grants (R4/R5), mirrored from the frontend approval store
    /// via `browser_set_grants`. **Default-deny**: an empty set authorizes nothing,
    /// so a driver command is refused until the user has actually granted the
    /// origin+operation. This is the authoritative copy — the TS store is a cache
    /// for UX, not the enforcement point (WI-2.1).
    pub grants: Mutex<Vec<StandingGrant>>,
    /// Single-use authorizations from the user's "Allow once" (R5). They live here
    /// rather than only in the TS store because the driver is the authority: a
    /// one-shot the frontend held alone would be checked there and then refused
    /// here, authorizing nothing. Each is consumed by the first matching action.
    pub one_shots: Mutex<Vec<OneShot>>,
    /// Rust-authoritative feature and AI posture state. Frontend settings are a
    /// desired state only; commands consult this copy before creating or driving
    /// an AI-owned tab.
    pub ai_policy: Mutex<AiBrowserPolicy>,
    /// Ephemeral human-tab attachments. Exact tab + generation binding prevents
    /// an approval from following a page navigation or a reused tab id.
    pub attachments: Mutex<Vec<TabAttachment>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabAttachment {
    pub tab_id: String,
    pub generation: u64,
    pub uses: Option<u8>,
}

impl BrowserSurface {
    /// Drop every trace of a tab: its registry entry **and** its crash budget.
    ///
    /// Both halves must go together. Removing only the registry entry (what
    /// `browser_destroy` used to do) leaked one `crash_trackers` entry per tab for
    /// the life of the process, and — worse — made a **reused** tab id inherit the
    /// dead tab's exhausted budget, so the new tab's first crash would refuse to
    /// auto-reload. Called on destroy and on failed creation.
    ///
    /// Idempotent: forgetting an unknown tab is a no-op, so a retried destroy is
    /// safe.
    pub fn forget_tab(&self, tab_id: &str) -> Result<(), String> {
        // Taken sequentially, never nested: no other path holds both locks, so
        // there is no lock-order to get wrong.
        self.registry
            .lock()
            .map_err(|e| e.to_string())?
            .remove(tab_id);
        self.crash_trackers
            .lock()
            .map_err(|e| e.to_string())?
            .remove(tab_id);
        // A destroyed tab's one-shots must not linger to authorize a reused id.
        self.clear_tab_one_shots(tab_id);
        self.clear_tab_attachment(tab_id);
        Ok(())
    }

    /// Revoke every "Allow once" for `tab_id` (R7a). Called when the tab starts a
    /// new navigation and when it is forgotten, so an approval never outlives the
    /// page it was granted on. Best-effort: a poisoned lock leaves nothing to leak.
    pub fn clear_tab_one_shots(&self, tab_id: &str) {
        if let Ok(mut shots) = self.one_shots.lock() {
            crate::browser::one_shot::clear_one_shots_for_tab(&mut shots, tab_id);
        }
    }

    pub fn attach_tab(&self, tab_id: String, generation: u64, once: bool) -> Result<(), String> {
        let mut attachments = self.attachments.lock().map_err(|e| e.to_string())?;
        attachments.retain(|attachment| attachment.tab_id != tab_id);
        attachments.push(TabAttachment {
            tab_id,
            generation,
            uses: once.then_some(1),
        });
        Ok(())
    }

    pub fn is_tab_attached(&self, tab_id: &str, generation: u64) -> bool {
        self.attachments
            .lock()
            .map(|attachments| {
                attachments
                    .iter()
                    .any(|attachment| attachment.tab_id == tab_id && attachment.generation == generation)
            })
            .unwrap_or(false)
    }

    pub fn clear_tab_attachment(&self, tab_id: &str) {
        if let Ok(mut attachments) = self.attachments.lock() {
            attachments.retain(|attachment| attachment.tab_id != tab_id);
        }
    }

    pub fn consume_tab_attachment(&self, tab_id: &str, generation: u64) -> bool {
        let Ok(mut attachments) = self.attachments.lock() else { return false };
        let Some(index) = attachments.iter().position(|attachment| {
            attachment.tab_id == tab_id && attachment.generation == generation
        }) else {
            return false;
        };
        if let Some(uses) = attachments[index].uses.as_mut() {
            if *uses == 0 {
                attachments.remove(index);
                return false;
            }
            *uses -= 1;
            if *uses == 0 {
                attachments.remove(index);
            }
        }
        true
    }
}

/// The read-only JS that asserts no Tauri bridge leaked into the browsed page
/// (R3 / SPIKE-1). Returns a JSON object of booleans; all must be false.
pub const NO_BRIDGE_ASSERTION: &str = "return JSON.stringify({\
    hasTauriInternals: typeof window.__TAURI_INTERNALS__ !== 'undefined',\
    hasTauri: typeof window.__TAURI__ !== 'undefined',\
    hasIpc: typeof window.ipc !== 'undefined',\
    invokeReachable: (function(){try{return typeof window.__TAURI_INTERNALS__.invoke==='function';}catch(e){return false;}})()\
});";

#[cfg(target_os = "macos")]
#[path = "surface_macos.rs"]
mod imp;

// --- Cross-platform command-facing API -------------------------------------
// macOS delegates to `imp`; other platforms return an explicit "unsupported"
// (their native backends land in WI-5.1 / WI-5.2).

#[cfg(target_os = "macos")]
pub use imp::{
    assert_no_bridge, clear_ai_sandbox_store, create, create_with_mode, destroy, dialog_respond,
    eval, go_history, navigate, set_bounds, set_hidden, stop,
};

#[cfg(not(target_os = "macos"))]
mod stub {
    use tauri::AppHandle;
    const MSG: &str = "embedded browser surface is macOS-only in this build";
    pub fn create(_a: &AppHandle, _t: String, _w: String, _u: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn create_with_mode(
        _a: &AppHandle,
        _t: String,
        _w: String,
        _u: String,
        _mode: crate::browser::registry::AutomationMode,
    ) -> Result<(), String> {
        Err("UNSUPPORTED_PLATFORM".into())
    }
    pub fn clear_ai_sandbox_store(_a: &AppHandle) -> Result<(), String> {
        Err("UNSUPPORTED_PLATFORM".into())
    }
    pub fn navigate(_a: &AppHandle, _t: String, _u: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn go_history(_a: &AppHandle, _t: String, _forward: bool) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn stop(_a: &AppHandle, _t: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn dialog_respond(_a: &AppHandle, _id: u64, _accepted: bool) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn set_bounds(
        _a: &AppHandle,
        _t: String,
        _x: f64,
        _y: f64,
        _w: f64,
        _h: f64,
    ) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn destroy(_a: &AppHandle, _t: String) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn assert_no_bridge(_a: &AppHandle, _t: String) -> Result<String, String> {
        Err(MSG.into())
    }
    pub fn eval(_a: &AppHandle, _t: String, _s: String) -> Result<String, String> {
        Err(MSG.into())
    }
    pub fn set_hidden(_a: &AppHandle, _t: String, _h: bool) -> Result<(), String> {
        Err(MSG.into())
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::{
    assert_no_bridge, clear_ai_sandbox_store, create, create_with_mode, destroy, dialog_respond,
    eval, go_history, navigate, set_bounds, set_hidden, stop,
};

#[cfg(test)]
#[path = "surface.test.rs"]
mod tests;
