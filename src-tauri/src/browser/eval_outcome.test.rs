//! Audit 20260903 E-03 / E-04 — an evaluation that did not produce a string is a
//! typed failure, never a `<timeout>` / `<null>` string handed back as a result.
//! Round 3 (#17, #18): a gate refusal crosses the main-thread hop intact, and a
//! timeout says its effect is indeterminate.

use super::*;
use crate::browser::refusals::stale_command;

fn mcp_code(err: &CommandError) -> Option<String> {
    err.detail()
        .and_then(|d| d.get("mcpCode"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn detail_str<'a>(err: &'a CommandError, key: &str) -> Option<&'a str> {
    err.detail()
        .and_then(|d| d.get(key))
        .and_then(|v| v.as_str())
}

#[test]
fn every_failure_maps_to_its_code_token_and_translation_key() {
    let cases = [
        (
            EvalFailure::Timeout,
            ErrorCode::Timeout,
            "EVAL_TIMEOUT",
            "errors.browser.evalTimeout",
        ),
        (
            EvalFailure::ScriptError("boom".into()),
            ErrorCode::InvalidInput,
            "EVAL_FAILED",
            "errors.browser.evalFailed",
        ),
        (
            EvalFailure::NoValue,
            ErrorCode::Internal,
            "EVAL_FAILED",
            "errors.browser.evalNoValue",
        ),
        (
            EvalFailure::TooLarge,
            ErrorCode::InvalidInput,
            "EVAL_RESULT_TOO_LARGE",
            "errors.browser.evalResultTooLarge",
        ),
    ];
    for (failure, code, token, key) in cases {
        let err = eval_failure(failure.clone());
        assert_eq!(err.code(), code, "{failure:?}");
        assert_eq!(mcp_code(&err).as_deref(), Some(token), "{failure:?}");
        assert_eq!(err.i18n_key(), Some(key), "{failure:?}");
        assert!(
            !err.message().is_empty(),
            "{failure:?} must render a user-visible message"
        );
    }
}

#[test]
fn a_timeout_is_marked_indeterminate_and_no_other_failure_is() {
    // Round 3 #18: nothing cancels an enqueued script, so a timed-out act may still
    // land. `timeout` is a retryable class everywhere else in the app; the flag is
    // what tells a generic retry policy (`classifyCommandError`) to stop and verify
    // instead of running a mutating act twice. The EVAL_TIMEOUT token is unchanged.
    let err = eval_failure(EvalFailure::Timeout);
    assert_eq!(
        err.code(),
        ErrorCode::Timeout,
        "what happened is still a timeout"
    );
    assert_eq!(mcp_code(&err).as_deref(), Some("EVAL_TIMEOUT"));
    assert_eq!(detail_str(&err, "kind"), Some("timeout"));
    let wire = serde_json::to_value(&err).expect("serialize");
    assert_eq!(
        wire["detail"]["indeterminate"],
        json!(true),
        "the frontend reads exactly `detail.indeterminate === true`"
    );
    for failure in [
        EvalFailure::ScriptError("boom".into()),
        EvalFailure::NoValue,
        EvalFailure::TooLarge,
    ] {
        assert!(
            eval_failure(failure.clone())
                .detail()
                .and_then(|d| d.get("indeterminate"))
                .is_none(),
            "{failure:?} is a definite failure — the script did not run to a result"
        );
    }
}

#[test]
fn a_script_error_carries_the_exception_text_in_detail_message() {
    // The model reads `detail.message`; the localized `message` stays a fixed
    // sentence so page-controlled text never becomes user-facing prose.
    let err = eval_failure(EvalFailure::ScriptError(
        "TypeError: x is not a function (line 3, column 9)".into(),
    ));
    assert_eq!(
        detail_str(&err, "message"),
        Some("TypeError: x is not a function (line 3, column 9)")
    );
    assert_eq!(detail_str(&err, "kind"), Some("script-error"));
    assert!(!err.message().contains("TypeError"));
}

#[test]
fn no_value_names_its_kind_so_the_two_eval_failed_shapes_stay_apart() {
    // Both share the `EVAL_FAILED` token; `detail.kind` is what tells a frontend
    // switching on it that this one is OUR bug, not the caller's script.
    let err = eval_failure(EvalFailure::NoValue);
    assert_eq!(detail_str(&err, "kind"), Some("no-value"));
    assert_ne!(
        detail_str(&err, "kind"),
        detail_str(&eval_failure(EvalFailure::non_string()), "kind")
    );
}

#[test]
fn too_large_reports_the_bound_it_was_measured_against() {
    let err = eval_failure(EvalFailure::TooLarge);
    assert_eq!(
        err.detail()
            .and_then(|d| d.get("maxUtf16"))
            .and_then(|v| v.as_u64()),
        Some(MAX_EVAL_RESULT_UTF16 as u64)
    );
}

#[test]
fn the_result_cap_is_eight_mebi_utf16_units() {
    // A bound on the main-thread allocation, not a truncation (see the const doc).
    assert_eq!(MAX_EVAL_RESULT_UTF16, 8 * 1024 * 1024);
}

#[test]
fn a_non_string_return_is_a_script_error_with_the_documented_message() {
    let EvalFailure::ScriptError(message) = EvalFailure::non_string() else {
        panic!("non_string() must be a ScriptError");
    };
    assert_eq!(
        message,
        "script returned a non-string value; return a JSON string"
    );
}

#[test]
fn flatten_keeps_the_four_outcomes_apart() {
    assert_eq!(
        EvalError::flatten(Ok(Ok("\"ok\"".into()))),
        Ok("\"ok\"".to_string())
    );
    assert_eq!(
        EvalError::flatten(Ok(Err(EvalFailure::Timeout.into()))),
        Err(EvalError::Failure(EvalFailure::Timeout))
    );
    let refusal = stale_command("t", "before the script could run");
    assert_eq!(
        EvalError::flatten(Ok(Err(refusal.clone().into()))),
        Err(EvalError::Refused(refusal))
    );
    let gone = NativeSurfaceError::NoWebview("no webview: t".into());
    assert_eq!(
        EvalError::flatten(Err(gone.clone())),
        Err(EvalError::Surface(gone))
    );
}

#[test]
fn a_refusal_inside_the_main_thread_turn_keeps_its_token_and_its_details() {
    // Regression, round 3 #17 — the tab navigated between authorization and the
    // main-thread submit. `submit_if_fresh` refused with STALE_COMMAND naming the tab
    // and the moment; the hop used to flatten that to a message string and the
    // classifier re-derived the class from a `STALE_COMMAND:` prefix, so the code and
    // token survived but `tabId` and `when` did not. The typed refusal now crosses
    // the hop as itself.
    let refusal = stale_command("tab-7", "before the script could run");
    let native: Result<Result<String, EvalError>, NativeSurfaceError> =
        Ok(Err(EvalError::Refused(refusal.clone())));
    let err = eval_error(EvalError::flatten(native).unwrap_err());
    assert_eq!(err, refusal, "the refusal must cross the hop unchanged");
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(mcp_code(&err).as_deref(), Some("STALE_COMMAND"));
    assert_eq!(err.i18n_key(), Some("errors.browser.staleCommand"));
    assert_eq!(detail_str(&err, "tabId"), Some("tab-7"));
    assert_eq!(
        detail_str(&err, "when"),
        Some("before the script could run")
    );
}

#[test]
fn a_surface_failure_inside_an_eval_error_keeps_its_native_class() {
    // The eval path must not flatten a "no webview" into an eval failure: the
    // caller re-discovers tabs on `not-found`, and retries on `timeout`.
    let err = eval_error(EvalError::Surface(NativeSurfaceError::NoWebview(
        "no webview: tab-9".into(),
    )));
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(detail_str(&err, "kind"), Some("no-webview"));
    let err = eval_error(EvalError::Failure(EvalFailure::Timeout));
    assert_eq!(err.code(), ErrorCode::Timeout);
    assert_eq!(mcp_code(&err).as_deref(), Some("EVAL_TIMEOUT"));
}

#[test]
fn script_error_message_prefers_the_exception_and_keeps_its_position() {
    assert_eq!(
        script_error_message(
            "A JavaScript exception occurred",
            Some("ReferenceError: foo is not defined"),
            Some(12),
            Some(4)
        ),
        "ReferenceError: foo is not defined (line 12, column 4)"
    );
    assert_eq!(
        script_error_message(
            "A JavaScript exception occurred",
            Some("boom"),
            Some(2),
            None
        ),
        "boom (line 2)"
    );
    assert_eq!(
        script_error_message("A JavaScript exception occurred", None, None, None),
        "A JavaScript exception occurred"
    );
    // A blank exception text falls back to the description; a blank description
    // never yields an empty message.
    assert_eq!(
        script_error_message("described", Some("   "), None, None),
        "described"
    );
    assert_eq!(
        script_error_message("", None, None, None),
        "the page script failed"
    );
}
