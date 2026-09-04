//! Audit 20260903 round 3, #21 — the same-document transition validates and writes
//! under one guard, and refuses to restore committed authority a concurrent
//! top-level navigation has revoked.

use super::*;
use crate::browser::registry::{AutomationMode, BrowserRegistry, Lifecycle};

/// A shared AI tab that committed `url` under an approved navigation.
fn committed_shared_tab(reg: &mut BrowserRegistry, url: &str) -> String {
    reg.create_with_mode("t", "main", AutomationMode::AiShared)
        .unwrap();
    reg.set_policy_epoch("t", 4).unwrap();
    let ticket = reg.begin_navigation("t", url).unwrap();
    reg.set_shared_navigation_approval("t", url).unwrap();
    reg.bump_generation("t").unwrap();
    reg.set_committed_url("t", url).unwrap();
    ticket.id
}

#[test]
fn the_view_reads_everything_the_observer_decides_on_in_one_guard() {
    let mut reg = BrowserRegistry::default();
    let ticket = committed_shared_tab(&mut reg, "https://ex.com/a");
    let view = reg
        .same_document_view("t", "https://ex.com/a#section")
        .expect("a known tab has a view");
    assert_eq!(
        view,
        SameDocumentView {
            committed_url: Some("https://ex.com/a".into()),
            mode: AutomationMode::AiShared,
            policy_epoch: 4,
            navigation_id: Some(ticket),
            shared_approved: true,
        }
    );
    // The approval is evaluated for the URL the observer saw, per origin.
    assert!(
        !reg.same_document_view("t", "https://evil.com/")
            .unwrap()
            .shared_approved
    );
    assert_eq!(reg.same_document_view("ghost", "https://ex.com/"), None);
}

#[test]
fn commit_bumps_the_generation_and_records_the_url() {
    let mut reg = BrowserRegistry::default();
    let ticket = committed_shared_tab(&mut reg, "https://ex.com/a");
    let generation = reg
        .commit_same_document("t", "https://ex.com/a#part", Some(&ticket))
        .unwrap();
    assert_eq!(generation, 2, "one bump per same-document navigation (R7a)");
    assert_eq!(reg.generation("t"), Some(2));
    assert_eq!(reg.committed_url("t"), Some("https://ex.com/a#part"));
    assert!(
        !reg.is_command_fresh("t", 1),
        "the previous view's stamps are stale"
    );
    assert!(reg.is_command_fresh("t", 2));
}

#[test]
fn a_top_level_navigation_begun_after_the_observation_supersedes_the_commit() {
    // The race this module exists for: the observer read the page, a command thread
    // began a navigation (revoking the committed page, minting a newer ticket), and
    // the observer's write must NOT put the old page's authority back on a tab that
    // is Navigating — and therefore executable.
    let mut reg = BrowserRegistry::default();
    let observed = committed_shared_tab(&mut reg, "https://ex.com/a");
    let view = reg.same_document_view("t", "https://ex.com/a#x").unwrap();
    reg.begin_navigation("t", "https://ex.com/next").unwrap();
    assert_eq!(reg.committed_url("t"), None, "begin revoked the page");

    let refused =
        reg.commit_same_document("t", "https://ex.com/a#x", view.navigation_id.as_deref());
    assert_eq!(refused, Err(SameDocumentRefusal::Superseded));
    assert_eq!(reg.committed_url("t"), None, "no authority restored");
    assert_eq!(reg.generation("t"), Some(1), "no bump for a refused commit");
    assert_eq!(reg.state("t"), Some(Lifecycle::Navigating));
    assert_ne!(
        reg.navigation_ticket("t").map(|t| t.id.clone()),
        Some(observed),
        "the newer ticket stays in force"
    );
}

#[test]
fn a_commit_on_a_non_executable_tab_is_refused() {
    let mut reg = BrowserRegistry::default();
    reg.create("t", "main").unwrap();
    assert_eq!(
        reg.commit_same_document("t", "https://ex.com/", None),
        Err(SameDocumentRefusal::NotExecutable),
        "Creating owns no page"
    );
    reg.transition("t", Lifecycle::Live).unwrap();
    reg.set_committed_url("t", "https://ex.com/").unwrap();
    reg.transition("t", Lifecycle::Crashed).unwrap();
    assert_eq!(
        reg.commit_same_document("t", "https://ex.com/", None),
        Err(SameDocumentRefusal::NotExecutable),
        "Crashed owns no live process"
    );
}

#[test]
fn a_tab_whose_page_never_committed_has_nothing_to_record() {
    let mut reg = BrowserRegistry::default();
    reg.create("t", "main").unwrap();
    let ticket = reg.begin_navigation("t", "https://ex.com/").unwrap();
    // Navigating (executable) but the load has not committed: no page, no bump.
    assert_eq!(
        reg.commit_same_document("t", "https://ex.com/#x", Some(&ticket.id)),
        Err(SameDocumentRefusal::NoCommittedPage)
    );
    assert_eq!(reg.generation("t"), Some(0));
}

// Round 3 follow-up — a generation that cannot advance cannot distinguish this
// view from the last one, so the tab's committed authority is DROPPED rather than
// re-recorded. `commit_navigation` already fails closed this way (#28); the
// same-document path used to be the remaining place where a committed URL could
// be written without a fresh generation behind it.
#[test]
fn an_exhausted_generation_drops_the_committed_page_instead_of_re_recording_it() {
    let mut reg = BrowserRegistry::default();
    let ticket = committed_shared_tab(&mut reg, "https://ex.com/a");
    reg.force_generation("t", u64::MAX);
    assert_eq!(
        reg.commit_same_document("t", "https://ex.com/a#x", Some(&ticket)),
        Err(SameDocumentRefusal::GenerationExhausted)
    );
    assert_eq!(
        reg.committed_url("t"),
        None,
        "the old view's origin must not survive a view change nothing can stamp"
    );
    assert_eq!(reg.generation("t"), Some(u64::MAX), "and nothing wrapped");
    // With no committed page, every driver command is refused at the gate.
    assert!(!reg.is_command_fresh("t", u64::MAX) || reg.committed_url("t").is_none());
}

#[test]
fn an_unknown_tab_is_refused() {
    let mut reg = BrowserRegistry::default();
    assert_eq!(
        reg.commit_same_document("ghost", "https://ex.com/", None),
        Err(SameDocumentRefusal::UnknownTab)
    );
}

#[test]
fn a_tab_that_never_navigated_by_ticket_commits_against_no_ticket() {
    // Delegate-driven human tabs may hold a committed page with no active ticket;
    // "no ticket then, no ticket now" is the same page.
    let mut reg = BrowserRegistry::default();
    reg.create("t", "main").unwrap();
    reg.transition("t", Lifecycle::Live).unwrap();
    reg.set_committed_url("t", "https://ex.com/").unwrap();
    assert_eq!(
        reg.commit_same_document("t", "https://ex.com/#x", None),
        Ok(1)
    );
    assert_eq!(
        reg.commit_same_document("t", "https://ex.com/#y", Some("nav-t-9")),
        Err(SameDocumentRefusal::Superseded),
        "expecting a ticket the tab does not hold is a mismatch too"
    );
}
