//! The closed operation vocabulary — parity with `isBrowserOperation` /
//! `BROWSER_OPERATIONS` in `src/lib/browser/approval/grants.ts`.

use super::*;

#[test]
fn known_operations_are_exactly_the_ts_vocabulary() {
    for op in ["read", "attach", "click", "type", "navigate", "publish", "upload"] {
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
fn deserialize_rejects_unknown_variants_at_the_wire_boundary() {
    for ok in ["read", "attach", "click", "type", "navigate", "publish", "upload"] {
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
