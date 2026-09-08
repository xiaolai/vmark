//! RW-16 (L8) — secure_store keychain commands, exercised against the
//! keyring crate's in-memory `mock` store so tests never touch the real
//! OS keychain. WI-FL6.7 adds the macOS-only status classification below.

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

// The three commands are `async` so a blocking keychain (a locked store, or
// the macOS confirmation prompt) cannot stall the IPC thread — audit #470.
#[tokio::test]
async fn an_empty_key_is_invalid_input_not_internal() {
    for err in [
        set_secret(String::new(), "v".into()).await.unwrap_err(),
        get_secret(String::new()).await.unwrap_err(),
        delete_secret(String::new()).await.unwrap_err(),
    ] {
        assert_eq!(err.code(), ErrorCode::InvalidInput);
    }
}

/// #469 — a key carrying a NUL must be refused, not handed to the backend.
///
/// The keychain ACCOUNT goes to a C string API on every platform (a
/// NUL-terminated D-Bus string on Secret Service, a NUL-terminated wide string
/// on Windows `CredWrite`), so `"apikey.a\0one"` and `"apikey.a\0two"` both
/// truncate to `"apikey.a"` — two secrets silently sharing one slot in the
/// store whose only job is keeping them apart. That collision is undetectable
/// afterwards, which is what makes this a boundary refusal.
#[tokio::test]
async fn a_key_with_a_control_character_is_refused_at_the_boundary() {
    for err in [
        set_secret("apikey.a\u{0}one".into(), "v".into())
            .await
            .unwrap_err(),
        get_secret("apikey.a\u{0}one".into()).await.unwrap_err(),
        delete_secret("apikey.a\u{0}one".into()).await.unwrap_err(),
        set_secret("apikey.a\nb".into(), "v".into())
            .await
            .unwrap_err(),
    ] {
        assert_eq!(err.code(), ErrorCode::InvalidInput, "{}", err.message());
    }
}

/// An unbounded key is refused too — and the bound is liberal enough that
/// every key this app actually writes passes it.
#[tokio::test]
async fn an_unbounded_key_is_refused_while_a_real_one_is_not() {
    let too_long = "x".repeat(super::MAX_KEY_LEN + 1);
    assert_eq!(
        set_secret(too_long, "v".into()).await.unwrap_err().code(),
        ErrorCode::InvalidInput
    );
    // The shape `services/secrets/apiKeySecrets.ts` produces, plus a
    // user-named custom provider with a space and non-ASCII in it — the
    // grammar must not strand keys the app has already written.
    for key in ["apikey.openai", "apikey.My Provider \u{4f60}\u{597d}"] {
        assert!(
            super::validated_entry(key).is_ok(),
            "{key:?} is a key this app writes"
        );
    }
}

#[test]
fn a_denied_keychain_is_permission_denied_and_the_rest_internal() {
    // `NoStorageAccess` means the credential STORE was unreachable —
    // keychain locked, read-only, missing or invalid — which the user can
    // act on, so calling it `internal` would blame VMark for something they
    // can fix. NOTE: this asserts the mapping of a SYNTHETIC variant only.
    // It does NOT prove what macOS produces for any given OSStatus; the
    // statuses keyring leaves in `PlatformFailure` — errSecAuthFailed above
    // all — are classified by the macOS-only module, tested in `macos` below.
    let denied = keychain_failure(
        "read",
        keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("denied"))),
    );
    assert_eq!(denied.code(), ErrorCode::PermissionDenied);
    assert!(denied.message().contains("failed to read secret"));

    let other = keychain_failure("store", keyring::Error::NoEntry);
    assert_eq!(other.code(), ErrorCode::Internal);
}

// WI-FL6.7 — the OSStatus keyring hides behind `PlatformFailure`, recovered on
// macOS by downcasting the box to `security_framework::base::Error`. Every case
// is table-driven on a PURE function; nothing here touches a keychain.
#[cfg(target_os = "macos")]
mod macos {
    use super::super::keychain_failure;
    use super::super::macos_status::{
        code_for_status, os_status, ERR_SEC_AUTH_FAILED, ERR_SEC_INTERACTION_NOT_ALLOWED,
        ERR_SEC_ITEM_NOT_FOUND, ERR_SEC_USER_CANCELED,
    };
    use crate::command_error::ErrorCode;
    use security_framework::base::Error as SecError;

    /// What keyring 3.6.3 hands back for any status outside its own table.
    fn platform_failure(status: i32) -> keyring::Error {
        keyring::Error::PlatformFailure(Box::new(SecError::from_code(status)))
    }

    #[test]
    fn the_constants_are_apples_sec_base_values() {
        assert_eq!(ERR_SEC_AUTH_FAILED, -25293);
        assert_eq!(ERR_SEC_ITEM_NOT_FOUND, -25300);
        assert_eq!(ERR_SEC_USER_CANCELED, -128);
        assert_eq!(ERR_SEC_INTERACTION_NOT_ALLOWED, -25308);
    }

