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
//!     **Known gap, stated rather than implied.** An earlier revision of this
//!     comment claimed `NoStorageAccess` covered the ACL denial described in
//!     the macOS caveat below. It does not: `errSecAuthFailed` (-25293) is NOT
//!     in keyring's mapping list (`macos.rs::decode_error`) and falls through
//!     to `PlatformFailure`, so a re-signed dev build denied by the ACL is
//!     reported as `internal`. Narrowing that needs the concrete OSStatus,
//!     which keyring hides behind `Box<dyn Error>` — it would mean taking a
//!     direct `security-framework` dependency to downcast, which is not worth
//!     it for a dev-build-only case.
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

/// Classify a keyring failure. `NoStorageAccess` means the credential STORE
/// could not be reached — on macOS: unavailable, read-only, missing or invalid
/// keychain — which the user can act on by unlocking or repairing it, so it is
/// `permission-denied`. See the module header for the one denial this does NOT
/// catch (`errSecAuthFailed`, which keyring reports as `PlatformFailure`).
fn keychain_failure(action: &str, error: keyring::Error) -> CommandError {
    let message = format!("failed to {action} secret: {error}");
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

/// Validate the key and build its entry. The empty-key check was copy-pasted
/// into all three commands (audit 20260809 #6); one caller-bug rejection with
/// one message is easier to keep true than three.
fn validated_entry(key: &str) -> Result<Entry, CommandError> {
    if key.is_empty() {
        return Err(CommandError::invalid_input("secret key must not be empty"));
    }
    entry(key)
}

/// Store `value` under `key` in the OS keychain (insert or overwrite).
#[tauri::command]
pub fn set_secret(key: String, value: String) -> Result<(), CommandError> {
    set_on(&validated_entry(&key)?, &value)
}

/// Read the secret stored under `key`. Returns `Ok(None)` when no entry
/// exists (the normal "not configured yet" case), `Err` only on a real
/// keychain failure.
#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, CommandError> {
    get_on(&validated_entry(&key)?)
}

/// Delete the secret stored under `key`. Deleting a missing entry is a no-op
/// (idempotent) so callers can clear keys without first checking existence.
#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), CommandError> {
    delete_on(&validated_entry(&key)?)
}

#[cfg(test)]
mod tests {
    // RW-16 (L8) — secure_store keychain commands, exercised against the
    // keyring crate's in-memory `mock` store so tests never touch the real
    // OS keychain.
    use super::*;
    use std::sync::Once;

    static INIT: Once = Once::new();

    /// Install the mock credential builder exactly once for the test binary.
    /// `set_default_credential_builder` panics if called twice, so guard it.
    fn init_mock() {
        INIT.call_once(|| {
            keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        });
    }

    /// A single mock-backed `Entry` per test. The core `*_on` helpers operate
    /// on one entry, so set/get/delete observe the same in-memory credential —
    /// matching how a real OS keychain shares state by (service, account).
    fn mock_entry(suffix: &str) -> Entry {
        init_mock();
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        Entry::new(SERVICE, &format!("test.{suffix}.{n}")).unwrap()
    }

    #[test]
    fn set_then_get_roundtrips_the_value() {
        let e = mock_entry("roundtrip");
        set_on(&e, "sk-secret-123").unwrap();
        assert_eq!(get_on(&e).unwrap(), Some("sk-secret-123".to_string()));
    }

    #[test]
    fn get_missing_key_returns_none_not_error() {
        let e = mock_entry("missing");
        assert_eq!(get_on(&e).unwrap(), None);
    }

    #[test]
    fn set_overwrites_existing_value() {
        let e = mock_entry("overwrite");
        set_on(&e, "first").unwrap();
        set_on(&e, "second").unwrap();
        assert_eq!(get_on(&e).unwrap(), Some("second".to_string()));
    }

    #[test]
    fn delete_removes_the_value() {
        let e = mock_entry("delete");
        set_on(&e, "to-remove").unwrap();
        delete_on(&e).unwrap();
        assert_eq!(get_on(&e).unwrap(), None);
    }

    #[test]
    fn delete_missing_key_is_idempotent_noop() {
        let e = mock_entry("delete-missing");
        // Deleting a never-set key must succeed, and again.
        delete_on(&e).unwrap();
        delete_on(&e).unwrap();
    }

    #[test]
    fn handles_unicode_and_long_values() {
        let e = mock_entry("unicode");
        let value = "鍵-🔑-".repeat(50);
        set_on(&e, &value).unwrap();
        assert_eq!(get_on(&e).unwrap(), Some(value));
    }

    // WI-DP2.9 — the codes carry meaning; a blanket `internal` would erase the
    // one case the user can act on.
    use crate::command_error::ErrorCode;

    #[test]
    fn an_empty_key_is_invalid_input_not_internal() {
        for err in [
            set_secret(String::new(), "v".into()).unwrap_err(),
            get_secret(String::new()).unwrap_err(),
            delete_secret(String::new()).unwrap_err(),
        ] {
            assert_eq!(err.code(), ErrorCode::InvalidInput);
        }
    }

    #[test]
    fn a_denied_keychain_is_permission_denied_and_the_rest_internal() {
        // `NoStorageAccess` means the credential STORE was unreachable —
        // keychain locked, read-only, missing or invalid — which the user can
        // act on, so calling it `internal` would blame VMark for something they
        // can fix. NOTE: this asserts the mapping of a SYNTHETIC variant only.
        // It does NOT prove what macOS produces for any given OSStatus, and in
        // particular errSecAuthFailed (the ACL denial in the module header)
        // arrives as `PlatformFailure`, not this variant.
        let denied = keychain_failure(
            "read",
            keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
        );
        assert_eq!(denied.code(), ErrorCode::PermissionDenied);
        assert!(denied.message().contains("failed to read secret"));

        let other = keychain_failure("store", keyring::Error::NoEntry);
        assert_eq!(other.code(), ErrorCode::Internal);
    }
}
