//! WI-2.1 / audit 20260903 round 3, #10 — the immutable half of the driver gate.
//! `decide` reads the registry, the policy and the owning window's grants, builds
//! a `Decision`, and spends nothing; every refusal it can raise is pinned here by
//! class and MCP token.

use super::*;
use crate::browser::registry::Lifecycle;
use crate::command_error::ErrorCode;

fn mcp_code(err: &CommandError) -> String {
    err.detail()
        .and_then(|d| d.get("mcpCode"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn enabled_policy() -> AiBrowserPolicy {
    AiBrowserPolicy {
        enabled: true,
        ..AiBrowserPolicy::default()
    }
}

/// A tab in `main` on a committed page at generation 0, stamped with epoch 0.
fn committed(mode: AutomationMode, url: &str) -> BrowserRegistry {
    let mut reg = BrowserRegistry::default();
    reg.create_with_mode("t", "main", mode).unwrap();
    reg.begin_navigation("t", url).unwrap();
    reg.set_committed_url("t", url).unwrap();
    reg.set_policy_epoch("t", 0).unwrap();
    reg
}

fn granted(window: &str, pattern: &str, ops: &[&str]) -> HashMap<String, Vec<StandingGrant>> {
    let mut by_window = HashMap::new();
    by_window.insert(
        window.to_string(),
        vec![StandingGrant {
            origin_pattern: pattern.into(),
            operations: ops.iter().map(|s| s.to_string()).collect(),
        }],
    );
    by_window
}

fn no_grants() -> HashMap<String, Vec<StandingGrant>> {
    HashMap::new()
}

#[test]
fn a_stale_generation_is_refused_before_the_page_is_read() {
    let reg = committed(AutomationMode::AiSandbox, "https://ex.com/");
    let err = decide(&reg, &enabled_policy(), &no_grants(), false, "t", 5, "read").unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "STALE_COMMAND");
    // An unknown tab is never fresh, and so is refused the same way.
    let err = decide(
        &reg,
        &enabled_policy(),
        &no_grants(),
        false,
        "ghost",
        0,
        "read",
    )
    .unwrap_err();
    assert_eq!(mcp_code(&err), "STALE_COMMAND");
}

#[test]
fn an_uncommitted_page_is_a_conflict() {
    let mut reg = BrowserRegistry::default();
    reg.create_with_mode("t", "main", AutomationMode::AiSandbox)
        .unwrap();
    reg.begin_navigation("t", "https://ex.com/").unwrap(); // executable, nothing committed
    let err = decide(&reg, &enabled_policy(), &no_grants(), false, "t", 0, "read").unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "NO_COMMITTED_PAGE");
}

#[test]
fn an_ai_tab_bound_to_an_older_epoch_is_refused_and_a_human_tab_is_not() {
    let moved = AiBrowserPolicy {
        epoch: 1,
        ..enabled_policy()
    };
    let reg = committed(AutomationMode::AiSandbox, "https://ex.com/");
    let err = decide(&reg, &moved, &no_grants(), false, "t", 0, "read").unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err), "POLICY_STALE");

    let reg = committed(AutomationMode::Human, "https://ex.com/");
    assert!(decide(&reg, &moved, &no_grants(), true, "t", 0, "read").is_ok());
}

#[test]
fn a_standing_grant_of_the_owning_window_marks_the_operation_allowed() {
    let reg = committed(AutomationMode::AiSandbox, "https://ex.com/page");
    let decision = decide(
        &reg,
        &enabled_policy(),
        &granted("main", "https://ex.com", &["click"]),
        false,
        "t",
        0,
        "click",
    )
    .unwrap();
    assert_eq!(
        decision,
        Decision {
            mode: AutomationMode::AiSandbox,
            committed: "https://ex.com/page".into(),
            allowed: true,
        }
    );
    // Another window's grant is not this tab's (audit 20260903 A-03): not an
    // error — a one-shot may still authorize it — but nothing standing.
    let decision = decide(
        &reg,
        &enabled_policy(),
        &granted("other", "https://ex.com", &["click"]),
        false,
        "t",
        0,
        "click",
    )
    .unwrap();
    assert!(!decision.allowed);
}

