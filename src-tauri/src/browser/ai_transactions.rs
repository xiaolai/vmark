//! The state transactions behind `browser_ai_create` and `browser_ai_navigate`
//! (audit 20260903 round 3, #2 / #3 / #4), each a function over `&BrowserSurface`
//! so it is testable without a Tauri app. The commands in `ai_commands.rs` are
//! the composition — policy, validation, then these, in order — and own nothing
//! else.
//!
//! Purpose: keep the security-load-bearing sequencing in one place per step —
//! which guard is held across which decision, and what compensates a failure —
//! instead of inline in a 115-line command where a step could be reordered
//! without anything noticing.
//!
//! Key decisions:
//!   - `reserve_ai_tab` answers the retry question under ONE registry guard: mode,
//!     epoch, capacity, and the full request identity the registry recorded for
//!     the tab (#3). A retry is honoured only as the request that reserved the id.
//!   - `begin_ai_navigation` snapshots and begins under ONE guard, so a rollback
//!     restores exactly what this navigation replaced — never a page a concurrent
//!     navigation had already left (#4).
//!   - Every native call goes through `create_native` / `navigate_native`, which
//!     own the compensation: forget the tab, or restore the snapshot.
//!
//! The native calls (`create_native_with`, `navigate_native_with`) run the
//! resolved-address pre-flight (`ai_transactions_preflight.rs`) before issuing the
//! load, with the resolver injected; a refusal takes the same compensation as a
//! failed native call (round 4, #7/#8).
//!
//! @coordinates-with browser/ai_commands.rs — the composition, the only caller
//! @coordinates-with browser/registry_ai.rs — the reservation decision
//! @coordinates-with browser/ai_guards.rs — the refusal vocabulary these raise

use crate::browser::ai_guards::{
    lock_failure, require_ai_tab_capacity, require_current_epoch, surface_failure, tab_not_found,
    with_mcp_code,
};
use crate::browser::ai_policy_dns::{DestinationResolver, SystemResolver};
use crate::browser::ai_transactions_preflight::preflight;
use crate::browser::native_failure::NativeSurfaceError;
use crate::browser::profile_open::consume_profile_open;
use crate::browser::registry::{
    AiRequestMismatch, AiReservation, AiReservationRefusal, AiTabRequest, AutomationMode,
    NavigationSnapshot, NavigationTicket,
};
use crate::browser::surface::BrowserSurface;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde_json::json;

/// The tab exists under a different automation mode.
fn provenance_mismatch() -> CommandError {
    with_mcp_code(
        localized_error!(ErrorCode::Conflict, "errors.browser.tabProvenanceMismatch"),
        "TAB_PROVENANCE_MISMATCH",
    )
}

/// The tab exists, but this create is not the request that reserved it (#3):
/// another window, another url or profile, or a navigation that has since moved
/// on. A conflict — no approval lifts it; the client opens a fresh tab.
///
/// Not translated, on purpose: the MCP tool description tells the client to
/// retry the SAME request, so a mismatch is a client bug, never something the
/// user did or can act on (rule 50 §10). The kind travels in `detail.kind` so no
/// one parses the sentence.
fn request_mismatch(kind: AiRequestMismatch) -> CommandError {
    with_mcp_code(
        CommandError::conflict(format!(
            "browser tab reserved for a different request ({})",
            kind.kind()
        ))
        .with_detail(json!({ "kind": kind.kind() })),
        "TAB_REQUEST_MISMATCH",
    )
}

