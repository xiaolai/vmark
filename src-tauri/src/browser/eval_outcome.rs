//! Typed outcomes of an isolated-world evaluation (audit 20260903 E-03 / E-04).
//!
//! `eval_js` used to fold every non-result into a STRING the caller received as a
//! success: a 5-second timeout came back as the literal `<timeout>`; `null`,
//! `undefined` and a thrown exception all came back as `<null>`; a non-string
//! return was rendered through `-description`; and the `NSError` WebKit hands the
//! completion handler was dropped on the floor. The act handler then reported a
//! still-running script as "did not affect the target" and retried it — a double
//! act — and a `read` returned `<timeout>` as its snapshot with `success: true`.
//!
//! This module is the platform-independent half of the fix: the closed set of
//! ways an evaluation can fail, how the command boundary reports each one, and
//! the pure helpers the objc2 layer feeds. `surface_view_macos.rs` classifies
//! the native completion; nothing here touches WebKit, so every mapping is a unit
//! test.
//!
//! @coordinates-with browser/eval_macos.rs — produces these outcomes
//! @coordinates-with browser/surface_view_macos.rs — classifies the native completion
//! @coordinates-with browser/commands_auth.rs — `browser_eval` reports them
//! @coordinates-with browser/ai_guards.rs — `with_mcp_code`, the MCP token shim

use crate::browser::ai_guards::{surface_failure, with_mcp_code};
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde_json::json;

/// Upper bound on a result string, in UTF-16 code units (what `NSString.length`
/// counts).
///
/// A BOUND, not a truncation: the check runs before the `NSString` is converted,
/// so it caps the main-thread allocation, and a result past it is refused whole.
/// Truncated JSON is unparseable, so handing back a prefix would only move the
/// failure downstream and label it a success on the way.
pub const MAX_EVAL_RESULT_UTF16: usize = 8 * 1024 * 1024;

/// Why an evaluation produced no usable string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvalFailure {
    /// The completion handler did not fire within the wait. Nothing cancels an
    /// enqueued script, so it may still be running — a caller must not assume the
    /// action did not happen.
    Timeout,
    /// WebKit reported an error: a thrown exception, a syntax error, or (VMark's
    /// own rule) a value that is not a string.
    ScriptError(String),
    /// The script completed with `null`/`undefined` and no error.
    NoValue,
    /// The result string exceeds [`MAX_EVAL_RESULT_UTF16`].
    TooLarge,
}

impl EvalFailure {
    /// The message for a value that is not a string. Every VMark agent script
    /// returns `JSON.stringify(...)`; the TS layer wraps `execute_js` the same
    /// way, so this names a caller bug rather than a page condition.
    pub const NON_STRING_MESSAGE: &'static str =
        "script returned a non-string value; return a JSON string";

    pub fn non_string() -> Self {
        Self::ScriptError(Self::NON_STRING_MESSAGE.to_string())
    }
}

/// Everything `surface::eval` can fail with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvalError {
    /// The native surface could not run the script at all — no webview for the
    /// tab, a stale command, a main-thread timeout. A `fail::`-tagged string,
    /// classified by `ai_guards::surface_failure` like every other native failure.
    Surface(String),
    /// The script was handed to WebKit and did not yield a usable string.
    Failure(EvalFailure),
}

impl EvalError {
    /// Flatten the main-thread hop's result. The hop itself may fail (the outer
    /// `Err`, a surface failure) or the script it ran may (the inner `Err`); a
    /// caller sees one error type either way.
    pub fn flatten(native: Result<Result<String, EvalFailure>, String>) -> Result<String, Self> {
        match native {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(failure)) => Err(Self::Failure(failure)),
            Err(surface) => Err(Self::Surface(surface)),
        }
    }
}

/// Compose the message for a WebKit JavaScript error.
///
/// `localizedDescription` of a `WKErrorJavaScriptExceptionOccurred` is the generic
/// "A JavaScript exception occurred"; the exception's own text lives in
/// `userInfo` under `WKJavaScriptExceptionMessage`, with the line and column
/// beside it. Prefer the specific text and keep the position when WebKit gave
/// one; fall back to the description, and never to an empty string.
pub fn script_error_message(
    localized: &str,
    exception: Option<&str>,
    line: Option<i64>,
    column: Option<i64>,
) -> String {
    let base = match exception.map(str::trim).filter(|m| !m.is_empty()) {
        Some(message) => message.to_string(),
        None if localized.trim().is_empty() => "the page script failed".to_string(),
        None => localized.trim().to_string(),
    };
    match (line, column) {
        (Some(line), Some(column)) => format!("{base} (line {line}, column {column})"),
        (Some(line), None) => format!("{base} (line {line})"),
        _ => base,
    }
}

/// Report an evaluation failure at the command boundary.
///
/// The `code` is VMark's class; `detail.mcpCode` is the token the MCP client
/// branches on (`with_mcp_code`). A timeout is `timeout`, not a result; a script
/// error is the CALLER's script and so `invalid-input`; no value from one of our
/// own scripts is a bug, hence `internal`; an oversized result is refused as
/// input too, because the script chose what to return.
pub(crate) fn eval_failure(failure: EvalFailure) -> CommandError {
    match failure {
        EvalFailure::Timeout => with_mcp_code(
            localized_error!(ErrorCode::Timeout, "errors.browser.evalTimeout")
                .with_detail(json!({ "kind": "timeout" })),
            "EVAL_TIMEOUT",
        ),
        EvalFailure::ScriptError(message) => with_mcp_code(
            localized_error!(ErrorCode::InvalidInput, "errors.browser.evalFailed")
                .with_detail(json!({ "kind": "script-error", "message": message })),
            "EVAL_FAILED",
        ),
        EvalFailure::NoValue => with_mcp_code(
            localized_error!(ErrorCode::Internal, "errors.browser.evalNoValue")
                .with_detail(json!({ "kind": "no-value" })),
            "EVAL_FAILED",
        ),
        EvalFailure::TooLarge => with_mcp_code(
            localized_error!(ErrorCode::InvalidInput, "errors.browser.evalResultTooLarge")
                .with_detail(json!({ "kind": "too-large", "maxUtf16": MAX_EVAL_RESULT_UTF16 })),
            "EVAL_RESULT_TOO_LARGE",
        ),
    }
}

/// Report anything `surface::eval` can fail with: a native surface failure keeps
/// its own class (`surface_failure`), an evaluation failure gets the mapping
/// above.
pub(crate) fn eval_error(error: EvalError) -> CommandError {
    match error {
        EvalError::Surface(message) => surface_failure(&message),
        EvalError::Failure(failure) => eval_failure(failure),
    }
}

#[cfg(test)]
#[path = "eval_outcome.test.rs"]
mod tests;
