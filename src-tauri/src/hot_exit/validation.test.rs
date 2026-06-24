//! Tests for the sibling module (extracted to keep the production
//! file under the size gate; included via `#[path]`).

use super::*;
use crate::hot_exit::session::*;

const TEST_VERSION: &str = "0.5.0";

fn make_ui_state() -> UiState {
    UiState {
        sidebar_visible: true,
        sidebar_width: 260,
        outline_visible: false,
        sidebar_view_mode: "files".to_string(),
        status_bar_visible: true,
        source_mode_enabled: false,
        focus_mode_enabled: false,
        typewriter_mode_enabled: false,
        terminal_visible: false,
        terminal_height: 250,
    }
}

fn make_tab(id: &str) -> TabState {
    TabState {
        id: id.to_string(),
        file_path: None,
        title: format!("Tab {}", id),
        is_pinned: false,
        document: DocumentState {
            content: String::new(),
            saved_content: String::new(),
            is_dirty: false,
            is_missing: false,
            is_divergent: false,
            line_ending: "\n".to_string(),
            cursor_info: None,
            last_modified_timestamp: None,
            is_untitled: true,
            untitled_number: Some(1),
            is_read_only: false,
            undo_history: Vec::new(),
            redo_history: Vec::new(),
            mode: None,
            hard_break_style: None,
            last_disk_content: None,
        },
        format_id: "markdown".to_string(),
        editing_enabled: true,
        active_schema_id: None,
    }
}

fn make_tab_with_path(id: &str, path: &str) -> TabState {
    let mut tab = make_tab(id);
    tab.file_path = Some(path.to_string());
    tab
}

fn make_window(label: &str, tab_ids: &[&str], active: Option<&str>) -> WindowState {
    WindowState {
        window_label: label.to_string(),
        is_main_window: label == "main",
        active_tab_id: active.map(|s| s.to_string()),
        tabs: tab_ids.iter().map(|id| make_tab(id)).collect(),
        ui_state: make_ui_state(),
        geometry: None, workspace_instance_ids: Vec::new(), active_workspace_instance_id: None, workspace_instances: Vec::new(),
    }
}

fn make_session(windows: Vec<WindowState>) -> SessionData {
    SessionData {
        version: SCHEMA_VERSION,
        timestamp: chrono::Utc::now().timestamp(),
        vmark_version: TEST_VERSION.to_string(),
        windows,
        workspace: None,
    }
}

#[test]
fn valid_session_produces_no_warnings() {
    let mut session = make_session(vec![
        make_window("main", &["tab-1", "tab-2"], Some("tab-1")),
    ]);

    let warnings = validate_and_repair(&mut session);
    assert!(warnings.is_empty());
}

#[test]
fn active_tab_id_none_is_valid() {
    let mut session = make_session(vec![
        make_window("main", &["tab-1"], None),
    ]);

    let warnings = validate_and_repair(&mut session);
    assert!(warnings.is_empty());
}

#[test]
fn fixes_active_tab_id_referencing_nonexistent_tab() {
    let mut session = make_session(vec![
        make_window("main", &["tab-1", "tab-2"], Some("tab-gone")),
    ]);

    let warnings = validate_and_repair(&mut session);

    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("active_tab_id 'tab-gone' not found"));
    // Should reset to first tab
    assert_eq!(
        session.windows[0].active_tab_id,
        Some("tab-1".to_string())
    );
}

#[test]
fn fixes_active_tab_id_to_none_when_no_tabs() {
    let mut session = make_session(vec![
        make_window("main", &[], Some("tab-gone")),
    ]);

    let warnings = validate_and_repair(&mut session);

    // Should produce warnings for both invalid active_tab_id and empty window
    assert!(warnings.iter().any(|w| w.contains("active_tab_id")));
    assert!(warnings.iter().any(|w| w.contains("contains no tabs")));
    assert_eq!(session.windows[0].active_tab_id, None);
}

#[test]
fn removes_duplicate_tab_ids() {
    let mut session = make_session(vec![
        make_window("main", &["tab-1", "tab-1", "tab-2", "tab-2", "tab-3"], Some("tab-1")),
    ]);

    let warnings = validate_and_repair(&mut session);

    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("removed 2 duplicate tab(s)"));
    // Should keep only unique tabs (first occurrence)
    let ids: Vec<&str> = session.windows[0]
        .tabs
        .iter()
        .map(|t| t.id.as_str())
        .collect();
    assert_eq!(ids, vec!["tab-1", "tab-2", "tab-3"]);
}

