//! Audit 20260903 (journey 37) — the flag choreography around an API-initiated
//! navigation, decided without WebKit. The WebKit facts it rests on are measured in
//! `nav_api_navigation_native.test.rs`.

use super::*;

#[test]
fn the_flag_is_raised_while_the_call_runs() {
    // The synchronous URL change happens INSIDE the call; the observer must see the
    // flag up at that moment.
    let loading = Cell::new(false);
    let owned = own(&loading, || {
        assert!(
            loading.get(),
            "the flag must be up while WebKit publishes the URL"
        );
        true
    });
    assert!(owned.is_some());
    assert!(
        loading.get(),
        "and it stays up until the navigation settles"
    );
}

#[test]
fn a_call_that_created_no_navigation_restores_the_flag_at_once() {
    // Nowhere to go: no URL change happened and nothing will report anything.
    let loading = Cell::new(false);
    assert_eq!(own(&loading, || false), None);
    assert!(!loading.get());
    let loading = Cell::new(true);
    assert_eq!(own(&loading, || false), None);
    assert!(loading.get(), "an in-flight load keeps its flag");
}

#[test]
fn a_reported_start_hands_the_flag_to_the_load() {
    let loading = Cell::new(false);
    let owned = own(&loading, || true).expect("created");
    assert_eq!(
        owned.settle(&loading, true, true),
        Settlement::CrossDocument
    );
    assert!(loading.get(), "did_commit lowers it, nothing before");
}

#[test]
fn no_start_and_an_idle_view_is_a_same_document_move_the_observer_must_handle() {
    let loading = Cell::new(false);
    let owned = own(&loading, || true).expect("created");
    assert_eq!(
        owned.settle(&loading, false, false),
        Settlement::SameDocument { observe_now: true }
    );
    assert!(!loading.get(), "back to what it was");
}

#[test]
fn a_same_document_move_during_an_in_flight_load_keeps_the_flag_and_skips_the_observer() {
    // A URL change while a top-level load is in flight belongs to that load's commit.
    let loading = Cell::new(true);
    let owned = own(&loading, || true).expect("created");
    assert_eq!(
        owned.settle(&loading, false, false),
        Settlement::SameDocument { observe_now: false }
    );
    assert!(loading.get(), "the in-flight load still owns the flag");
}

#[test]
fn no_start_while_still_loading_leaves_the_flag_raised_for_the_start_to_come() {
    let loading = Cell::new(false);
    let owned = own(&loading, || true).expect("created");
    assert_eq!(owned.settle(&loading, false, true), Settlement::Pending);
    assert!(loading.get());
}
