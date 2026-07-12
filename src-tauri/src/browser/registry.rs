//! Browser tab lifecycle + identity registry (WI-1.2 / R11 / R7a).
//!
//! Purpose: the pure, platform-independent core of the embedded-browser surface.
//! It owns the identity map — `tabId ↔ window ↔ navigation generation ↔ lifecycle
//! state` — and the lifecycle state machine. The native WKWebView (macOS) /
//! WebView2 (Windows) / webkit2gtk (Linux) surface is layered on top and holds
//! the actual view handle; this module owns the invariants the native layer, the
//! automation lease (R11), and the eval watchdog (WI-1.8) all depend on.
//!
//! The **navigation generation** is load-bearing: every driver command is stamped
//! with the generation current when it was issued, and a command is rejected as
//! stale once the page navigates (generation bumped). This is what stops a late
//! eval result from being applied to a page that has since navigated away.
//!
//! Lifecycle state machine:
//! ```text
//!   Creating ─▶ Live ⇄ Navigating
//!                 │
//!                 ├─▶ Hibernated ─(reactivate)─▶ Creating
//!                 ├─▶ Crashed    ─(reload)─────▶ Creating
//!                 └─▶ Destroyed  (terminal)
//! ```

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
    Hibernated,
    /// The content process died (WI-1.8) — awaiting a user reload.
    Crashed,
    /// The webview has been torn down. Terminal.
    Destroyed,
}

impl Lifecycle {
    /// Whether `self → to` is a valid lifecycle transition.
    pub fn can_transition_to(self, to: Lifecycle) -> bool {
        use Lifecycle::*;
        matches!(
            (self, to),
            (Creating, Live)
                | (Creating, Crashed)
                | (Creating, Destroyed)
                | (Live, Navigating)
                | (Live, Hibernated)
                | (Live, Crashed)
                | (Live, Destroyed)
                | (Navigating, Live)
                | (Navigating, Crashed)
                | (Navigating, Destroyed)
                | (Hibernated, Creating)
                | (Hibernated, Destroyed)
                | (Crashed, Creating)
                | (Crashed, Destroyed)
        )
    }

    /// Destroyed is the only terminal state.
    pub fn is_terminal(self) -> bool {
        matches!(self, Lifecycle::Destroyed)
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
    /// The navigation URL is not a navigable http(s) URL.
    InvalidUrl(String),
}

struct Entry {
    window_label: String,
    generation: u64,
    state: Lifecycle,
}

/// The identity map: `tabId ↔ {window, generation, lifecycle}`. Not thread-safe
/// on its own; the native surface wraps it in a `Mutex` behind the command layer.
#[derive(Default)]
pub struct BrowserRegistry {
    tabs: HashMap<String, Entry>,
}

impl BrowserRegistry {
    pub fn new() -> Self {
        Self::default()
    }

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
            },
        );
        Ok(())
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
        Ok(())
    }

    /// Bump the navigation generation (a page navigated); returns the new value.
    /// Invalidates in-flight driver commands stamped with the old generation.
    pub fn bump_generation(&mut self, tab_id: &str) -> Result<u64, BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        entry.generation += 1;
        Ok(entry.generation)
    }

    pub fn generation(&self, tab_id: &str) -> Option<u64> {
        self.tabs.get(tab_id).map(|e| e.generation)
    }

    pub fn state(&self, tab_id: &str) -> Option<Lifecycle> {
        self.tabs.get(tab_id).map(|e| e.state)
    }

    pub fn window_of(&self, tab_id: &str) -> Option<&str> {
        self.tabs.get(tab_id).map(|e| e.window_label.as_str())
    }

    pub fn contains(&self, tab_id: &str) -> bool {
        self.tabs.contains_key(tab_id)
    }

    pub fn len(&self) -> usize {
        self.tabs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tabs.is_empty()
    }

    /// A driver command tagged with `generation` is fresh iff the tab exists, is
    /// not terminal, and the generation matches the current one (WI-1.8).
    pub fn is_command_fresh(&self, tab_id: &str, generation: u64) -> bool {
        match self.tabs.get(tab_id) {
            Some(e) => !e.state.is_terminal() && e.generation == generation,
            None => false,
        }
    }

    /// Remove a tab (after its native webview is torn down).
    pub fn remove(&mut self, tab_id: &str) {
        self.tabs.remove(tab_id);
    }

    /// All tab ids in `window_label` (for per-window teardown).
    pub fn tabs_in_window(&self, window_label: &str) -> Vec<String> {
        self.tabs
            .iter()
            .filter(|(_, e)| e.window_label == window_label)
            .map(|(id, _)| id.clone())
            .collect()
    }
}

/// Validate a navigation target: only http/https URLs are navigable. Opaque
/// origins (`about:`/`data:`/`blob:`/`file:`/`javascript:`) are rejected for the
/// driver-owned surface (R7a). This is a structural gate; full origin-grant
/// enforcement is R4/WI-2.1.
pub fn validate_navigation_url(url: &str) -> Result<(), BrowserError> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let scheme_len = if lower.starts_with("https://") {
        8
    } else if lower.starts_with("http://") {
        7
    } else {
        return Err(BrowserError::InvalidUrl(url.to_string()));
    };
    let after = &trimmed[scheme_len..];
    let authority_end = after.find(['/', '?', '#']).unwrap_or(after.len());
    if after[..authority_end].is_empty() {
        return Err(BrowserError::InvalidUrl(url.to_string()));
    }
    Ok(())
}

#[cfg(test)]
#[path = "registry.test.rs"]
mod tests;
