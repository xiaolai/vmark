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
