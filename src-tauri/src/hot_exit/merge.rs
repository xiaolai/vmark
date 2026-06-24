//! Partial-capture session merging — pure logic extracted from
//! `hot_exit_capture` so the data-loss-critical branches are table-testable
//! (audit 20260612 H12: this path had zero tests).
//!
//! When a capture is partial (some windows timed out during the IPC
//! broadcast), windows that were expected-but-missing are resurrected from
//! the previous session so their unsaved state isn't silently dropped on
//! restart. Windows the user intentionally closed are NOT in
//! `expected_labels` and are never resurrected.

use std::collections::HashSet;

use super::session::SessionData;

/// Refuse to merge from a previous session older than this — resurrecting
/// hour-old window state would surprise more than it saves.
const MAX_MERGE_AGE_SECS: i64 = 3600;

/// Merge a (possibly partial) fresh capture with the previous session.
///
/// - Resurrects windows that are in `expected_labels` (alive at capture
///   time) but missing from the capture (timed out), unless the previous
///   session is stale (older than [`MAX_MERGE_AGE_SECS`]), has a future
///   timestamp, or the age computation overflows.
/// - Re-sorts windows main-first whenever a merge happened.
/// - Carries the previous session's workspace forward when the capture has
///   none (workspace capture not yet implemented).
pub fn merge_partial_capture(
    mut session: SessionData,
    prev_session: Option<SessionData>,
    expected_labels: &HashSet<String>,
    now: i64,
) -> SessionData {
    let Some(prev_session) = prev_session else {
        return session;
    };

    // Track which labels are already present (captured this round) AND which
    // we resurrect below. Without folding resurrected labels back into this
    // set, a previous session that itself contains duplicate window labels
    // would push the same label multiple times — producing duplicate windows
    // on restart.
    let mut present_labels: HashSet<String> = session
        .windows
        .iter()
        .map(|w| w.window_label.clone())
        .collect();

    let prev_age_secs = now.checked_sub(prev_session.timestamp);
    let is_stale = match prev_age_secs {
        Some(age) if (0..=MAX_MERGE_AGE_SECS).contains(&age) => false,
        _ => true, // overflow, negative (future timestamp), or too old
    };

    let mut merged = false;
    if is_stale {
        log::debug!(
            "[HotExit] Skipping stale merge: previous session age {:?}s (max {}s)",
            prev_age_secs,
            MAX_MERGE_AGE_SECS
        );
    } else {
        for prev_window in prev_session.windows {
            if expected_labels.contains(&prev_window.window_label)
                && !present_labels.contains(&prev_window.window_label)
            {
                log::debug!(
                    "[HotExit] Merging previous state for timed-out window '{}' ({:?}s old)",
                    prev_window.window_label,
                    prev_age_secs
                );
                present_labels.insert(prev_window.window_label.clone());
                session.windows.push(prev_window);
                merged = true;
            }
        }
    }

    if merged {
        // Re-sort: main window first, then by label
        session.windows.sort_by(|a, b| {
            match (a.is_main_window, b.is_main_window) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.window_label.cmp(&b.window_label),
            }
        });
    }

    // Preserve workspace from previous session if not set
    // (workspace capture not yet implemented, so current capture always has None)
    if session.workspace.is_none() {
        session.workspace = prev_session.workspace;
    }

    session
}

#[cfg(test)]
#[path = "merge.test.rs"]
mod tests;
