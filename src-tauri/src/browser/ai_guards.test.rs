//! WI-14 — the refusal vocabulary these guards produce.
//!
//! The AI browser commands used to return bare SCREAMING_CASE strings, and
//! `services/mcpBridge/v2/browserNavigation.ts` recovered the class with
//! `String(error).includes("APPROVAL_REQUIRED")` at four call sites. A substring
//! match on prose is not a contract: any URL or message that happened to carry
//! the token would have triggered an approval prompt, and rewording the refusal
//! would have silently disabled it.

use super::*;
use crate::browser::origin_guard::StandingGrant;
use crate::browser::registry::AutomationMode;
use crate::command_error::CommandError;

#[test]
fn a_disabled_browser_is_feature_disabled_not_a_generic_failure() {
    // WI-19's dark-feature gates return exactly this code.
    let err = require_browser_enabled(&AiBrowserPolicy::default())
        .expect_err("the default policy is off");
    assert_eq!(err.code(), ErrorCode::FeatureDisabled);
    assert_eq!(err.i18n_key(), Some("errors.browser.disabled"));
}

#[test]
fn an_enabled_policy_passes_the_gate() {
    let policy = AiBrowserPolicy {
        enabled: true,
        ..AiBrowserPolicy::default()
    };
    assert!(require_browser_enabled(&policy).is_ok());
}

/// WI-19 — the disabled-browser refusal, through real serde.
///
/// The sibling of `workflow::guards`' identical assertion: both dark features
/// must produce the SAME `feature-disabled` shape, or the frontend's single
/// "turned off in Settings" branch handles one of them and not the other. The
/// browser adds `detail.mcpCode`, which the MCP client has already shipped
/// against; `code` stays VMark's class either way.
#[test]
fn the_disabled_browser_refusal_serializes_to_the_feature_disabled_wire_shape() {
    let err = require_browser_enabled(&AiBrowserPolicy::default()).expect_err("off");
    let wire = serde_json::to_value(&err).expect("CommandError serializes");
    let object = wire.as_object().expect("an object, not a string");

    assert_eq!(
        object.get("code").and_then(|v| v.as_str()),
        Some("feature-disabled")
    );
    assert_eq!(
        object.get("i18nKey").and_then(|v| v.as_str()),
        Some("errors.browser.disabled")
    );
    assert!(
        object
            .get("message")
            .and_then(|v| v.as_str())
            .is_some_and(|m| !m.is_empty()),
        "the user-visible message must be rendered, not empty"
    );
    assert_eq!(
        object
            .get("detail")
            .and_then(|d| d.get("mcpCode"))
            .and_then(|v| v.as_str()),
        Some("BROWSER_DISABLED"),
        "the token the shipped MCP client already knows this refusal by"
    );
    assert!(
        !err.code().is_retryable(),
        "a feature the user switched off does not become on by retrying"
    );
}

#[test]
fn session_mode_parses_the_two_known_values_and_rejects_the_rest() {
    assert_eq!(
        parse_session_mode("sandbox").expect("sandbox is valid"),
        AiSessionMode::Sandbox
    );
    assert_eq!(
        parse_session_mode("shared").expect("shared is valid"),
        AiSessionMode::Shared
    );

    let err = parse_session_mode("Sandbox").expect_err("the wire form is lowercase");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(
        err.detail()
            .and_then(|d| d.get("mode"))
            .and_then(|v| v.as_str()),
        Some("Sandbox"),
        "the rejected value must be machine-readable, not only in the sentence"
    );
}

#[test]
fn a_stale_policy_epoch_is_a_conflict_not_a_permission_problem() {
    // The user changed the AI posture mid-flight. Retrying after re-reading the
    // policy works; asking for approval does not — different affordance.
    let err = require_current_epoch(Some(3), 4).expect_err("epoch 3 is stale against 4");
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(err.i18n_key(), Some("errors.browser.policyStale"));
    assert!(require_current_epoch(Some(4), 4).is_ok());
}