#[test]
fn removes_duplicates_then_fixes_active_tab() {
    // active_tab_id was a duplicate that got removed
    let mut session = make_session(vec![
        make_window("main", &["tab-1", "tab-2", "tab-2"], Some("tab-dup-gone")),
    ]);

    let warnings = validate_and_repair(&mut session);

    // Should have both a duplicate warning and an active_tab_id warning
    assert!(warnings.iter().any(|w| w.contains("duplicate")));
    assert!(warnings.iter().any(|w| w.contains("active_tab_id")));
    // active_tab_id should be reset to first remaining tab
    assert_eq!(
        session.windows[0].active_tab_id,
        Some("tab-1".to_string())
    );
}

#[test]
fn warns_about_empty_window() {
    let mut session = make_session(vec![
        make_window("main", &["tab-1"], Some("tab-1")),
        make_window("secondary", &[], None),
    ]);

    let warnings = validate_and_repair(&mut session);

    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("Window 'secondary': contains no tabs"));
}

#[test]
fn handles_multiple_windows_independently() {
    let mut session = make_session(vec![
        make_window("main", &["tab-1", "tab-1"], Some("tab-1")),
        make_window("secondary", &["tab-a", "tab-b"], Some("tab-missing")),
    ]);

    let warnings = validate_and_repair(&mut session);

    assert_eq!(warnings.len(), 2);
    // Window 1: duplicate
    assert!(warnings.iter().any(|w| w.contains("Window 'main'") && w.contains("duplicate")));
    // Window 2: invalid active_tab_id
    assert!(warnings.iter().any(|w| w.contains("Window 'secondary'") && w.contains("active_tab_id")));

    // Verify repairs
    assert_eq!(session.windows[0].tabs.len(), 1);
    assert_eq!(
        session.windows[1].active_tab_id,
        Some("tab-a".to_string())
    );
}

#[test]
fn empty_session_is_valid() {
    let mut session = make_session(vec![]);

    let warnings = validate_and_repair(&mut session);
    assert!(warnings.is_empty());
}

#[test]
fn removes_duplicate_file_paths() {
    let mut session = make_session(vec![{
        let mut w = make_window("main", &[], Some("t1"));
        w.tabs = vec![
            make_tab_with_path("t1", "/path/to/file.md"),
            make_tab_with_path("t2", "/path/to/file.md"),
            make_tab_with_path("t3", "/path/to/other.md"),
        ];
        w
    }]);

    let warnings = validate_and_repair(&mut session);

    assert!(warnings.iter().any(|w| w.contains("duplicate file_path")));
    let ids: Vec<&str> = session.windows[0]
        .tabs
        .iter()
        .map(|t| t.id.as_str())
        .collect();
    assert_eq!(ids, vec!["t1", "t3"]);
}

#[test]
fn case_different_paths_are_treated_as_distinct_on_all_platforms() {
    // Regression: earlier code lowercased paths on non-Linux to handle
    // case-insensitive HFS+/APFS/NTFS. That approach incorrectly merged
    // distinct files on case-sensitive APFS volumes — a data-availability
    // bug. The validator now compares paths exactly on every platform.
    // The TS-side restore at src/services/persistence/hotExit/restoreHelpers.ts
    // does the same.
    let mut session = make_session(vec![{
        let mut w = make_window("main", &[], Some("t1"));
        w.tabs = vec![
            make_tab_with_path("t1", "/Path/To/File.md"),
            make_tab_with_path("t2", "/path/to/file.md"),
        ];
        w
    }]);

    let warnings = validate_and_repair(&mut session);

    // Both tabs are kept on every platform — exact-match comparison.
    assert!(!warnings.iter().any(|w| w.contains("duplicate file_path")));
    assert_eq!(session.windows[0].tabs.len(), 2);
    let ids: Vec<&str> = session.windows[0]
        .tabs
        .iter()
        .map(|t| t.id.as_str())
        .collect();
    assert_eq!(ids, vec!["t1", "t2"]);
}

fn make_workspace_instance(
    id: &str,
    tab_ids: &[&str],
    closed_tab_ids: &[&str],
    active: Option<&str>,
) -> WorkspaceInstanceState {
    WorkspaceInstanceState {
        workspace_instance_id: id.to_string(),
        kind: "loose".to_string(),
        root_id: None,
        root_path: None,
        display_name: "Loose Files".to_string(),
        owner_window_label: "main".to_string(),
        created_from: "restore".to_string(),
        active_tab_id: active.map(|s| s.to_string()),
        tab_ids: tab_ids.iter().map(|s| s.to_string()).collect(),
        closed_tab_ids: closed_tab_ids.iter().map(|s| s.to_string()).collect(),
        unavailable_root: false,
    }
}

