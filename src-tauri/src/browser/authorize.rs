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
//! The gate is two halves composed under one guard (audit 20260903 round 3,
//! #10): `authorize_decision.rs` builds an immutable `Decision` from the
//! registry, the policy and the owning window's grants, spending nothing;
//! `authorize_spend.rs` consumes exactly what that decision requires. The
//! composition here owns the LOCK ORDER — registry, held across both halves;
//! then attachments (a released peek) and grants (released before any spend);
//! then, inside the spend, attachments → one_shots — and nothing else.
//!
//! @coordinates-with browser/authorize_decision.rs — the immutable decision
//! @coordinates-with browser/authorize_spend.rs — the atomic spend
//! @coordinates-with browser/refusals.rs — the typed refusal vocabulary this
//!   gate raises, split out at WI-DP2.5 to keep the security core one screen
//! @coordinates-with browser/commands_auth.rs — the command entry points

use crate::browser::ai_guards::{ai_policy, lock_failure, require_browser_enabled};
use crate::browser::one_shot::OneShotTarget;
use crate::browser::refusals::stale_command;
use crate::browser::registry::AutomationMode;
use crate::browser::surface::BrowserSurface;
use crate::command_error::CommandError;

#[path = "authorize_decision.rs"]
mod decision;
#[path = "authorize_spend.rs"]
mod spend;

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
    // Hex SHA-256 of the exact script, for `style`/`eval` (`None` otherwise). The
    // one-shot path binds it so an approved script cannot be swapped for another on
    // the retry. (Security review P5, High #1.)
    payload_hash: Option<&str>,
) -> Result<(), CommandError> {
    let policy = ai_policy(state)?;
    require_browser_enabled(&policy)?;
    // The registry guard spans the decision AND the spend: no navigation, destroy
    // or epoch bump on another thread can sit between what was decided and what
    // is consumed for it.
    let reg = state.registry.lock().map_err(lock_failure)?;
    let attached = state.is_tab_attached(tab_id, generation);
    let decided = {
        // Grants are read and released here: authority is computed, then the
        // grants lock is not held across the spends.
        let grants = state.grants.lock().map_err(lock_failure)?;
        decision::decide(
            &reg, &policy, &grants, attached, tab_id, generation, operation,
        )?
    };
    let outcome = spend::spend(
        state,
        &decided,
        tab_id,
        generation,
        operation,
        target,
        payload_hash,
    );
    drop(reg);
    outcome
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
    fresh_under_guard(&reg, &policy, tab_id, generation)
}

/// The freshness predicate itself, against guards the CALLER holds.
///
/// Extracted so `submit_if_fresh` can evaluate it and act while still holding the
/// registry lock — which is what makes the check and the dispatch atomic against
/// other threads. `command_still_fresh` keeps the convenience form for callers
/// that only need a peek.
fn fresh_under_guard(
    reg: &crate::browser::registry::BrowserRegistry,
    policy: &crate::browser::ai_policy::AiBrowserPolicy,
    tab_id: &str,
    generation: u64,
) -> bool {
    if !reg.is_command_fresh(tab_id, generation) || reg.committed_url(tab_id).is_none() {
        return false;
    }
    match reg.automation_mode(tab_id) {
        Some(AutomationMode::Human) => true,
        Some(_) => reg.policy_epoch(tab_id) == Some(policy.epoch),
        None => false,
    }
}

/// Verify freshness and SUBMIT, both under the registry guard — then hand the
/// caller a handle to await outside it.
///
/// This is the actual close on the WI-2 race. `dispatch_if_fresh` released the
/// guard before dispatching, so another thread could navigate, destroy the tab, or
/// bump the policy epoch in the gap; an audit was right that the earlier "nothing
/// can interleave" claim only covered main-thread work. Holding the registry lock
/// across the check AND the submit removes the gap entirely: no other thread can
/// mutate that state while the script is being enqueued.
///
/// **`submit` MUST NOT pump the run loop.** That is the whole reason the operation
/// is split: `callAsyncJavaScript` merely enqueues and returns, which is safe under
/// the lock, while waiting for the result pumps — and WebKit callbacks re-enter on
/// the main thread and take this same lock, so pumping here would deadlock. The
/// guard is dropped before this returns, so the caller awaits unlocked.
pub(crate) fn submit_if_fresh<S, H>(
    state: &BrowserSurface,
    tab_id: &str,
    generation: u64,
    submit: S,
) -> Result<H, CommandError>
where
    S: FnOnce() -> H,
{
    let policy = state.ai_policy.lock().map_err(lock_failure).map(|p| *p)?;
    require_browser_enabled(&policy)?;
    let reg = state.registry.lock().map_err(lock_failure)?;
    if !fresh_under_guard(&reg, &policy, tab_id, generation) {
        return Err(stale_command(tab_id, "before the script could run"));
    }
    // Enqueue while still holding the guard — this is the atomic step.
    let handle = submit();
    drop(reg);
    Ok(handle)
}

#[cfg(test)]
#[path = "authorize.test.rs"]
mod tests;
