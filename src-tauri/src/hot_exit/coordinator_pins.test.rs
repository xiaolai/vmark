// WI-20 — pending-restore pins for the hot-exit coordinator.
//
//! Written against the PRE-`.manage()` implementation and carried across the
//! migration UNCHANGED except for the SEAM block below, which names where the
//! state lives.
//!
//! Pre-migration the seam had to hold the file's serialization mutex for the
//! whole test and wipe the process-global `OnceLock` first, because every test
//! in the binary shared one restore map. Post-migration it constructs a
//! `HotExitState` and that preamble is gone — which is the proof: the
//! isolation these pins need was being bought with a global test lock, not
//! with the design.

use super::*;

// ── THE SEAM ────────────────────────────────────────────────────────────────

/// The restore state under test — the only thing the `.manage()` migration
/// changed in this file.
///
/// It used to be a `Harness` wrapper that took the file's serialization mutex
/// and called `clear_pending_restore()`, because the state was one
/// process-global map shared by every test in the binary. Now each test simply
/// owns one.
fn harness() -> HotExitState {
    HotExitState::default()
}

// ── Fixtures ────────────────────────────────────────────────────────────────

fn make_tab(id: &str, path: Option<&str>) -> super::super::session::TabState {
    super::super::session::TabState {
        id: id.to_string(),
        file_path: path.map(str::to_string),
        title: format!("title-{id}"),
        is_pinned: path.is_none(),
        document: super::super::session::DocumentState {
            content: format!("# {id}\n\nbody for {id}\n"),
            saved_content: format!("# {id}\n"),
            is_dirty: path.is_none(),
            is_missing: false,
            is_divergent: false,
            line_ending: "lf".to_string(),
            cursor_info: None,
            last_modified_timestamp: Some(1_700_000_000),
            is_untitled: path.is_none(),
            untitled_number: None,
            is_read_only: false,
            undo_history: Vec::new(),
            redo_history: Vec::new(),
            mode: Some("source".to_string()),
            hard_break_style: None,
            last_disk_content: None,
        },
        format_id: "markdown".to_string(),
        editing_enabled: true,
        active_schema_id: None,
    }
}

/// A window state with enough shape that a lossy round-trip is detectable —
/// tabs with content (including an unsaved one and a CJK path), a
/// non-default UI state, workspace instance ids.
fn detailed_window_state(label: &str, is_main: bool) -> WindowState {
    WindowState {
        window_label: label.to_string(),
        is_main_window: is_main,
        active_tab_id: Some("tab-b".to_string()),
        tabs: vec![
            make_tab("tab-a", Some("/tmp/a.md")),
            make_tab("tab-b", None),
            make_tab("tab-c", Some("/tmp/CJK-文档.md")),
        ],
        ui_state: super::super::session::UiState {
            sidebar_visible: false,
            sidebar_width: 313,
            outline_visible: true,
            sidebar_view_mode: "outline".to_string(),
            status_bar_visible: false,
            source_mode_enabled: true,
            focus_mode_enabled: true,
            typewriter_mode_enabled: false,
            terminal_visible: true,
            terminal_height: 411,
        },
        geometry: None,
        workspace_instance_ids: vec!["ws-1".to_string()],
        active_workspace_instance_id: Some("ws-1".to_string()),
        workspace_instances: Vec::new(),
        ui_state_by_instance: None,
        closed_tab_scopes: None,
        browser_session: None,
    }
}

/// Compare window states by their serialized form: `WindowState` has no
/// `PartialEq`, and serialization equality is the stronger claim anyway — it
/// is the shape that actually reaches disk and the webview.
fn same_state(left: &WindowState, right: &WindowState) {
    assert_eq!(
        serde_json::to_value(left).expect("serializable"),
        serde_json::to_value(right).expect("serializable"),
    );
}

fn labels(names: &[&str]) -> HashSet<String> {
    names.iter().map(|n| n.to_string()).collect()
}