/// Reserve `tab_id` for `request`, or recognise the request as the one that
/// already reserved it — under one registry guard. Policy first (mode, epoch, and
/// the AI-tab cap for an id the registry does not know), then the identity the
/// registry recorded.
pub(super) fn reserve_ai_tab(
    state: &BrowserSurface,
    tab_id: &str,
    request: &AiTabRequest<'_>,
) -> Result<AiReservation, CommandError> {
    let mut reg = state.registry.lock().map_err(lock_failure)?;
    match reg.automation_mode(tab_id) {
        Some(existing) if existing != request.mode => return Err(provenance_mismatch()),
        Some(_) => require_current_epoch(reg.policy_epoch(tab_id), request.policy_epoch)?,
        // Bounded (audit 20260903 X-01): every AI `open` is an unprompted content
        // process, and URL dedupe is defeated by distinct paths.
        None => require_ai_tab_capacity(reg.live_ai_tab_count())?,
    }
    reg.reserve_ai_tab(tab_id, request)
        .map_err(|refusal| match refusal {
            AiReservationRefusal::ProvenanceMismatch => provenance_mismatch(),
            AiReservationRefusal::Terminal => tab_not_found(),
            AiReservationRefusal::Mismatch(kind) => request_mismatch(kind),
            // The window-gone class the native layer already speaks: a reservation
            // under a window in teardown is refused before anything is recorded.
            AiReservationRefusal::WindowClosed => {
                surface_failure(&NativeSurfaceError::WindowGone(format!(
                    "window '{}' is closing; nothing to attach a browser to",
                    request.window_label
                )))
            }
        })
}

/// Begin `url` on an AI tab under ONE registry guard (#4), returning the ticket
/// and the state it replaced. Shared posture records the destination approval
/// alongside, so the delegate does not ask for a second one at commit.
pub(super) fn begin_ai_navigation(
    state: &BrowserSurface,
    tab_id: &str,
    url: &str,
    mode: AutomationMode,
) -> Result<(NavigationTicket, NavigationSnapshot), CommandError> {
    let mut reg = state.registry.lock().map_err(lock_failure)?;
    let (ticket, replaced) = reg.begin_navigation_with_snapshot(tab_id, url)?;
    if mode == AutomationMode::AiShared {
        reg.set_shared_navigation_approval(tab_id, url)?;
    }
    Ok((ticket, replaced))
}

/// The profile this creation will actually apply — or a refusal.
///
/// A named profile is a SANDBOX capability: it selects an isolated persistent
/// store, and the shared posture has no such store to select. The command used to
/// drop a profile it could not honour and create an ordinary tab, which is the
/// wrong answer to a real race (round 3 follow-up): the frontend reads the
/// posture once and is awaited across, so a posture that changes mid-flight
/// produced a tab that silently lacked the login the caller asked for — and the
/// caller then drove it as though authenticated. Rust re-reads the posture at
/// creation time, and a disagreement is reported instead of resolved silently.
///
/// A `conflict`, like `POLICY_STALE`: nothing is wrong with the request, the
/// world changed, and re-reading the posture and retrying is the fix. The message
/// is plain rather than translated, matching the frontend's own local refusal for
/// the same condition (`PROFILE_REQUIRES_SANDBOX` in `browserOpenFlow.ts`) — it
/// names an AI-client contract, not something a user did.
pub(super) fn profile_for_mode(
    mode: AutomationMode,
    profile: Option<String>,
) -> Result<Option<String>, CommandError> {
    match (mode, profile) {
        (AutomationMode::AiSandbox, profile) => Ok(profile),
        (_, None) => Ok(None),
        (_, Some(profile)) => Err(with_mcp_code(
            CommandError::conflict(
                "a named browser profile applies to sandbox tabs only; the AI session posture is shared",
            )
            .with_detail(json!({ "profile": profile, "session": "shared" })),
            "PROFILE_REQUIRES_SANDBOX",
        )),
    }
}

