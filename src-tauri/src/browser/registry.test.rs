//! Unit tests for the browser lifecycle + identity registry (WI-1.2).

use super::*;

#[test]
fn create_registers_a_tab_in_creating_state_at_generation_zero() {
    let mut reg = BrowserRegistry::new();
    reg.create("t1", "main").unwrap();
    assert_eq!(reg.state("t1"), Some(Lifecycle::Creating));
    assert_eq!(reg.generation("t1"), Some(0));
    assert_eq!(reg.window_of("t1"), Some("main"));
    assert_eq!(reg.len(), 1);
}

#[test]
fn create_rejects_a_duplicate_tab_id() {
    let mut reg = BrowserRegistry::new();
    reg.create("t1", "main").unwrap();
    assert_eq!(
        reg.create("t1", "main"),
        Err(BrowserError::DuplicateTab("t1".into()))
    );
}

#[test]
fn transition_and_bump_reject_unknown_tabs() {
    let mut reg = BrowserRegistry::new();
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
    let mut reg = BrowserRegistry::new();
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
    let mut reg = BrowserRegistry::new();
    reg.create("t1", "main").unwrap();
    // Creating → Navigating is not allowed (must go Live first).
    assert_eq!(
        reg.transition("t1", Lifecycle::Navigating),
        Err(BrowserError::InvalidTransition {
            from: Lifecycle::Creating,
            to: Lifecycle::Navigating
        })
    );
}

#[test]
fn destroyed_is_terminal() {
    let mut reg = BrowserRegistry::new();
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Destroyed).unwrap();
    assert!(Lifecycle::Destroyed.is_terminal());
    // No transition out of Destroyed.
    assert!(reg.transition("t1", Lifecycle::Live).is_err());
    assert!(reg.transition("t1", Lifecycle::Creating).is_err());
}

#[test]
fn generation_bump_makes_prior_commands_stale() {
    let mut reg = BrowserRegistry::new();
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
    let mut reg = BrowserRegistry::new();
    assert!(!reg.is_command_fresh("nope", 0));
    reg.create("t1", "main").unwrap();
    reg.transition("t1", Lifecycle::Destroyed).unwrap();
    assert!(!reg.is_command_fresh("t1", 0)); // terminal → not fresh
}

#[test]
fn remove_and_tabs_in_window() {
    let mut reg = BrowserRegistry::new();
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
