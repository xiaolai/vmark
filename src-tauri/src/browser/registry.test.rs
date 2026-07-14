//! WI-S0.2 — window routing. Every browser event used to be broadcast to every window;
//! routing needs one fact, and this is where it lives: which window owns this tab.
//! Unit tests for the browser lifecycle + identity registry (WI-1.2).

use super::*;

#[test]
fn create_registers_a_tab_in_creating_state_at_generation_zero() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    assert_eq!(reg.state("t1"), Some(Lifecycle::Creating));
    assert_eq!(reg.generation("t1"), Some(0));
    assert_eq!(reg.window_of("t1"), Some("main"));
    assert!(reg.contains("t1"));
}

#[test]
fn create_rejects_a_duplicate_tab_id() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    assert_eq!(
        reg.create("t1", "main"),
        Err(BrowserError::DuplicateTab("t1".into()))
    );
}

#[test]
fn transition_and_bump_reject_unknown_tabs() {
    let mut reg = BrowserRegistry::default();
    assert_eq!(
        reg.transition("nope", Lifecycle::Live),
        Err(BrowserError::UnknownTab("nope".into()))
    );
    assert_eq!(
        reg.bump_generation("nope"),
        Err(BrowserError::UnknownTab("nope".into()))
    );
}

#[test]
fn valid_lifecycle_path_is_accepted() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    // Creating → Live → Navigating → Live → Hibernated → Creating → Destroyed
    reg.transition("t1", Lifecycle::Live).unwrap();
    reg.transition("t1", Lifecycle::Navigating).unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    reg.transition("t1", Lifecycle::Hibernated).unwrap();
    reg.transition("t1", Lifecycle::Creating).unwrap();
    reg.transition("t1", Lifecycle::Crashed).unwrap();
    reg.transition("t1", Lifecycle::Creating).unwrap();
    reg.transition("t1", Lifecycle::Destroyed).unwrap();
    assert_eq!(reg.state("t1"), Some(Lifecycle::Destroyed));
}

#[test]
fn invalid_transitions_are_rejected() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    // A tab still constructing cannot hibernate — it has no page to collapse.
    assert_eq!(
        reg.transition("t1", Lifecycle::Hibernated),
        Err(BrowserError::InvalidTransition {
            from: Lifecycle::Creating,
            to: Lifecycle::Hibernated
        })
    );
}

// ---------------------------------------------------------------------------
// Navigation-commit transitions. `didCommitNavigation` is the ONLY writer of
// `Navigating`, and it can fire from every state in which a webview exists and
// a load can start: the first load (Creating), a normal navigation (Live), a
// redirect chain committing again (Navigating), and a post-crash reload
// (Crashed). Rejecting any of these left the registry stuck in the pre-commit
// state, because the delegate swallowed the error.
// ---------------------------------------------------------------------------

#[test]
fn the_first_load_commits_from_creating() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Navigating).unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    assert_eq!(reg.state("t1"), Some(Lifecycle::Live));
}

#[test]
fn a_redirect_chain_can_commit_again_while_navigating() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    reg.transition("t1", Lifecycle::Navigating).unwrap();
    // The redirect target commits too — a self-transition, not an error.
    reg.transition("t1", Lifecycle::Navigating).unwrap();
    assert_eq!(reg.state("t1"), Some(Lifecycle::Navigating));
}

#[test]
fn a_crashed_tab_reaches_live_again_through_a_reload_navigation() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    reg.transition("t1", Lifecycle::Crashed).unwrap();
    // The user hits "reload" on the crash overlay: the reload's commit lands
    // straight on the crashed entry (no Creating hop from the command side).
    reg.transition("t1", Lifecycle::Navigating).unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    assert_eq!(reg.state("t1"), Some(Lifecycle::Live));
}

#[test]
fn a_failed_load_returns_the_tab_to_an_idle_live_state() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    // didFailProvisionalNavigation on the very first load: the webview exists and
    // is idle, so it must not stay stuck in Creating forever.
    reg.transition("t1", Lifecycle::Live).unwrap();
    assert_eq!(reg.state("t1"), Some(Lifecycle::Live));
}

#[test]
fn bump_generation_is_refused_on_a_destroyed_tab() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Destroyed).unwrap();
    // Destroyed is terminal: nothing about it may change, generation included.
    assert_eq!(
        reg.bump_generation("t1"),
        Err(BrowserError::TerminalTab("t1".into()))
    );
    assert_eq!(reg.generation("t1"), Some(0));
}