#[test]
fn an_unknown_epoch_is_stale_too() {
    // A tab the registry has no epoch for was never bound to a policy.
    assert_eq!(
        require_current_epoch(None, 1)
            .expect_err("no epoch is not a current epoch")
            .code(),
        ErrorCode::Conflict
    );
}

#[test]
fn tab_ownership_separates_missing_from_human_owned() {
    let missing = require_ai_owned(None).expect_err("no such tab");
    assert_eq!(missing.code(), ErrorCode::NotFound);
    assert_eq!(missing.i18n_key(), Some("errors.browser.tabNotFound"));

    let human = require_ai_owned(Some(AutomationMode::Human)).expect_err("human tab");
    assert_eq!(human.code(), ErrorCode::PermissionDenied);
    assert_eq!(human.i18n_key(), Some("errors.browser.tabNotAiOwned"));

    assert_eq!(
        require_ai_owned(Some(AutomationMode::AiShared)).expect("ai tab"),
        AutomationMode::AiShared
    );
}

#[test]
fn shared_navigation_without_a_grant_requires_approval() {
    let surface = BrowserSurface::default();
    let err = authorize_shared_navigation(&surface, "tab-1", 0, "https://example.com/page")
        .expect_err("default-deny: an empty grant set authorizes nothing");
    assert_eq!(err.code(), ErrorCode::ApprovalRequired);
    assert_eq!(err.i18n_key(), Some("errors.browser.approvalRequired"));
}

/// Level 3 — the exact value the MCP bridge receives, serialized the way Tauri
/// serializes a rejected command. This is the contract that replaced
/// `String(error).includes("APPROVAL_REQUIRED")`.
#[test]
fn the_approval_refusal_serializes_to_a_branchable_wire_value() {
    let surface = BrowserSurface::default();
    let err = authorize_shared_navigation(&surface, "tab-1", 0, "https://example.com/")
        .expect_err("must refuse");
    let value = serde_json::to_value(&err).expect("serialize as Tauri does");
    assert_eq!(value["code"], json!("approval-required"));
    assert_eq!(value["i18nKey"], json!("errors.browser.approvalRequired"));
    assert!(
        value
            .get("message")
            .and_then(|m| m.as_str())
            .is_some_and(|m| !m.is_empty()),
        "a human-readable fallback message is part of the contract"
    );
}

#[test]
fn a_standing_grant_authorizes_shared_navigation_without_approval() {
    let surface = BrowserSurface::default();
    surface
        .grants
        .lock()
        .expect("lock grants")
        .push(StandingGrant {
            origin_pattern: "https://example.com".into(),
            operations: vec!["navigate".into()],
        });
    authorize_shared_navigation(&surface, "tab-1", 0, "https://example.com/page")
        .expect("a matching standing grant authorizes navigation");
}

#[test]
fn a_grant_for_another_origin_still_requires_approval() {
    let surface = BrowserSurface::default();
    surface
        .grants
        .lock()
        .expect("lock grants")
        .push(StandingGrant {
            origin_pattern: "https://example.com".into(),
            operations: vec!["navigate".into()],
        });
    let err = authorize_shared_navigation(&surface, "tab-1", 0, "https://evil.test/page")
        .expect_err("a grant is bound to its origin");
    assert_eq!(err.code(), ErrorCode::ApprovalRequired);
}

/// The MCP tool protocol's own error vocabulary predates WI-14 and is shipped
/// to AI clients. It rides in `detail.mcpCode` so typing the internal class did
/// not silently rename anything the clients match on.
#[test]
fn every_refusal_keeps_the_mcp_token_it_shipped_with() {
    let surface = BrowserSurface::default();
    let cases: Vec<(CommandError, &str)> = vec![
        (
            require_browser_enabled(&AiBrowserPolicy::default()).expect_err("off"),
            "BROWSER_DISABLED",
        ),
        (
            parse_session_mode("nope").expect_err("unknown mode"),
            "INVALID_POLICY",
        ),
        (
            require_current_epoch(Some(1), 2).expect_err("stale"),
            "POLICY_STALE",
        ),
        (
            require_ai_owned(Some(AutomationMode::Human)).expect_err("human"),
            "TAB_NOT_AI_OWNED",
        ),
        (
            require_ai_owned(None).expect_err("missing"),
            "TAB_NOT_FOUND",
        ),
        (blocked_destination(), "SSRF_BLOCKED"),
        (
            authorize_shared_navigation(&surface, "t", 0, "https://example.com/")
                .expect_err("no grant"),
            "APPROVAL_REQUIRED",
        ),
    ];
    for (err, expected) in cases {
        assert_eq!(
            err.detail()
                .and_then(|d| d.get("mcpCode"))
                .and_then(|v| v.as_str()),
            Some(expected),
            "{err:?} lost its MCP token"
        );
    }
}

