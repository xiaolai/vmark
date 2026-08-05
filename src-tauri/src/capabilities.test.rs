//! Capability-file contract (#1202).
//!
//! Tauri capability files are per-WINDOW. A permission granted in
//! `default.json` covers `main` and `doc-*` and reaches the Settings window not
//! at all — which is how the CC-Switch import button shipped dead: the
//! `ccswitch://*` opener scope was declared in `default.json` while the button
//! that uses it lives in the Settings window, so every click raised
//! "Not allowed to open url ccswitch://…" on every platform.
//!
//! Nothing pinned that pairing, so these tests read the shipped JSON and assert
//! the scope sits in the capability of the window that actually needs it.

use serde_json::Value;

const DEFAULT_CAPABILITY: &str = include_str!("../capabilities/default.json");
const SETTINGS_CAPABILITY: &str = include_str!("../capabilities/settings.json");

fn parse(raw: &str) -> Value {
    serde_json::from_str(raw).expect("capability file is valid JSON")
}

/// Window-label globs the capability applies to.
fn windows(capability: &Value) -> Vec<String> {
    capability["windows"]
        .as_array()
        .expect("capability declares windows")
        .iter()
        .map(|w| w.as_str().expect("window label is a string").to_string())
        .collect()
}

/// Every URL string allowed by a scoped `opener:allow-open-url` entry.
fn allowed_open_urls(capability: &Value) -> Vec<String> {
    capability["permissions"]
        .as_array()
        .expect("capability declares permissions")
        .iter()
        .filter(|p| p["identifier"] == "opener:allow-open-url")
        .flat_map(|p| {
            p["allow"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
        })
        .filter_map(|entry| entry["url"].as_str().map(str::to_owned))
        .collect()
}

#[test]
fn the_settings_window_may_open_ccswitch_links() {
    // The CC-Switch import row renders in `src/pages/settings/` — the Settings
    // window — so this is the capability that has to carry the scheme.
    let settings = parse(SETTINGS_CAPABILITY);
    assert!(
        windows(&settings).iter().any(|w| w == "settings"),
        "settings.json must govern the settings window"
    );
    assert!(
        allowed_open_urls(&settings)
            .iter()
            .any(|u| u.starts_with("ccswitch://")),
        "the settings window needs an opener scope for ccswitch:// — \
         `opener:default` allows only mailto:, tel:, http:// and https://, so \
         without this the import button fails with 'Not allowed to open url'"
    );
}

#[test]
fn the_document_capability_keeps_its_ccswitch_scope() {
    // Document windows also surface the link (Settings can be opened from
    // either surface in future); losing it here would be a silent regression of
    // the same class, so pin both rather than moving the grant around.
    let default = parse(DEFAULT_CAPABILITY);
    assert!(
        allowed_open_urls(&default)
            .iter()
            .any(|u| u.starts_with("ccswitch://")),
        "default.json lost its ccswitch:// opener scope"
    );
}

#[test]
fn capability_windows_do_not_overlap_between_default_and_settings() {
    // The bug was a grant landing in a capability whose windows exclude the
    // caller. That is only diagnosable if the split stays disjoint — if
    // `default.json` ever also matched "settings", a missing settings grant
    // would be masked and the next such bug would be invisible again.
    let default_windows = windows(&parse(DEFAULT_CAPABILITY));
    assert!(
        !default_windows.iter().any(|w| w == "settings" || w == "*"),
        "default.json must not cover the settings window: {default_windows:?}"
    );
}
