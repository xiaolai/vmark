//! Browser tab lifecycle + identity registry (WI-1.2 / R11 / R7a).
//!
//! Purpose: the pure, platform-independent core of the embedded-browser surface.
//! It owns the identity map — `tabId ↔ window ↔ navigation generation ↔ lifecycle
//! state` — the lifecycle state machine, and the live AI-tab count behind the
//! `MAX_AI_TABS` cap (audit 2026-09-03 X-01). The native surface (WKWebView on
//! macOS today; WebView2/webkit2gtk backends planned for Windows/Linux) is layered
//! on top and holds the actual view handle; this module owns the invariants the
//! native layer, the automation lease (R11), and the eval watchdog (WI-1.8) all
//! depend on.
//!
//! The **navigation generation** is load-bearing: every driver command is stamped
//! with the generation current when it was issued, and a command is rejected as
//! stale once the page navigates (generation bumped). This is what stops a late
//! eval result from being applied to a page that has since navigated away.
//!
//! A **profile-backed AiSandbox tab** also pins a set-once `profile_origin` (the
//! origin its profile-open grant approved). The driver gate confines the AI's reads
//! to that origin for the tab's whole life — unlike the per-navigation shared-origin
//! approval, it is never cleared — so a persistent-login profile cannot be read
//! cross-origin after a redirect (WI-P6.1 H1).
//!
//! An **AI tab** records the request that reserved it (`registry_ai.rs`): a
//! `browser_ai_create` retry naming an existing id is honoured only as that same
//! request — same window, mode, url and profile — and refused otherwise (audit
//! 20260903 round 3, #3). The same-document transition (`registry_same_document.rs`)
//! and the paired snapshot-and-begin (`registry_navigation.rs`) are the other two
//! places where a decision and its write share one guard on purpose.
//!
//! Lifecycle state machine:
//! ```text
//!   Creating ─▶ Live ⇄ Navigating ⟲   (a redirect chain commits again)
//!      │          │
//!      └──────────┼─▶ Crashed   ─(reload)─▶ Creating | Navigating
//!                 └─▶ Destroyed (terminal)
//! ```
//!
//! There is no hibernated state: a background tab keeps no native webview at
//! all. The frontend mounts one surface for the active page only and destroys
//! the view on unmount, so an inactive page's entry here is simply `Destroyed`
//! and a fresh entry is created on reactivation. (A `Hibernated` variant used
//! to sit in this enum "awaiting WI-1.6"; that WI's hibernation-cap store was
//! judged fiction and deleted — review finding E4, 2026-08-03.)
//!
//! `Navigating` is entered by `didCommitNavigation` alone, so it is reachable
//! from every state that owns a webview which can commit a load: `Creating` (the
//! first load), `Live`, `Navigating` (a redirect), and `Crashed` (a reload from
//! the crash overlay). A *failed* load has no state of its own — the webview is
//! idle on whatever it was showing, which is `Live`; the committed URL stays
//! cleared, so the driver is granted nothing on a page that never loaded.
//!
//! A window that is being torn down is remembered in `closed_windows` (audit
//! 20260903, journey 37): `create_with_mode` and `reserve_ai_tab` refuse a tab under
//! that label with `BrowserError::WindowClosed`, so a view registered around a
//! teardown cannot outlive its window.

use std::collections::HashMap;

/// Lifecycle state of a browser tab's native webview.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lifecycle {
    /// The webview is being constructed / performing its first load.
    Creating,
    /// A page is loaded and interactive.
    Live,
    /// A navigation is in flight (provisional → committed).
    Navigating,
    /// The content process died (WI-1.8) — awaiting a user reload.
    Crashed,
    /// The webview has been torn down. Terminal.
    Destroyed,
}

/// Authoritative browser-tab provenance. The frontend mirrors this value for UI
/// and tab discovery, but Rust commands select and enforce it at creation time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AutomationMode {
    Human,
    AiSandbox,
    AiShared,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NavigationTicket {
    pub id: String,
    pub sequence: u64,
    pub requested_url: String,
}

