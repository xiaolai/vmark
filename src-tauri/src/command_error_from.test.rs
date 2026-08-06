//! WI-14 — `From<ExistingEnum> for CommandError` conversion tests.
//!
//! Eight hand-rolled error enums were each flattened to `String` at the command
//! boundary (`genie_step.rs` had a literal `impl From<GenieStepError> for
//! String`), so every distinction the enum drew died on the wire. Each table
//! below pins, per source variant: the resulting `code`, and that the text the
//! old flattening produced (`Display`) is still reachable — either as the
//! message or inside `detail`. Nothing the boundary used to carry may be lost.

use crate::atomic_replace::AtomicReplaceError;
use crate::browser::ai_policy::AiUrlError;
use crate::browser::registry::{BrowserError, Lifecycle};
use crate::coherence::cas::CasError;
use crate::command_error::{CommandError, ErrorCode};
use crate::workflow::expressions::ExprError;
use crate::workflow::genie_step::GenieStepError;
use crate::workflow::template::TemplateError;

/// Assert the conversion keeps the code AND does not lose the flattened text.
fn assert_converted(err: CommandError, legacy: &str, expected: ErrorCode) {
    assert_eq!(
        err.code(),
        expected,
        "wrong code for legacy text {legacy:?}"
    );
    let detail_text = err.detail().map(|d| d.to_string()).unwrap_or_default();
    assert!(
        err.message() == legacy || err.message().contains(legacy) || detail_text.contains(legacy),
        "information lost: legacy text {legacy:?} is not reachable from {err:?}"
    );
}

/// A real `tempfile::PersistError` — the only way to cover the `Persist` stage
/// without a fake, since the error owns the temp file it failed to move.
fn persist_error() -> tempfile::PersistError {
    let temp = tempfile::NamedTempFile::new().expect("create temp file");
    temp.persist("/vmark-no-such-directory-for-tests/target")
        .expect_err("persisting into a missing directory must fail")
}

#[test]
fn atomic_replace_error_maps_every_stage_to_io_without_collapsing_them() {
    let io = || std::io::Error::other("boom");
    let cases: Vec<AtomicReplaceError> = vec![
        AtomicReplaceError::CreateTemp {
            parent: std::path::PathBuf::from("/tmp/parent"),
            source: io(),
        },
        AtomicReplaceError::WriteTemp(io()),
        AtomicReplaceError::FlushTemp(io()),
        AtomicReplaceError::SyncTemp(io()),
        AtomicReplaceError::Persist(persist_error()),
    ];
    let expected_stages = cases.len();
    let mut stages = Vec::new();
    for case in cases {
        let err = CommandError::from(case);
        assert_eq!(err.code(), ErrorCode::Io);
        let stage = err
            .detail()
            .and_then(|d| d.get("stage"))
            .and_then(|v| v.as_str())
            .expect("every atomic-replace error carries its failing stage")
            .to_string();
        assert!(!err.message().is_empty(), "os error text dropped");
        stages.push(stage);
    }
    stages.sort();
    stages.dedup();
    assert_eq!(
        stages.len(),
        expected_stages,
        "distinct stages collapsed into one code+detail: {stages:?}"
    );
}

// `cli_install` is macOS-only (Help > Install 'vmark' Command), so both the
// conversion and this test are gated the same way the module is.
#[cfg(target_os = "macos")]
#[test]
fn cli_install_error_separates_cancellation_from_a_foreign_file() {
    use crate::cli_install::CliInstallError;
    let cases = [
        (CliInstallError::Cancelled, ErrorCode::Cancelled),
        (CliInstallError::ForeignFile, ErrorCode::Conflict),
        (
            CliInstallError::Failed("chmod refused".into()),
            ErrorCode::Io,
        ),
    ];
    for (source, expected) in cases {
        let legacy = source.to_string();
        assert_converted(CommandError::from(source), &legacy, expected);
    }
}

#[test]
fn cas_error_distinguishes_missing_from_corrupt() {
    let cases = [
        (CasError::Missing, ErrorCode::NotFound),
        (CasError::Corrupt, ErrorCode::Conflict),
        (CasError::Io("read failed".into()), ErrorCode::Io),
    ];
    for (source, expected) in cases {
        let legacy = source.to_string();
        assert_converted(CommandError::from(source), &legacy, expected);
    }
}

#[test]
fn browser_error_maps_each_registry_failure_to_its_own_class() {
    let cases = [
        (BrowserError::UnknownTab("t1".into()), ErrorCode::NotFound),
        (BrowserError::DuplicateTab("t1".into()), ErrorCode::Conflict),
        (
            BrowserError::InvalidTransition {
                from: Lifecycle::Live,
                to: Lifecycle::Creating,
            },
            ErrorCode::Conflict,
        ),
        (BrowserError::TerminalTab("t1".into()), ErrorCode::Conflict),
        (
            BrowserError::InvalidUrl("ftp://x".into()),
            ErrorCode::InvalidInput,
        ),
    ];
    for (source, expected) in cases {
        // The pre-WI-14 boundary flattened these with `format!("{e:?}")`.
        let legacy = format!("{source:?}");
        let err = CommandError::from(source);
        assert_eq!(err.code(), expected, "wrong code for {legacy}");
        assert!(
            err.detail().is_some_and(|d| d.to_string().contains("kind")),
            "{legacy}: the registry variant name must survive in detail"
        );
    }
}

