//! Session & storage-state commands (WI-P6.2 / P6.3) — save and load a context's
//! credential blob by an opaque HANDLE, **user-approved per call** (op `session`).
//!
//! Security model (ADR-A7):
//!   - `session` is NEVER_GRANTABLE (operation.rs), so `authorize_driver_op` never
//!     authorizes it from a standing grant — it always needs a fresh one-shot the
//!     user minted for THIS action. The one-shot is payload-bound to an
//!     `action:handle` descriptor, so an "Allow once" for `load:work_login` cannot
//!     be spent on loading a different session (the same anti-substitution rule as
//!     style/eval — see the Phase 5 security review).
//!   - `save` returns only a value-FREE `redacted_summary` (counts); `load` returns
//!     nothing. Cookie/token VALUES never cross to the AI and are never logged.
//!   - The blob lives in the OS keychain (session_state.rs), not a plaintext file.
//!
//! Capture/replay scope: `localStorage` is captured and replayed through the
//! isolated-world eval (per-origin storage is shared across content worlds). Cookie
//! capture via `WKHTTPCookieStore` is the remaining NATIVE piece and is verified by
//! live E2E — a `StorageState` already carries a `cookies` vec for when it lands.
//!
//! @coordinates-with browser/session_state.rs — keychain persistence + the model
//! @coordinates-with browser/authorize.rs — the shared driver-authorization gate

use crate::browser::authorize::{authorize_driver_op, command_still_fresh};
use crate::browser::origin_guard::canonicalize_origin;
use crate::browser::session_state::{self, OriginStorage, StorageState};
use crate::browser::surface::{self, BrowserSurface};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

/// Bind the one-shot to the exact `action:handle` so an approved save/load cannot
/// be spent on a different handle or the other action.
fn session_payload_hash(action: &str, handle: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{action}:{handle}").as_bytes());
    format!("{:x}", hasher.finalize())
}

fn committed_origin(state: &BrowserSurface, tab_id: &str) -> Result<String, String> {
    let reg = state.registry.lock().map_err(|e| e.to_string())?;
    reg.committed_url(tab_id)
        .map(str::to_owned)
        .ok_or_else(|| format!("tab '{tab_id}' has no committed page"))
}

/// Capture the current page's session: `localStorage` (per-origin, via the
/// isolated-world eval) AND cookies (via the native `WKHTTPCookieStore`). The blob
/// records the committed `origin` it was captured from, so load can bind the whole
/// restore to it (even a cookies-only blob with empty `origins`).
///
/// FAILS CLOSED: a failed/timed-out eval (`<null>`/`<timeout>`) or an unparseable
/// result is an error, NEVER an empty blob — so a capture that could not read the
/// page cannot silently overwrite a good saved session with nothing. (Sec review
/// P6, Medium.)
fn capture(app: &AppHandle, tab_id: &str, origin: &str) -> Result<StorageState, String> {
    let script = "return JSON.stringify(Object.keys(localStorage).map(function(k){return [k, localStorage.getItem(k)];}));";
    let raw = surface::eval(app, tab_id.to_string(), script.to_string())?;
    if raw == "<null>" || raw == "<timeout>" || raw.is_empty() {
        return Err("capture failed: could not read the page's storage".into());
    }
    let items: Vec<(String, String)> =
        serde_json::from_str(&raw).map_err(|e| format!("capture parse error: {e}"))?;
    let origins = if items.is_empty() {
        Vec::new()
    } else {
        vec![OriginStorage {
            origin: origin.to_string(),
            items,
        }]
    };
    // Cookies from the native store, DOMAIN-SCOPED to the committed host (never the
    // whole store). A failed native capture is an error, not an empty set.
    let host = host_of(origin).ok_or_else(|| "committed page has no host".to_string())?;
    let cookies = surface::capture_cookies(app, tab_id.to_string(), host)?;
    Ok(StorageState {
        origin: Some(origin.to_string()),
        cookies,
        origins,
    })
}

/// The host of a committed URL (for cookie domain-scoping on replay).
fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
}

/// Every saved origin must canonically equal the destination's committed origin,
/// or the whole restore is refused. This is the cross-origin credential-release
/// guard (Sec review P6, Critical/High) — pure, so it is unit-tested directly.
pub(crate) fn ensure_same_origin(committed: &str, state: &StorageState) -> Result<(), String> {
    let here = canonicalize_origin(committed)
        .ok_or_else(|| "current page has no canonical origin".to_string())?;
    let mismatch = || -> String {
        "STORAGE_STATE_ORIGIN_MISMATCH: the saved session is for a different origin \
         than the current page — refusing to write credentials cross-origin"
            .to_string()
    };
    // Session-level binding: covers a COOKIES-ONLY blob (empty `origins`), which the
    // per-localStorage-origin loop below would otherwise pass vacuously. (Sec review
    // P6 re-verify note.)
    match &state.origin {
        Some(saved) => {
            let saved = canonicalize_origin(saved)
                .ok_or_else(|| "saved session has a non-canonical origin".to_string())?;
            if saved != here {
                return Err(mismatch());
            }
        }
        // [L2] A blob carrying cookies MUST carry a canonical origin to bind them to;
        // refuse an origin-less cookie blob rather than let it apply anywhere.
        None if !state.cookies.is_empty() => {
            return Err(
                "STORAGE_STATE_UNSCOPED: a saved session with cookies has no origin to bind to"
                    .into(),
            );
        }
        None => {}
    }
    for origin in &state.origins {
        let saved = canonicalize_origin(&origin.origin)
            .ok_or_else(|| "saved session has a non-canonical origin".to_string())?;
        if saved != here {
            return Err(mismatch());
        }
    }
    Ok(())
}