impl Lifecycle {
    /// Whether `self → to` is a valid lifecycle transition.
    ///
    /// `Navigating` is written by exactly one thing — `didCommitNavigation` — so
    /// it must be reachable from every state in which a webview exists and a load
    /// can commit: the first load (`Creating`), an ordinary navigation (`Live`), a
    /// redirect chain committing again (`Navigating` → itself), and a reload after
    /// a crash (`Crashed`). Any of these rejected meant the delegate's transition
    /// failed and the entry stayed stuck in its pre-commit state.
    pub fn can_transition_to(self, to: Lifecycle) -> bool {
        use Lifecycle::*;
        matches!(
            (self, to),
            (Creating, Live)
                | (Creating, Navigating)
                | (Creating, Crashed)
                | (Creating, Destroyed)
                | (Live, Navigating)
                | (Live, Crashed)
                | (Live, Destroyed)
                | (Navigating, Live)
                | (Navigating, Navigating)
                | (Navigating, Crashed)
                | (Navigating, Destroyed)
                | (Crashed, Creating)
                | (Crashed, Navigating)
                | (Crashed, Destroyed)
        )
    }

    /// Destroyed is the only terminal state.
    pub fn is_terminal(self) -> bool {
        matches!(self, Lifecycle::Destroyed)
    }

    /// Whether a live, committed page can be executed against in this state. Only
    /// `Live`/`Navigating` own a webview with a committed top-level page (`Creating`
    /// has not committed; `Crashed` has no live process; `Destroyed`
    /// is gone). `browser_eval` freshness and the committed-origin invariant key off
    /// this: a driver command must never authorize against a tab that cannot run it.
    pub fn is_executable(self) -> bool {
        matches!(self, Lifecycle::Live | Lifecycle::Navigating)
    }
}

/// Cap on live AI-owned tabs (audit 20260903 X-01). Each `open` is an unprompted
/// `WKWebView` content process, and dedupe by URL is defeated by distinct paths, so
/// without a bound an AI could grow processes without limit. `browser_ai_create`
/// refuses past this with `TAB_LIMIT`; a closed tab frees its slot.
pub const MAX_AI_TABS: usize = 8;

/// Error from a registry operation.
#[derive(Debug, PartialEq, Eq)]
pub enum BrowserError {
    /// No entry for this tab id.
    UnknownTab(String),
    /// A tab with this id already exists.
    DuplicateTab(String),
    /// The requested lifecycle transition is not allowed.
    InvalidTransition { from: Lifecycle, to: Lifecycle },
    /// The tab is in a terminal state — nothing about it may change any more.
    TerminalTab(String),
    /// The navigation URL is not a navigable http(s) URL.
    InvalidUrl(String),
    /// The tab's navigation generation cannot advance any further (u64::MAX).
    /// Unreachable in practice; refusing loudly beats a counter that stops
    /// moving and leaves every command stamped with it fresh forever.
    GenerationExhausted(String),
    /// The window named is being torn down (or already was): nothing may be
    /// registered under it any more. Journey 37 found the race this closes — the
    /// dying window's own frontend re-creating a native view AFTER the native
    /// teardown had run, leaving a live WKWebView the app could no longer reach.
    WindowClosed(String),
}

struct Entry {
    /// Read by `window_of`/`tabs_in_window`: event routing, per-window grants,
    /// dialog ownership, and window teardown.
    window_label: String,
    generation: u64,
    state: Lifecycle,
    /// The **committed** top-level URL (R7a) — the only origin the driver may act
    /// on. `None` until a navigation commits, and cleared again the moment a new
    /// provisional navigation starts, so a redirect chain never briefly grants the
    /// wrong origin. `browser_eval` gates on this, never on a caller-supplied URL.
    committed_url: Option<String>,
    automation_mode: AutomationMode,
    navigation_sequence: u64,
    active_navigation: Option<NavigationTicket>,
    shared_navigation_origin: Option<String>,
    /// For a profile-backed AiSandbox tab, the origin key the profile-open grant
    /// approved. Set ONCE at creation and NEVER cleared on navigation (unlike
    /// `shared_navigation_origin`), so read-confinement persists for the tab's whole
    /// life: a profile tab may navigate anywhere (logins/redirects work), but the AI
    /// may only READ this origin (sec review WI-P6.1 H1). `None` for a profile-less
    /// tab, which reads its committed page unconfined.
    profile_origin: Option<String>,
    policy_epoch: u64,
    /// For an AI tab, the request that reserved it (`registry_ai.rs`): a later
    /// `browser_ai_create` naming this id is honoured only as the SAME request.
    /// `None` for a human tab.
    ai_request: Option<ai::AiCreation>,
}