#[test]
fn committed_url_writes_are_refused_on_a_destroyed_tab() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.set_committed_url("t1", "https://a.com").unwrap();
    reg.transition("t1", Lifecycle::Destroyed).unwrap();
    // A late delegate callback must not re-grant an origin on a dead tab.
    assert_eq!(
        reg.set_committed_url("t1", "https://evil.com"),
        Err(BrowserError::TerminalTab("t1".into()))
    );
    // Destroyed is non-executable, so the transition already revoked the committed
    // origin: a dead tab holds NO committed authority — stronger than merely not
    // being overwritten by the refused write.
    assert_eq!(reg.committed_url("t1"), None);
}

#[test]
fn destroyed_is_terminal() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Destroyed).unwrap();
    assert!(Lifecycle::Destroyed.is_terminal());
    // No transition out of Destroyed.
    assert!(reg.transition("t1", Lifecycle::Live).is_err());
    assert!(reg.transition("t1", Lifecycle::Creating).is_err());
}

#[test]
fn generation_bump_makes_prior_commands_stale() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    let gen = reg.generation("t1").unwrap();
    assert!(reg.is_command_fresh("t1", gen)); // fresh at current generation

    let new_gen = reg.bump_generation("t1").unwrap(); // page navigated
    assert_eq!(new_gen, gen + 1);
    assert!(!reg.is_command_fresh("t1", gen)); // old-generation command is now stale
    assert!(reg.is_command_fresh("t1", new_gen)); // new-generation command is fresh
}

#[test]
fn commands_for_unknown_or_destroyed_tabs_are_never_fresh() {
    let mut reg = BrowserRegistry::default();
    assert!(!reg.is_command_fresh("nope", 0));
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Destroyed).unwrap();
    assert!(!reg.is_command_fresh("t1", 0)); // terminal → not fresh
}

#[test]
fn remove_and_tabs_in_window() {
    let mut reg = BrowserRegistry::default();
    reg.create("a", "w1").unwrap();
    reg.create("b", "w1").unwrap();
    reg.create("c", "w2").unwrap();
    let mut w1 = reg.tabs_in_window("w1");
    w1.sort();
    assert_eq!(w1, vec!["a".to_string(), "b".to_string()]);
    assert_eq!(reg.tabs_in_window("w2"), vec!["c".to_string()]);

    reg.remove("a");
    assert!(!reg.contains("a"));
    assert_eq!(reg.tabs_in_window("w1"), vec!["b".to_string()]);
}

#[test]
fn validate_navigation_url_accepts_http_and_https() {
    assert!(validate_navigation_url("https://example.com/x").is_ok());
    assert!(validate_navigation_url("http://example.com").is_ok());
    assert!(validate_navigation_url("  https://example.com/a?b=1#c  ").is_ok());
    assert!(validate_navigation_url("HTTPS://Example.COM/x").is_ok());
}

#[test]
fn validate_navigation_url_returns_the_value_the_caller_must_load() {
    // The gate validated `url.trim()` but returned `()`, so callers loaded the
    // ORIGINAL string — validated value ≠ consumed value. It now hands back the
    // exact string that passed, so the two can never diverge.
    assert_eq!(
        validate_navigation_url("  https://example.com/a?b=1#c  ").unwrap(),
        "https://example.com/a?b=1#c"
    );
    assert_eq!(
        validate_navigation_url("https://example.com").unwrap(),
        "https://example.com"
    );
}

#[test]
fn validate_navigation_url_rejects_opaque_and_empty() {
    for bad in [
        "about:blank",
        "data:text/html,x",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "blob:https://x/y",
        "https://",
        "http:///path",
        "not a url",
        "",
    ] {
        assert!(
            validate_navigation_url(bad).is_err(),
            "expected {bad:?} to be rejected"
        );
    }
}

// ---------------------------------------------------------------------------
// Committed-origin tracking (WI-2.1 / R7a) — the fact browser_eval gates on.
//
// R7a: "The grant attaches to the **committed** top-level origin
// (didCommitNavigation), never to a *provisional* one — otherwise a redirect
// chain briefly grants the wrong origin. It is **revoked the moment a new
// provisional navigation starts**, and re-granted only on the next commit."
// ---------------------------------------------------------------------------

#[test]
fn a_new_tab_has_no_committed_url_until_a_navigation_commits() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    // Creating a tab with a target URL does NOT grant that origin — nothing has
    // committed yet, so the driver must not be able to eval in it.
    assert_eq!(reg.committed_url("t1"), None);
}

#[test]
fn commit_records_the_committed_url() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.set_committed_url("t1", "https://a.com/page").unwrap();
    assert_eq!(reg.committed_url("t1"), Some("https://a.com/page"));
}

#[test]
fn a_new_provisional_navigation_revokes_the_committed_url() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.set_committed_url("t1", "https://a.com").unwrap();

    // A redirect chain starts: the old origin's grant must lapse IMMEDIATELY,
    // not linger until the next commit lands.
    reg.clear_committed_url("t1").unwrap();
    assert_eq!(reg.committed_url("t1"), None);

    // …and is re-established only by the next commit.
    reg.set_committed_url("t1", "https://b.com").unwrap();
    assert_eq!(reg.committed_url("t1"), Some("https://b.com"));
}