/// Replay a blob's `localStorage` into the current page — ONLY into a page whose
/// committed origin matches every saved entry's origin (`ensure_same_origin`), so a
/// credential can never be written cross-origin. Never returns values. (Sec review P6.)
fn apply(
    app: &AppHandle,
    tab_id: &str,
    committed: &str,
    state: &StorageState,
) -> Result<(), String> {
    // Defence in depth: refuse a cross-origin blob on the COMMAND thread before we
    // even dispatch. But the authoritative check is IN the replay script below —
    // the command-thread check can be raced by a navigation before the main-thread
    // write actually runs (Sec review P6 re-verify, PARTIAL #1).
    ensure_same_origin(committed, state)?;
    // Cookies first: replayed into the native store, DOMAIN-SCOPED to the committed
    // host (apply_cookies drops any cookie whose domain doesn't cover it), so a saved
    // session's cookies can never be planted under an unrelated origin.
    if !state.cookies.is_empty() {
        let host = host_of(committed)
            .ok_or_else(|| "current page has no host for cookie replay".to_string())?;
        let origin = url::Url::parse(committed)
            .ok()
            .map(|u| u.origin().ascii_serialization())
            .ok_or_else(|| "current page has no canonical origin".to_string())?;
        surface::apply_cookies(app, tab_id.to_string(), host, origin, state.cookies.clone())?;
    }
    // All saved origins equal `committed` (ensure_same_origin), so flatten and write once.
    let items: Vec<&(String, String)> = state.origins.iter().flat_map(|o| &o.items).collect();
    if items.is_empty() {
        return Ok(());
    }
    // The values are injected as a JSON literal the script READS — never interpolated
    // into code. The script re-checks the EXECUTING document's live origin against the
    // approved one immediately before any write, in the SAME synchronous turn, so a
    // navigation that raced the main-thread dispatch cannot land the credential in a
    // different origin. Both sides use the browser's own origin normalization.
    let pairs = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    let expected = serde_json::to_string(committed).map_err(|e| e.to_string())?;
    let script = format!(
        "if(new URL({expected}).origin!==location.origin){{return JSON.stringify({{applied:false,reason:'origin-changed'}});}}\
         var d={pairs};for(var i=0;i<d.length;i++){{try{{localStorage.setItem(d[i][0],d[i][1]);}}catch(e){{}}}}return JSON.stringify({{applied:true}});"
    );
    let raw = surface::eval(app, tab_id.to_string(), script)?;
    if raw.contains("origin-changed") {
        return Err(
            "stale command: the page's origin changed before the session could be restored \
             — refusing to write credentials into a different origin"
                .into(),
        );
    }
    Ok(())
}

/// Snapshot the tab's session into the keychain under `handle`; return a value-FREE
/// summary. Gated on a fresh, payload-bound `session` one-shot (`save:handle`).
#[tauri::command]
pub async fn browser_save_storage_state(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    generation: u64,
    handle: String,
) -> Result<String, String> {
    let payload_hash = session_payload_hash("save", &handle);
    authorize_driver_op(
        &state,
        &tab_id,
        generation,
        "session",
        None,
        Some(&payload_hash),
    )?;
    let origin = committed_origin(&state, &tab_id)?;
    let captured = capture(&app, &tab_id, &origin)?;
    // The capture eval could have raced a navigation, leaving `captured` labelled
    // with `origin` but read from a different page. Re-check freshness before
    // persisting so a mislabelled blob never overwrites a good saved session.
    if !command_still_fresh(&state, &tab_id, generation) {
        return Err(format!(
            "stale command: tab '{tab_id}' navigated or closed during capture"
        ));
    }
    session_state::persist(&handle, &captured)?;
    // Counts only — never a cookie/localStorage name or value.
    Ok(captured.redacted_summary())
}

/// Restore a saved session (by `handle`) into the tab. Returns nothing — the AI
/// never sees the values. Gated on a fresh, payload-bound `session` one-shot
/// (`load:handle`).
#[tauri::command]
pub async fn browser_load_storage_state(
    app: AppHandle,
    state: State<'_, BrowserSurface>,
    tab_id: String,
    generation: u64,
    handle: String,
) -> Result<(), String> {
    let payload_hash = session_payload_hash("load", &handle);
    authorize_driver_op(
        &state,
        &tab_id,
        generation,
        "session",
        None,
        Some(&payload_hash),
    )?;
    let blob = session_state::load(&handle)?
        .ok_or_else(|| "no saved session for that handle".to_string())?;
    // The keychain read + main-thread dispatch open a window in which the page can
    // navigate. A credential write cannot be undone, so re-check freshness right
    // before replay (as browser_eval does) and read the CURRENT committed origin —
    // `apply` refuses unless every saved entry's origin matches it. (Sec review P6.)
    if !command_still_fresh(&state, &tab_id, generation) {
        return Err(format!(
            "stale command: tab '{tab_id}' navigated or closed before the session could be restored"
        ));
    }
    let committed = committed_origin(&state, &tab_id)?;
    apply(&app, &tab_id, &committed, &blob)
}

/// Delete a saved session. User-initiated cleanup (the profile UI / data
/// management), not an AI operation, so it carries no driver gate.
#[tauri::command]
pub async fn browser_forget_storage_state(handle: String) -> Result<(), String> {
    session_state::forget(&handle)
}

#[cfg(test)]
#[path = "session_commands.test.rs"]
mod tests;
