//! Tests for hot_exit::session — split from session.rs (file-size gate).

use super::super::session::*;

const TEST_VERSION: &str = "0.3.18";

#[test]
fn test_session_serialization() {
    let session = SessionData::new(TEST_VERSION.to_string());
    let json = serde_json::to_string(&session).unwrap();
    let deserialized: SessionData = serde_json::from_str(&json).unwrap();
    assert_eq!(session.version, deserialized.version);
    assert_eq!(session.vmark_version, deserialized.vmark_version);
}

#[test]
fn test_session_compatibility() {
    let session = SessionData::new(TEST_VERSION.to_string());
    assert_eq!(session.version, SCHEMA_VERSION);

    let mut old_session = SessionData::new(TEST_VERSION.to_string());
    old_session.version = 0;
    assert_ne!(old_session.version, SCHEMA_VERSION);
}

#[test]
fn test_stale_session() {
    let mut session = SessionData::new(TEST_VERSION.to_string());
    let now = chrono::Utc::now().timestamp();

    // 8 days old - should be stale
    session.timestamp = now - (8 * SECONDS_PER_DAY);
    assert!(session.is_stale(MAX_SESSION_AGE_DAYS));

    // 6 days old - should not be stale
    session.timestamp = now - (6 * SECONDS_PER_DAY);
    assert!(!session.is_stale(MAX_SESSION_AGE_DAYS));

    // Future timestamp - should be stale (clock skew)
    session.timestamp = now + SECONDS_PER_DAY;
    assert!(session.is_stale(MAX_SESSION_AGE_DAYS));

    // Invalid max_age_days - should be stale
    session.timestamp = now - SECONDS_PER_DAY;
    assert!(session.is_stale(0));
    assert!(session.is_stale(-1));
}

/// WI-9.4 — the opaque per-instance context fields must survive a full
/// serde round-trip untouched (Rust never interprets them).
#[test]
fn wi94_opaque_context_fields_round_trip() {
    let json = serde_json::json!({
        "window_label": "main",
        "is_main_window": true,
        "active_tab_id": null,
        "tabs": [],
        "ui_state": {
            "sidebar_visible": true,
            "sidebar_width": 260,
            "outline_visible": false,
            "sidebar_view_mode": "files",
            "status_bar_visible": true,
            "source_mode_enabled": false,
            "focus_mode_enabled": false,
            "typewriter_mode_enabled": false
        },
        "geometry": null,
        "ui_state_by_instance": { "wsi-a": { "sidebarWidth": 240 } },
        "closed_tab_scopes": { "wsi-a": [{ "tab": { "id": "t1", "kind": "document" }, "closedSeq": 3 }] },
        "browser_session": { "version": 1, "tabs": [] }
    });
    let state: WindowState = serde_json::from_value(json.clone()).unwrap();
    let back = serde_json::to_value(&state).unwrap();
    assert_eq!(back["ui_state_by_instance"], json["ui_state_by_instance"]);
    assert_eq!(back["closed_tab_scopes"], json["closed_tab_scopes"]);
    assert_eq!(back["browser_session"], json["browser_session"]);

    // Old payloads without the fields still parse; None is not serialized.
    let mut old = json;
    old.as_object_mut().unwrap().remove("ui_state_by_instance");
    old.as_object_mut().unwrap().remove("closed_tab_scopes");
    old.as_object_mut().unwrap().remove("browser_session");
    let old_state: WindowState = serde_json::from_value(old).unwrap();
    let old_back = serde_json::to_value(&old_state).unwrap();
    assert!(old_back.get("ui_state_by_instance").is_none());
}

// -- untrusted timestamps (audit 20260906, B7) -----------------------------
//
// `timestamp` comes straight off disk. `now - i64::MIN` overflows, which
// panics in a debug build; the neighbouring max-age multiplication was already
// guarded with `checked_mul` for exactly this reason.

#[test]
fn an_extreme_past_timestamp_is_stale_rather_than_a_panic() {
    let mut session = SessionData::new(TEST_VERSION.to_string());
    session.timestamp = i64::MIN;

    assert!(
        session.is_stale(MAX_SESSION_AGE_DAYS),
        "an unusable timestamp must be treated as stale, never restored"
    );
}

#[test]
fn an_extreme_future_timestamp_is_stale() {
    let mut session = SessionData::new(TEST_VERSION.to_string());
    session.timestamp = i64::MAX;

    assert!(session.is_stale(MAX_SESSION_AGE_DAYS));
}

#[test]
fn a_fresh_timestamp_is_not_stale() {
    let mut session = SessionData::new(TEST_VERSION.to_string());
    session.timestamp = chrono::Utc::now().timestamp();

    assert!(!session.is_stale(MAX_SESSION_AGE_DAYS));
}
