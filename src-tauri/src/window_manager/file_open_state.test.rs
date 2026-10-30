//! Tests for `file_open_state.rs` (included via `#[path]`; split from the
//! former single window_manager test file).

use super::*;

// -- get_workspace_root_for_file -------------------------------------------

#[test]
fn workspace_root_nested_file() {
    assert_eq!(
        get_workspace_root_for_file("/Users/alice/project/file.md"),
        Some("/Users/alice/project".to_string())
    );
}

#[test]
fn workspace_root_home_level_file() {
    assert_eq!(
        get_workspace_root_for_file("/Users/alice/file.md"),
        Some("/Users/alice".to_string())
    );
}

#[test]
fn workspace_root_root_level_file() {
    assert_eq!(get_workspace_root_for_file("/file.md"), None);
}

#[test]
fn workspace_root_empty_string() {
    assert_eq!(get_workspace_root_for_file(""), None);
}

// -- determine_file_open_action --------------------------------------------

#[test]
fn action_ready_with_window() {
    assert_eq!(
        determine_file_open_action(QueueOwner::Settled, true),
        FileOpenAction::EmitToDocumentWindow,
    );
}

#[test]
fn action_ready_without_window() {
    assert_eq!(
        determine_file_open_action(QueueOwner::Settled, false),
        FileOpenAction::QueueAndCreateWindow,
    );
}

#[test]
fn action_not_ready_with_window() {
    assert_eq!(
        determine_file_open_action(QueueOwner::Booting, true),
        FileOpenAction::QueueOnly,
    );
}

#[test]
fn action_not_ready_without_window() {
    assert_eq!(
        determine_file_open_action(QueueOwner::Booting, false),
        FileOpenAction::QueueOnly,
    );
}

// -- atomic decide / drain (WI-0.8, C3) ------------------------------------

