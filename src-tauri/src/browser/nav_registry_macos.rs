//! The nav delegate's bridge to the `Send` registry (WI-1.7 / WI-1.8). Split from
//! nav_delegate_macos.rs to keep it under the file-size limit; a `#[path]`
//! submodule of `nav_delegate`, adding inherent methods to `NavDelegate`.
//!
//! Everything here answers one question: *what does this WebKit callback mean for
//! the tab's recorded lifecycle?* Each method takes and releases the registry lock
//! itself and never holds two locks at once — these run on the **main thread**,
//! reentrantly with the run-loop pumping in `driver_loop`, so a held lock here is
//! a deadlock.
//!
//! Failed transitions are LOGGED, never discarded: the registry and the native
//! view disagreeing about what a tab is, is precisely the thing worth knowing.

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_web_kit::{WKNavigationDelegate, WKUIDelegate, WKWebView};
use tauri::{AppHandle, Manager};

use super::NavDelegate;
use crate::browser::recovery::RecoveryAction;
use crate::browser::registry::Lifecycle;
use crate::browser::surface::BrowserSurface;

#[path = "nav_failure_macos.rs"]
mod failure;
#[path = "nav_registry_policy_macos.rs"]
mod policy;
use policy::ai_commit_allowed;
#[path = "nav_registry_identity_macos.rs"]
mod identity;

/// Per-delegate context: which tab it serves and the handle to emit events on.
pub struct NavDelegateIvars {
    pub(super) tab_id: String,
    pub(super) app: AppHandle,
    /// Did the CURRENT provisional navigation follow a server redirect (WI-S2.2)?
    ///
    /// History folds a redirect chain into one entry — the user went to one place, even
    /// though every hop commits. Knowing that requires the real signal, not a timing
    /// heuristic that would mistake a fast link click for a redirect. Reset when a
    /// navigation starts, set by the redirect callback, read at commit.
    pub(super) redirected: std::cell::Cell<bool>,
    /// Is a full-page navigation in flight (started, not yet committed)?
    ///
    /// Read by the `URL` KVO observer to tell the two kinds of URL change apart: a normal
    /// load changes `URL` too — at commit — and `did_commit` owns that path. A change seen
    /// while NO navigation is in flight is same-document.
    pub(super) loading: std::cell::Cell<bool>,
    /// Native navigation identity paired with the registry ticket. WebKit can
    /// deliver a late callback for an older `WKNavigation` after a newer load
    /// has started; pointer identity lets the delegate drop that callback.
    pub(super) native_navigation: std::cell::RefCell<Vec<(usize, String)>>,
    /// Ticket selected by the most recent navigation-policy callback, consumed
    /// when WebKit announces that native navigation actually started.
    pub(super) pending_navigation_id: std::cell::RefCell<Option<String>>,
}

// Same-document navigation (KVO on `URL`) — see nav_kvo_macos.rs.
#[path = "nav_kvo_macos.rs"]
mod kvo;
pub(super) use kvo::URL_KEY_PATH;

impl NavDelegate {
    /// A navigation COMMITTED: bump the generation, mark the tab navigating, and record
    /// the committed url — the only origin the driver may act on (R7a), taken from the
    /// webview itself and never from a caller's claim. Returns the new generation.
    ///
    /// One bump per commit, and only here: the navigate command used to bump too, which
    /// advanced the generation twice for one navigation — and once for a navigation that
    /// never happened.
    pub(super) fn commit_navigation(&self, url: &str, navigation_id: &str) -> Option<u64> {
        let ivars = self.ivars();
        let state = ivars.app.try_state::<BrowserSurface>()?;
        if state.registry.lock().ok().and_then(|reg| {
            reg.navigation_ticket(&ivars.tab_id)
                .map(|ticket| ticket.id == navigation_id)
        }) != Some(true)
        {
            return None;
        }
        let mode = state
            .registry
            .lock()
            .ok()
            .and_then(|reg| reg.automation_mode(&ivars.tab_id));
        if let Some(mode) = mode {
            if !ai_commit_allowed(&state, mode, &ivars.tab_id, url) {
                state.clear_tab_one_shots(&ivars.tab_id);
                state.clear_tab_attachment(&ivars.tab_id);
                if let Ok(mut reg) = state.registry.lock() {
                    let _ = reg.clear_committed_url(&ivars.tab_id);
                }
                return None;
            }
        }
        let mut reg = match state.registry.lock() {
            Ok(reg) => reg,
            Err(e) => {
                log::warn!("[browser] registry lock poisoned on commit: {e}");
                return None;
            }
        };
        let generation = match reg.bump_generation(&ivars.tab_id) {
            Ok(g) => g,
            Err(e) => {
                log::warn!(
                    "[browser] generation bump refused for {}: {e:?}",
                    ivars.tab_id
                );
                0
            }
        };
        if let Err(e) = reg.transition(&ivars.tab_id, Lifecycle::Navigating) {
            log::warn!(
                "[browser] commit transition refused for {}: {e:?}",
                ivars.tab_id
            );
        }
        if let Err(e) = reg.set_committed_url(&ivars.tab_id, url) {
            log::warn!(
                "[browser] committed-url write refused for {}: {e:?}",
                ivars.tab_id
            );
        }
        Some(generation)
    }

