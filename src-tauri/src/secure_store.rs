//! # Secure Store (OS Keychain)
//!
//! RW-16 (L8) — store API keys in OS-backed secure storage (macOS Keychain,
//! Windows Credential Manager, Linux Secret Service) instead of a plaintext
//! Zustand/`tauri-plugin-store` JSON file.
//!
//! Purpose: expose `set_secret` / `get_secret` / `delete_secret` Tauri
//! commands, scoped to a single VMark service name, so the frontend can keep
//! API keys out of any DevTools- or disk-readable plaintext location.
//!
//! Pipeline: frontend `secureSecrets.ts` → `set_secret` / `get_secret` /
//! `delete_secret` commands → `keyring::Entry` → OS credential store.
//!
//! Key decisions:
//!   - One service name (`SERVICE`) for all VMark secrets; the `key` argument
//!     becomes the keychain "account/username", giving a flat per-key
//!     namespace (e.g. `apikey.anthropic`).
//!   - `get_secret` returns `Ok(None)` for a missing entry (not an error), so
//!     callers can treat "no key yet" as a normal state.
//!   - Commands return `Result<_, CommandError>` (rule 50 §10, WI-DP2.9).
//!     `NoStorageAccess` is `permission-denied`: on macOS `keyring` 3.6.3 maps
//!     errSecNotAvailable / errSecReadOnly / errSecNoSuchKeychain /
//!     errSecInvalidKeychain to it, i.e. the credential store itself cannot be
//!     reached, and unlocking or repairing the keychain is a thing the user can
//!     actually do. An empty key is `invalid-input` (a caller bug); everything
//!     else is `internal`.
//!
//!   - **macOS classifies the OSStatus keyring hides (WI-FL6.7).** An earlier
//!     revision claimed `NoStorageAccess` covered the ACL denial described in
//!     the macOS caveat below. It does not: `errSecAuthFailed` (-25293) is NOT
//!     in keyring's mapping list (`macos.rs::decode_error`) and falls through
//!     to `PlatformFailure(Box<dyn Error>)`, so a re-signed dev build denied by
//!     the ACL was reported as `internal`. The box holds the concrete
//!     `security_framework::base::Error`; `macos_status` downcasts it and maps
//!     the status through a pure, table-tested function —
//!     `errSecAuthFailed` and `errSecInteractionNotAllowed` →
//!     `permission-denied` (localized, the one message a user must act on),
//!     `errSecItemNotFound` → `not-found`, `errSecUserCanceled` →
//!     `cancelled`, and every OTHER status → `internal` — with the status
//!     itself in `detail.osStatus`. `internal` is the conservative fallback
//!     (audit 20260907 #241): the earlier `io` invited a retry that an
//!     unrecognised status — a decode failure, a missing entitlement, a code
//!     Apple adds tomorrow — has given no reason to expect. A
//!     `PlatformFailure` that is not a keychain status, and every other
//!     platform, keep the mapping above.
//!   - Tests use the crate's `mock` credential store
//!     (`set_default_credential_builder(mock::default_credential_builder())`)
//!     so they never touch the real OS keychain.
//!
//! macOS caveat: reading/writing the login keychain from a *dev* (unsigned or
//! ad-hoc-signed) build can trigger a "vmark wants to use your confidential
//! information" prompt, and the ACL is keyed to the code signature — a
//! re-signed/rebuilt binary may be denied or re-prompt. Release builds signed
//! with a stable Developer ID identity get a stable ACL and prompt once. This
//! is expected and does not affect the persistence guarantee.

use keyring::Entry;

use crate::command_error::CommandError;

/// Single keychain service namespace for every VMark secret. The per-secret
/// `key` is stored as the keychain account, giving a flat key→value map.
const SERVICE: &str = "app.vmark.secrets";

/// Build a keyring entry for `key` under the VMark service namespace.
fn entry(key: &str) -> Result<Entry, CommandError> {
    Entry::new(SERVICE, key)
        .map_err(|e| CommandError::internal(format!("keychain entry error: {e}")))
}