fn paths(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn decide_emits_when_ready_with_window() {
    let mut state = FileOpenState::new();
    state.owner = QueueOwner::Settled;
    let outcome = decide_file_open_locked(&mut state, true, paths(&["/a.md"]), None);
    match outcome {
        FileOpenOutcome::Emit(p) => assert_eq!(p.len(), 1),
        _ => panic!("expected Emit"),
    }
    // Emit path does NOT queue.
    assert!(state.pending.is_empty());
}

#[test]
fn decide_queues_and_requests_window_when_ready_without_window() {
    let mut state = FileOpenState::new();
    state.owner = QueueOwner::Settled;
    let outcome = decide_file_open_locked(&mut state, false, paths(&["/a.md"]), Some("/ws"));
    assert!(matches!(
        outcome,
        FileOpenOutcome::Queued {
            create_window: true
        }
    ));
    assert_eq!(state.pending.len(), 1);
    assert_eq!(state.pending[0].workspace_root.as_deref(), Some("/ws"));
    // The replacement window has not mounted yet. Keeping readiness true
    // would let a rapid second Finder open emit into a window with no listener.
    assert_eq!(state.owner, QueueOwner::Booting);
}

#[test]
fn decide_queues_only_when_not_ready() {
    let mut state = FileOpenState::new();
    let outcome = decide_file_open_locked(&mut state, true, paths(&["/a.md"]), None);
    assert!(matches!(
        outcome,
        FileOpenOutcome::Queued {
            create_window: false
        }
    ));
    assert_eq!(state.pending.len(), 1);
}

#[test]
fn drain_during_cold_start_then_emit_after_ready_no_drop_no_double() {
    // Models the interleaving the single lock now serializes: a cold-start
    // open is queued; the frontend then marks ready + drains in one step;
    // a subsequent open emits rather than re-queuing — so the first open is
    // delivered exactly once (drain), the second exactly once (emit).
    let mut state = FileOpenState::new();

    // Open A arrives before the frontend is ready → queued.
    let a = decide_file_open_locked(&mut state, true, paths(&["/A.md"]), None);
    assert!(matches!(a, FileOpenOutcome::Queued { .. }));
    assert_eq!(state.pending.len(), 1);

    // Frontend becomes ready and drains atomically → receives A exactly once.
    let drained = mark_ready_and_drain(&mut state, "main");
    assert_eq!(drained.len(), 1);
    assert_eq!(drained[0].path, "/A.md");
    assert_eq!(state.owner, QueueOwner::Settled);
    assert!(state.pending.is_empty());

    // Open B after ready → emitted (not re-queued), so not dropped.
    let b = decide_file_open_locked(&mut state, true, paths(&["/B.md"]), None);
    match b {
        FileOpenOutcome::Emit(p) => assert_eq!(p[0].path, "/B.md"),
        _ => panic!("expected Emit"),
    }
    assert!(state.pending.is_empty());
}

// -- the queue's owner can die (WI-RA7.4) -----------------------------------
//
// Only `main` drains the queue, once, when its frontend mounts. "Not drained
// yet" therefore only means "wait" while that window is alive: a `main` that
// is destroyed before it drains leaves nobody to wait for, and every later
// open used to be queued behind it for the rest of the session.

#[test]
fn an_open_after_main_died_undrained_asks_for_a_new_main_instead_of_waiting() {
    let mut state = FileOpenState::new();
    // Cold start: an open is queued for the booting main window.
    let cold = decide_file_open_locked(&mut state, false, paths(&["/cold.md"]), None);
    assert!(matches!(
        cold,
        FileOpenOutcome::Queued {
            create_window: false
        }
    ));

    // The window is destroyed before its frontend ever drained the queue.
    state.remove_window("main");

    let next = decide_file_open_locked(&mut state, false, paths(&["/next.md"]), None);
    assert!(
        matches!(
            next,
            FileOpenOutcome::Queued {
                create_window: true
            }
        ),
        "nobody is left to drain the queue, so a new main window must be created"
    );
    // The new window drains everything that was waiting, in order.
    let queued: Vec<&str> = state.pending.iter().map(|o| o.path.as_str()).collect();
    assert_eq!(queued, vec!["/cold.md", "/next.md"]);
    // And it is the one being waited for now: a third open joins the queue.
    assert_eq!(state.owner, QueueOwner::Booting);
}

#[test]
fn an_open_after_main_died_undrained_goes_to_a_listening_document_window() {
    let mut state = FileOpenState::new();
    state.record_window_focus("doc-2", true, true);
    state.remove_window("main");

    let outcome = decide_file_open_locked(&mut state, true, paths(&["/a.md"]), None);
    assert!(
        matches!(outcome, FileOpenOutcome::Emit(_)),
        "a listening window exists and nothing is booting, so the open is delivered"
    );
    assert!(state.pending.is_empty());
}

#[test]
fn another_window_being_destroyed_does_not_end_the_wait_for_main() {
    let mut state = FileOpenState::new();
    state.remove_window("doc-3");
    state.remove_window("settings");
    state.remove_window("");
    state.remove_window("main-2");
    assert_eq!(state.owner, QueueOwner::Booting);
}

#[test]
fn the_window_that_drained_is_a_target_before_its_ready_event_arrives() {
    // `main` registers its open-file listener, then drains; its separate
    // `ready` event comes later. An open landing in between used to find no
    // target, be queued for a window that had already drained, and stay there.
    let mut state = FileOpenState::new();
    assert_eq!(state.finder_window_target(&labels(&["main"])), None);

    let drained = mark_ready_and_drain(&mut state, "main");
    assert!(drained.is_empty());

    assert_eq!(
        state.finder_window_target(&labels(&["main"])),
        Some("main".to_string())
    );
    let outcome = decide_file_open_locked(&mut state, true, paths(&["/hot.md"]), None);
    assert!(matches!(outcome, FileOpenOutcome::Emit(_)));
}

#[test]
fn a_drain_by_a_window_that_is_not_a_document_window_marks_no_target() {
    let mut state = FileOpenState::new();
    mark_ready_and_drain(&mut state, "settings");
    assert_eq!(state.owner, QueueOwner::Settled);
    assert_eq!(state.finder_window_target(&labels(&["settings"])), None);
}

// -- Finder hot-open target tracking ---------------------------------------

fn labels(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn finder_target_retains_last_focused_document_after_focus_loss() {
    let mut state = FileOpenState::new();
    state.record_window_focus("main", true, true);
    state.record_window_focus("doc-7", true, true);
    state.record_window_focus("doc-7", false, true);

    assert_eq!(
        state.finder_window_target(&labels(&["main", "doc-7"])),
        Some("doc-7".to_string())
    );
}

/// #1612: MCP routing reads the same focus history, and it must survive the
/// user switching to another app (the MCP client's terminal).
#[test]
fn last_focused_document_window_survives_focus_loss_and_window_removal_clears_it() {
    let mut state = FileOpenState::new();
    assert_eq!(state.last_focused_document_window(), None);
    state.record_window_focus("main", true, true);
    state.record_window_focus("doc-8", true, true);
    state.record_window_focus("doc-8", false, true);
    state.record_window_focus("settings", true, true);
    assert_eq!(state.last_focused_document_window(), Some("doc-8"));
    state.remove_window("doc-8");
    assert_eq!(state.last_focused_document_window(), None);
}

#[test]
fn finder_target_ignores_non_document_window_focus() {
    let mut state = FileOpenState::new();
    state.record_window_focus("doc-3", true, true);
    state.record_window_focus("settings", true, true);

    assert_eq!(
        state.finder_window_target(&labels(&["main", "doc-3", "settings"])),
        Some("doc-3".to_string())
    );
}

#[test]
fn finder_target_forgets_destroyed_document_window() {
    let mut state = FileOpenState::new();
    state.record_window_focus("main", false, true);
    state.record_window_focus("doc-2", true, true);
    state.remove_window("doc-2");

    // Include doc-2 in the supplied labels to prove removal clears the
    // remembered preference instead of merely relying on app enumeration.
    assert_eq!(
        state.finder_window_target(&labels(&["doc-2", "main"])),
        Some("main".to_string())
    );
}

#[test]
fn finder_target_prefers_remembered_live_document_window() {
    let mut state = FileOpenState::new();
    state.record_window_focus("doc-9", true, true);

    assert_eq!(
        state.finder_window_target(&labels(&["main", "doc-2", "doc-9"])),
        Some("doc-9".to_string())
    );
}

#[test]
fn finder_target_falls_back_to_main_then_sorted_document_then_none() {
    let mut state = FileOpenState::new();
    state.record_window_focus("doc-9", true, true);
    state.record_window_focus("main", false, true);

    assert_eq!(
        state.finder_window_target(&labels(&["doc-2", "main"])),
        Some("main".to_string())
    );

    state.remove_window("main");
    state.record_window_focus("doc-4", false, true);
    state.record_window_focus("doc-2", false, true);
    assert_eq!(
        state.finder_window_target(&labels(&["doc-4", "doc-2"])),
        Some("doc-2".to_string())
    );
    assert_eq!(state.finder_window_target(&[]), None);
}

#[test]
fn finder_target_ignores_focus_before_window_listener_is_ready() {
    let mut state = FileOpenState::new();
    state.record_window_focus("main", false, true);
    state.record_window_focus("doc-5", true, false);

    assert_eq!(
        state.finder_window_target(&labels(&["main", "doc-5"])),
        Some("main".to_string())
    );

    state.record_window_focus("doc-5", true, true);
    assert_eq!(
        state.finder_window_target(&labels(&["main", "doc-5"])),
        Some("doc-5".to_string())
    );
}

#[test]
fn finder_target_never_falls_back_to_a_window_without_a_ready_listener() {
    let mut state = FileOpenState::new();
    state.record_window_focus("doc-5", true, false);

    assert_eq!(state.finder_window_target(&labels(&["doc-5"])), None);
}

// -- group_paths_by_workspace ----------------------------------------------

#[test]
fn group_single_file() {
    let paths = vec!["/Users/alice/project/file.md".to_string()];
    let groups = group_paths_by_workspace(&paths);
    assert_eq!(groups.len(), 1);
    assert_eq!(
        groups["/Users/alice/project"],
        vec!["/Users/alice/project/file.md"]
    );
}

#[test]
fn group_same_directory() {
    let paths = vec![
        "/Users/alice/project/a.md".to_string(),
        "/Users/alice/project/b.md".to_string(),
    ];
    let groups = group_paths_by_workspace(&paths);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups["/Users/alice/project"].len(), 2);
}

#[test]
fn group_different_directories() {
    let paths = vec![
        "/Users/alice/proj1/a.md".to_string(),
        "/Users/alice/proj2/b.md".to_string(),
    ];
    let groups = group_paths_by_workspace(&paths);
    assert_eq!(groups.len(), 2);
    assert!(groups.contains_key("/Users/alice/proj1"));
    assert!(groups.contains_key("/Users/alice/proj2"));
}

#[test]
fn group_root_level_file() {
    let paths = vec!["/file.md".to_string()];
    let groups = group_paths_by_workspace(&paths);
    assert_eq!(groups.len(), 1);
    assert!(groups.contains_key(""));
}

#[test]
fn group_empty_input() {
    let groups = group_paths_by_workspace(&[]);
    assert!(groups.is_empty());
}

// -- queue_pending_file_opens ----------------------------------------------

#[test]
fn queue_single_file_with_workspace() {
    let mut pending = Vec::new();
    queue_pending_file_opens(&mut pending, vec!["/a/b.md".to_string()], Some("/a"));
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].path, "/a/b.md");
    assert_eq!(pending[0].workspace_root, Some("/a".to_string()));
}

