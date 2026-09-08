//! Should a cancel request fire? (split from `state.rs` at the file-size limit)
//!
//! Pure — no Tauri, no locks, no i18n — so the rule can be read and tested on
//! its own. `WorkflowRunnerState::request_cancel` applies it under the
//! `current_execution` lock, which is what makes the match and the store one
//! step (#273).
//!
//! @coordinates-with workflow/state.rs — the caller, and the lock
//! @module workflow::state_cancel

/// Outcome of evaluating a cancel request against the currently-running
/// execution. Pure (no Tauri/i18n dependency) so it is unit-testable.
#[derive(Debug, PartialEq, Eq)]
pub(in crate::workflow) enum CancelDecision {
    /// The requested id matches the running execution — fire the cancel.
    Cancel,
    /// Nothing is running, or a *different* execution is running. The
    /// requested execution must not be cancelled.
    NotRunning,
}

/// Decide whether a cancel request for `requested_id` should fire, given the
/// id of the execution currently running (`current`, `None` when idle).
///
/// Honoring the execution id (C6) closes a TOCTOU window: execution A finishes
/// and execution B starts before A's late `cancel_workflow(A)` arrives. A
/// global `running`-only check would cancel B; matching the id drops the stale
/// request instead.
pub(in crate::workflow) fn decide_cancel(
    current: Option<&str>,
    requested_id: &str,
) -> CancelDecision {
    match current {
        Some(id) if id == requested_id => CancelDecision::Cancel,
        _ => CancelDecision::NotRunning,
    }
}
