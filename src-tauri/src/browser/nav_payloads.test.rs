//! Wire-contract tests for the browser nav/UI delegate payloads (WI-1.7 / WI-1.8).
//!
//! These structs are the exact JSON the frontend (`useBrowserNavEvents.ts`) reads,
//! so the `#[serde(rename)]` camelCase keys and the presence/absence of optional
//! fields are load-bearing, not cosmetic. A silent serde rename here would break
//! the frontend with no compile error on either side — these assertions are the
//! only thing that catches it.

use super::*;
use serde_json::json;

fn value<T: serde::Serialize>(payload: &T) -> serde_json::Value {
    serde_json::to_value(payload).expect("payload serializes")
}

#[test]
fn nav_payload_uses_camelcase_tab_id_and_carries_generation() {
    let p = NavPayload {
        tab_id: "t1".into(),
        url: "https://a.com".into(),
        generation: 7,
        can_go_back: true,
        can_go_forward: false,
    };
    assert_eq!(
        value(&p),
        json!({
            "tabId": "t1",
            "url": "https://a.com",
            "generation": 7,
            "canGoBack": true,
            "canGoForward": false
        })
    );
}

#[test]
fn loaded_payload_shape() {
    let p = LoadedPayload {
        tab_id: "t1".into(),
        url: "https://a.com".into(),
        title: "Hello".into(),
        can_go_back: false,
        can_go_forward: true,
    };
    assert_eq!(
        value(&p),
        json!({
            "tabId": "t1",
            "url": "https://a.com",
            "title": "Hello",
            "canGoBack": false,
            "canGoForward": true
        })
    );
}

#[test]
fn history_flags_ride_every_navigation_event() {
    // WI-S1.6 (Codex re-review D3#5): back/forward shipped as always-enabled no-ops.
    // The omnibox derives its disabled state from these flags, so both the commit
    // and the finish event must carry them — a page can gain history on either.
    let nav = value(&NavPayload {
        tab_id: "t1".into(),
        url: "https://a.com".into(),
        generation: 1,
        can_go_back: true,
        can_go_forward: true,
    });
    let loaded = value(&LoadedPayload {
        tab_id: "t1".into(),
        url: "https://a.com".into(),
        title: "T".into(),
        can_go_back: true,
        can_go_forward: true,
    });
    for v in [&nav, &loaded] {
        assert!(v.get("canGoBack").is_some_and(|b| b.is_boolean()));
        assert!(v.get("canGoForward").is_some_and(|b| b.is_boolean()));
    }
}

#[test]
fn failed_payload_shape() {
    let p = FailedPayload {
        tab_id: "t1".into(),
        message: "boom".into(),
    };
    assert_eq!(value(&p), json!({ "tabId": "t1", "message": "boom" }));
}

#[test]
fn crash_payload_carries_the_action_literal() {
    let p = CrashPayload {
        tab_id: "t1".into(),
        action: "auto-reload",
    };
    assert_eq!(value(&p), json!({ "tabId": "t1", "action": "auto-reload" }));
}

#[test]
fn popup_payload_shape() {
    let p = PopupPayload {
        tab_id: "t1".into(),
        url: "https://a.com".into(),
    };
    assert_eq!(value(&p), json!({ "tabId": "t1", "url": "https://a.com" }));
}

#[test]
fn confirm_dialog_includes_its_id() {
    let p = DialogPayload {
        tab_id: "t1".into(),
        kind: "confirm",
        message: "sure?".into(),
        id: Some(42),
    };
    assert_eq!(
        value(&p),
        json!({ "tabId": "t1", "kind": "confirm", "message": "sure?", "id": 42 })
    );
}

#[test]
fn alert_dialog_omits_the_id_field_entirely() {
    // `skip_serializing_if = "Option::is_none"`: an alert has no id, and the frontend
    // distinguishes interactive dialogs by the presence of the key — a serialized
    // `"id": null` would be read as an answerable dialog and strand the response.
    let p = DialogPayload {
        tab_id: "t1".into(),
        kind: "alert",
        message: "fyi".into(),
        id: None,
    };
    let v = value(&p);
    assert_eq!(
        v,
        json!({ "tabId": "t1", "kind": "alert", "message": "fyi" })
    );
    assert!(v.get("id").is_none(), "alert must not serialize an id key");
}

#[test]
fn generation_serializes_as_a_json_number_at_the_safe_integer_boundary() {
    // The generation crosses the wire as a JSON number. This pins that contract so
    // a future change to a string/nonce encoding (the safer form past 2^53, which
    // would require a coordinated frontend change) cannot land silently. Values up
    // to Number.MAX_SAFE_INTEGER round-trip exactly through JS.
    let p = NavPayload {
        tab_id: "t1".into(),
        url: "https://a.com".into(),
        generation: 9_007_199_254_740_991, // 2^53 - 1
        can_go_back: false,
        can_go_forward: false,
    };
    let g = value(&p);
    let g = g.get("generation").expect("generation key present");
    assert!(g.is_number(), "generation must serialize as a JSON number");
    assert_eq!(g.as_u64(), Some(9_007_199_254_740_991));
}
