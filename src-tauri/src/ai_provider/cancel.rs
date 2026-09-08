//! Per-request cancellation for the streaming `run_ai_prompt` path.
//!
//! Purpose: let the webview's Cancel reach the provider. `run_ai_prompt`
//! dispatches under a `CancellationToken` registered here for exactly the
//! dispatch's lifetime, and `cancel_ai_prompt` fires it — which kills a CLI
//! child (`cli.rs`) or drops the in-flight REST request (`dispatch.rs`).
//! Before this the streaming path wired a fresh token nothing could fire, and
//! the frontend's cancel only dropped its `ai:response` listener while the
//! provider ran on to completion (audit #375).
//!
//! Key decisions:
//!   - Managed Tauri state, never a static (rule 50 §10): every caller holds
//!     the app, and a test constructs its own registry instead of sharing one.
//!   - Registration is a drop guard (`InFlightRequest`). The entry leaves the
//!     table when the guard does — on `Ok`, on `Err`, and when the command
//!     future is dropped mid-flight — with no per-return cleanup to forget.
//!   - A request id already in flight is REFUSED, not overwritten. The
//!     frontend mints one id per invocation (`crypto.randomUUID()`), so a
//!     repeat is a caller bug; overwriting would let the first guard's drop
//!     evict the second's live token — the "dispose A → create B → dispose A"
//!     class `services/editor/editorActionOwner.ts` already guards against.
//!   - Cancelling an id that is not in flight succeeds as a no-op (logged at
//!     debug). Cancel is a desired-state operation — "this request is not
//!     running" — and the benign race, a stream finishing between the click
//!     and the IPC arriving, must not become an error the frontend would have
//!     to swallow, which would also hide a genuinely wrong id. `cancel_workflow`
//!     answers `not-found` instead because its execution id is user-visible
//!     panel state, where a stale id means a stale panel.
//!   - Desired state means it also holds FORWARD (audit #242). `run_ai_prompt`
//!     and `cancel_ai_prompt` are two independently spawned command futures,
//!     so a cancel for an id whose registration has not run yet used to be a
//!     successful no-op and the request then started under a fresh, uncancelled
//!     token — the exact silent failure this module exists to delete, at a
//!     narrower window. A cancel with nothing to fire is therefore REMEMBERED,
//!     and the next registration under that id starts already cancelled. The
//!     memory is bounded (`PRE_CANCELLED_CAP`) and consumed on use; ids are
//!     `crypto.randomUUID()`, so it can only ever match the request it was
//!     meant for.
//!
//! @coordinates-with dispatch.rs — the dispatch the token aborts
//! @coordinates-with cli.rs — kills the child once the token fires
//! @module ai_provider/cancel

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::State;
use tokio_util::sync::CancellationToken;

use super::dispatch::{dispatch_to_provider, ProviderRequest};
use super::sink::AiSink;
use crate::command_error::CommandError;

/// Streaming requests currently dispatching, keyed by the frontend-minted
/// request id. Managed by Tauri (`.manage()` in `lib.rs`).
#[derive(Default)]
pub struct AiPromptCancelRegistry {
    in_flight: Mutex<HashMap<String, CancellationToken>>,
    /// Ids cancelled before anything registered under them, newest last.
    pre_cancelled: Mutex<VecDeque<String>>,
}

/// How many pre-registration cancels are remembered. The window they cover is
/// two IPC dispatches wide, so one is realistic and a queue this size is
/// generous; the cap is what keeps a caller that only ever cancels unknown ids
/// from growing the map without bound.
const PRE_CANCELLED_CAP: usize = 32;

