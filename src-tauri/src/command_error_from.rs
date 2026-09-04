//! WI-14 — conversions from the crate's eight hand-rolled error enums.
//!
//! Each of these types drew real distinctions that the old `Result<T, String>`
//! boundary erased: `genie_step.rs` carried a literal
//! `impl From<GenieStepError> for String`, the browser registry was flattened
//! with `format!("{e:?}")`, and `atomic_replace`'s five-stage enum became one
//! sentence. The rule here is **lossless**: the text the old flattening
//! produced stays reachable (as `message`, or inside `detail`), and no two
//! source variants may share a `detail.kind`. `command_error_from.test.rs`
//! asserts both, per variant.
//!
//! @module command_error::from_impls

use super::{CommandError, ErrorCode};
use serde_json::json;

use crate::atomic_replace::AtomicReplaceError;
use crate::browser::ai_policy::AiUrlError;
use crate::browser::registry::BrowserError;
use crate::coherence::cas::CasError;
use crate::workflow::expressions::ExprError;
use crate::workflow::genie_step::GenieStepError;
use crate::workflow::template::TemplateError;

// ── 1. atomic_replace::AtomicReplaceError ──────────────────────────────────
// Every stage is an OS write failure (retryable), but WHICH stage failed is the
// difference between "disk full" and "the rename raced a delete", so the stage
// survives in `detail` instead of being folded into prose.
impl From<AtomicReplaceError> for CommandError {
    fn from(error: AtomicReplaceError) -> Self {
        let (stage, message, extra) = match error {
            AtomicReplaceError::CreateTemp { parent, source } => (
                "create-temp",
                source.to_string(),
                Some(json!({ "parent": parent.display().to_string() })),
            ),
            AtomicReplaceError::WriteTemp(e) => ("write-temp", e.to_string(), None),
            AtomicReplaceError::FlushTemp(e) => ("flush-temp", e.to_string(), None),
            AtomicReplaceError::SyncTemp(e) => ("sync-temp", e.to_string(), None),
            AtomicReplaceError::Persist(e) => ("persist", e.to_string(), None),
        };
        let mut detail = json!({ "kind": "atomic-replace", "stage": stage });
        if let (Some(serde_json::Value::Object(extra)), Some(target)) =
            (extra, detail.as_object_mut())
        {
            target.extend(extra);
        }
        CommandError::io(message).with_detail(detail)
    }
}

// ── 2. cli_install::CliInstallError (macOS-only module) ────────────────────
// `Cancelled` is the user closing a dialog — the frontend must not toast it as
// a failure, which a flattened string made impossible to tell apart.
#[cfg(target_os = "macos")]
impl From<crate::cli_install::CliInstallError> for CommandError {
    fn from(error: crate::cli_install::CliInstallError) -> Self {
        use crate::cli_install::CliInstallError as E;
        let message = error.to_string();
        let (code, kind) = match error {
            E::Cancelled => (ErrorCode::Cancelled, "cancelled"),
            E::ForeignFile => (ErrorCode::Conflict, "foreign-file"),
            E::Failed(_) => (ErrorCode::Io, "failed"),
        };
        CommandError::new(code, message).with_detail(json!({ "kind": kind }))
    }
}

// ── 3. coherence::cas::CasError ────────────────────────────────────────────
// A missing snapshot is recoverable by re-capturing; a corrupt one means the
// hash disagreed and the bytes must not be trusted. Same string before.
impl From<CasError> for CommandError {
    fn from(error: CasError) -> Self {
        let message = error.to_string();
        let (code, kind) = match error {
            CasError::Missing => (ErrorCode::NotFound, "snapshot-missing"),
            CasError::Corrupt => (ErrorCode::Conflict, "snapshot-corrupt"),
            CasError::Io(_) => (ErrorCode::Io, "snapshot-io"),
        };
        CommandError::new(code, message).with_detail(json!({ "kind": kind }))
    }
}

// ── 4. browser::registry::BrowserError ─────────────────────────────────────
// `BrowserError` has no `Display`; the command layer flattened it with
// `format!("{e:?}")`, so that exact text becomes the message (lossless) and the
// variant name becomes the branchable `detail.kind`.
impl From<BrowserError> for CommandError {
    fn from(error: BrowserError) -> Self {
        let message = format!("{error:?}");
        let (code, detail) = match error {
            BrowserError::UnknownTab(tab_id) => (
                ErrorCode::NotFound,
                json!({ "kind": "unknown-tab", "tabId": tab_id }),
            ),
            BrowserError::DuplicateTab(tab_id) => (
                ErrorCode::Conflict,
                json!({ "kind": "duplicate-tab", "tabId": tab_id }),
            ),
            BrowserError::InvalidTransition { from, to } => (
                ErrorCode::Conflict,
                json!({
                    "kind": "invalid-transition",
                    "from": format!("{from:?}"),
                    "to": format!("{to:?}"),
                }),
            ),
            BrowserError::TerminalTab(tab_id) => (
                ErrorCode::Conflict,
                json!({ "kind": "terminal-tab", "tabId": tab_id }),
            ),
            BrowserError::InvalidUrl(url) => (
                ErrorCode::InvalidInput,
                json!({ "kind": "invalid-url", "url": url }),
            ),
            BrowserError::GenerationExhausted(tab_id) => (
                ErrorCode::Internal,
                json!({ "kind": "generation-exhausted", "tabId": tab_id }),
            ),
            BrowserError::WindowClosed(label) => (
                ErrorCode::NotFound,
                json!({ "kind": "window-gone", "windowLabel": label }),
            ),
        };
        CommandError::new(code, message).with_detail(detail)
    }
}

