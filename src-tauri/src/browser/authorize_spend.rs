//! The spending half of the driver gate (audit 20260903 round 3, #10).
//!
//! `spend` consumes exactly what a [`Decision`] requires — a one-shot when
//! standing authority does not cover the operation, and a human tab's
//! attachment — under the `attachments → one_shots` order, with the registry
//! guard still held by the caller. Two invariants, both pinned by its tests: a
//! denial burns NOTHING (the attachment is verified before, and consumed after,
//! the one-shot), and the origin a one-shot is matched against is the decision's
//! committed page, never a caller's URL.
//!
//! A `#[path]` child of `authorize.rs`.
//!
//! @coordinates-with browser/authorize.rs — the composition and the lock order
//! @coordinates-with browser/authorize_decision.rs — what is being spent on
//! @coordinates-with browser/one_shot.rs — single-use "Allow once" consumption
//! @coordinates-with browser/tab_attachments.rs — human attachment consumption

use super::decision::Decision;
use crate::browser::ai_guards::lock_failure;
use crate::browser::one_shot::{self, OneShotTarget};
use crate::browser::redact;
use crate::browser::refusals::{attachment_required, not_granted};
use crate::browser::registry::AutomationMode;
use crate::browser::surface::{self, BrowserSurface};
use crate::command_error::CommandError;

/// Spend the authority `decision` requires for `operation`, or refuse without
/// spending. `target` and `payload_hash` bind a one-shot to the exact element and
/// script (Security review P5, High #1; audit 20260903 A-05).
pub(super) fn spend(
    state: &BrowserSurface,
    decision: &Decision,
    tab_id: &str,
    generation: u64,
    operation: &str,
    target: Option<&OneShotTarget>,
    payload_hash: Option<&str>,
) -> Result<(), CommandError> {
    // For a human tab, hold the attachments lock from the presence check THROUGH
    // the consume, so the single-use attachment cannot be raced away in between —
    // otherwise a lost race after a one-shot was already spent would burn that
    // one-shot on an action that never runs (Audit round 2). The decision's peek
    // is re-verified under THIS lock. A non-human tab needs no attachment.
    let mut human_attachment = if decision.mode == AutomationMode::Human {
        let guard = state.attachments.lock().map_err(lock_failure)?;
        if !surface::attachment_present(&guard, tab_id, generation) {
            return Err(attachment_required());
        }
        Some(guard)
    } else {
        None
    };
    if !decision.allowed {
        // No standing authority. A single-use "Allow once" may still authorize
        // this exact action — consumed HERE, atomically, so the check and the
        // spend cannot be separated. The full descriptor (tab, generation,
        // origin, operation, target, payload) must match, so an approval cannot
        // be spent on a different page, element or script.
        let mut one_shots = state.one_shots.lock().map_err(lock_failure)?;
        if !one_shot::consume_one_shot(
            &mut one_shots,
            tab_id,
            generation,
            &decision.committed,
            operation,
            target,
            payload_hash,
        ) {
            // Origin only: the committed URL's query string routinely carries
            // session tokens, and a refusal log is not a place to persist them.
            log::warn!(
                "[browser] REFUSED {operation} on {} (tab {tab_id}): not granted",
                redact::redact(&decision.committed)
            );
            return Err(not_granted(operation));
        }
        log::info!(
            "[browser] {operation} on {} (tab {tab_id}): one-shot consumed",
            redact::redact(&decision.committed)
        );
    }
    // Attachment verified present under the still-held lock ⇒ this consume cannot
    // fail; a persistent attachment (uses = None) is left in place. Done last, so
    // a denied action never burns consent.
    if let Some(attachments) = human_attachment.as_deref_mut() {
        surface::consume_attachment_in(attachments, tab_id, generation);
    }
    Ok(())
}

#[cfg(test)]
#[path = "authorize_spend.test.rs"]
mod tests;
