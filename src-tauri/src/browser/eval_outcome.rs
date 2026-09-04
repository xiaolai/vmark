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
//! Round 3 (#17): a refusal raised INSIDE the main-thread turn — `submit_if_fresh`
//! finding the generation superseded — is carried as the typed `CommandError` it is
//! (`EvalError::Refused`), never flattened to a message string and re-derived from
//! a prefix, which kept the code and token but lost the `tabId`/`when` details.
//!
//! @coordinates-with browser/eval_macos.rs — produces these outcomes
//! @coordinates-with browser/surface_view_macos.rs — classifies the native completion
//! @coordinates-with browser/commands_auth.rs — `browser_eval` reports them
//! @coordinates-with browser/ai_guards.rs — `with_mcp_code`, the MCP token shim
//! @coordinates-with src/services/commands/commandError.ts — reads `detail.indeterminate`

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
///
/// `PartialEq` but not `Eq`: a `CommandError` carries a `serde_json::Value`.
#[derive(Debug, Clone, PartialEq)]
pub enum EvalError {
    /// The native surface could not run the script at all — no webview for the
    /// tab, a main-thread timeout. A `fail::`-tagged string, classified by
    /// `ai_guards::surface_failure` like every other native failure.
    Surface(String),
    /// The gate refused the script inside the main-thread turn: the tab's
    /// generation was superseded between authorization and the submit
    /// (`authorize::submit_if_fresh`). The typed refusal — its class, its
    /// `STALE_COMMAND` token, and the `tabId`/`when` in its detail — travels intact.
    Refused(CommandError),
    /// The script was handed to WebKit and did not yield a usable string.
    Failure(EvalFailure),
}

impl From<EvalFailure> for EvalError {
    fn from(failure: EvalFailure) -> Self {
        Self::Failure(failure)
    }
}

impl From<CommandError> for EvalError {
    fn from(refusal: CommandError) -> Self {
        Self::Refused(refusal)
    }
}

impl EvalError {
    /// Fold the main-thread hop's own failure into the turn's verdict. The hop
    /// itself may fail (the outer `Err`, a native surface failure) or the turn it
    /// ran may have (the inner `Err`: a gate refusal or a script failure); a caller
    /// sees one error type either way.
    pub fn flatten(native: Result<Result<String, EvalError>, String>) -> Result<String, Self> {
        match native {
            Ok(turn) => turn,
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
/// branches on (`with_mcp_code`). A script error is the CALLER's script and so
/// `invalid-input`; no value from one of our own scripts is a bug, hence
/// `internal`; an oversized result is refused as input too, because the script
/// chose what to return.
///
/// A timeout is `timeout` — that is what happened — but an INDETERMINATE one
/// (round 3, #18): nothing cancels an enqueued script, so it may still complete,
/// and `timeout` is otherwise the app's retryable class. `detail.indeterminate:
/// true` is what tells a generic retry policy to stop and verify instead of running
/// a mutating act twice; `classifyCommandError` on the frontend reads exactly that
/// key and reports `indeterminate` rather than `retryable`. No code in the closed
/// vocabulary says this truthfully — `conflict` claims the caller's view of state is
/// stale, `internal` claims a bug, `cancelled` claims the user stopped it — and the
/// TS twin classifies `conflict` as retryable anyway, so the flag rides in `detail`,
/// the wire's designated machine-readable channel. The EVAL_TIMEOUT token and the
/// shipped clients matching on it are unchanged.
pub(crate) fn eval_failure(failure: EvalFailure) -> CommandError {
    match failure {
        EvalFailure::Timeout => with_mcp_code(
            localized_error!(ErrorCode::Timeout, "errors.browser.evalTimeout")
                .with_detail(json!({ "kind": "timeout", "indeterminate": true })),
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
/// its own class (`surface_failure`), a gate refusal is already the typed error it
/// should be, and an evaluation failure gets the mapping above.
pub(crate) fn eval_error(error: EvalError) -> CommandError {
    match error {
        EvalError::Surface(message) => surface_failure(&message),
        EvalError::Refused(refusal) => refusal,
        EvalError::Failure(failure) => eval_failure(failure),
    }
}

#[cfg(test)]
#[path = "eval_outcome.test.rs"]
mod tests;