impl Entry {
    /// A fresh entry: `Creating`, generation 0, nothing committed, nothing bound.
    fn new(window_label: &str, automation_mode: AutomationMode) -> Self {
        Entry {
            window_label: window_label.to_string(),
            generation: 0,
            state: Lifecycle::Creating,
            // Not the target URL: nothing is committed until the nav delegate
            // says so (R7a). A tab created pointing at an origin grants nothing.
            committed_url: None,
            automation_mode,
            navigation_sequence: 0,
            active_navigation: None,
            shared_navigation_origin: None,
            profile_origin: None,
            policy_epoch: 0,
            ai_request: None,
        }
    }
}

/// The identity map: `tabId ↔ {window, generation, lifecycle}`. Not thread-safe
/// on its own; the native surface wraps it in a `Mutex` behind the command layer.
#[derive(Default)]
pub struct BrowserRegistry {
    tabs: HashMap<String, Entry>,
    /// Labels whose window teardown has begun (`mark_window_closed`), kept for the
    /// process lifetime — Tauri never reuses a document-window label, so the set is
    /// bounded by windows ever created. Checked under this guard by every
    /// registration path, which is what makes teardown authoritative.
    closed_windows: std::collections::HashSet<String>,
}

#[path = "registry_navigation.rs"]
mod navigation;
pub use navigation::NavigationSnapshot;

#[path = "registry_state.rs"]
mod state;
pub use state::TabStatus;

#[path = "registry_ai.rs"]
mod ai;
pub use ai::{AiRequestMismatch, AiReservation, AiReservationRefusal, AiTabRequest};

// A `pub mod`, not a re-export: its only consumer is the macOS KVO observer, and a
// `pub use` nothing imports is an unused-import warning on the Windows/Linux legs.
#[path = "registry_same_document.rs"]
pub mod same_document;

impl BrowserRegistry {
    /// Register a new browser tab in `Creating` state at generation 0.
    pub fn create(&mut self, tab_id: &str, window_label: &str) -> Result<(), BrowserError> {
        self.create_with_mode(tab_id, window_label, AutomationMode::Human)
    }

    /// Register a tab with explicit provenance. Human callers use `create`; the
    /// AI command family reserves through `reserve_ai_tab`, which also records the
    /// request the tab is bound to.
    pub fn create_with_mode(
        &mut self,
        tab_id: &str,
        window_label: &str,
        automation_mode: AutomationMode,
    ) -> Result<(), BrowserError> {
        if self.window_closed(window_label) {
            return Err(BrowserError::WindowClosed(window_label.to_string()));
        }
        if self.tabs.contains_key(tab_id) {
            return Err(BrowserError::DuplicateTab(tab_id.to_string()));
        }
        self.tabs.insert(
            tab_id.to_string(),
            Entry::new(window_label, automation_mode),
        );
        Ok(())
    }

    pub fn automation_mode(&self, tab_id: &str) -> Option<AutomationMode> {
        self.tabs.get(tab_id).map(|entry| entry.automation_mode)
    }
}

// `validate_navigation_url` now lives in browser/origin_guard.rs, which parses
// with the WHATWG `url` crate instead of a hand-rolled prefix check. The old
// version here accepted malformed authorities (`https://@`, `https://:443`,
// `https://exa mple.com`). Re-exported so existing callers are unchanged.
pub use crate::browser::origin_guard::validate_navigation_url;

#[cfg(test)]
#[path = "registry.test.rs"]
mod tests;