#[test]
fn an_ungranted_operation_is_a_decision_to_spend_not_a_refusal() {
    let reg = committed(AutomationMode::AiShared, "https://ex.com/page");
    let decision = decide(&reg, &enabled_policy(), &no_grants(), false, "t", 0, "type").unwrap();
    assert!(!decision.allowed);
    assert_eq!(decision.mode, AutomationMode::AiShared);
    assert_eq!(
        decision.committed, "https://ex.com/page",
        "the origin a one-shot is matched against is the REGISTRY's committed page"
    );
}

#[test]
fn the_modes_own_read_right_is_standing_authority() {
    let reg = committed(AutomationMode::AiSandbox, "https://ex.com/");
    assert!(
        decide(&reg, &enabled_policy(), &no_grants(), false, "t", 0, "read")
            .unwrap()
            .allowed,
        "a sandbox tab reads its own committed page"
    );
    // A shared tab reads only the origin its navigation was approved for.
    let mut reg = committed(AutomationMode::AiShared, "https://ex.com/");
    assert!(
        !decide(&reg, &enabled_policy(), &no_grants(), false, "t", 0, "read")
            .unwrap()
            .allowed
    );
    reg.set_shared_navigation_approval("t", "https://ex.com/")
        .unwrap();
    assert!(
        decide(&reg, &enabled_policy(), &no_grants(), false, "t", 0, "read")
            .unwrap()
            .allowed
    );
}

#[test]
fn a_confined_profile_read_is_refused_here_so_no_one_shot_is_ever_consulted() {
    // WI-P6.1 H1: the page carries the profile's real login; off the approved
    // origin a read is HARD-denied, before any spend could rescue it.
    let mut reg = committed(AutomationMode::AiSandbox, "https://evil.com/");
    reg.set_profile_origin("t", "https://github.com/login")
        .unwrap();
    let err = decide(&reg, &enabled_policy(), &no_grants(), false, "t", 0, "read").unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "PROFILE_ORIGIN_CONFINED");
    // A click on that page is not a read: it reaches the ordinary spend decision.
    assert!(
        !decide(
            &reg,
            &enabled_policy(),
            &no_grants(),
            false,
            "t",
            0,
            "click"
        )
        .unwrap()
        .allowed
    );
}

#[test]
fn a_human_tab_without_an_attachment_is_refused_even_with_a_grant() {
    let reg = committed(AutomationMode::Human, "https://ex.com/");
    let grants = granted("main", "https://ex.com", &["click"]);
    let err = decide(&reg, &enabled_policy(), &grants, false, "t", 0, "click").unwrap_err();
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(mcp_code(&err), "ATTACHMENT_REQUIRED");
    // With the attachment peeked present, the grant stands and nothing was spent
    // — spending is the other half's job.
    let decision = decide(&reg, &enabled_policy(), &grants, true, "t", 0, "click").unwrap();
    assert!(decision.allowed);
}

#[test]
fn a_never_automated_or_unknown_operation_never_has_standing_authority() {
    let reg = committed(AutomationMode::AiSandbox, "https://ex.com/");
    let grants = granted("main", "https://ex.com", &["upload", "frobnicate"]);
    for op in ["upload", "frobnicate", "Read"] {
        let decision = decide(&reg, &enabled_policy(), &grants, false, "t", 0, op).unwrap();
        assert!(!decision.allowed, "{op}");
    }
}

#[test]
fn a_non_executable_tab_is_stale_whatever_its_generation_says() {
    let mut reg = committed(AutomationMode::AiSandbox, "https://ex.com/");
    reg.transition("t", Lifecycle::Crashed).unwrap();
    let err = decide(&reg, &enabled_policy(), &no_grants(), false, "t", 0, "read").unwrap_err();
    assert_eq!(mcp_code(&err), "STALE_COMMAND");
}
