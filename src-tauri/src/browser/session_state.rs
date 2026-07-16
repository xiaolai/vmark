//! Persisted browser storage-state blobs (WI-P6.2 / P6.3) — the credential-bearing
//! cookies + `localStorage` the AI reuses by an opaque HANDLE, never by value.
//!
//! Security model (ADR-A7):
//!   - The blob is stored in the **OS keychain**, not a plaintext file, so
//!     encryption-at-rest is the keychain's job — the same posture as
//!     `secure_store.rs` for API keys. A distinct service namespace keeps a
//!     storage-state blob from ever being confused with an API key.
//!   - The AI is handed only a **handle**. Cookie/token VALUES never cross the
//!     trust boundary to the AI and are never written to a log — `redacted_summary`
//!     is the only thing about a blob that is safe to surface.
//!   - Loading a blob into a context is per-call **user-approved** (op `session`,
//!     never grantable — see `operation.rs`), enforced above this layer.
//!
//! This module is platform-neutral and unit-tested against the keyring crate's
//! in-memory `mock` store; the native cookie/`localStorage` capture that produces a
//! `StorageState` lives in `session_macos.rs`.
//!
//! @coordinates-with browser/secure_store.rs — the same keychain pattern for API keys
//! @coordinates-with browser/session_macos.rs — native capture/replay of a StorageState

use keyring::Entry;
use serde::{Deserialize, Serialize};

/// One cookie captured from a context (the `WKHTTPCookie` fields we can replay).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StoredCookie {
    pub name: String,
    /// SECRET — never logged, never returned to the AI.
    pub value: String,
    pub domain: String,
    pub path: String,
    #[serde(default)]
    pub secure: bool,
    /// Whether the cookie was HttpOnly at capture. `cookieWithProperties:` CANNOT
    /// recreate an HttpOnly cookie, so replay SKIPS these rather than restoring them
    /// without the flag (which would let an untrusted page read the credential via
    /// `document.cookie`). HttpOnly logins are the named-context feature's job.
    /// (Sec review — cookie H1.)
    #[serde(default, rename = "httpOnly")]
    pub http_only: bool,
    /// Unix seconds; `None` for a session cookie. Preserved on replay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<f64>,
    /// SameSite policy string (`strict`/`lax`/`none`), if any — preserved on replay
    /// so a Strict cookie is not restored with weaker cross-site behaviour.
    #[serde(default, rename = "sameSite", skip_serializing_if = "Option::is_none")]
    pub same_site: Option<String>,
}

/// Per-origin `localStorage` snapshot. Values are SECRET.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OriginStorage {
    pub origin: String,
    /// `(key, value)` pairs; the value is SECRET.
    pub items: Vec<(String, String)>,
}

/// A full storage-state blob for one saved session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct StorageState {
    /// The committed origin this session was captured from (`scheme://host[:port]`),
    /// or `None` for a legacy blob. Load binds the WHOLE restore to it — including a
    /// cookies-only blob (which has empty `origins`) — so a saved session can never
    /// be replayed into a different origin. (Sec review P6: cookie work must add its
    /// own destination enforcement, not rely on the per-localStorage-origin check.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    pub cookies: Vec<StoredCookie>,
    #[serde(default)]
    pub origins: Vec<OriginStorage>,
}

impl StorageState {
    /// A value-FREE, one-line summary safe to log or hand to the AI: COUNTS only,
    /// never a name or value. This is the ONLY view of a blob allowed to leave
    /// this layer other than a same-process replay into a context.
    pub fn redacted_summary(&self) -> String {
        let items: usize = self.origins.iter().map(|o| o.items.len()).sum();
        format!(
            "{} cookie(s), {} origin(s), {} localStorage item(s)",
            self.cookies.len(),
            self.origins.len(),
            items
        )
    }
}

/// Keychain namespace for storage-state blobs — distinct from `secure_store`'s
/// `app.vmark.secrets` so a blob is never confused with an API key.
const SERVICE: &str = "app.vmark.browser.storagestate";

/// A handle is the keychain account name AND appears in the AI-facing response, so
/// it must be a safe, bounded token — never free-form text that could smuggle a
/// value or a control character into either place.
fn validate_handle(handle: &str) -> Result<(), String> {
    if handle.is_empty() || handle.len() > 128 {
        return Err("storage-state handle must be 1..=128 chars".into());
    }
    if !handle
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("storage-state handle must be [A-Za-z0-9._-]".into());
    }
    Ok(())
}

fn entry(handle: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, handle).map_err(|e| format!("keychain entry error: {e}"))
}

// Core ops take an `&Entry` so they can be unit-tested against a single shared
// mock credential (each `Entry::new` under the mock store owns its own in-memory
// credential, so a fresh entry per call would never observe a prior write).

fn persist_on(entry: &Entry, state: &StorageState) -> Result<(), String> {
    let json = serde_json::to_string(state).map_err(|e| format!("serialize storage-state: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("store storage-state: {e}"))
}

fn load_on(entry: &Entry) -> Result<Option<StorageState>, String> {
    match entry.get_password() {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| format!("parse storage-state: {e}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("read storage-state: {e}")),
    }
}

fn forget_on(entry: &Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("delete storage-state: {e}")),
    }
}

/// Store `state` under `handle` in the OS keychain (insert or overwrite).
pub fn persist(handle: &str, state: &StorageState) -> Result<(), String> {
    validate_handle(handle)?;
    persist_on(&entry(handle)?, state)
}

/// Read the blob stored under `handle`. `Ok(None)` when nothing is stored (the
/// normal "unknown handle" case), `Err` only on a real keychain/parse failure.
pub fn load(handle: &str) -> Result<Option<StorageState>, String> {
    validate_handle(handle)?;
    load_on(&entry(handle)?)
}

/// Delete the blob under `handle`. Deleting a missing handle is an idempotent no-op.
pub fn forget(handle: &str) -> Result<(), String> {
    validate_handle(handle)?;
    forget_on(&entry(handle)?)
}

#[cfg(test)]
#[path = "session_state.test.rs"]
mod tests;