/// macOS only: the OSStatus behind a keyring failure, and its classification.
///
/// keyring 3.6.3 maps four statuses to `NoStorageAccess`, `errSecItemNotFound`
/// to `NoEntry`, and boxes every other `security_framework::base::Error` inside
/// `PlatformFailure`. The box is `dyn Error + Send + Sync`, so the concrete
/// type is recoverable by downcast — which is the whole reason this crate
/// depends on `security-framework` directly (`Cargo.toml`, macOS table).
#[cfg(target_os = "macos")]
mod macos_status {
    use crate::command_error::{CommandError, ErrorCode};
    use crate::localized_error;
    use security_framework::base::Error as SecError;

    /// `errSecAuthFailed` (SecBase.h): the keychain refused this binary — the
    /// ACL denial a re-signed dev build hits, or "Deny" in the keychain prompt.
    pub(super) const ERR_SEC_AUTH_FAILED: i32 = -25293;
    /// `errSecItemNotFound` (SecBase.h). keyring maps it to `NoEntry` before it
    /// can reach `PlatformFailure`; it is in the table so the classification is
    /// complete rather than accidental.
    pub(super) const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    /// `errSecUserCanceled` (SecBase.h): the user dismissed the keychain prompt.
    pub(super) const ERR_SEC_USER_CANCELED: i32 = -128;
    /// `errSecInteractionNotAllowed` (SecBase.h): the keychain must prompt and
    /// cannot — locked, or no UI session. Unlocking it is the user's act, the
    /// same footing as the `NoStorageAccess` statuses.
    pub(super) const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;

    /// The pure mapping. Every status outside the named rows is `Internal`:
    /// nothing is known about it, so nothing licenses a retry (#241).
    pub(super) fn code_for_status(status: i32) -> ErrorCode {
        match status {
            ERR_SEC_AUTH_FAILED | ERR_SEC_INTERACTION_NOT_ALLOWED => ErrorCode::PermissionDenied,
            ERR_SEC_ITEM_NOT_FOUND => ErrorCode::NotFound,
            ERR_SEC_USER_CANCELED => ErrorCode::Cancelled,
            _ => ErrorCode::Internal,
        }
    }

    /// The OSStatus keyring hid, if `error` carries one.
    pub(super) fn os_status(error: &keyring::Error) -> Option<i32> {
        match error {
            keyring::Error::PlatformFailure(inner) => {
                inner.downcast_ref::<SecError>().map(|e| e.code())
            }
            _ => None,
        }
    }

    /// The typed error for a recovered status. Only the denial is localized: it
    /// is the one outcome the user must act on (allow VMark in the prompt, or
    /// in Keychain Access); the rest keep the diagnostic text and carry the
    /// status as machine-readable detail either way.
    pub(super) fn classified(action: &str, status: i32, message: String) -> CommandError {
        let error = match code_for_status(status) {
            ErrorCode::PermissionDenied => localized_error!(
                ErrorCode::PermissionDenied,
                "errors.secureStore.keychainDenied"
            ),
            code => CommandError::new(code, message),
        };
        error.with_detail(serde_json::json!({ "action": action, "osStatus": status }))
    }
}

/// Classify a keyring failure. `NoStorageAccess` means the credential STORE
/// could not be reached — on macOS: unavailable, read-only, missing or invalid
/// keychain — which the user can act on by unlocking or repairing it, so it is
/// `permission-denied`. On macOS the statuses keyring leaves in
/// `PlatformFailure` are classified first (`macos_status`); everywhere else, and
/// for a failure that carries no keychain status, the rest is `internal`.
fn keychain_failure(action: &str, error: keyring::Error) -> CommandError {
    let message = format!("failed to {action} secret: {error}");
    #[cfg(target_os = "macos")]
    if let Some(status) = macos_status::os_status(&error) {
        return macos_status::classified(action, status, message);
    }
    match error {
        keyring::Error::NoStorageAccess(_) => CommandError::permission_denied(message),
        _ => CommandError::internal(message),
    }
}

// Core operations take an `&Entry` so they can be unit-tested against a single
// shared mock credential (the keyring `mock` store gives each `Entry::new` its
// own in-memory credential, so a fresh entry per call would never observe a
// prior write under test). The command wrappers build a real per-key entry.

fn set_on(entry: &Entry, value: &str) -> Result<(), CommandError> {
    entry
        .set_password(value)
        .map_err(|e| keychain_failure("store", e))
}

fn get_on(entry: &Entry) -> Result<Option<String>, CommandError> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keychain_failure("read", e)),
    }
}