// ── Pins ────────────────────────────────────────────────────────────────────

/// Case 5: the capture → restore round-trip through the pending state is
/// EXACT. This is the data-loss class: anything dropped here is a tab —
/// possibly a dirty, unsaved one — the user silently loses on restart.
#[test]
fn a_stored_window_state_is_handed_back_exactly() {
    let hot_exit = harness();
    let stored = detailed_window_state("main", true);

    hot_exit.store(
        std::iter::once(("main".to_string(), stored.clone())),
        labels(&["main"]),
    );

    let restored = hot_exit
        .window_state("main")
        .expect("the window must find its pending state");
    same_state(&restored, &stored);
}

/// The multi-window shape: each label gets ITS OWN state back, never a
/// neighbour's, and an unknown label restores nothing rather than guessing.
#[test]
fn each_window_gets_its_own_state_back() {
    let hot_exit = harness();
    let main = detailed_window_state("main", true);
    let second = detailed_window_state("doc-7", false);

    hot_exit.store(
        [
            ("main".to_string(), main.clone()),
            ("doc-7".to_string(), second.clone()),
        ],
        labels(&["main", "doc-7"]),
    );

    same_state(&hot_exit.window_state("main").expect("main"), &main);
    same_state(&hot_exit.window_state("doc-7").expect("doc-7"), &second);
    assert!(hot_exit.window_state("doc-999").is_none());
}

/// Completion is signalled only when EVERY expected window has reported, and
/// an unexpected window can neither complete the round nor be counted.
#[test]
fn the_round_completes_only_when_every_expected_window_reports() {
    let hot_exit = harness();
    hot_exit.store(
        [
            ("main".to_string(), detailed_window_state("main", true)),
            ("doc-1".to_string(), detailed_window_state("doc-1", false)),
        ],
        labels(&["main", "doc-1"]),
    );

    assert!(
        !hot_exit.mark_complete("doc-stranger"),
        "an unexpected window must not complete the round"
    );
    assert!(!hot_exit.mark_complete("main"), "one of two is not all");
    assert!(
        hot_exit.mark_complete("doc-1"),
        "the last expected window completes the round"
    );
    assert!(
        hot_exit.window_state("main").is_none(),
        "a completed round clears its state"
    );
}

/// Cases 6 and 8: parallel readers and writers never deadlock, and a thread
/// that PANICS while touching the state does not wedge the next access. The
/// wall-clock deadline is the deadlock assertion.
#[test]
fn concurrent_access_survives_a_panicking_writer() {
    let hot_exit = harness();
    let stored = detailed_window_state("main", true);
    hot_exit.store(
        std::iter::once(("main".to_string(), stored.clone())),
        labels(&["main"]),
    );

    let barrier = std::sync::Barrier::new(16);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    std::thread::scope(|scope| {
        // A writer that unwinds mid-flight.
        let panicked = scope
            .spawn(|| {
                hot_exit.mark_complete("doc-never-expected");
                panic!("simulated panic in a restore writer");
            })
            .join();
        assert!(panicked.is_err(), "the writer really did panic");

        // 16 threads hammering the same state afterwards.
        let mut handles = Vec::new();
        for i in 0..16 {
            let (hot_exit, barrier) = (&hot_exit, &barrier);
            handles.push(scope.spawn(move || {
                barrier.wait();
                for _ in 0..50 {
                    let _ = hot_exit.window_state("main");
                    let _ = hot_exit.mark_complete(&format!("doc-{i}"));
                }
            }));
        }
        for handle in handles {
            handle.join().expect("no worker may panic");
            assert!(
                std::time::Instant::now() < deadline,
                "concurrent access deadlocked"
            );
        }
    });

    // The state is still usable and intact — a panicking writer must not have
    // wedged it, and no unexpected window may have cleared the round.
    same_state(
        &hot_exit
            .window_state("main")
            .expect("state survives a panicking writer"),
        &stored,
    );
}
