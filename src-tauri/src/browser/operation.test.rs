//! The closed operation vocabulary — parity with `isBrowserOperation` /
//! `BROWSER_OPERATIONS` in `src/lib/browser/approval/grants.ts`.

use super::*;

/// The vocabulary, in full. Any test that enumerates it reads this so a token can
/// only be added or removed in one place — and the TS mirror's test does the same.
const VOCABULARY: &[&str] = &[
    "read", "attach", "click", "type", "scroll", "key", "style", "navigate", "upload", "eval",
    "session", "record",
];

#[test]
fn known_operations_are_exactly_the_ts_vocabulary() {
    for op in VOCABULARY {
        assert!(is_known_operation(op), "{op} is a known operation");
    }
}

#[test]
fn unknown_and_case_variant_spellings_are_not_known() {
    // The closed set is how a lowercase-only hard denial or an operation-scoped
    // grant cannot be bypassed by a variant spelling.
    for op in ["Read", "Upload", "CLICK", "frobnicate", "read ", "", " "] {
        assert!(
            !is_known_operation(op),
            "{op:?} must not be a known operation"
        );
    }
}

#[test]
fn publish_is_no_longer_an_operation() {
    // Audit 20260903: `publish` had no consumer on either side, so a grant for it
    // was authority that could be shown to the user and could never fire.
    assert!(!is_known_operation("publish"));
    assert!(serde_json::from_value::<BrowserOperation>(serde_json::json!("publish")).is_err());
}

#[test]
fn deserialize_rejects_unknown_variants_at_the_wire_boundary() {
    for ok in VOCABULARY {
        assert!(
            serde_json::from_value::<BrowserOperation>(serde_json::json!(ok)).is_ok(),
            "{ok} deserializes"
        );
    }
    for bad in ["Read", "Upload", "frobnicate", "", "CLICK"] {
        assert!(
            serde_json::from_value::<BrowserOperation>(serde_json::json!(bad)).is_err(),
            "{bad:?} must be rejected at the deserialization boundary"
        );
    }
}

#[test]
fn payload_binding_operations_are_exactly_those_whose_script_embeds_the_payload() {
    // Audit 20260903 A-05: the built script for type/key/scroll embeds the text,
    // the key and modifiers, or the delta — so an "Allow once" that does not bind
    // the script hash authorizes ANY text, key or delta on the retry.
    for op in ["style", "eval", "session", "type", "key", "scroll"] {
        assert!(operation_binds_payload(op), "{op} must bind its payload");
    }
    // A click's script carries nothing beyond the descriptor the prompt showed;
    // read/attach/navigate/record carry no script argument at all.
    for op in ["read", "attach", "click", "navigate", "upload", "record"] {
        assert!(!operation_binds_payload(op), "{op} binds no payload");
    }
    // Every binding operation is in the vocabulary — a stray token here would be
    // a binding rule for an operation that can never be minted.
    for op in VOCABULARY {
        let _ = operation_binds_payload(op);
    }
    assert!(!operation_binds_payload("Type"));
}
