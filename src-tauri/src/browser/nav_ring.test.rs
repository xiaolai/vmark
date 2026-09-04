//! Audit 20260903 round 4, #19 — overlapping and superseded navigations, decided
//! without WebKit.

use super::*;

/// The registry's view: which ticket is live.
fn current(live: &str) -> impl Fn(&str) -> bool + '_ {
    move |id| id == live
}

#[test]
fn a_callback_with_no_navigation_object_is_taken_as_current() {
    // Unattributable, so it cannot be dropped as stale — and `is_current` is never
    // consulted for it.
    assert!(decide(None, |_| panic!("nothing to look up")));
}

#[test]
fn a_navigation_we_never_mapped_is_not_current() {
    // Every load we started was recorded at its provisional start; an unmapped one
    // was evicted — superseded — and `is_current` cannot rescue it.
    assert!(!decide(Some(None), |_| panic!("no id to check")));
}

#[test]
fn a_mapped_navigation_is_decided_by_the_registry() {
    assert!(decide(Some(Some("nav-2")), current("nav-2")));
    assert!(!decide(Some(Some("nav-1")), current("nav-2")));
}

#[test]
fn overlapping_navigations_are_told_apart_by_identity() {
    // A starts, then B starts before A commits. A late callback for A must not be
    // mistaken for B's, and B's must not be dropped because A once existed.
    let mut ring = Vec::new();
    push(&mut ring, 0xa, "nav-a".into());
    push(&mut ring, 0xb, "nav-b".into());
    let live = current("nav-b");
    assert!(!decide(Some(lookup(&ring, 0xa)), &live), "A was superseded");
    assert!(
        decide(Some(lookup(&ring, 0xb)), &live),
        "B is the live load"
    );
    // The registry moves on to B before A's redirect arrives: same verdict.
    assert_eq!(lookup(&ring, 0xa), Some("nav-a"));
    assert_eq!(lookup(&ring, 0xb), Some("nav-b"));
}

#[test]
fn a_superseded_navigation_evicted_from_the_ring_is_not_current() {
    let mut ring = Vec::new();
    push(&mut ring, 1, "nav-1".into());
    for key in 2..=(CAPACITY + 1) {
        push(&mut ring, key, format!("nav-{key}"));
    }
    assert_eq!(ring.len(), CAPACITY, "the ring is bounded");
    assert_eq!(lookup(&ring, 1), None, "the oldest navigation was evicted");
    assert_eq!(lookup(&ring, 2), Some("nav-2"), "the next-oldest survives");
    assert_eq!(lookup(&ring, CAPACITY + 1), Some("nav-9"));
    // A late callback for the evicted load: even a registry that (impossibly)
    // still named it current cannot make it so — it is unmapped.
    assert!(!decide(Some(lookup(&ring, 1)), |_| true));
}

#[test]
fn re_pushing_a_key_replaces_its_ticket_and_makes_it_newest() {
    // WebKit reuses `WKNavigation` addresses; the same key seen again is a NEW load
    // and must map to its new ticket, once, at the newest position.
    let mut ring = Vec::new();
    push(&mut ring, 7, "first".into());
    push(&mut ring, 8, "other".into());
    push(&mut ring, 7, "second".into());
    assert_eq!(lookup(&ring, 7), Some("second"));
    assert_eq!(ring.iter().filter(|(key, _)| *key == 7).count(), 1);
    assert_eq!(
        ring.last().map(|(key, _)| *key),
        Some(7),
        "re-pushed = newest"
    );
    // Being newest, it now outlives entries pushed before it.
    for key in 100..(100 + CAPACITY - 1) {
        push(&mut ring, key, format!("nav-{key}"));
    }
    assert_eq!(lookup(&ring, 8), None, "the older entry went first");
    assert_eq!(
        lookup(&ring, 7),
        Some("second"),
        "the re-pushed one is still here"
    );
}

#[test]
fn lookup_misses_are_none_not_a_neighbour() {
    let mut ring = Vec::new();
    push(&mut ring, 10, "nav-10".into());
    assert_eq!(lookup(&ring, 11), None);
    assert_eq!(lookup(&[], 10), None);
}
