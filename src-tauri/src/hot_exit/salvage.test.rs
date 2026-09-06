//! Audit 20260906 B6 — a strict whole-session parse discarded healthy unsaved
//! documents because one item beside them was malformed.

use super::*;

/// A session whose windows/tabs are filled in by the caller.
fn session_json(windows: &str) -> String {
    format!(
        r#"{{
            "version": 5,
            "timestamp": 1700000000,
            "vmark_version": "0.9.64",
            "windows": {windows},
            "workspace": null
        }}"#
    )
}

fn ui_state(extra: &str) -> String {
    format!(
        r#"{{
            "sidebar_visible": true,
            "sidebar_width": {extra},
            "outline_visible": false,
            "sidebar_view_mode": "files",
            "status_bar_visible": true,
            "source_mode_enabled": false,
            "focus_mode_enabled": false,
            "typewriter_mode_enabled": false
        }}"#
    )
}

fn tab(id: &str, content: &str) -> String {
    format!(
        r#"{{
            "id": "{id}",
            "file_path": null,
            "title": "{id}",
            "is_pinned": false,
            "format_id": "markdown",
            "document": {{
                "content": "{content}",
                "saved_content": "",
                "is_dirty": true,
                "is_missing": false,
                "is_divergent": false,
                "line_ending": "lf",
                "cursor_info": null,
                "last_modified_timestamp": null,
                "is_untitled": true,
                "untitled_number": 1
            }}
        }}"#
    )
}

fn window(tabs: &str, ui: &str) -> String {
    format!(
        r#"[{{
            "window_label": "main",
            "is_main_window": true,
            "active_tab_id": null,
            "tabs": [{tabs}],
            "ui_state": {ui},
            "geometry": null
        }}]"#
    )
}

/// The headline case: one `null` in the tab array used to reject the whole
/// session, so a healthy unsaved sibling was never offered for recovery.
#[test]
fn one_null_tab_does_not_cost_its_healthy_siblings() {
    let json = session_json(&window(
        &format!("{}, null", tab("a", "keep me")),
        &ui_state("260"),
    ));
    // Precondition: the strict parser really does reject this.
    assert!(serde_json::from_str::<SessionData>(&json).is_err());

    let salvaged = salvage_session(&json).expect("salvage must recover the healthy tab");

    assert_eq!(salvaged.session.windows.len(), 1);
    assert_eq!(salvaged.session.windows[0].tabs.len(), 1);
    assert_eq!(
        salvaged.session.windows[0].tabs[0].document.content,
        "keep me"
    );
    assert_eq!(salvaged.dropped_tabs, 1);
    assert!(salvaged.is_lossy(), "a dropped tab is a real loss");
}

/// A cosmetic integer field must not cost documents. `sidebar_width` is `u32`
/// in the schema and a fractional value rejected the entire session.
#[test]
fn a_fractional_ui_field_does_not_block_document_recovery() {
    let json = session_json(&window(&tab("a", "keep me"), &ui_state("260.5")));
    assert!(serde_json::from_str::<SessionData>(&json).is_err());

    let salvaged = salvage_session(&json).expect("salvage must normalize the width");

    assert_eq!(salvaged.session.windows[0].tabs.len(), 1);
    assert_eq!(salvaged.session.windows[0].ui_state.sidebar_width, 261);
    assert_eq!(salvaged.dropped_tabs, 0);
    assert!(
        !salvaged.is_lossy(),
        "rounding a panel width loses nothing and must not trigger a quarantine"
    );
    assert!(salvaged.repaired_fields >= 1);
}

#[test]
fn keeps_every_healthy_tab_when_several_survive() {
    let json = session_json(&window(
        &format!("{}, null, {}", tab("a", "one"), tab("b", "two")),
        &ui_state("260"),
    ));

    let salvaged = salvage_session(&json).unwrap();

    let contents: Vec<_> = salvaged.session.windows[0]
        .tabs
        .iter()
        .map(|t| t.document.content.as_str())
        .collect();
    assert_eq!(contents, vec!["one", "two"]);
}

/// Malformed JSON has no envelope to anchor a restore to; the backup file is
/// the better bet, so salvage must decline rather than invent a session.
#[test]
fn declines_when_the_json_itself_is_malformed() {
    assert!(salvage_session("{ not json").is_none());
}

#[test]
fn declines_when_the_envelope_has_no_version() {
    let json = r#"{"timestamp": 1, "vmark_version": "x", "windows": []}"#;
    assert!(salvage_session(json).is_none());
}

/// A session with nothing recoverable must fall through to the backup arm
/// rather than return an empty success that clears the file.
#[test]
fn declines_when_no_window_survives() {
    let json = session_json("[null, 42]");
    assert!(salvage_session(json.as_str()).is_none());
}

#[test]
fn drops_an_unreadable_window_and_keeps_the_rest() {
    let good = format!(
        r#"{{
            "window_label": "main",
            "is_main_window": true,
            "active_tab_id": null,
            "tabs": [{}],
            "ui_state": {},
            "geometry": null
        }}"#,
        tab("a", "kept"),
        ui_state("260")
    );
    let json = session_json(&format!("[null, {good}]"));

    let salvaged = salvage_session(&json).unwrap();

    assert_eq!(salvaged.session.windows.len(), 1);
    assert_eq!(salvaged.dropped_windows, 1);
    assert!(salvaged.is_lossy());
}

/// Salvage must not alter a session the strict parser already accepts — it is
/// a fallback, not a normalizer.
#[test]
fn preserves_a_healthy_session_unchanged() {
    let json = session_json(&window(&tab("a", "content"), &ui_state("260")));
    let strict: SessionData = serde_json::from_str(&json).expect("this one is valid");

    let salvaged = salvage_session(&json).unwrap();

    assert_eq!(salvaged.session.windows.len(), strict.windows.len());
    assert_eq!(salvaged.session.windows[0].tabs.len(), 1);
    assert_eq!(salvaged.session.windows[0].ui_state.sidebar_width, 260);
    assert_eq!(salvaged.dropped_tabs, 0);
    assert_eq!(salvaged.repaired_fields, 0);
    assert!(!salvaged.is_lossy());
}

#[test]
fn envelope_fields_survive_salvage() {
    let json = session_json(&window(&tab("a", "x"), &ui_state("260.5")));

    let salvaged = salvage_session(&json).unwrap();

    assert_eq!(salvaged.session.version, 5);
    assert_eq!(salvaged.session.timestamp, 1700000000);
    assert_eq!(salvaged.session.vmark_version, "0.9.64");
}

#[test]
fn summary_reports_what_was_lost() {
    let json = session_json(&window(
        &format!("{}, null", tab("a", "x")),
        &ui_state("260"),
    ));

    let summary = salvage_session(&json).unwrap().summary();

    assert!(summary.contains("dropped 1 tab"), "got: {summary}");
}
