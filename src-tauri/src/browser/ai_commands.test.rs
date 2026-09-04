// WI-N2.1 — AI command result contracts remain camelCase and ticket-bearing.
// The refusal vocabulary (WI-14) is tested beside the guards that produce it,
// in `ai_guards.test.rs`.
use super::*;
use crate::browser::registry::AutomationMode;

#[test]
fn navigation_result_shape_is_stable() {
    let value = serde_json::to_value(AiNavigationResult {
        tab_id: "tab-1".into(),
        navigation_id: "nav-1".into(),
    })
    .expect("serializable");
    assert_eq!(value["tabId"], "tab-1");
    assert_eq!(value["navigationId"], "nav-1");
}

// Audit 20260903 round 3, #5 — the state report is ONE registry read; nothing is
// defaulted.
#[test]
fn state_is_built_from_a_single_registry_read_with_no_fallbacks() {
    use crate::browser::registry::{BrowserRegistry, Lifecycle};
    let mut reg = BrowserRegistry::default();
    reg.create_with_mode("t", "main", AutomationMode::AiShared)
        .unwrap();
    let ticket = reg.begin_navigation("t", "https://a.example/").unwrap();
    reg.bump_generation("t").unwrap();
    reg.transition("t", Lifecycle::Live).unwrap();

    let status = reg.tab_status("t").expect("a known tab");
    let wire = AiBrowserState::from_status("t".into(), status);
    assert_eq!(wire.automation_mode, AutomationMode::AiShared);
    assert_eq!(wire.generation, 1);
    assert_eq!(wire.lifecycle, "Live");
    assert_eq!(wire.navigation_id, Some(ticket.id));
    // An unknown tab has no status to build from — the command answers
    // TAB_NOT_FOUND instead of a "Destroyed" placeholder at generation 0.
    assert!(reg.tab_status("ghost").is_none());
}

#[test]
fn state_shape_keeps_provenance_and_ticket() {
    let value = serde_json::to_value(AiBrowserState {
        tab_id: "tab-1".into(),
        automation_mode: AutomationMode::AiSandbox,
        generation: 2,
        lifecycle: "Navigating".into(),
        navigation_id: Some("nav-2".into()),
    })
    .expect("serializable");
    assert_eq!(value["automationMode"], "ai-sandbox");
    assert_eq!(value["navigationId"], "nav-2");
}
