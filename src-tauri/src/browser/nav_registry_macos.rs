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
use objc2_foundation::NSError;
use objc2_web_kit::{WKNavigationDelegate, WKUIDelegate, WKWebView};
use tauri::{AppHandle, Emitter, Manager};

use super::payloads::FailedPayload;
use super::NavDelegate;
use crate::browser::recovery::RecoveryAction;
use crate::browser::registry::Lifecycle;
use crate::browser::surface::BrowserSurface;

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
    pub(super) fn commit_navigation(&self, url: &str) -> u64 {
        let ivars = self.ivars();
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return 0;
        };
        let mut reg = match state.registry.lock() {
            Ok(reg) => reg,
            Err(e) => {
                log::warn!("[browser] registry lock poisoned on commit: {e}");
                return 0;
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
        generation
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
        }
        generation
    }

    /// Build a delegate bound to `tab_id`, emitting on `app`.
    pub fn new(mtm: MainThreadMarker, tab_id: String, app: AppHandle) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(NavDelegateIvars {
            tab_id,
            app,
            redirected: std::cell::Cell::new(false),
            loading: std::cell::Cell::new(false),
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

    /// A load failed. The webview is alive and idle on whatever it was showing, so
    /// the tab settles back to `Live` — leaving it in `Creating`/`Navigating` (what
    /// this used to do) stranded the entry in a transient state indefinitely. The
    /// committed URL stays revoked, so a page that never loaded grants nothing.
    fn settle_after_failure(&self) {
        let ivars = self.ivars();
        let Some(state) = ivars.app.try_state::<BrowserSurface>() else {
            return;
        };
        let locked = state.registry.lock();
        let Ok(mut reg) = locked else {
            return;
        };
        // Only the transient states settle: a crashed or destroyed tab keeps its.
        if matches!(
            reg.state(&ivars.tab_id),
            Some(Lifecycle::Creating | Lifecycle::Navigating)
        ) {
            if let Err(e) = reg.transition(&ivars.tab_id, Lifecycle::Live) {
                log::warn!(
                    "[browser] failed-load settle refused for {}: {e:?}",
                    ivars.tab_id
                );
            }
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

    /// Settle the lifecycle, then report the failure to the frontend.
    pub(super) fn emit_failed(&self, error: &NSError) {
        let ivars = self.ivars();
        // The load is over. Leaving this set would mute the URL observer for the rest of
        // the tab's life, and every same-document navigation after a single failed load
        // would silently keep the page's authority alive.
        ivars.loading.set(false);
        let message = error.localizedDescription().to_string();
        log::debug!("[browser] load failed for {}: {message}", ivars.tab_id);
        self.settle_after_failure();
        let _ = ivars.app.emit(
            "browser://load-failed",
            FailedPayload {
                tab_id: ivars.tab_id.clone(),
                message,
            },
        );
    }
}
