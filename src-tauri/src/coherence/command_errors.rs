//! Typed errors for the coherence commands, at the command boundary.
//!
//! Rule 50 §10: a new `#[tauri::command]` returns `Result<T, CommandError>` so
//! the frontend branches on `code`. A `String` forces it back to matching
//! message text — which fires on any payload containing the token and stops
//! firing the day someone rewords it.
//!
//! ## Why the boundary is HERE and not one layer down
//!
//! Everything beneath these commands — `WorkspaceKernelRegistry::kernel_for`,
//! the ledger, `anchors`, `logbook` — still returns `String`. That module
//! predates the migration and is carried, whole, in
//! `scripts/command-error-baseline.json`. Typing it properly means threading a
//! `CoherenceError` enum through the entire subsystem, which is a refactor of
//! main's code, not of this branch's.
//!
//! So classification happens where it can still be done HONESTLY: at the call
//! site, which knows *which call it made*. `set_anchor` failing means the
//! caller's heading path was bad; `kernel_for` failing means the workspace or
//! the registry is unusable. Neither conclusion requires reading the message.
//!
//! What this deliberately does NOT do is pattern-match the strings coming up
//! from below (`"no such edge: …"`, `"invalid heading path"`) to recover a
//! code. That is the exact anti-pattern rule 50 exists to kill, and doing it
//! here would launder text-matching into something that *looks* typed.
//!
//! @coordinates-with src-tauri/src/command_error.rs — CommandError, ErrorCode
//! @coordinates-with scripts/check-command-error-ratchet.mjs — the gate this satisfies

use crate::command_error::CommandError;

/// The workspace could not be opened: an inaccessible root, a poisoned
/// registry, or a kernel that failed to open. All three are environment or
/// process state the caller cannot fix by changing an argument.
pub(super) fn workspace_unavailable(detail: String) -> CommandError {
    CommandError::internal(detail)
}

/// A `Mutex` guarding a kernel was poisoned by a panic in another thread. The
/// state may be torn, so this is never retryable by repeating the call.
pub(super) fn kernel_poisoned() -> CommandError {
    CommandError::internal("coherence kernel lock poisoned")
}

/// A ledger/index read failed, or the kernel refused to serve a poisoned
/// index (9R-4). Plumbing, not an argument problem.
pub(super) fn ledger_unavailable(detail: String) -> CommandError {
    CommandError::internal(detail)
}

/// The operation rejected an argument the caller supplied — an edge that does
/// not exist, a heading path that matches nothing or matches ambiguously, an
/// unknown lifecycle or judgment value. Retrying unchanged cannot succeed;
/// the caller must send something different.
pub(super) fn rejected_argument(detail: String) -> CommandError {
    CommandError::invalid_input(detail)
}

/// The workspace state does not permit the operation right now — e.g. an
/// upstream with no single live revision to anchor against. Distinct from
/// `rejected_argument`: the same call may succeed once the state changes, so
/// the frontend should offer a refresh rather than an input correction.
pub(super) fn state_conflict(detail: String) -> CommandError {
    CommandError::conflict(detail)
}
