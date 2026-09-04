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
//! Lock order across this state (audit 20260903 round 3, #35): the registry is
//! OUTERMOST. Every path that holds two of these guards takes the registry first
//! — the authorization gate (registry → grants, registry → attachments →
//! one_shots), minting (registry → one_shots), `attach_tab` (registry →
//! attachments), `forget_tab` and `teardown::forget_window` (registry →
//! crash_trackers / one_shots / attachments) — and no path holds one of the
//! others while waiting for the registry. That is what lets a forget remove the
//! entry and clear every piece of tab-scoped state as ONE step (for one tab, or
//! for every tab of a closing window), and `attach_tab` validate and write as
//! one.
//!
//! The macOS objc2 recipe is the productionized form of the validated Phase-0
//! spike (git cd162e02:src-tauri/src/spike_embed.rs).

use crate::browser::ai_policy::AiBrowserPolicy;
use crate::browser::one_shot::OneShot;
use crate::browser::origin_guard::{self, StandingGrant};
use crate::browser::profile_open::ProfileOpen;
use crate::browser::recovery::CrashTracker;
use crate::browser::registry::BrowserRegistry;
use std::collections::HashMap;
use std::sync::Mutex;

#[path = "tab_attachments.rs"]
mod tab_attachments;
pub use tab_attachments::TabAttachment;
pub(crate) use tab_attachments::{attachment_present, consume_attachment_in};
#[path = "attachment_state.rs"]
mod attachment_state;
pub use attachment_state::AttachmentState;

/// Tauri-managed browser state: the platform-independent lifecycle/identity
/// registry (Send). Native handles are held per-platform, off this struct.
#[derive(Default)]
pub struct BrowserSurface {
    pub registry: Mutex<BrowserRegistry>,
    /// Per-tab consecutive-crash state (WI-1.8). The navigation delegate records
    /// crashes/clean-loads here to decide auto-reload vs. manual (recovery.rs).
    pub crash_trackers: Mutex<HashMap<String, CrashTracker>>,
    /// Standing origin grants (R4/R5), mirrored from each window's frontend
    /// approval store via `browser_set_grants` and keyed by that window's label
    /// (audit 20260903 A-03 — one process-wide vector let whichever window synced
    /// last clobber the rest). A tab is authorized by the grants of the window that
    /// owns it, per the registry. **Default-deny**: an absent or empty slice
    /// authorizes nothing, so a driver command is refused until the user has
    /// actually granted the origin+operation. This is the authoritative copy — the
    /// TS store is a cache for UX, not the enforcement point (WI-2.1).
    pub grants: Mutex<HashMap<String, Vec<StandingGrant>>>,
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
    /// an approval from following a page navigation or a reused tab id; written
    /// and cleared under the registry guard (`tab_attachments.rs`).
    pub attachments: Mutex<Vec<TabAttachment>>,
    /// Single-use grants to open a named persistent context (WI-P6.1 H1). Bound to
    /// (profile, destination origin); minted from the user's per-use approval,
    /// consumed authoritatively in `browser_ai_create` before the profile is applied.
    pub profile_opens: Mutex<Vec<ProfileOpen>>,
}