#[test]
fn committed_url_operations_reject_unknown_tabs() {
    let mut reg = BrowserRegistry::default();
    assert_eq!(
        reg.set_committed_url("nope", "https://a.com"),
        Err(BrowserError::UnknownTab("nope".into()))
    );
    assert_eq!(
        reg.clear_committed_url("nope"),
        Err(BrowserError::UnknownTab("nope".into()))
    );
    assert_eq!(reg.committed_url("nope"), None);
}

#[test]
fn removing_a_tab_drops_its_committed_url() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.set_committed_url("t1", "https://a.com").unwrap();
    reg.remove("t1");
    assert_eq!(reg.committed_url("t1"), None);
}

// ---------------------------------------------------------------------------
// R2 audit — authorization must not survive a crash/hibernate. A current-
// generation eval could otherwise pass freshness + origin checks against a dead
// or collapsed webview (registry.rs:193 / nav_delegate crash path).
// ---------------------------------------------------------------------------

#[test]
fn only_live_and_navigating_are_executable_states() {
    assert!(Lifecycle::Live.is_executable());
    assert!(Lifecycle::Navigating.is_executable());
    assert!(!Lifecycle::Creating.is_executable());
    assert!(!Lifecycle::Crashed.is_executable());
    assert!(!Lifecycle::Hibernated.is_executable());
    assert!(!Lifecycle::Destroyed.is_executable());
}

#[test]
fn a_crash_revokes_the_committed_url_and_freshness() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    reg.set_committed_url("t1", "https://a.com").unwrap();
    let gen = reg.generation("t1").unwrap();
    assert!(reg.is_command_fresh("t1", gen));

    // The content process dies. An eval stamped with the CURRENT generation must
    // no longer authorize: the committed origin is gone and the tab is not
    // executable, so both the freshness gate and the origin gate fail closed.
    reg.transition("t1", Lifecycle::Crashed).unwrap();
    assert_eq!(reg.committed_url("t1"), None);
    assert!(!reg.is_command_fresh("t1", gen));
}

#[test]
fn hibernation_revokes_the_committed_url_and_freshness() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    reg.set_committed_url("t1", "https://a.com").unwrap();
    let gen = reg.generation("t1").unwrap();

    reg.transition("t1", Lifecycle::Hibernated).unwrap();
    assert_eq!(reg.committed_url("t1"), None);
    assert!(!reg.is_command_fresh("t1", gen));
}

#[test]
fn a_reload_after_crash_re_establishes_authority_only_on_commit() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    reg.set_committed_url("t1", "https://a.com").unwrap();
    reg.transition("t1", Lifecycle::Crashed).unwrap();
    // The reload commits: authority returns, scoped to the freshly committed page.
    reg.transition("t1", Lifecycle::Navigating).unwrap();
    reg.set_committed_url("t1", "https://a.com").unwrap();
    let gen = reg.generation("t1").unwrap();
    assert_eq!(reg.committed_url("t1"), Some("https://a.com"));
    assert!(reg.is_command_fresh("t1", gen));
}

#[test]
fn an_executable_transition_preserves_the_committed_url() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Live).unwrap();
    reg.set_committed_url("t1", "https://a.com").unwrap();
    // Live → Navigating (a redirect committing) keeps the current committed page
    // until the new one is recorded.
    reg.transition("t1", Lifecycle::Navigating).unwrap();
    assert_eq!(reg.committed_url("t1"), Some("https://a.com"));
}

// WI-S0.2 — window-routed events. The delegate used to `app.emit`, broadcasting every
// browser event to every window. Routing needs one fact: which window owns this tab.
// It is recorded at create time from the invoking WebviewWindow, never from a caller's
// claim, and this is the lookup the emitter depends on.
#[test]
fn window_of_names_the_window_that_owns_the_tab() {
    let mut reg = BrowserRegistry::default();
    reg.create("t1", "main").expect("create");
    reg.create("t2", "doc-2").expect("create");

    assert_eq!(reg.window_of("t1"), Some("main"));
    assert_eq!(reg.window_of("t2"), Some("doc-2"));
}

#[test]
fn window_of_is_none_for_an_unknown_tab_so_an_event_is_dropped_not_broadcast() {
    // The emitter drops an event whose owner it cannot resolve. That is deliberate: an
    // event with no known window has no window it is entitled to reach, and sending it
    // to all of them is how a routing failure becomes a leak.
    let reg = BrowserRegistry::default();
    assert_eq!(reg.window_of("ghost"), None);
}