#[test]
fn browser_error_variants_do_not_collapse_into_one_detail() {
    let kinds: Vec<String> = [
        BrowserError::UnknownTab("t".into()),
        BrowserError::DuplicateTab("t".into()),
        BrowserError::InvalidTransition {
            from: Lifecycle::Live,
            to: Lifecycle::Creating,
        },
        BrowserError::TerminalTab("t".into()),
        BrowserError::InvalidUrl("x".into()),
    ]
    .into_iter()
    .map(|e| {
        CommandError::from(e)
            .detail()
            .and_then(|d| d.get("kind"))
            .and_then(|v| v.as_str())
            .expect("kind present")
            .to_string()
    })
    .collect();
    let mut unique = kinds.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), kinds.len(), "variants collapsed: {kinds:?}");
}

#[test]
fn ai_url_error_is_a_refusal_not_a_bad_argument() {
    // The AI navigation validator rejects private/special-use destinations.
    // That is a policy REFUSAL (the caller may not go there), not malformed
    // input — the frontend shows a different affordance for each.
    let err = CommandError::from(AiUrlError::Blocked);
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(
        err.detail()
            .and_then(|d| d.get("kind"))
            .and_then(|v| v.as_str()),
        Some("ssrf-blocked")
    );
}

#[test]
fn expr_error_keeps_the_unresolved_reference_in_detail() {
    let cases: Vec<(ExprError, &str, &str)> = vec![
        (
            ExprError::UnknownStep("build".into()),
            "unknown-step",
            "build",
        ),
        (
            ExprError::MissingField {
                step: "build".into(),
                field: "sha".into(),
            },
            "missing-field",
            "sha",
        ),
        (
            ExprError::UnknownEnv("TOKEN".into()),
            "unknown-env",
            "TOKEN",
        ),
        (
            ExprError::Unsupported("a ?? b".into()),
            "unsupported-expression",
            "a ?? b",
        ),
    ];
    for (source, kind, needle) in cases {
        let legacy = source.to_string();
        let err = CommandError::from(source);
        assert_eq!(err.code(), ErrorCode::InvalidInput, "{legacy}");
        let detail = err.detail().expect("detail present").to_string();
        assert!(detail.contains(kind), "{legacy}: kind {kind} missing");
        assert!(detail.contains(needle), "{legacy}: reference {needle} lost");
    }
}

#[test]
fn template_error_lists_every_unbound_placeholder_in_order() {
    let err = CommandError::from(TemplateError::Unbound(vec![
        "name".into(),
        "topic".into(),
        "name".into(),
    ]));
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    let unbound = err
        .detail()
        .and_then(|d| d.get("unbound"))
        .and_then(|v| v.as_array())
        .expect("unbound list present")
        .iter()
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    // Duplicates preserved, left-to-right — the enum's documented contract.
    assert_eq!(unbound, vec!["name", "topic", "name"]);
}

#[test]
fn genie_step_error_no_longer_flattens_to_string() {
    let cases = [
        (
            GenieStepError::NotGenieStep,
            ErrorCode::InvalidInput,
            "not-a-genie-step",
        ),
        (
            GenieStepError::NotFound("summarize".into()),
            ErrorCode::NotFound,
            "genie-not-found",
        ),
        (
            GenieStepError::InvalidInput("with.topic must be a string".into()),
            ErrorCode::InvalidInput,
            "invalid-input",
        ),
        (
            GenieStepError::Template("Unbound placeholders: {{topic}}".into()),
            ErrorCode::InvalidInput,
            "template",
        ),
        // Audit 20260803 §8: a provider that failed or answered with garbage is
        // a REMOTE failure, which `ErrorCode::Network` documents as its class
        // ("provider request") and marks retryable. `Internal` is reserved for
        // "a bug: poisoned lock, task join failure, closed channel" — calling a
        // flaky `claude` invocation an internal bug both misfiled it and told
        // every caller not to retry the one thing worth retrying.
        (
            GenieStepError::Provider("claude exited 1".into()),
            ErrorCode::Network,
            "provider",
        ),
        (
            GenieStepError::InvalidOutput("not JSON".into()),
            ErrorCode::Network,
            "invalid-output",
        ),
        (
            GenieStepError::UnsupportedOutput("pipe".into()),
            ErrorCode::Unsupported,
            "unsupported-output",
        ),
    ];
    let mut kinds = Vec::new();
    for (source, expected, kind) in cases {
        let legacy = source.to_string();
        let err = CommandError::from(source);
        assert_converted(err.clone(), &legacy, expected);
        assert_eq!(
            err.detail()
                .and_then(|d| d.get("kind"))
                .and_then(|v| v.as_str()),
            Some(kind),
            "{legacy}"
        );
        kinds.push(kind);
    }
    let mut unique = kinds.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), kinds.len(), "variants collapsed: {kinds:?}");
}

#[test]
fn a_failed_provider_call_is_retryable_and_an_internal_bug_is_not() {
    // The property the code change is FOR — retry policy is read off the code,
    // so misfiling a remote failure as `Internal` silently disables retry for
    // the whole class (audit 20260803 §8).
    assert!(
        CommandError::from(GenieStepError::Provider("timed out".into()))
            .code()
            .is_retryable()
    );
    assert!(
        CommandError::from(GenieStepError::InvalidOutput("half a JSON object".into()))
            .code()
            .is_retryable(),
        "a truncated or malformed model answer is the canonical retry case"
    );
    // …and the variants that really are the caller's fault stay non-retryable.
    for source in [
        GenieStepError::NotGenieStep,
        GenieStepError::NotFound("summarize".into()),
        GenieStepError::InvalidInput("with.topic must be a string".into()),
        GenieStepError::UnsupportedOutput("pipe".into()),
    ] {
        let legacy = source.to_string();
        assert!(
            !CommandError::from(source).code().is_retryable(),
            "{legacy} must not invite a retry loop"
        );
    }
}
