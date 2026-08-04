//! WI-14 — the crate-wide typed error Tauri commands return.
//!
//! Purpose: give the frontend something to BRANCH on. Rule 50 §10 used to
//! canonize `Result<T, String>` for all 161 commands, so every distinction a
//! module drew died at the boundary: eight hand-rolled error enums were
//! flattened with `Display`/`{:?}` (`genie_step.rs` had a literal
//! `impl From<GenieStepError> for String`), ~370 raw-English `format!` sites
//! were invisible to `lint:i18n`, and the frontend had to sniff message TEXT to
//! recover the class — `saveToPath.ts` matched a `PARENT_MISSING:` prefix, the
//! MCP browser handlers matched `String(error).includes("APPROVAL_REQUIRED")`.
//! A substring match is not a contract; rewording an error silently changed
//! control flow.
//!
//! Wire shape, pinned by `command_error.test.rs` and consumed by
//! `src/services/commands/commandError.ts`:
//!
//! ```json
//! { "code": "not-found", "message": "…", "i18nKey": "errors.…", "detail": {…} }
//! ```
//!
//! Absent optionals are ABSENT, not `null` — a `"detail" in err` guard on the
//! frontend must mean what it reads like.
//!
//! Key decisions:
//!   - **A struct with a code enum, not a 12-variant enum.** The wire shape is
//!     then exact by construction (one `#[serde]` block, not twelve), and the
//!     vocabulary stays a closed set the frontend can exhaustively switch on.
//!   - **The vocabulary is derived, not invented.** Each code names an error
//!     class this crate already produces — see the table below.
//!   - **`is_retryable` is a property of the code**, so retry policy lives in
//!     one place instead of being re-derived from message text per call site.
//!   - **`message` is rendered here, from the Rust locale bundle; `i18nKey`
//!     names the string it came from.** The webview does NOT load the Rust
//!     bundles, so it shows `message` and maps `code` to its own translation
//!     key. The key travels anyway for two reasons that pay for themselves
//!     today: `lint:i18n` can only see a string that has one, and a test scans
//!     the crate for these keys and fails if any locale is missing them.
//!
//! @coordinates-with src/services/commands/commandError.ts — the frontend twin
//! @coordinates-with scripts/check-command-error-ratchet.mjs — migration ratchet
//! @module command_error

use serde::{Deserialize, Deserializer, Serialize, Serializer};

macro_rules! error_codes {
    ($( $(#[$meta:meta])* $variant:ident => $wire:literal, retryable = $retry:literal );+ $(;)?) => {
        /// The closed discrimination vocabulary. Every code names a class this
        /// crate really produces; nothing here is speculative.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum ErrorCode {
            $( $(#[$meta])* $variant, )+
        }

        impl ErrorCode {
            /// Every code, for exhaustive table-driven tests and for the
            /// frontend-parity fixture.
            pub const ALL: &'static [ErrorCode] = &[ $( ErrorCode::$variant ),+ ];

            /// The exact string on the wire. Renaming one is a frontend-visible
            /// breaking change.
            pub fn as_str(self) -> &'static str {
                match self { $( ErrorCode::$variant => $wire ),+ }
            }

            /// True when repeating the IDENTICAL call may succeed with nothing
            /// else changed. Approval and conflict need a user action or a state
            /// refresh first, so auto-retrying them is a spin loop.
            pub fn is_retryable(self) -> bool {
                match self { $( ErrorCode::$variant => $retry ),+ }
            }

            /// Parse a wire string. `None` for anything outside the vocabulary —
            /// an unknown code must never silently become a known variant.
            pub fn from_wire(wire: &str) -> Option<Self> {
                match wire { $( $wire => Some(ErrorCode::$variant), )+ _ => None }
            }
        }
    };
}

error_codes! {
    /// Caller-side validation failed: non-absolute path, `..` segment, empty
    /// string, unparsable expression, bad profile name.
    InvalidInput => "invalid-input", retryable = false;
    /// The addressed thing does not exist: unknown tab, missing parent
    /// directory, genie not found, absent CAS snapshot.
    NotFound => "not-found", retryable = false;
    /// Refused by policy and no user action can change it in place: SSRF-blocked
    /// destination, path outside the workspace, origin-confined read.
    PermissionDenied => "permission-denied", retryable = false;
    /// Refused *pending* a user decision. Distinct from `PermissionDenied`
    /// because the frontend raises an approval prompt and retries — the
    /// distinction the `includes("APPROVAL_REQUIRED")` sniff was reconstructing.
    ApprovalRequired => "approval-required", retryable = false;
    /// The caller's view of state is stale or the resource is busy: stale policy
    /// epoch, superseded navigation, duplicate tab, workflow already running.
    Conflict => "conflict", retryable = false;
    /// Filesystem or OS failure — usually transient.
    Io => "io", retryable = true;
    /// Remote call failed: provider request, action fetch, token mint.
    Network => "network", retryable = true;
    /// A deadline elapsed: Pandoc, PDF print, HTML load, store teardown.
    Timeout => "timeout", retryable = true;
    /// The user aborted. Not a failure to shout about.
    Cancelled => "cancelled", retryable = false;
    /// A feature flag is off. WI-19's dark-feature gates return exactly this.
    FeatureDisabled => "feature-disabled", retryable = false;
    /// Not available on this platform or not implemented yet.
    Unsupported => "unsupported", retryable = false;
    /// A bug: poisoned lock, task join failure, closed channel.
    Internal => "internal", retryable = false;
}

impl Serialize for ErrorCode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ErrorCode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = String::deserialize(deserializer)?;
        ErrorCode::from_wire(&wire)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown error code: {wire}")))
    }
}