// ── 5. browser::ai_policy::AiUrlError ──────────────────────────────────────
// A blocked destination is a policy REFUSAL, not a malformed argument: the
// caller may not go there at all, and no re-formatting of the URL will help.
// An unusable URL is the opposite (audit 20260803 §6) — fixing the argument is
// exactly what the caller should do — so it must not arrive as a security
// refusal, and its `detail.kind` must not collide with the refusal's.
impl From<AiUrlError> for CommandError {
    fn from(error: AiUrlError) -> Self {
        match error {
            AiUrlError::Blocked => CommandError::permission_denied(
                "AI navigation to this destination is blocked by policy",
            )
            .with_detail(json!({ "kind": "ssrf-blocked" })),
            AiUrlError::Invalid => CommandError::invalid_input("That is not a usable http(s) URL")
                .with_detail(json!({ "kind": "ai-url-invalid" })),
        }
    }
}

// ── 6. workflow::expressions::ExprError ────────────────────────────────────
// The unresolved reference is the whole point of the error; it moves into
// `detail` so the editor can highlight it instead of regex-ing the sentence.
impl From<ExprError> for CommandError {
    fn from(error: ExprError) -> Self {
        let message = error.to_string();
        let detail = match error {
            ExprError::UnknownStep(step) => json!({ "kind": "unknown-step", "step": step }),
            ExprError::MissingField { step, field } => {
                json!({ "kind": "missing-field", "step": step, "field": field })
            }
            ExprError::UnknownEnv(name) => json!({ "kind": "unknown-env", "name": name }),
            ExprError::Unsupported(expression) => {
                json!({ "kind": "unsupported-expression", "expression": expression })
            }
        };
        CommandError::invalid_input(message).with_detail(detail)
    }
}

// ── 7. workflow::template::TemplateError ───────────────────────────────────
// Duplicates and order are preserved: the enum's documented contract is that an
// author can see a typo appear twice.
impl From<TemplateError> for CommandError {
    fn from(error: TemplateError) -> Self {
        let message = error.to_string();
        let TemplateError::Unbound(names) = error;
        CommandError::invalid_input(message)
            .with_detail(json!({ "kind": "unbound-placeholders", "unbound": names }))
    }
}

// ── 8. workflow::genie_step::GenieStepError ────────────────────────────────
// This is the enum that carried `impl From<GenieStepError> for String`. Seven
// variants spanning three different classes — a bad step definition, a missing
// genie, and a provider blowing up — all became one opaque sentence.
//
// `Provider` and `InvalidOutput` are `Network`, not `Internal` (audit 20260803
// §8). `ErrorCode::Network` documents its class as "Remote call failed:
// provider request, …" and marks it RETRYABLE; `Internal` documents itself as
// "A bug: poisoned lock, task join failure, closed channel" and does not. A CLI
// provider exiting non-zero, or a model answering with a truncated JSON object,
// is neither a bug in VMark nor a reason to tell the caller never to try again
// — it is the single most retry-worthy failure the genie path has.
impl From<GenieStepError> for CommandError {
    fn from(error: GenieStepError) -> Self {
        use GenieStepError as E;
        let message = error.to_string();
        let (code, detail) = match error {
            E::NotGenieStep => (
                ErrorCode::InvalidInput,
                json!({ "kind": "not-a-genie-step" }),
            ),
            E::NotFound(name) => (
                ErrorCode::NotFound,
                json!({ "kind": "genie-not-found", "genie": name }),
            ),
            E::InvalidInput(_) => (ErrorCode::InvalidInput, json!({ "kind": "invalid-input" })),
            E::Template(_) => (ErrorCode::InvalidInput, json!({ "kind": "template" })),
            E::Provider(_) => (ErrorCode::Network, json!({ "kind": "provider" })),
            E::InvalidOutput(_) => (ErrorCode::Network, json!({ "kind": "invalid-output" })),
            E::UnsupportedOutput(output_type) => (
                ErrorCode::Unsupported,
                json!({ "kind": "unsupported-output", "outputType": output_type }),
            ),
        };
        CommandError::new(code, message).with_detail(detail)
    }
}

#[cfg(test)]
#[path = "command_error_from.test.rs"]
mod tests;