    #[test]
    fn status_to_code_names_every_status_it_understands_and_defaults_to_internal() {
        // #241: the fallback used to be `Io`, which `is_retryable` — a
        // cancellation, a decode failure or a missing entitlement was thereby
        // presented as something worth trying again unchanged.
        let table = [
            (ERR_SEC_AUTH_FAILED, ErrorCode::PermissionDenied),
            (ERR_SEC_INTERACTION_NOT_ALLOWED, ErrorCode::PermissionDenied),
            (ERR_SEC_ITEM_NOT_FOUND, ErrorCode::NotFound),
            (ERR_SEC_USER_CANCELED, ErrorCode::Cancelled),
            (-26275, ErrorCode::Internal), // errSecDecode
            (-34018, ErrorCode::Internal), // errSecMissingEntitlement
            (-25291, ErrorCode::Internal), // errSecNotAvailable — keyring classifies it first
            (-1, ErrorCode::Internal),
        ];
        for (status, code) in table {
            assert_eq!(code_for_status(status), code, "OSStatus {status}");
        }
        assert!(
            !code_for_status(-1).is_retryable(),
            "an unknown status must not invite a retry"
        );
    }

    #[test]
    fn the_status_survives_keyrings_own_boxing() {
        // `platform_failure` below boxes the SecError itself, which proves the
        // downcast only against a box THIS crate built. keyring's real
        // `decode_error` is public: run the status through it, so a keyring
        // upgrade that boxed a different `security-framework` major would fail
        // here rather than in a user's keychain prompt (#242).
        let boxed = keyring::macos::decode_error(SecError::from_code(ERR_SEC_AUTH_FAILED));
        assert_eq!(os_status(&boxed), Some(ERR_SEC_AUTH_FAILED));
        // And the statuses keyring keeps for itself never reach the downcast.
        assert!(matches!(
            keyring::macos::decode_error(SecError::from_code(-25291)),
            keyring::Error::NoStorageAccess(_)
        ));
        assert!(matches!(
            keyring::macos::decode_error(SecError::from_code(ERR_SEC_ITEM_NOT_FOUND)),
            keyring::Error::NoEntry
        ));
    }

    #[test]
    fn the_status_is_recovered_only_from_a_boxed_security_framework_error() {
        assert_eq!(
            os_status(&platform_failure(ERR_SEC_AUTH_FAILED)),
            Some(ERR_SEC_AUTH_FAILED)
        );
        assert_eq!(os_status(&keyring::Error::NoEntry), None);
        assert_eq!(
            os_status(&keyring::Error::NoStorageAccess(Box::new(
                std::io::Error::other("x")
            ))),
            None
        );
        assert_eq!(
            os_status(&keyring::Error::PlatformFailure(Box::new(
                std::io::Error::other("not a keychain status")
            ))),
            None
        );
    }

    #[test]
    fn an_acl_denial_is_permission_denied_localized_with_the_status_in_detail() {
        let err = keychain_failure("read", platform_failure(ERR_SEC_AUTH_FAILED));
        assert_eq!(err.code(), ErrorCode::PermissionDenied);
        assert_eq!(err.i18n_key(), Some("errors.secureStore.keychainDenied"));
        assert!(!err.message().is_empty());
        let detail = err.detail().expect("the OSStatus travels as detail");
        assert_eq!(detail["osStatus"], ERR_SEC_AUTH_FAILED);
        assert_eq!(detail["action"], "read");
    }

    #[test]
    fn item_not_found_is_not_found_a_cancel_is_cancelled_and_an_unknown_status_is_internal() {
        let missing = keychain_failure("delete", platform_failure(ERR_SEC_ITEM_NOT_FOUND));
        assert_eq!(missing.code(), ErrorCode::NotFound);
        assert_eq!(
            missing.detail().unwrap()["osStatus"],
            ERR_SEC_ITEM_NOT_FOUND
        );

        let cancelled = keychain_failure("read", platform_failure(ERR_SEC_USER_CANCELED));
        assert_eq!(cancelled.code(), ErrorCode::Cancelled);

        let locked = keychain_failure("read", platform_failure(ERR_SEC_INTERACTION_NOT_ALLOWED));
        assert_eq!(locked.code(), ErrorCode::PermissionDenied);
        assert_eq!(locked.i18n_key(), Some("errors.secureStore.keychainDenied"));

        let other = keychain_failure("store", platform_failure(-26275));
        assert_eq!(other.code(), ErrorCode::Internal);
        assert!(other.message().contains("failed to store secret"));
        assert_eq!(other.detail().unwrap()["osStatus"], -26275);
    }

    /// The untouched path: a `PlatformFailure` that carries no keychain status is
    /// still a bug report, on macOS as everywhere else.
    #[test]
    fn a_platform_failure_that_carries_no_keychain_status_stays_internal() {
        let err = keychain_failure(
            "read",
            keyring::Error::PlatformFailure(Box::new(std::io::Error::other("opaque"))),
        );
        assert_eq!(err.code(), ErrorCode::Internal);
    }
}
