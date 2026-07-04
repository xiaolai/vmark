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
        determine_file_open_action(true, true),
        FileOpenAction::EmitToMainWindow,
    );
}

#[test]
fn action_ready_without_window() {
    assert_eq!(
        determine_file_open_action(true, false),
        FileOpenAction::QueueAndCreateWindow,
    );
}

#[test]
fn action_not_ready_with_window() {
    assert_eq!(
        determine_file_open_action(false, true),
        FileOpenAction::QueueOnly,
    );
}

#[test]
fn action_not_ready_without_window() {
    assert_eq!(
        determine_file_open_action(false, false),
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
    state.frontend_ready = true;
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
    state.frontend_ready = true;
    let outcome = decide_file_open_locked(&mut state, false, paths(&["/a.md"]), Some("/ws"));
    assert!(matches!(
        outcome,
        FileOpenOutcome::Queued {
            create_window: true
        }
    ));
    assert_eq!(state.pending.len(), 1);
    assert_eq!(state.pending[0].workspace_root.as_deref(), Some("/ws"));
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
    let drained = mark_ready_and_drain(&mut state);
    assert_eq!(drained.len(), 1);
    assert_eq!(drained[0].path, "/A.md");
    assert!(state.frontend_ready);
    assert!(state.pending.is_empty());

    // Open B after ready → emitted (not re-queued), so not dropped.
    let b = decide_file_open_locked(&mut state, true, paths(&["/B.md"]), None);
    match b {
        FileOpenOutcome::Emit(p) => assert_eq!(p[0].path, "/B.md"),
        _ => panic!("expected Emit"),
    }
    assert!(state.pending.is_empty());
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
