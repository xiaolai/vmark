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
//!   - All commands return `Result<_, String>` per the project convention; the
//!     keyring error is stringified at the boundary.
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

/// Single keychain service namespace for every VMark secret. The per-secret
/// `key` is stored as the keychain account, giving a flat key→value map.
const SERVICE: &str = "app.vmark.secrets";

/// Build a keyring entry for `key` under the VMark service namespace.
fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| format!("keychain entry error: {e}"))
}

// Core operations take an `&Entry` so they can be unit-tested against a single
// shared mock credential (the keyring `mock` store gives each `Entry::new` its
// own in-memory credential, so a fresh entry per call would never observe a
// prior write under test). The command wrappers build a real per-key entry.

fn set_on(entry: &Entry, value: &str) -> Result<(), String> {
    entry
        .set_password(value)
        .map_err(|e| format!("failed to store secret: {e}"))
}

fn get_on(entry: &Entry) -> Result<Option<String>, String> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("failed to read secret: {e}")),
    }
}

fn delete_on(entry: &Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("failed to delete secret: {e}")),
    }
}

/// Store `value` under `key` in the OS keychain (insert or overwrite).
#[tauri::command]
pub fn set_secret(key: String, value: String) -> Result<(), String> {
    if key.is_empty() {
        return Err("secret key must not be empty".into());
    }
    set_on(&entry(&key)?, &value)
}

/// Read the secret stored under `key`. Returns `Ok(None)` when no entry
/// exists (the normal "not configured yet" case), `Err` only on a real
/// keychain failure.
#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
    if key.is_empty() {
        return Err("secret key must not be empty".into());
    }
    get_on(&entry(&key)?)
}

/// Delete the secret stored under `key`. Deleting a missing entry is a no-op
/// (idempotent) so callers can clear keys without first checking existence.
#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), String> {
    if key.is_empty() {
        return Err("secret key must not be empty".into());
    }
    delete_on(&entry(&key)?)
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
    fn empty_key_is_rejected_on_all_ops() {
        // Command-level validation rejects an empty key before touching the store.
        assert!(set_secret(String::new(), "x".into()).is_err());
        assert!(get_secret(String::new()).is_err());
        assert!(delete_secret(String::new()).is_err());
    }

    #[test]
    fn handles_unicode_and_long_values() {
        let e = mock_entry("unicode");
        let value = "鍵-🔑-".repeat(50);
        set_on(&e, &value).unwrap();
        assert_eq!(get_on(&e).unwrap(), Some(value));
    }
}