    /// R7a: the view this tab's authority was granted against is gone. Bump the
    /// generation (so any operation stamped with the old one is refused as stale), record
    /// the new committed url, and drop the tab's one-shots outright.
    ///
    /// Shared by a full navigation and a SAME-DOCUMENT one. The same-document case is the
    /// subtle one: the origin does not change, so the origin guard still passes — but the
    /// ELEMENT the user approved can be a completely different button once an SPA has
    /// rewritten its DOM. "Click Publish", approved on one view, spent on another.
    /// Authority must lapse with the view it was granted against, not merely with the
    /// document. Returns the new generation.
    pub(super) fn expire_authority(&self, committed_url: Option<&str>) -> u64 {
        let ivars = self.ivars();
        let mut generation = 0;
        if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
            if let Ok(mut reg) = state.registry.lock() {
                match committed_url {
                    // A same-document navigation stays on a real page: record where it is.
                    Some(url) => {
                        if let Ok(g) = reg.bump_generation(&ivars.tab_id) {
                            generation = g;
                        }
                        let _ = reg.set_committed_url(&ivars.tab_id, url);
                    }
                    // A navigation is STARTING: there is no committed page until it lands,
                    // so the tab grants nothing in the meantime.
                    None => {
                        let _ = reg.clear_committed_url(&ivars.tab_id);
                    }
                }
            }
            state.clear_tab_one_shots(&ivars.tab_id);
            state.clear_tab_attachment(&ivars.tab_id);
        }
        generation
    }

    /// A load finished cleanly: reset the tab's crash budget, the mirror of `record_crash`.
    pub(super) fn record_load_success(&self) {
        let ivars = self.ivars();
        if let Some(state) = ivars.app.try_state::<BrowserSurface>() {
            if let Ok(mut trackers) = state.crash_trackers.lock() {
                trackers
                    .entry(ivars.tab_id.clone())
                    .or_default()
                    .on_load_success();
            }
        }
    }

    /// The tab's current committed generation, or 0 if the registry is unavailable. Read at
    /// `did_finish` so a late `loaded` event carries the generation of the page that
    /// finished — the store then drops it if a newer navigation has since bumped past it.
    pub(super) fn committed_generation(&self) -> u64 {
        let ivars = self.ivars();
        ivars
            .app
            .try_state::<BrowserSurface>()
            .and_then(|state| {
                state
                    .registry
                    .lock()
                    .ok()
                    .and_then(|reg| reg.generation(&ivars.tab_id))
            })
            .unwrap_or(0)
    }

    /// Build a delegate bound to `tab_id`, emitting on `app`.
    pub fn new(mtm: MainThreadMarker, tab_id: String, app: AppHandle) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(NavDelegateIvars {
            tab_id,
            app,
            redirected: std::cell::Cell::new(false),
            loading: std::cell::Cell::new(false),
            native_navigation: std::cell::RefCell::new(Vec::new()),
            pending_navigation_id: std::cell::RefCell::new(None),
        });
        // SAFETY: NSObject's init has the standard signature.
        unsafe { msg_send![super(this), init] }
    }

    /// Wrap `self` as a WKNavigationDelegate protocol object for `setNavigationDelegate`.
    pub fn as_protocol(&self) -> &ProtocolObject<dyn WKNavigationDelegate> {
        ProtocolObject::from_ref(self)
    }

    /// Wrap `self` as a WKUIDelegate protocol object for `setUIDelegate`.
    pub fn as_ui_protocol(&self) -> &ProtocolObject<dyn WKUIDelegate> {
        ProtocolObject::from_ref(self)
    }

    /// Apply a lifecycle transition, logging a rejected one rather than swallowing
    /// it — an invalid transition means the registry and the native view have
    /// diverged, and continuing as though the mutation succeeded hides that.
    pub(super) fn set_state(&self, to: Lifecycle) {
        let ivars = self.ivars();
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return;
        };
        let locked = state.registry.lock();
        match locked {
            Ok(mut reg) => {
                if let Err(e) = reg.transition(&ivars.tab_id, to) {
                    log::warn!("[browser] {} → {to:?} refused: {e:?}", ivars.tab_id);
                }
            }
            Err(e) => log::warn!("[browser] registry lock poisoned: {e}"),
        }
    }

    /// Record a crash against the tab's budget and mark the registry `Crashed`.
    pub(super) fn record_crash(&self) -> RecoveryAction {
        let ivars = self.ivars();
        ivars.loading.set(false); // no load is in flight; the process is gone
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return RecoveryAction::ManualOnly;
        };
        let action = state
            .crash_trackers
            .lock()
            .map(|mut t| t.entry(ivars.tab_id.clone()).or_default().on_crash())
            .unwrap_or(RecoveryAction::ManualOnly);
        self.set_state(Lifecycle::Crashed);
        action
    }

    /// Reload a crashed tab. Returns whether a navigation actually STARTED:
    /// `reload()` returns nil when there is nothing to reload, and a tab that
    /// announced "auto-reload" but never navigates leaves the frontend waiting on a
    /// load event that can never arrive. On nil the tab goes back to `Crashed` so
    /// the user gets the manual-reload affordance instead of a silent hang.
    pub(super) fn try_reload(&self, web_view: &WKWebView) -> bool {
        // A reload restarts loading, so the entry moves back through `Creating`.
        self.set_state(Lifecycle::Creating);
        if unsafe { web_view.reload() }.is_some() {
            return true;
        }
        log::warn!(
            "[browser] reload produced no navigation for {}",
            self.ivars().tab_id
        );
        self.set_state(Lifecycle::Crashed);
        false
    }
}
