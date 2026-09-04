//! The resolved-address pre-flight as the AI transactions raise it (audit 20260903
//! round 4, #7 / #8): the refusal class and the lock discipline around the lookup.
//! Split out of `ai_transactions.rs` for size; that module is the only caller.
//!
//! @coordinates-with browser/ai_policy_dns.rs — the pre-flight itself
//! @coordinates-with browser/ai_guards.rs — `blocked_destination`, the class reused
//! @coordinates-with browser/ai_transactions.rs — `create_native_with` / `navigate_native_with`

use crate::browser::ai_guards::{blocked_destination, lock_failure};
use crate::browser::ai_policy_dns::{
    preflight_destination, DestinationRefused, DestinationResolver,
};
use crate::browser::surface::BrowserSurface;
use crate::command_error::CommandError;
use serde_json::json;

/// The refusal a resolved-address pre-flight raises: the SAME class as a blocked
/// literal (`blocked_destination`: `permission-denied`, `SSRF_BLOCKED`,
/// `kind: ssrf-blocked`), plus the normalized host and why
/// (`reason: resolves-private | unresolved`) — the MCP client already matches
/// on that token, and a name and its literal are one policy (round 4, #7/#8).
pub(crate) fn resolved_destination_refused(refused: &DestinationRefused) -> CommandError {
    let error = blocked_destination();
    let mut detail = error
        .detail()
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
    if let Some(object) = detail.as_object_mut() {
        object.insert("host".into(), json!(refused.host));
        object.insert("reason".into(), json!(refused.reason.as_str()));
    }
    error.with_detail(detail)
}

/// Resolve `url`'s host and judge every answer under the CURRENT loopback
/// posture. The posture is read and released before the resolver runs: DNS may
/// take seconds, and the navigation delegate on the main thread takes the
/// surface's locks — resolving under one would stall the UI.
pub(crate) fn preflight(
    state: &BrowserSurface,
    url: &str,
    resolver: &dyn DestinationResolver,
) -> Result<(), CommandError> {
    let allow_loopback = state.ai_policy.lock().map_err(lock_failure)?.allow_loopback;
    preflight_destination(resolver, url, allow_loopback).map_err(|refused| {
        log::warn!(
            "[browser] AI destination pre-flight refused {} ({})",
            refused.host,
            refused.reason.as_str()
        );
        resolved_destination_refused(&refused)
    })
}