/// The error every migrated `#[tauri::command]` returns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct CommandError {
    code: ErrorCode,
    message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    i18n_key: Option<String>,
    /// Boxed so `CommandError` stays small. A bare `serde_json::Value` (an
    /// `IndexMap` under `preserve_order`) pushed the struct past clippy's
    /// 128-byte `result_large_err` threshold, which every `Result<T, _>` in the
    /// crate would then pay for by value. `Box` is transparent to serde, so the
    /// wire shape is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    detail: Option<Box<serde_json::Value>>,
}

macro_rules! constructors {
    ($( $name:ident => $variant:ident ),+ $(,)?) => {
        impl CommandError {
            $(
                #[doc = concat!("A [`ErrorCode::", stringify!($variant), "`] error carrying `message`.")]
                pub fn $name(message: impl Into<String>) -> Self {
                    Self::new(ErrorCode::$variant, message)
                }
            )+
        }
    };
}

constructors! {
    invalid_input => InvalidInput,
    not_found => NotFound,
    permission_denied => PermissionDenied,
    approval_required => ApprovalRequired,
    conflict => Conflict,
    io => Io,
    network => Network,
    timeout => Timeout,
    cancelled => Cancelled,
    feature_disabled => FeatureDisabled,
    unsupported => Unsupported,
    internal => Internal,
}

impl CommandError {
    /// Build an error with `code` and a human-readable `message`.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            i18n_key: None,
            detail: None,
        }
    }

    /// Attach the locale key the message was rendered from, so the webview can
    /// re-render it in ITS locale. Prefer [`localized_error!`], which takes the
    /// key once and cannot drift from the message.
    #[must_use]
    pub fn with_i18n_key(mut self, key: impl Into<String>) -> Self {
        self.i18n_key = Some(key.into());
        self
    }

    /// Attach machine-readable context (the missing directory, the failing
    /// stage, the unbound placeholders). Never put user-facing prose here.
    #[must_use]
    pub fn with_detail(mut self, detail: serde_json::Value) -> Self {
        self.detail = Some(Box::new(detail));
        self
    }

    pub fn code(&self) -> ErrorCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn i18n_key(&self) -> Option<&str> {
        self.i18n_key.as_deref()
    }

    pub fn detail(&self) -> Option<&serde_json::Value> {
        self.detail.as_deref()
    }
}

/// Build a localized [`CommandError`]: the locale key is written ONCE and used
/// both to render the message and to travel on the wire, so the two cannot
/// drift. `command_error.test.rs` asserts every key reachable this way resolves
/// in every locale bundle.
///
/// ```ignore
/// localized_error!(ErrorCode::NotFound, "errors.save.parentMissing", dir = dir.display())
/// ```
#[macro_export]
macro_rules! localized_error {
    ($code:expr, $key:literal $(, $name:ident = $value:expr)* $(,)?) => {
        $crate::command_error::CommandError::new(
            $code,
            rust_i18n::t!($key $(, $name = $value)*),
        )
        .with_i18n_key($key)
    };
}

#[path = "command_error_from.rs"]
mod from_impls;

#[cfg(test)]
#[path = "command_error.test.rs"]
mod tests;