#[test]
fn attaching_an_mcp_token_preserves_the_detail_already_there() {
    let err = parse_session_mode("nope").expect_err("unknown mode");
    let detail = err.detail().expect("detail present");
    assert_eq!(detail.get("mode").and_then(|v| v.as_str()), Some("nope"));
    assert_eq!(
        detail.get("mcpCode").and_then(|v| v.as_str()),
        Some("INVALID_POLICY")
    );
}

#[test]
fn a_blocked_destination_is_denied_outright_never_approval_required() {
    // The security-critical discrimination: an SSRF-blocked destination must
    // NOT open an approval prompt, because no user approval may unblock it.
    // Under the old string protocol both were opaque strings on one channel.
    let blocked =
        crate::browser::ai_policy::validate_ai_navigation_url("http://127.0.0.1:8080/admin", false)
            .expect_err("loopback is blocked when allow_loopback is off");
    let err = crate::command_error::CommandError::from(blocked);
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_ne!(err.code(), ErrorCode::ApprovalRequired);
}

// ── Audit 20260803 §6 — a typo is not a security refusal ───────────────────

#[test]
fn an_unusable_url_is_invalid_input_with_its_own_mcp_token() {
    let err = rejected_destination(
        crate::browser::ai_policy::AiUrlError::Invalid,
        "https://exa mple.com/",
    );
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.browser.invalidUrl"));
    let detail = err.detail().expect("detail present");
    assert_eq!(
        detail.get("mcpCode").and_then(|v| v.as_str()),
        Some("INVALID_URL"),
        "the AI client must be able to tell 'fix your argument' from 'you may \
         not go there' without parsing prose"
    );
    assert_eq!(
        detail.get("url").and_then(|v| v.as_str()),
        Some("https://exa mple.com/"),
        "the rejected value travels structurally, not only in the sentence"
    );
}

#[test]
fn a_policy_refusal_still_reaches_the_client_as_ssrf_blocked() {
    // The direction that must NOT regress: a real refusal keeps the token the
    // shipped MCP client matches on, and stays permission-denied.
    let err = rejected_destination(
        crate::browser::ai_policy::AiUrlError::Blocked,
        "http://10.0.0.1/",
    );
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(
        err.detail()
            .and_then(|d| d.get("mcpCode"))
            .and_then(|v| v.as_str()),
        Some("SSRF_BLOCKED")
    );
}

#[test]
fn the_two_destination_refusals_do_not_share_a_detail_kind() {
    // Same rule the `From` impls live by: a frontend switching on `detail.kind`
    // must not see one class wearing the other's name.
    let blocked = rejected_destination(
        crate::browser::ai_policy::AiUrlError::Blocked,
        "http://10.0.0.1/",
    );
    let invalid = rejected_destination(crate::browser::ai_policy::AiUrlError::Invalid, "");
    assert_ne!(
        blocked.detail().and_then(|d| d.get("kind")),
        invalid.detail().and_then(|d| d.get("kind"))
    );
}

// ── Audit 20260803 §7 — native failures are not poisoned mutexes ───────────

/// A failure message shaped exactly as the native surface produces it.
fn native(token: &str, detail: &str) -> String {
    format!("{token}: {detail}")
}

