//! The authoritative driver-authorization gate (WI-2.1 / R4 / I3 / R7a).
//!
//! Split from `commands_auth.rs` (the `#[tauri::command]` entry points) so the
//! security core lives in one small, unit-testable file — and so the file-size
//! limit does not pressure the gate to be inlined per-command, which is exactly
//! the mutually-masked divergence `.claude/rules/60-ai-governance.md` §10 warns
//! about. `browser_eval` and `browser_screenshot` both route through
//! `authorize_driver_op`; `browser_screenshot` additionally re-checks
//! `command_still_fresh` after its long capture.
//!
//! @coordinates-with browser/commands_auth.rs — the command entry points
//! @coordinates-with browser/origin_guard.rs — the per-operation decision
//! @coordinates-with browser/one_shot.rs — single-use "Allow once" consumption

use crate::browser::one_shot::{self, OneShotTarget};
use crate::browser::origin_guard;
use crate::browser::redact;
use crate::browser::registry::AutomationMode;
use crate::browser::surface::{self, BrowserSurface};

/// The full driver authorization gate, shared by every command that drives a
/// **committed** page (`browser_eval`, `browser_screenshot`).
///
/// **This is the authoritative security gate for R4/I3/R7a.** It is extracted
/// into one function precisely so a second command cannot grow its own inline
/// copy that drifts from this one — the mutually-masked divergence
/// `.claude/rules/60-ai-governance.md` §10 warns about. Taking `&BrowserSurface`
/// (not an AppHandle-bound `State`) also makes the gate unit-testable without a
/// Tauri harness. Callers still check approval for UX, but that check is
/// advisory: any code path reaching a driver command is refused unless all
/// three invariants hold —
///
///   1. `generation` matches the tab's current navigation generation. This
///      closes the TOCTOU where a page navigates between the approval decision
///      and the command, which would otherwise run an approved action against a
///      *different* origin. A stale command is rejected, never best-effort applied.
///   2. The tab has a **committed** top-level URL (R7a). A provisional/in-flight
///      navigation grants nothing — a redirect chain must not briefly authorize
///      an intermediate origin.
///   3. That committed origin grants `operation` (R4/R5), by standing grant or a
///      one-shot consumed here atomically (or, for a human tab, an attachment
///      consumed here). The origin is read from the registry, never from a
///      caller-supplied URL. A denied action consumes neither a one-shot nor an
///      attachment.
///
/// On `Ok(())` the caller may run its AppHandle-bound side effect (the eval or
/// the capture); nothing here touches the page.
pub(crate) fn authorize_driver_op(
    state: &BrowserSurface,
    tab_id: &str,
    generation: u64,
    operation: &str,
    // The element an `act` targets (absent for a `read`/`screenshot`). Passed as
    // structured data — not parsed out of an opaque script — so the decision and
    // a one-shot's target binding rest on the descriptor the caller declared.
    target: Option<&OneShotTarget>,
) -> Result<(), String> {
    let policy = state
        .ai_policy
        .lock()
        .map_err(|e| e.to_string())
        .map(|policy| *policy)?;
    if !policy.enabled {
        return Err("BROWSER_DISABLED".into());
    }
    let reg = state.registry.lock().map_err(|e| e.to_string())?;

    if !reg.is_command_fresh(tab_id, generation) {
        return Err(format!(
            "stale command: tab '{tab_id}' navigated or closed since this operation was authorized"
        ));
    }

    // The origin comes from the registry's committed URL — NOT from the caller.
    let committed = reg
        .committed_url(tab_id)
        .ok_or_else(|| format!("tab '{tab_id}' has no committed page; nothing is granted yet"))?;

    let mode = reg
        .automation_mode(tab_id)
        .ok_or_else(|| "TAB_NOT_FOUND".to_string())?;
    if mode != AutomationMode::Human && reg.policy_epoch(tab_id) != Some(policy.epoch) {
        return Err("POLICY_STALE".into());
    }
    let shared_origin_approved =
        mode == AutomationMode::AiShared && reg.shared_navigation_approved(tab_id, committed);
    let attached = state.is_tab_attached(tab_id, generation);
    let grants = state.grants.lock().map_err(|e| e.to_string())?;
    let allowed = origin_guard::is_driver_operation_allowed_for_mode(
        committed,
        operation,
        &grants,
        mode,
        attached,
        shared_origin_approved,
    );
    drop(grants); // authority computed; don't hold this lock across the spends below

    // A human tab requires an ephemeral attachment for EVERY operation — read AND
    // mutating — on top of any standing grant or one-shot. A grant authorizes the
    // *operation* on the origin; it is NEVER the per-view human consent. Refusing
    // an unattached human tab here is what stops a granted click/type from slipping
    // past on a tab the user never attached (Audit, High).
    if mode == AutomationMode::Human && !attached {
        return Err("ATTACHMENT_REQUIRED".into());
    }
    // For a human tab, hold the attachments lock from the presence check THROUGH
    // the consume, so the single-use attachment cannot be raced away in between —
    // otherwise a lost race after a one-shot was already spent would burn that
    // one-shot on an action that never runs (Audit round 2). A non-human tab needs
    // no attachment, so the guard stays None.
    let mut human_attachment = if mode == AutomationMode::Human {
        let guard = state.attachments.lock().map_err(|e| e.to_string())?;
        // Re-verify under THIS held lock (the earlier `attached` used a transient one).
        if !surface::attachment_present(&guard, tab_id, generation) {
            return Err("ATTACHMENT_REQUIRED".into());
        }
        Some(guard)
    } else {
        None
    };
    if !allowed {
        // No standing authority. A single-use "Allow once" may still authorize
        // this exact action — consumed HERE, atomically, so the check and the
        // spend cannot be separated (and so a one-shot the frontend believed in
        // is actually honored by the authority rather than refused by it). The
        // full descriptor (tab, generation, origin, operation, target) must
        // match, so an approval can't be spent on a different page or element.
        let mut one_shots = state.one_shots.lock().map_err(|e| e.to_string())?;
        if !one_shot::consume_one_shot(&mut one_shots, tab_id, generation, committed, operation, target)
        {
            // Origin only. The committed URL's query string routinely carries session
            // tokens and document ids, and a refusal log is not a place to persist
            // them. (Audit, Medium.)
            log::warn!(
                "[browser] REFUSED {operation} on {} (tab {tab_id}): not granted",
                redact::redact(committed)
            );
            return Err(format!(
                "operation '{operation}' is not granted for the current origin"
            ));
        }
        log::info!(
            "[browser] {operation} on {} (tab {tab_id}): one-shot consumed",
            redact::redact(committed)
        );
    }
    // Attachment verified present under the still-held lock ⇒ this consume cannot
    // fail; a persistent attachment (uses = None) is left in place. Done last, so a
    // denied action never burns consent.
    if let Some(attachments) = human_attachment.as_deref_mut() {
        surface::consume_attachment_in(attachments, tab_id, generation);
    }
    Ok(())
}

/// Re-check that a command authorized against (`tab_id`, `generation`) is STILL
/// valid — the tab hasn't navigated, closed, or had its policy epoch bumped —
/// WITHOUT consuming any one-shot or attachment. Closes the window between
/// authorizing a capture and the capture completing: `takeSnapshot` pumps the
/// run loop for up to ten seconds, during which the page can navigate, and a
/// stale generation must not return pixels from a different origin (Audit, High).
pub(crate) fn command_still_fresh(state: &BrowserSurface, tab_id: &str, generation: u64) -> bool {
    let Ok(policy) = state.ai_policy.lock().map(|policy| *policy) else {
        return false;
    };
    if !policy.enabled {
        return false;
    }
    let Ok(reg) = state.registry.lock() else {
        return false;
    };
    if !reg.is_command_fresh(tab_id, generation) || reg.committed_url(tab_id).is_none() {
        return false;
    }
    match reg.automation_mode(tab_id) {
        Some(AutomationMode::Human) => true,
        Some(_) => reg.policy_epoch(tab_id) == Some(policy.epoch),
        None => false,
    }
}

#[cfg(test)]
#[path = "authorize.test.rs"]
mod tests;