/// The wire spelling of each `NativeSurfaceError` class (audit 20260803 §7;
/// typed in 20260903 rounds 3–4).
///
/// The native surface fails with `native_failure::NativeSurfaceError` end to end,
/// so no producer spells one of these itself: `Display` renders `TOKEN: detail`
/// and `parse` reads it back at the seams that are still `String`-errored — the
/// view/store helpers (`surface_view_macos.rs`, `browser_store_macos.rs`) and the
/// two entry points whose callers' closure types live in `ai_transactions.rs`
/// (`create_with_mode`, `navigate`). `native_failure.test.rs` reads this block
/// from source and pins one variant per constant. Matching is anchored at the
/// start and delimited, so a token inside a URL never reclassifies a failure, and
/// anything untagged stays `internal`.
pub mod fail {
    /// The window a tab was to be attached to is gone (or has no content view).
    pub const WINDOW_GONE: &str = "WINDOW_GONE";
    /// No native webview is registered for that tab id.
    pub const NO_WEBVIEW: &str = "NO_WEBVIEW";
    /// The platform URL type rejected the string.
    pub const INVALID_URL: &str = "INVALID_URL";
    /// The named-profile data-store cap is exhausted (WI-P6.1 H2).
    pub const PROFILE_STORE_LIMIT: &str = "PROFILE_STORE_LIMIT";
    /// This build has no native browser surface.
    pub const UNSUPPORTED_PLATFORM: &str = "UNSUPPORTED_PLATFORM";
    /// The main-thread hop did not answer within its deadline.
    pub const MAIN_THREAD_TIMEOUT: &str = "MAIN_THREAD_TIMEOUT";
    /// The AI destination rule list did not compile, so no AI webview was created
    /// (audit 20260903 P-01 — fail closed, never an unguarded AI tab).
    pub const CONTENT_RULES_FAILED: &str = "CONTENT_RULES_FAILED";
    /// A page dialog was answered from a window that does not own its tab.
    pub const DIALOG_NOT_OWNED: &str = "DIALOG_NOT_OWNED";
    /// The authorized generation was superseded between authorization and a
    /// native submit. `eval` carries that refusal typed (`EvalError::Refused`,
    /// `CommandError` intact); the token stays the class's wire name.
    pub const STALE_COMMAND: &str = "STALE_COMMAND";
}

/// The standing grants of one window, as a slice. `None` (an unknown tab) or a
/// window that never synced reads as EMPTY — default-deny, the same answer the
/// old process-wide vector gave before its first sync.
pub(crate) fn grants_of<'a>(
    by_window: &'a HashMap<String, Vec<StandingGrant>>,
    window_label: Option<&str>,
) -> &'a [StandingGrant] {
    window_label
        .and_then(|label| by_window.get(label))
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

impl BrowserSurface {
    /// Does the window `window_label` grant `operation` on `url`? The navigation
    /// delegate's question, asked with the registry guard held (registry → grants
    /// is the established lock order). A poisoned lock answers `false`: deny.
    pub fn is_granted_in_window(
        &self,
        window_label: Option<&str>,
        url: &str,
        operation: &str,
    ) -> bool {
        self.grants
            .lock()
            .map(|by_window| {
                origin_guard::is_operation_granted(
                    url,
                    operation,
                    grants_of(&by_window, window_label),
                )
            })
            .unwrap_or(false)
    }

    /// Drop every trace of a tab: its registry entry, its crash budget, its
    /// one-shots and its attachment — as ONE step under the registry guard.
    ///
    /// All halves must go together. Removing only the registry entry (what
    /// `browser_destroy` used to do) leaked one `crash_trackers` entry per tab for
    /// the life of the process, and made a **reused** tab id inherit the dead
    /// tab's exhausted budget. And they must go under one guard (audit 20260903
    /// round 3, #35): taken sequentially, the entry was already gone while the
    /// rest still existed, so a `create` + `attach_tab` for the same id could land
    /// in the gap and have its fresh attachment erased by this cleanup — or, in
    /// the other order, a stale generation-0 attachment could be written after
    /// the entry was removed and survive to authorize the id's next tenant.
    /// Called on destroy and on failed creation.
    ///
    /// Idempotent: forgetting an unknown tab is a no-op, so a retried destroy is
    /// safe.
    pub fn forget_tab(&self, tab_id: &str) -> Result<(), String> {
        let mut reg = self.registry.lock().map_err(|e| e.to_string())?;
        self.forget_tab_in(&mut reg, tab_id)
    }

    /// `forget_tab`'s body, on a registry guard the caller already holds —
    /// `teardown::forget_window` forgets every tab of a closing window under ONE
    /// guard this way (round 4, #35). Taking `&mut BrowserRegistry` makes holding
    /// the guard a type-level requirement rather than a comment. Lock order:
    /// registry → crash_trackers / one_shots / attachments, so nothing can hold
    /// one of those and wait for the registry.
    pub(crate) fn forget_tab_in(
        &self,
        reg: &mut BrowserRegistry,
        tab_id: &str,
    ) -> Result<(), String> {
        reg.remove(tab_id);
        self.crash_trackers
            .lock()
            .map_err(|e| e.to_string())?
            .remove(tab_id);
        // A destroyed tab's one-shots must not linger to authorize a reused id.
        self.clear_tab_authority_in(reg, tab_id);
        Ok(())
    }

