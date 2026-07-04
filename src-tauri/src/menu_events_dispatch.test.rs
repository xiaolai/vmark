//! Tests for `menu_events_dispatch.rs` — pure decision logic of the menu
//! event dispatcher: id classification, document-window routing decisions,
//! and event-payload construction. Behavior that needs a live `AppHandle`
//! (actual emits, window creation) is exercised via the app, not here.

use super::*;

// --- classify_menu_id -------------------------------------------------------

#[test]
fn quit_and_save_all_quit_are_rust_handled() {
    assert_eq!(classify_menu_id("quit"), MenuAction::Quit);
    assert_eq!(classify_menu_id("save-all-quit"), MenuAction::SaveAllQuit);
}

#[test]
fn recent_file_ids_parse_their_index() {
    assert_eq!(classify_menu_id("recent-file-0"), MenuAction::RecentFile(0));
    assert_eq!(
        classify_menu_id("recent-file-12"),
        MenuAction::RecentFile(12)
    );
}

#[test]
fn recent_workspace_ids_parse_their_index() {
    assert_eq!(
        classify_menu_id("recent-workspace-3"),
        MenuAction::RecentWorkspace(3)
    );
}

#[test]
fn genie_item_ids_parse_their_index() {
    assert_eq!(classify_menu_id("genie-item-7"), MenuAction::GenieItem(7));
}

#[test]
fn unparseable_indices_fall_through_to_generic_routing() {
    // Matches the historical dispatcher: a malformed index never matched the
    // `if let Ok(index)` arm and fell through to the generic emit.
    assert_eq!(classify_menu_id("recent-file-abc"), MenuAction::Generic);
    assert_eq!(classify_menu_id("recent-file-"), MenuAction::Generic);
    assert_eq!(classify_menu_id("recent-file--1"), MenuAction::Generic);
    assert_eq!(classify_menu_id("recent-workspace-x"), MenuAction::Generic);
    assert_eq!(classify_menu_id("genie-item-"), MenuAction::Generic);
}

#[test]
fn window_management_ids_are_classified() {
    assert_eq!(classify_menu_id("new-window"), MenuAction::NewWindow);
    assert_eq!(classify_menu_id("new"), MenuAction::New);
    assert_eq!(classify_menu_id("close"), MenuAction::Close);
}

#[test]
fn settings_and_about_are_rust_handled() {
    assert_eq!(classify_menu_id("preferences"), MenuAction::Preferences);
    assert_eq!(classify_menu_id("about"), MenuAction::About);
}

#[test]
fn open_like_ids_share_the_document_routing_path() {
    assert_eq!(classify_menu_id("open"), MenuAction::OpenLike);
    assert_eq!(classify_menu_id("open-folder"), MenuAction::OpenLike);
    assert_eq!(classify_menu_id("quick-open"), MenuAction::OpenLike);
}

#[test]
fn remaining_special_ids_are_classified() {
    assert_eq!(
        classify_menu_id("clear-recent-workspaces"),
        MenuAction::ClearRecentWorkspaces
    );
    assert_eq!(classify_menu_id("install-cli"), MenuAction::InstallCli);
}

#[test]
fn everything_else_routes_generically() {
    for id in ["save", "bold", "undo", "toggle-terminal", "unknown-id", ""] {
        assert_eq!(classify_menu_id(id), MenuAction::Generic, "id: {id}");
    }
}

// --- decide_document_routing -------------------------------------------------

#[test]
fn focused_document_window_gets_a_direct_emit() {
    assert_eq!(
        decide_document_routing(true, true),
        DocumentRouting::EmitToFocused
    );
    // A focused document window implies a document window exists, but the
    // decision must not depend on the second flag.
    assert_eq!(
        decide_document_routing(true, false),
        DocumentRouting::EmitToFocused
    );
}

#[test]
fn no_document_windows_creates_one_and_queues() {
    assert_eq!(
        decide_document_routing(false, false),
        DocumentRouting::CreateWindowAndQueue
    );
}

#[test]
fn unfocused_document_window_gets_the_event_queued() {
    assert_eq!(
        decide_document_routing(false, true),
        DocumentRouting::QueueToExistingWindow
    );
}

// --- event constructors ------------------------------------------------------

#[test]
fn simple_menu_events_carry_no_path() {
    let event = make_menu_event("menu:open");
    assert_eq!(event.event_name, "menu:open");
    assert!(event.recent_file_path.is_none());
}

#[test]
fn recent_file_events_use_the_shared_listener_channel() {
    let event = make_recent_file_event("/tmp/a.md");
    assert_eq!(event.event_name, "menu:open-recent-file");
    assert_eq!(event.recent_file_path.as_deref(), Some("/tmp/a.md"));
}

#[test]
fn recent_workspace_events_use_the_shared_listener_channel() {
    let event = make_recent_workspace_event("/tmp/ws");
    assert_eq!(event.event_name, "menu:open-recent-workspace");
    assert_eq!(event.recent_file_path.as_deref(), Some("/tmp/ws"));
}
