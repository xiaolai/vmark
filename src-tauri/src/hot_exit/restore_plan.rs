//! Choosing which saved window becomes `main` on restore.
//!
//! Pure, and split from `coordinator.rs` on purpose (and to keep that file
//! under the size gate): the invariant that matters — N saved windows restore
//! to exactly N windows, each once — is arithmetic, and pinning it should not
//! require a native window builder.
//!
//! @coordinates-with coordinator.rs — the only caller

use super::session::WindowState;

/// Which saved window becomes the app's `main` window on restore, and which
/// become freshly-labelled secondaries.
pub(crate) struct RestorePlan {
    /// The saved state to restore INTO the existing `main` window, if any.
    pub main_state: Option<WindowState>,
    /// Every other saved window, each to be restored into a new window.
    pub secondary_windows: Vec<WindowState>,
}

/// Partition saved windows into one main source and the rest.
///
/// Pure, and separated from window creation on purpose: the invariant that
/// matters — **N saved windows restore to exactly N windows, each once** — is
/// arithmetic, and pinning it should not require a native window builder.
///
/// The rule is a single choice by INDEX, then everything else. Two independent
/// queries (`find(is_main_window)` with a `first()` fallback, plus a separate
/// `filter(!is_main_window)`) used to overlap whenever no window carried the
/// flag: the first survivor answered both, and came back twice (audit
/// 20260906, B4).
///
/// A session with no main-flagged window is ORDINARY, not corrupt: capture
/// flags only the literal `main` label, so closing the original window and
/// carrying on in a `doc-*` window produces one. A session with SEVERAL
/// flagged windows is malformed; the extras are restored as secondaries rather
/// than dropped, since a saved window with content is worth more than the flag
/// is.
pub(crate) fn plan_window_restore(windows: &[WindowState]) -> RestorePlan {
    let main_index = windows
        .iter()
        .position(|w| w.is_main_window)
        .or(if windows.is_empty() { None } else { Some(0) });

    RestorePlan {
        main_state: main_index.map(|i| windows[i].clone()),
        secondary_windows: windows
            .iter()
            .enumerate()
            .filter(|(i, _)| Some(*i) != main_index)
            .map(|(_, w)| w.clone())
            .collect(),
    }
}

#[cfg(test)]
#[path = "restore_plan.test.rs"]
mod tests;
