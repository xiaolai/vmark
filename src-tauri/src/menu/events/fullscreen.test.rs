//! Tests for `menu/events/fullscreen.rs` — which window a Toggle Full Screen
//! click applies to, and that the toggle flips the window's real state.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use super::*;

// --- pick_fullscreen_target ---------------------------------------------------

#[test]
fn the_focused_window_wins() {
    let live = ["doc-2", "main"];
    assert_eq!(
        pick_fullscreen_target(Some("doc-2"), Some("main"), &live, &live),
        Some("doc-2")
    );
    // Any focused window, not only a document one: F11 in Settings
    // fullscreens Settings.
    assert_eq!(
        pick_fullscreen_target(
            Some("settings"),
            Some("main"),
            &["main", "settings"],
            &["main"]
        ),
        Some("settings")
    );
}

#[test]
fn without_focus_the_last_natively_focused_window_is_used() {
    // A Windows menu click can briefly clear focus; the secondary window the
    // user was in must be toggled, not `main` — even one opened a moment ago
    // whose frontend is not ready yet.
    let live = ["doc-3", "main"];
    assert_eq!(
        pick_fullscreen_target(None, Some("doc-3"), &live, &live),
        Some("doc-3")
    );
}

#[test]
fn a_closed_last_focused_window_is_not_targeted() {
    assert_eq!(
        pick_fullscreen_target(None, Some("doc-9"), &["main"], &["main"]),
        Some("main")
    );
    let live = ["doc-1", "main"];
    assert_eq!(
        pick_fullscreen_target(None, Some("doc-9"), &live, &live),
        None
    );
}

#[test]
fn a_lone_document_window_is_unambiguous() {
    assert_eq!(
        pick_fullscreen_target(None, None, &["doc-4", "settings"], &["doc-4"]),
        Some("doc-4")
    );
}

#[test]
fn several_windows_and_no_history_toggle_nothing() {
    let live = ["doc-1", "main"];
    assert_eq!(pick_fullscreen_target(None, None, &live, &live), None);
    assert_eq!(pick_fullscreen_target(None, None, &[], &[]), None);
}

// --- Linux pending requests: one in flight, latest desired --------------------

#[test]
fn a_first_press_requests_the_opposite_of_the_realized_state() {
    let now = Instant::now();
    let (slot, request) = on_press(None, false, now);
    assert_eq!(request, Some(true));
    assert_eq!((slot.in_flight, slot.desired), (true, true));
    assert_eq!(on_press(None, true, now).1, Some(false));
}

#[test]
fn presses_while_a_request_is_in_flight_only_move_the_desired_state() {
    let at = Instant::now();
    let (slot, _) = on_press(None, false, at);
    let (slot, request) = on_press(Some(slot), false, at + Duration::from_millis(30));
    assert_eq!(request, None);
    assert_eq!((slot.in_flight, slot.desired), (true, false));
}

#[test]
fn three_fast_presses_then_a_fourth_leave_fullscreen() {
    // The audit's sequence: enter, leave, enter queued fast; GTK reports the
    // enter; the fourth press must LEAVE, not enter again.
    let at = Instant::now();
    let mut map = HashMap::new();
    assert_eq!(apply_press(&mut map, "main", false, at), Some(true));
    assert_eq!(apply_press(&mut map, "main", false, at), None);
    assert_eq!(apply_press(&mut map, "main", false, at), None);
    // Desired is enter again, and the enter in flight just landed: settled.
    assert_eq!(apply_observed(&mut map, "main", true, at), None);
    assert!(map.is_empty());
    assert_eq!(apply_press(&mut map, "main", true, at), Some(false));
}

#[test]
fn an_acknowledged_request_sends_the_next_one_when_the_user_changed_their_mind() {
    let at = Instant::now();
    let mut map = HashMap::new();
    apply_press(&mut map, "main", false, at); // enter in flight
    apply_press(&mut map, "main", false, at); // desired: leave
                                              // The enter lands: the leave goes out now, one request at a time.
    assert_eq!(apply_observed(&mut map, "main", true, at), Some(false));
    assert_eq!(map.get("main").map(|s| s.in_flight), Some(false));
    // The leave lands: settled.
    assert_eq!(apply_observed(&mut map, "main", false, at), None);
    assert!(map.is_empty());
}

