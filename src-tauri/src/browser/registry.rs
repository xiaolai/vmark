//! Browser tab lifecycle + identity registry (WI-1.2 / R11 / R7a).
//!
//! Purpose: the pure, platform-independent core of the embedded-browser surface.
//! It owns the identity map — `tabId ↔ window ↔ navigation generation ↔ lifecycle
//! state` — and the lifecycle state machine. The native surface (WKWebView on
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
//! Lifecycle state machine:
//! ```text
//!   Creating ─▶ Live ⇄ Navigating ⟲   (a redirect chain commits again)
//!      │          │
//!      └──────────┴─▶ Hibernated ─(reactivate)─▶ Creating
//!                 ├─▶ Crashed    ─(reload)─────▶ Creating | Navigating
//!                 └─▶ Destroyed  (terminal)
//! ```
//!
//! `Navigating` is entered by `didCommitNavigation` alone, so it is reachable
//! from every state that owns a webview which can commit a load: `Creating` (the
//! first load), `Live`, `Navigating` (a redirect), and `Crashed` (a reload from
//! the crash overlay). A *failed* load has no state of its own — the webview is
//! idle on whatever it was showing, which is `Live`; the committed URL stays
//! cleared, so the driver is granted nothing on a page that never loaded.

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
    /// Background tab collapsed to `{url,title,scrollY,snapshot}` (WI-1.6).
    /// The state machine already models it; the WI that constructs it is not in.
    #[allow(dead_code, reason = "constructed by the hibernation WI (WI-1.6)")]
    Hibernated,
    /// The content process died (WI-1.8) — awaiting a user reload.
    Crashed,
    /// The webview has been torn down. Terminal.
    Destroyed,
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
                | (Live, Hibernated)
                | (Live, Crashed)
                | (Live, Destroyed)
                | (Navigating, Live)
                | (Navigating, Navigating)
                | (Navigating, Crashed)
                | (Navigating, Destroyed)
                | (Hibernated, Creating)
                | (Hibernated, Destroyed)
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
    /// has not committed; `Crashed`/`Hibernated` have no live process; `Destroyed`
    /// is gone). `browser_eval` freshness and the committed-origin invariant key off
    /// this: a driver command must never authorize against a tab that cannot run it.
    pub fn is_executable(self) -> bool {
        matches!(self, Lifecycle::Live | Lifecycle::Navigating)
    }
}

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
}

struct Entry {
    /// Read by `window_of`/`tabs_in_window` — the per-window teardown WI's hook.
    #[allow(dead_code, reason = "consumer is the per-window teardown WI")]
    window_label: String,
    generation: u64,
    state: Lifecycle,
    /// The **committed** top-level URL (R7a) — the only origin the driver may act
    /// on. `None` until a navigation commits, and cleared again the moment a new
    /// provisional navigation starts, so a redirect chain never briefly grants the
    /// wrong origin. `browser_eval` gates on this, never on a caller-supplied URL.
    committed_url: Option<String>,
}

/// The identity map: `tabId ↔ {window, generation, lifecycle}`. Not thread-safe
/// on its own; the native surface wraps it in a `Mutex` behind the command layer.
#[derive(Default)]
pub struct BrowserRegistry {
    tabs: HashMap<String, Entry>,
}

impl BrowserRegistry {
    /// Register a new browser tab in `Creating` state at generation 0.
    pub fn create(&mut self, tab_id: &str, window_label: &str) -> Result<(), BrowserError> {
        if self.tabs.contains_key(tab_id) {
            return Err(BrowserError::DuplicateTab(tab_id.to_string()));
        }
        self.tabs.insert(
            tab_id.to_string(),
            Entry {
                window_label: window_label.to_string(),
                generation: 0,
                state: Lifecycle::Creating,
                // Not the target URL: nothing is committed until the nav delegate
                // says so (R7a). A tab created pointing at an origin grants nothing.
                committed_url: None,
            },
        );
        Ok(())
    }

    /// Record the committed top-level URL (called from `didCommitNavigation`).
    /// This is the fact the origin gate reads — see `Entry::committed_url`.
    ///
    /// Refused on a terminal tab: a callback arriving after teardown must never
    /// re-grant an origin on a dead tab.
    pub fn set_committed_url(&mut self, tab_id: &str, url: &str) -> Result<(), BrowserError> {
        let entry = self.live_entry_mut(tab_id)?;
        entry.committed_url = Some(url.to_string());
        Ok(())
    }

