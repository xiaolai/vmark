//! Crash-recovery policy (WI-1.8) — decide whether a crashed browser tab may
//! auto-reload or must wait for a manual reload, bounding a reload-crash loop.
//!
//! A killed web-content process leaves the tab in `Lifecycle::Crashed`
//! (`registry.rs`). Reloading a page that crashes on load would spin forever, so
//! this policy caps *consecutive* crashes (those with no successful load between
//! them): under the budget the surface auto-reloads; past it, it holds a manual
//! "page crashed — reload" state until the user acts. A clean load forgives the
//! streak. This is the pure decision half of WI-1.8; the native delegate that
//! observes the crash and the store that renders the manual state are the gated
//! integration points that call into it.
//!
//! @coordinates-with browser/registry.rs — Lifecycle::Crashed ⇄ Creating (reload)

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryAction {
    /// Within the consecutive-crash budget — safe to reload automatically.
    AutoReload,
    /// Budget exhausted — a reload-crash loop; hold a manual-reload state and
    /// stop auto-reloading until the user intervenes.
    ManualOnly,
}

/// Default consecutive-crash budget before auto-reloading stops.
pub const MAX_AUTO_RELOADS: u32 = 3;

/// Consecutive-crash counter for one tab (reset on a successful load).
///
/// Deliberately **not** `Copy`/`Clone`: the streak is per-tab mutable state living
/// in `BrowserSurface::crash_trackers`, and a copy of it would be a second budget
/// that silently diverges from the one the reload policy consults.
#[derive(Debug, Default)]
pub struct CrashTracker {
    consecutive: u32,
}

impl CrashTracker {
    /// Record a crash and decide what to do, using the default budget.
    pub fn on_crash(&mut self) -> RecoveryAction {
        self.on_crash_with_budget(MAX_AUTO_RELOADS)
    }

    /// Record a crash and decide against an explicit budget. The first `budget`
    /// consecutive crashes auto-reload; the next one (and beyond) is manual-only.
    /// Production always goes through `on_crash` (the default budget); the explicit
    /// budget exists so the boundary is testable without 3 real crashes — it is
    /// private so no production path can bypass the default invariant.
    ///
    /// The decision is made from the count BEFORE this crash, then the count
    /// saturates. Incrementing first and comparing with `<=` broke the `u32::MAX`
    /// budget: the count pinned at the ceiling stayed `== budget`, so every crash
    /// read as within budget and auto-reloaded forever.
    fn on_crash_with_budget(&mut self, budget: u32) -> RecoveryAction {
        let action = if self.consecutive < budget {
            RecoveryAction::AutoReload
        } else {
            RecoveryAction::ManualOnly
        };
        self.consecutive = self.consecutive.saturating_add(1);
        action
    }

    /// A clean load forgives the crash streak.
    pub fn on_load_success(&mut self) {
        self.consecutive = 0;
    }

    /// Test-only observation seam: production reads the *decision*
    /// (`RecoveryAction`), never the counter behind it.
    #[cfg(test)]
    pub fn consecutive(&self) -> u32 {
        self.consecutive
    }

    #[cfg(test)]
    pub fn force_consecutive(&mut self, n: u32) {
        self.consecutive = n;
    }
}

#[cfg(test)]
#[path = "recovery.test.rs"]
mod tests;