fn delete_on(entry: &Entry) -> Result<(), CommandError> {
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_failure("delete", e)),
    }
}

/// Longest secret key the commands accept.
///
/// A BOUND where there was none (audit 20260907 #469), not a tightening of one.
/// Every key this app produces is `apikey.<provider type>`
/// (`services/secrets/apiKeySecrets.ts`), so 256 leaves two orders of magnitude
/// of headroom over anything legitimate while refusing a megabyte of garbage at
/// the boundary instead of handing it to three different platform backends to
/// fail three different ways.
const MAX_KEY_LEN: usize = 256;

/// Validate the key and build its entry. The empty-key check was copy-pasted
/// into all three commands (audit 20260809 #6); one caller-bug rejection with
/// one message is easier to keep true than three.
///
/// **Control characters are refused, and NUL is why** (audit 20260907 #469).
/// The key becomes the keychain ACCOUNT, and every backend hands it to a C
/// string API: the Secret Service takes a NUL-terminated D-Bus string and
/// Windows `CredWrite` a NUL-terminated wide string, so `"a\0b"` and `"a\0c"`
/// both truncate to `"a"` — two distinct secrets silently sharing one slot, in
/// a store whose whole job is to keep them apart. Nothing here can detect that
/// after the fact, which is what makes it a boundary check rather than an
/// error to report.
///
/// The grammar is deliberately LIBERAL otherwise: spaces and non-ASCII are
/// accepted, because a provider type is user-visible text and a stricter rule
/// would strand keys already in the keychain under names this app once wrote.
fn validated_entry(key: &str) -> Result<Entry, CommandError> {
    if key.is_empty() {
        return Err(CommandError::invalid_input("secret key must not be empty"));
    }
    if key.chars().count() > MAX_KEY_LEN {
        return Err(CommandError::invalid_input(format!(
            "secret key is {} characters; the limit is {MAX_KEY_LEN}",
            key.chars().count()
        )));
    }
    if let Some(bad) = key.chars().find(|c| c.is_control()) {
        return Err(CommandError::invalid_input(format!(
            "secret key contains the control character U+{:04X}; \
             the platform keychains truncate at it and two keys would collide",
            bad as u32
        )));
    }
    entry(key)
}

/// Run one keychain operation off the IPC thread.
///
/// **Why these three commands are `async` (audit #470).** A non-`async`
/// `#[tauri::command]` is `ExecutionContext::Blocking`, so Tauri runs its body
/// inline on the thread that delivered the IPC message — and every keychain
/// call here can block for an unbounded time: a locked login keychain, an
/// unreachable Secret Service, and above all the "vmark wants to use your
/// confidential information" prompt this file's own macOS caveat describes,
/// which waits for a human. Blocking that thread freezes the IPC channel the
/// dialog's own UI is served over.
///
/// `spawn_blocking` is the pool meant for exactly this, and the entry is built
/// INSIDE it: `validated_entry` is where the caller-bug rejection lives, so
/// keeping it here would leave the only cheap step on the wrong side of the
/// hop for no benefit. Nothing here reads state before it writes, so going
/// async introduces no check-then-act to re-examine.
async fn off_ipc_thread<T: Send + 'static>(
    op: impl FnOnce() -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tokio::task::spawn_blocking(op)
        .await
        .map_err(|e| CommandError::internal(format!("keychain task failed: {e}")))?
}

/// Store `value` under `key` in the OS keychain (insert or overwrite).
#[tauri::command]
pub async fn set_secret(key: String, value: String) -> Result<(), CommandError> {
    off_ipc_thread(move || set_on(&validated_entry(&key)?, &value)).await
}

/// Read the secret stored under `key`. Returns `Ok(None)` when no entry
/// exists (the normal "not configured yet" case), `Err` only on a real
/// keychain failure.
#[tauri::command]
pub async fn get_secret(key: String) -> Result<Option<String>, CommandError> {
    off_ipc_thread(move || get_on(&validated_entry(&key)?)).await
}

/// Delete the secret stored under `key`. Deleting a missing entry is a no-op
/// (idempotent) so callers can clear keys without first checking existence.
#[tauri::command]
pub async fn delete_secret(key: String) -> Result<(), CommandError> {
    off_ipc_thread(move || delete_on(&validated_entry(&key)?)).await
}

#[cfg(test)]
#[path = "secure_store.test.rs"]
mod tests;