    /// Revoke the committed URL (called when a new provisional navigation starts).
    /// R7a: the grant lapses immediately, and is re-established only on the next
    /// commit — otherwise a redirect chain briefly grants the wrong origin.
    ///
    /// Unlike `set_committed_url` this is allowed in every state: revoking
    /// authority is never the unsafe direction.
    pub fn clear_committed_url(&mut self, tab_id: &str) -> Result<(), BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        entry.committed_url = None;
        Ok(())
    }

    /// A mutable entry that is known, and not terminal — the precondition for any
    /// mutation that grants authority or advances navigation.
    fn live_entry_mut(&mut self, tab_id: &str) -> Result<&mut Entry, BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        if entry.state.is_terminal() {
            return Err(BrowserError::TerminalTab(tab_id.to_string()));
        }
        Ok(entry)
    }

    /// The tab's committed top-level URL, if a navigation has committed.
    pub fn committed_url(&self, tab_id: &str) -> Option<&str> {
        self.tabs
            .get(tab_id)
            .and_then(|e| e.committed_url.as_deref())
    }

    /// Apply a lifecycle transition, validating it against the state machine.
    pub fn transition(&mut self, tab_id: &str, to: Lifecycle) -> Result<(), BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        if !entry.state.can_transition_to(to) {
            return Err(BrowserError::InvalidTransition {
                from: entry.state,
                to,
            });
        }
        entry.state = to;
        // Authority is scoped to executable states. Entering a non-executable state
        // (crash, hibernate, reload-to-Creating, teardown) revokes the committed
        // origin in the SAME atomic transition, so an in-flight eval cannot pass the
        // origin gate against a page the webview no longer holds. The next commit
        // re-establishes it via `set_committed_url`.
        if !to.is_executable() {
            entry.committed_url = None;
        }
        Ok(())
    }

    /// Bump the navigation generation (a page navigated); returns the new value.
    /// Invalidates in-flight driver commands stamped with the old generation.
    ///
    /// Refused on a terminal tab: `Destroyed` is terminal in every respect, so a
    /// late callback cannot mutate an entry that is on its way out.
    pub fn bump_generation(&mut self, tab_id: &str) -> Result<u64, BrowserError> {
        let entry = self.live_entry_mut(tab_id)?;
        entry.generation = entry.generation.saturating_add(1);
        Ok(entry.generation)
    }

    /// The current navigation generation — what a driver command must be stamped
    /// with to be fresh. Production learns it from the `browser://navigated` event
    /// the delegate emits, so this reader is the tests' window onto the same fact.
    #[allow(dead_code, reason = "observation seam for the generation tests")]
    pub fn generation(&self, tab_id: &str) -> Option<u64> {
        self.tabs.get(tab_id).map(|e| e.generation)
    }

    pub fn state(&self, tab_id: &str) -> Option<Lifecycle> {
        self.tabs.get(tab_id).map(|e| e.state)
    }

    #[allow(dead_code, reason = "consumer is the per-window teardown WI")]
    pub fn window_of(&self, tab_id: &str) -> Option<&str> {
        self.tabs.get(tab_id).map(|e| e.window_label.as_str())
    }

    #[allow(dead_code, reason = "observation seam for the lifecycle tests")]
    pub fn contains(&self, tab_id: &str) -> bool {
        self.tabs.contains_key(tab_id)
    }

    #[allow(dead_code, reason = "observation seam for the lifecycle tests")]
    pub fn is_empty(&self) -> bool {
        self.tabs.is_empty()
    }

    /// A driver command tagged with `generation` is fresh iff the tab exists, is
    /// in an **executable** state, and the generation matches the current one
    /// (WI-1.8). Restricting to executable states (not merely "non-terminal") is
    /// what stops an eval from running against a crashed, hibernated, or
    /// still-constructing webview that shares the current generation.
    pub fn is_command_fresh(&self, tab_id: &str, generation: u64) -> bool {
        match self.tabs.get(tab_id) {
            Some(e) => e.state.is_executable() && e.generation == generation,
            None => false,
        }
    }

    /// Remove a tab (after its native webview is torn down).
    pub fn remove(&mut self, tab_id: &str) {
        self.tabs.remove(tab_id);
    }

    /// All tab ids in `window_label` (for per-window teardown).
    #[allow(dead_code, reason = "consumer is the per-window teardown WI")]
    pub fn tabs_in_window(&self, window_label: &str) -> Vec<String> {
        self.tabs
            .iter()
            .filter(|(_, e)| e.window_label == window_label)
            .map(|(id, _)| id.clone())
            .collect()
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