#[test]
fn queue_multiple_files_same_workspace() {
    let mut pending = Vec::new();
    queue_pending_file_opens(
        &mut pending,
        vec!["/a/x.md".to_string(), "/a/y.md".to_string()],
        Some("/a"),
    );
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].workspace_root, Some("/a".to_string()));
    assert_eq!(pending[1].workspace_root, Some("/a".to_string()));
}

#[test]
fn queue_without_workspace() {
    let mut pending = Vec::new();
    queue_pending_file_opens(&mut pending, vec!["/file.md".to_string()], None);
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].workspace_root, None);
}

#[test]
fn queue_appends_to_existing() {
    let mut pending = vec![PendingFileOpen {
        path: "/existing.md".to_string(),
        workspace_root: None,
    }];
    queue_pending_file_opens(&mut pending, vec!["/new.md".to_string()], Some("/dir"));
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].path, "/existing.md");
    assert_eq!(pending[1].path, "/new.md");
}

#[test]
fn queue_empty_file_paths_is_noop() {
    let mut pending = Vec::new();
    queue_pending_file_opens(&mut pending, vec![], Some("/a"));
    assert!(pending.is_empty());
}

// -- queue_launch_file_args (WI-RA7.6) ---------------------------------------

use std::sync::Mutex;

/// A mutex some earlier holder panicked under. `std::sync::Mutex` marks it
/// poisoned and every later `lock()` returns `Err` — the state a launch must
/// still queue its files in.
fn poisoned_state() -> Mutex<FileOpenState> {
    let state = Mutex::new(FileOpenState::new());
    let outcome = std::thread::scope(|scope| {
        scope
            .spawn(|| {
                let _guard = state.lock().expect("fresh mutex");
                panic!("poison the file-open state (expected by this test)");
            })
            .join()
    });
    assert!(outcome.is_err(), "the holder must have panicked");
    assert!(state.is_poisoned(), "premise: the mutex is poisoned");
    state
}