/// Consume the per-use profile-open grant for `(profile, url)` and pin the tab's
/// read confinement to that origin (WI-P6.1 H1). `profile` is what
/// `profile_for_mode` resolved, so the posture question is already settled and
/// asked in exactly one place. No grant → the reservation is forgotten and the
/// profile is NEVER applied, so a guessed profile cannot silently open
/// authenticated content. Returns the profile to create with.
pub(super) fn authorize_profile(
    state: &BrowserSurface,
    tab_id: &str,
    profile: Option<String>,
    url: &str,
) -> Result<Option<String>, CommandError> {
    let Some(name) = profile else {
        return Ok(None);
    };
    // The grant guard is released before any other lock is taken: nothing nests
    // `profile_opens` under the registry, or the reverse.
    let granted = {
        let mut opens = state.profile_opens.lock().map_err(lock_failure)?;
        consume_profile_open(&mut opens, &name, url)
    };
    if !granted {
        state.forget_tab(tab_id).map_err(lock_failure)?;
        return Err(with_mcp_code(
            localized_error!(
                ErrorCode::PermissionDenied,
                "errors.browser.profileNotApproved"
            ),
            "PROFILE_NOT_APPROVED",
        ));
    }
    state
        .registry
        .lock()
        .map_err(lock_failure)?
        .set_profile_origin(tab_id, url)?;
    Ok(Some(name))
}

/// Run the native creation with the OS resolver (`SystemResolver`).
pub(super) fn create_native(
    state: &BrowserSurface,
    tab_id: &str,
    create: impl FnOnce() -> Result<(), NativeSurfaceError>,
) -> Result<(), CommandError> {
    create_native_with(state, tab_id, &SystemResolver::default(), create)
}

/// Run the native creation, after the resolved-address pre-flight of the
/// ticket's requested url. On EITHER failure every half of the tab's state is
/// forgotten (`forget_tab`), so a retried id starts clean, and the failure is
/// classified for the caller. A create with no begun navigation has nothing to
/// pre-flight: that is an internal failure, never a skipped check.
pub(super) fn create_native_with(
    state: &BrowserSurface,
    tab_id: &str,
    resolver: &dyn DestinationResolver,
    create: impl FnOnce() -> Result<(), NativeSurfaceError>,
) -> Result<(), CommandError> {
    let requested = state
        .registry
        .lock()
        .map_err(lock_failure)?
        .navigation_ticket(tab_id)
        .map(|ticket| ticket.requested_url.clone());
    let Some(url) = requested else {
        state.forget_tab(tab_id).map_err(lock_failure)?;
        return Err(CommandError::internal(
            "browser_ai_create reached the native call with no navigation ticket",
        ));
    };
    if let Err(refused) = preflight(state, &url, resolver) {
        state.forget_tab(tab_id).map_err(lock_failure)?;
        return Err(refused);
    }
    if let Err(error) = create() {
        state.forget_tab(tab_id).map_err(lock_failure)?;
        return Err(surface_failure(&error));
    }
    Ok(())
}

/// Run the native navigation with the OS resolver (`SystemResolver`).
pub(super) fn navigate_native(
    state: &BrowserSurface,
    tab_id: &str,
    ticket: &NavigationTicket,
    replaced: NavigationSnapshot,
    navigate: impl FnOnce() -> Result<(), NativeSurfaceError>,
) -> Result<(), CommandError> {
    navigate_native_with(
        state,
        tab_id,
        ticket,
        replaced,
        &SystemResolver::default(),
        navigate,
    )
}

/// Run the native navigation, after the resolved-address pre-flight of the
/// ticket's requested url. On EITHER failure the state `begin_ai_navigation`
/// replaced is restored — only while `ticket` is still the active navigation; a
/// newer one is left in force, since its own native call decides its fate.
pub(super) fn navigate_native_with(
    state: &BrowserSurface,
    tab_id: &str,
    ticket: &NavigationTicket,
    replaced: NavigationSnapshot,
    resolver: &dyn DestinationResolver,
    navigate: impl FnOnce() -> Result<(), NativeSurfaceError>,
) -> Result<(), CommandError> {
    let outcome = match preflight(state, &ticket.requested_url, resolver) {
        Err(refused) => Err(refused),
        Ok(()) => navigate().map_err(|error| surface_failure(&error)),
    };
    if let Err(error) = outcome {
        let mut reg = state.registry.lock().map_err(lock_failure)?;
        // `Err` here means the tab has since been forgotten: nothing to restore.
        let _ = reg.restore_navigation(tab_id, &ticket.id, replaced);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
#[path = "ai_transactions.test.rs"]
mod tests;
