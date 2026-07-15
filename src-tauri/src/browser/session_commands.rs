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

use crate::browser::authorize::authorize_driver_op;
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

/// Capture the current page's `localStorage` (per-origin) via the isolated-world
/// eval. Cookies are the remaining native piece (see module note); a
/// localStorage-only blob still round-trips app-local session state.
fn capture(app: &AppHandle, tab_id: &str, origin: &str) -> Result<StorageState, String> {
    let script = "return JSON.stringify(Object.keys(localStorage).map(function(k){return [k, localStorage.getItem(k)];}));";
    let raw = surface::eval(app, tab_id.to_string(), script.to_string())?;
    let items: Vec<(String, String)> = serde_json::from_str(&raw).unwrap_or_default();
    let origins = if items.is_empty() {
        Vec::new()
    } else {
        vec![OriginStorage {
            origin: origin.to_string(),
            items,
        }]
    };
    Ok(StorageState {
        cookies: Vec::new(),
        origins,
    })
}

/// Replay a blob's `localStorage` into the current page. Never returns values.
fn apply(app: &AppHandle, tab_id: &str, state: &StorageState) -> Result<(), String> {
    for origin in &state.origins {
        // The values are injected as a JSON literal the isolated-world script reads
        // — never interpolated into code — and setItem failures are swallowed
        // per-item so one quota rejection doesn't abort the whole restore.
        let pairs = serde_json::to_string(&origin.items).map_err(|e| e.to_string())?;
        let script = format!(
            "var d={pairs};for(var i=0;i<d.length;i++){{try{{localStorage.setItem(d[i][0],d[i][1]);}}catch(e){{}}}}return true;"
        );
        surface::eval(app, tab_id.to_string(), script)?;
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
    apply(&app, &tab_id, &blob)
}

/// Delete a saved session. User-initiated cleanup (the profile UI / data
/// management), not an AI operation, so it carries no driver gate.
#[tauri::command]
pub async fn browser_forget_storage_state(handle: String) -> Result<(), String> {
    session_state::forget(&handle)
}