fn queued(state: &Mutex<FileOpenState>) -> Vec<(String, Option<String>)> {
    state
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .pending
        .iter()
        .map(|open| (open.path.clone(), open.workspace_root.clone()))
        .collect()
}

#[test]
fn launch_file_args_are_queued_with_their_workspace_roots() {
    let state = Mutex::new(FileOpenState::new());
    queue_launch_file_args(
        &state,
        vec!["/docs/notes/a.md".to_string(), "/b.md".to_string()],
    );
    assert_eq!(
        queued(&state),
        vec![
            (
                "/docs/notes/a.md".to_string(),
                Some("/docs/notes".to_string())
            ),
            // Root-level file: no workspace, so `/` is never opened as one.
            ("/b.md".to_string(), None),
        ]
    );
}

#[test]
fn launch_file_args_survive_a_poisoned_state_mutex() {
    let state = poisoned_state();
    queue_launch_file_args(&state, vec!["/docs/笔记/日记.md".to_string()]);
    assert_eq!(
        queued(&state),
        vec![(
            "/docs/笔记/日记.md".to_string(),
            Some("/docs/笔记".to_string())
        )],
        "a poisoned mutex must not drop the file the app was launched to open"
    );
}

#[test]
fn no_launch_file_args_queue_nothing() {
    let state = Mutex::new(FileOpenState::new());
    queue_launch_file_args(&state, Vec::new());
    assert!(queued(&state).is_empty());
}