#[test]
fn a_state_change_that_is_not_the_request_in_flight_leaves_it_pending() {
    let at = Instant::now();
    let mut map = HashMap::new();
    apply_press(&mut map, "main", false, at); // enter in flight
    assert_eq!(apply_observed(&mut map, "main", false, at), None);
    assert!(map.contains_key("main"));
    // Another window's change never touches this one.
    assert_eq!(apply_observed(&mut map, "doc-1", true, at), None);
    assert!(map.contains_key("main"));
}

#[test]
fn a_request_the_window_manager_never_applies_expires() {
    let at = Instant::now();
    let (slot, _) = on_press(None, false, at);
    // Still not fullscreen long after: the realized state decides again.
    let (slot, request) = on_press(Some(slot), false, at + PENDING_WINDOW);
    assert_eq!(request, Some(true));
    assert_eq!(slot.since, at + PENDING_WINDOW);
}

#[test]
fn after_settling_an_outside_change_is_followed() {
    // Entered and acknowledged, then the window manager left fullscreen on
    // its own: nothing is pending, so the next press enters again.
    let at = Instant::now();
    let mut map = HashMap::new();
    apply_press(&mut map, "main", false, at);
    apply_observed(&mut map, "main", true, at);
    assert_eq!(apply_observed(&mut map, "main", false, at), None);
    assert_eq!(apply_press(&mut map, "main", false, at), Some(true));
}

// --- toggle_fullscreen (Windows: synchronous state, no pending record) -------

struct FakeWindow {
    fullscreen: Cell<bool>,
    fail_read: bool,
    requests: RefCell<Vec<bool>>,
}

impl FakeWindow {
    fn new(fullscreen: bool) -> Self {
        Self {
            fullscreen: Cell::new(fullscreen),
            fail_read: false,
            requests: RefCell::new(Vec::new()),
        }
    }
}

impl FullscreenWindow for FakeWindow {
    fn is_fullscreen_now(&self) -> tauri::Result<bool> {
        if self.fail_read {
            return Err(tauri::Error::WindowNotFound);
        }
        Ok(self.fullscreen.get())
    }

    fn set_fullscreen(&self, fullscreen: bool) -> tauri::Result<()> {
        // Records the request only: the realized state changes when the
        // test says the window manager applied it.
        self.requests.borrow_mut().push(fullscreen);
        Ok(())
    }
}

#[test]
fn toggling_enters_then_leaves_fullscreen() {
    let window = FakeWindow::new(false);
    assert!(toggle_fullscreen(&window).unwrap());
    window.fullscreen.set(true);
    assert!(!toggle_fullscreen(&window).unwrap());
    assert_eq!(*window.requests.borrow(), vec![true, false]);
}

#[test]
fn an_unreadable_state_requests_nothing() {
    let window = FakeWindow {
        fail_read: true,
        ..FakeWindow::new(false)
    };
    assert!(toggle_fullscreen(&window).is_err());
    assert!(window.requests.borrow().is_empty());
}

// One test owns the statics, so parallel tests never race on them.
#[test]
fn focus_and_pending_records_follow_the_window_lifecycle() {
    note_window_focus("doc-77", true);
    note_window_focus("doc-77", false);
    assert_eq!(LAST_FOCUSED.lock().unwrap().as_deref(), Some("doc-77"));

    apply_press(
        pending().get_or_insert_with(HashMap::new),
        "doc-77",
        false,
        Instant::now(),
    );
    // Destroying another window leaves doc-77's records alone.
    forget_window("doc-78");
    assert_eq!(LAST_FOCUSED.lock().unwrap().as_deref(), Some("doc-77"));
    assert!(pending().as_ref().unwrap().contains_key("doc-77"));
    // A window reopened under the label inherits nothing.
    forget_window("doc-77");
    assert_eq!(*LAST_FOCUSED.lock().unwrap(), None);
    assert!(!pending().as_ref().unwrap().contains_key("doc-77"));
}