#[test]
fn every_native_failure_class_gets_its_own_code() {
    use crate::browser::surface::fail;
    let cases = [
        (
            native(fail::WINDOW_GONE, "window 'doc-3' is gone"),
            ErrorCode::NotFound,
            "window-gone",
        ),
        (
            native(fail::NO_WEBVIEW, "no webview: tab-9"),
            ErrorCode::NotFound,
            "no-webview",
        ),
        (
            native(fail::INVALID_URL, "invalid URL: h ttp://x"),
            ErrorCode::InvalidInput,
            "invalid-url",
        ),
        (
            fail::PROFILE_STORE_LIMIT.to_string(),
            ErrorCode::Conflict,
            "profile-limit",
        ),
        (
            native(fail::UNSUPPORTED_PLATFORM, "macOS-only in this build"),
            ErrorCode::Unsupported,
            "unsupported-platform",
        ),
        (
            native(fail::MAIN_THREAD_TIMEOUT, "main-thread op timed out"),
            ErrorCode::Timeout,
            "main-thread-timeout",
        ),
    ];
    let mut kinds = Vec::new();
    for (message, expected, kind) in cases {
        let err = surface_failure(&message);
        assert_eq!(err.code(), expected, "{message}");
        assert_eq!(
            err.detail()
                .and_then(|d| d.get("kind"))
                .and_then(|v| v.as_str()),
            Some(kind),
            "{message}"
        );
        assert!(
            err.i18n_key()
                .is_some_and(|k| k.starts_with("errors.browser.")),
            "{message} lost its translation key"
        );
        assert_eq!(
            err.detail()
                .and_then(|d| d.get("detail"))
                .and_then(|v| v.as_str()),
            Some(message.as_str()),
            "the original text must stay reachable — nothing is lost by classifying"
        );
        kinds.push(kind);
    }
    let mut unique = kinds.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), kinds.len(), "classes collapsed: {kinds:?}");
}

#[test]
fn an_untagged_native_failure_degrades_to_internal_rather_than_guessing() {
    let err = surface_failure("something nobody tagged");
    assert_eq!(err.code(), ErrorCode::Internal);
    assert_eq!(err.i18n_key(), Some("errors.browser.surfaceFailed"));
}

#[test]
fn a_token_appearing_inside_the_message_does_not_reclassify_it() {
    // The substring-sniff trap WI-14 exists to close: a URL carrying a token in
    // its query string must not be able to relabel its own failure. Matching is
    // anchored at the start AND delimited.
    use crate::browser::surface::fail;
    for message in [
        format!("some prose mentioning {}", fail::WINDOW_GONE),
        format!("{}_SUFFIXED: not the token", fail::NO_WEBVIEW),
        format!("https://x.test/?e={}", fail::INVALID_URL),
    ] {
        assert_eq!(
            surface_failure(&message).code(),
            ErrorCode::Internal,
            "{message} was reclassified by an unanchored match"
        );
    }
}

#[test]
fn lock_failure_still_means_a_poisoned_mutex() {
    // The guard it was rescued from: `lock_failure` must keep meaning exactly
    // one thing, or the split buys nothing.
    let err = lock_failure("poisoned");
    assert_eq!(err.code(), ErrorCode::Internal);
    assert_eq!(err.i18n_key(), Some("errors.browser.stateUnavailable"));
}

// ── Audit 20260803 §10 — the profile-name refusal is translated ────────────

#[test]
fn an_invalid_profile_name_is_translated_and_names_the_profile() {
    let err = invalid_profile_name("../../etc", "profile name contains a path separator");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(
        err.i18n_key(),
        Some("errors.browser.invalidProfileName"),
        "this was the one refusal in the module with no key at all — invisible \
         to lint:i18n and untranslatable for the user"
    );
    assert!(
        !err.message().is_empty(),
        "the rendered message must not be empty"
    );
    let detail = err.detail().expect("detail present");
    assert_eq!(
        detail.get("profile").and_then(|v| v.as_str()),
        Some("../../etc"),
        "the rejected profile travels structurally"
    );
    assert_eq!(
        detail.get("detail").and_then(|v| v.as_str()),
        Some("profile name contains a path separator"),
        "the validator's own reason stays reachable"
    );
}