#[test]
fn preserves_duplicate_path_tab_with_dirty_content() {
    // A second tab for the same file holds UNSAVED edits — dropping it
    // would silently lose the user's work, so validation must keep it.
    let mut session = make_session(vec![{
        let mut w = make_window("main", &[], Some("t1"));
        let mut clean = make_tab_with_path("t1", "/path/to/file.md");
        clean.document.content = "saved".to_string();
        let mut dirty = make_tab_with_path("t2", "/path/to/file.md");
        dirty.document.content = "unsaved edits".to_string();
        dirty.document.is_dirty = true;
        w.tabs = vec![clean, dirty];
        w
    }]);

    let warnings = validate_and_repair(&mut session);

    // No "removed ... duplicate file_path" warning — both tabs survive.
    assert!(!warnings.iter().any(|w| w.contains("removed")
        && w.contains("duplicate file_path")));
    assert!(warnings.iter().any(|w| w.contains("kept duplicate-path tab")));
    let ids: Vec<&str> = session.windows[0]
        .tabs
        .iter()
        .map(|t| t.id.as_str())
        .collect();
    assert_eq!(ids, vec!["t1", "t2"]);
}

#[test]
fn preserves_duplicate_path_tab_with_divergent_content() {
    let mut session = make_session(vec![{
        let mut w = make_window("main", &[], Some("t1"));
        let kept = make_tab_with_path("t1", "/file.md");
        let mut divergent = make_tab_with_path("t2", "/file.md");
        divergent.document.is_divergent = true;
        w.tabs = vec![kept, divergent];
        w
    }]);

    validate_and_repair(&mut session);
    assert_eq!(session.windows[0].tabs.len(), 2);
}

#[test]
fn preserves_duplicate_path_tab_with_different_clean_content() {
    // Same path, both clean, but content differs — not provably identical,
    // so it is preserved rather than risk dropping diverged work.
    let mut session = make_session(vec![{
        let mut w = make_window("main", &[], Some("t1"));
        let mut a = make_tab_with_path("t1", "/file.md");
        a.document.content = "version A".to_string();
        let mut b = make_tab_with_path("t2", "/file.md");
        b.document.content = "version B".to_string();
        w.tabs = vec![a, b];
        w
    }]);

    validate_and_repair(&mut session);
    let ids: Vec<&str> = session.windows[0]
        .tabs
        .iter()
        .map(|t| t.id.as_str())
        .collect();
    assert_eq!(ids, vec!["t1", "t2"]);
}

#[test]
fn drops_only_clean_identical_duplicate_keeps_dirty_one() {
    // Three tabs for the same path: one identical+clean (drop), one dirty
    // (keep). Order: kept survivor, clean dup, dirty dup.
    let mut session = make_session(vec![{
        let mut w = make_window("main", &[], Some("t1"));
        let mut kept = make_tab_with_path("t1", "/file.md");
        kept.document.content = "base".to_string();
        let mut clean_dup = make_tab_with_path("t2", "/file.md");
        clean_dup.document.content = "base".to_string();
        let mut dirty_dup = make_tab_with_path("t3", "/file.md");
        dirty_dup.document.content = "edited".to_string();
        dirty_dup.document.is_dirty = true;
        w.tabs = vec![kept, clean_dup, dirty_dup];
        w
    }]);

    validate_and_repair(&mut session);
    let ids: Vec<&str> = session.windows[0]
        .tabs
        .iter()
        .map(|t| t.id.as_str())
        .collect();
    assert_eq!(ids, vec!["t1", "t3"], "clean identical dup dropped, dirty kept");
}

#[test]
fn prunes_workspace_instance_references_to_removed_tabs() {
    // A workspace instance references a duplicate tab that gets dropped —
    // its tab_ids / closed_tab_ids / active_tab_id must be pruned so they
    // never point at a tab that no longer exists.
    let mut session = make_session(vec![{
        let mut w = make_window("main", &[], Some("t1"));
        let kept = make_tab_with_path("t1", "/file.md");
        let clean_dup = make_tab_with_path("t2", "/file.md"); // identical+clean → dropped
        w.tabs = vec![kept, clean_dup];
        w.workspace_instances = vec![make_workspace_instance(
            "wsi-1",
            &["t1", "t2"],
            &["t2"],
            Some("t2"),
        )];
        w
    }]);

    let warnings = validate_and_repair(&mut session);

    let instance = &session.windows[0].workspace_instances[0];
    assert_eq!(instance.tab_ids, vec!["t1"], "removed tab pruned from tab_ids");
    assert!(instance.closed_tab_ids.is_empty(), "removed tab pruned from closed_tab_ids");
    assert!(instance.active_tab_id.is_none(), "active pointing at removed tab reset");
    assert!(warnings.iter().any(|w| w.contains("pruned removed tab references")));
}

#[test]
fn untitled_tabs_are_not_deduplicated_by_path() {
    let mut session = make_session(vec![
        make_window("main", &["t1", "t2", "t3"], Some("t1")),
    ]);
    // All tabs have file_path: None (untitled) — no dedup should occur

    let warnings = validate_and_repair(&mut session);

    assert!(warnings.is_empty());
    assert_eq!(session.windows[0].tabs.len(), 3);
}