impl AiPromptCancelRegistry {
    /// Register a fresh token under `request_id` for as long as the returned
    /// guard lives. `None` when that id is already in flight.
    pub fn register(&self, request_id: &str) -> Option<InFlightRequest<'_>> {
        let mut table = self.table();
        if table.contains_key(request_id) {
            return None;
        }
        let token = CancellationToken::new();
        // A cancel that arrived before this registration is honoured here, not
        // dropped: the dispatch starts already cancelled and ends at its first
        // check rather than running to completion unstoppably (#242).
        if self.take_pre_cancel(request_id) {
            log::info!("AI prompt {request_id} was cancelled before it registered");
            token.cancel();
        }
        table.insert(request_id.to_owned(), token.clone());
        Some(InFlightRequest {
            registry: self,
            request_id: request_id.to_owned(),
            token,
        })
    }

    /// Fire the token registered under `request_id`. `false` when nothing is
    /// in flight under that id — finished, already cancelled, or never started.
    pub fn cancel(&self, request_id: &str) -> bool {
        match self.table().get(request_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => {
                self.remember_pre_cancel(request_id);
                false
            }
        }
    }

    /// Remember a cancel that found nothing, dropping the oldest past the cap.
    fn remember_pre_cancel(&self, request_id: &str) {
        let mut seen = self.pre_cancelled.lock().unwrap_or_else(|p| p.into_inner());
        if seen.iter().any(|id| id == request_id) {
            return;
        }
        if seen.len() >= PRE_CANCELLED_CAP {
            seen.pop_front();
        }
        seen.push_back(request_id.to_owned());
    }

    /// Consume a remembered cancel for `request_id`, if there is one.
    fn take_pre_cancel(&self, request_id: &str) -> bool {
        let mut seen = self.pre_cancelled.lock().unwrap_or_else(|p| p.into_inner());
        match seen.iter().position(|id| id == request_id) {
            Some(at) => {
                seen.remove(at);
                true
            }
            None => false,
        }
    }

    /// Whether a request is currently registered under `request_id` — a test
    /// observation point; production only ever registers and cancels.
    #[cfg(test)]
    pub fn is_in_flight(&self, request_id: &str) -> bool {
        self.table().contains_key(request_id)
    }

    fn table(&self) -> MutexGuard<'_, HashMap<String, CancellationToken>> {
        // A poisoned lock means a panic while holding it; the map has no
        // invariant a half-applied insert or remove can break, so recover.
        self.in_flight.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// A registered request. Dropping it removes the entry, so the table cannot
/// keep a token for a dispatch that has already returned.
pub struct InFlightRequest<'a> {
    registry: &'a AiPromptCancelRegistry,
    request_id: String,
    token: CancellationToken,
}

impl InFlightRequest<'_> {
    /// The token `cancel_ai_prompt` fires for this request.
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for InFlightRequest<'_> {
    fn drop(&mut self) {
        self.registry.table().remove(&self.request_id);
    }
}

/// Dispatch `request` under a token registered for exactly the dispatch's
/// lifetime. This is `run_ai_prompt` minus its boundary — the `cli_path`
/// guard and the window sink stay in the command — so it runs under any sink.
pub(super) async fn dispatch_registered(
    registry: &AiPromptCancelRegistry,
    request_id: &str,
    sink: Arc<dyn AiSink>,
    request: ProviderRequest<'_>,
) -> Result<(), String> {
    let in_flight = registry
        .register(request_id)
        .ok_or_else(|| format!("AI request {request_id} is already in flight"))?;
    dispatch_to_provider(sink, in_flight.token(), request).await
}

/// Cancel the streaming AI request `request_id` — the id the frontend passed
/// to `run_ai_prompt`. Idempotent: an id that is not in flight is a no-op.
#[tauri::command]
pub async fn cancel_ai_prompt(
    state: State<'_, AiPromptCancelRegistry>,
    request_id: String,
) -> Result<(), CommandError> {
    if state.cancel(&request_id) {
        log::info!("AI prompt cancellation requested for {request_id}");
    } else {
        log::debug!("cancel_ai_prompt: no request in flight for {request_id}");
    }
    Ok(())
}

#[cfg(test)]
#[path = "cancel.test.rs"]
mod tests;