    /// Drop every "Allow once" and the human-tab attachment of `tab_id` while the
    /// caller HOLDS the registry guard (round 4, #35): the guard is taken by `&mut`
    /// so holding it is a type-level requirement, and the lock order — registry
    /// outermost, then one-shots, then attachments — is the one every other path
    /// uses. Clearing with the guard released left a gap in which a `create` +
    /// `attach_tab` for a reused id could land and have its fresh authority erased
    /// by a late delegate callback for the tab that had just gone.
    pub(crate) fn clear_tab_authority_in(&self, _reg: &mut BrowserRegistry, tab_id: &str) {
        self.clear_tab_one_shots(tab_id);
        self.clear_tab_attachment(tab_id);
    }

    /// Revoke every "Allow once" for `tab_id` (R7a). Called when the tab starts a
    /// new navigation and when it is forgotten, so an approval never outlives the
    /// page it was granted on. Best-effort: a poisoned lock leaves nothing to leak.
    pub fn clear_tab_one_shots(&self, tab_id: &str) {
        if let Ok(mut shots) = self.one_shots.lock() {
            crate::browser::one_shot::clear_one_shots_for_tab(&mut shots, tab_id);
        }
    }

    /// Bind an attachment to `tab_id` at `generation` — only for a tab the
    /// registry knows, outside a terminal state, at exactly that generation, and
    /// with the registry guard held across the write (audit 20260903 round 3,
    /// #35). A destroy cannot slip between the check and the write, so an
    /// attachment is never written for an id whose entry is gone, where it would
    /// authorize the id's next tenant at generation 0. `once` makes it
    /// single-use. Refuses with `STALE_NAVIGATION`, the token `mint::attach_ai_tab`
    /// already uses for a generation the tab has left.
    pub fn attach_tab(&self, tab_id: String, generation: u64, once: bool) -> Result<(), String> {
        let reg = self.registry.lock().map_err(|e| e.to_string())?;
        if !reg.tab_alive_at(&tab_id, generation) {
            return Err("STALE_NAVIGATION".into());
        }
        let mut attachments = self.attachments.lock().map_err(|e| e.to_string())?;
        tab_attachments::attach(&mut attachments, tab_id, generation, once);
        drop(attachments);
        drop(reg);
        Ok(())
    }

    pub fn is_tab_attached(&self, tab_id: &str, generation: u64) -> bool {
        self.attachments
            .lock()
            .map(|attachments| attachment_present(&attachments, tab_id, generation))
            .unwrap_or(false)
    }

    pub fn clear_tab_attachment(&self, tab_id: &str) {
        if let Ok(mut attachments) = self.attachments.lock() {
            attachments.retain(|attachment| attachment.tab_id != tab_id);
        }
    }
}

#[cfg(target_os = "macos")]
#[path = "surface_macos.rs"]
mod imp;

// --- Cross-platform command-facing API -------------------------------------
// macOS delegates to `imp`; other platforms return an explicit "unsupported"
// (their native backends land in WI-5.1 / WI-5.2).

#[cfg(all(target_os = "macos", debug_assertions))]
pub use imp::{debug_attached_webviews, debug_hit_test, debug_native_tab_ids};

#[cfg(target_os = "macos")]
pub use imp::{
    assert_no_bridge, clear_ai_sandbox_store, create, create_with_mode, destroy, dialog_respond,
    eval, forget_profile, go_history, navigate,
    screenshot::screenshot,
    session_cookies::{apply_cookies, capture_cookies},
    set_bounds, set_hidden, stop,
};

#[cfg(not(target_os = "macos"))]
#[path = "surface_stub.rs"]
mod stub;

#[cfg(all(not(target_os = "macos"), debug_assertions))]
pub use stub::{debug_attached_webviews, debug_hit_test, debug_native_tab_ids};

#[cfg(not(target_os = "macos"))]
pub use stub::{
    apply_cookies, assert_no_bridge, capture_cookies, clear_ai_sandbox_store, create,
    create_with_mode, destroy, dialog_respond, eval, forget_profile, go_history, navigate,
    screenshot, set_bounds, set_hidden, stop,
};

#[cfg(test)]
#[path = "surface.test.rs"]
mod tests;
