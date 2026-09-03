//! Audit 20260903 E-03 / E-04 — an evaluation that did not produce a string is a
//! typed failure, never a `<timeout>` / `<null>` string handed back as a result.

use super::*;
use crate::browser::surface::fail;

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
fn flatten_keeps_the_three_outcomes_apart() {
    assert_eq!(
        EvalError::flatten(Ok(Ok("\"ok\"".into()))),
        Ok("\"ok\"".to_string())
    );
    assert_eq!(
        EvalError::flatten(Ok(Err(EvalFailure::Timeout))),
        Err(EvalError::Failure(EvalFailure::Timeout))
    );
    assert_eq!(
        EvalError::flatten(Err("NO_WEBVIEW: no webview: t".into())),
        Err(EvalError::Surface("NO_WEBVIEW: no webview: t".into()))
    );
}

#[test]
fn a_surface_failure_inside_an_eval_error_keeps_its_native_class() {
    // The eval path must not flatten a "no webview" into an eval failure: the
    // caller re-discovers tabs on `not-found`, and retries on `timeout`.
    let err = eval_error(EvalError::Surface(format!(
        "{}: no webview: tab-9",
        fail::NO_WEBVIEW
    )));
    assert_eq!(err.code(), ErrorCode::NotFound);
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
