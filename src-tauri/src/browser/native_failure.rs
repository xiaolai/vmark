//! The typed vocabulary of native surface failures (audit 20260903 round 3 #31,
//! carried end to end in round 4).
//!
//! Every native entry point in `surface.rs` — creation, navigation, eval,
//! screenshot, cookies, teardown, the debug probes — and the main-thread hop they
//! run through fail with THIS type. A producer names a variant with its detail
//! (`NativeSurfaceError::NoWebview(format!("no webview: {tab_id}"))`), the hop
//! carries it unchanged, and `surface_failure.rs` maps each variant to its
//! `CommandError` with an EXHAUSTIVE match — so a class without a classification
//! is a compile error, never a quiet fallthrough to `internal`.
//!
//! Round 3 typed only the classifier's INPUT: producers still rendered
//! `TOKEN: detail` strings and the classifier parsed the tag back off. Round 4
//! typed every native producer — the view and store helpers, and the two entry
//! points (`create_with_mode`, `navigate`) whose closure types live in
//! `ai_transactions.rs` — so no native path renders a string any more. The
//! tokens in [`crate::browser::surface::fail`] survive as the WIRE spelling of
//! each class: what [`fmt::Display`] renders for logs and the frontend, and what
//! [`NativeSurfaceError::parse`] / `From<String>` read back for a rendering that
//! crossed a text boundary (tests, a log line). `native_failure.test.rs` reads
//! `mod fail` from source and pins that every constant has exactly one variant
//! and every variant round-trips through its own rendering.
//!
//! @coordinates-with browser/surface.rs — `mod fail`, the wire tokens
//! @coordinates-with browser/surface_failure.rs — the exhaustive classification
//! @coordinates-with browser/main_thread_hop.rs — carries this across the hop

use crate::browser::surface::fail;
use std::fmt;

/// One native surface failure: its class, and the detail the producer attached.
/// `Unclassified` is the class of a failure with no class of its own — it
/// degrades to `internal` rather than being guessed at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeSurfaceError {
    /// The window a tab was to be attached to is gone (or has no content view).
    WindowGone(String),
    /// No native webview is registered for that tab id.
    NoWebview(String),
    /// The platform URL type rejected the string.
    InvalidUrl(String),
    /// The named-profile data-store cap is exhausted (WI-P6.1 H2).
    ProfileStoreLimit(String),
    /// This build has no native browser surface.
    UnsupportedPlatform(String),
    /// The main-thread hop did not answer within its deadline, and the body never
    /// ran (`main_thread_hop`).
    MainThreadTimeout(String),
    /// The AI destination rule list did not compile; no AI webview was created.
    ContentRulesFailed(String),
    /// The authorized generation was superseded before a native submit.
    StaleCommand(String),
    /// A page dialog was answered from a window that does not own its tab.
    DialogNotOwned(String),
    /// A failure with no class of its own: an internal invariant, a WebKit
    /// completion that never fired, a scheduler that refused.
    Unclassified(String),
}

impl NativeSurfaceError {
    /// Every tagged class, as its constructor — the order `parse` consults them in.
    pub const TAGGED: [fn(String) -> Self; 9] = [
        Self::WindowGone,
        Self::NoWebview,
        Self::InvalidUrl,
        Self::ProfileStoreLimit,
        Self::UnsupportedPlatform,
        Self::MainThreadTimeout,
        Self::ContentRulesFailed,
        Self::StaleCommand,
        Self::DialogNotOwned,
    ];

    /// The wire token this class travels under, from `surface::fail` — the ONE
    /// place a producer, this type and the classifier agree on the spelling.
    pub fn token(&self) -> Option<&'static str> {
        match self {
            Self::WindowGone(_) => Some(fail::WINDOW_GONE),
            Self::NoWebview(_) => Some(fail::NO_WEBVIEW),
            Self::InvalidUrl(_) => Some(fail::INVALID_URL),
            Self::ProfileStoreLimit(_) => Some(fail::PROFILE_STORE_LIMIT),
            Self::UnsupportedPlatform(_) => Some(fail::UNSUPPORTED_PLATFORM),
            Self::MainThreadTimeout(_) => Some(fail::MAIN_THREAD_TIMEOUT),
            Self::ContentRulesFailed(_) => Some(fail::CONTENT_RULES_FAILED),
            Self::StaleCommand(_) => Some(fail::STALE_COMMAND),
            Self::DialogNotOwned(_) => Some(fail::DIALOG_NOT_OWNED),
            Self::Unclassified(_) => None,
        }
    }

    /// The detail the producer attached.
    pub fn detail(&self) -> &str {
        match self {
            Self::WindowGone(detail)
            | Self::NoWebview(detail)
            | Self::InvalidUrl(detail)
            | Self::ProfileStoreLimit(detail)
            | Self::UnsupportedPlatform(detail)
            | Self::MainThreadTimeout(detail)
            | Self::ContentRulesFailed(detail)
            | Self::StaleCommand(detail)
            | Self::DialogNotOwned(detail)
            | Self::Unclassified(detail) => detail,
        }
    }

    /// Read a failure back off its rendering — the adapter for the `String`-errored
    /// seams named in the module doc.
    ///
    /// Anchored and delimited on purpose: a bare `contains()` would let a URL
    /// carrying a token in its query string reclassify its own failure, which is
    /// precisely the substring-sniff defect WI-14 exists to remove. Text with no
    /// leading token is `Unclassified`, whole.
    pub fn parse(text: &str) -> Self {
        Self::TAGGED
            .iter()
            .find_map(|make| {
                let token = make(String::new()).token()?;
                strip_tag(text, token).map(|detail| make(detail.to_string()))
            })
            .unwrap_or_else(|| Self::Unclassified(text.to_string()))
    }
}

/// The detail behind `token`, if `text` begins with it as a whole tag: `TOKEN`
/// (an empty detail) or `TOKEN: detail`.
fn strip_tag<'a>(text: &'a str, token: &str) -> Option<&'a str> {
    match text.strip_prefix(token)? {
        "" => Some(""),
        rest => rest.strip_prefix(':').map(str::trim_start),
    }
}

impl fmt::Display for NativeSurfaceError {
    /// `TOKEN: detail`; the bare token when the detail is empty (the form
    /// `PROFILE_STORE_LIMIT` ships as); the detail alone for an unclassified
    /// failure — no token is invented for it. `parse` reads every form back.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.token(), self.detail()) {
            (Some(token), "") => f.write_str(token),
            (Some(token), detail) => write!(f, "{token}: {detail}"),
            (None, detail) => f.write_str(detail),
        }
    }
}

impl std::error::Error for NativeSurfaceError {}

/// The adapter for a helper that still fails with a tagged string (see the module
/// doc): one anchored parse at the seam, so `?` carries its class into the typed
/// hop instead of a producer re-spelling the token.
impl From<String> for NativeSurfaceError {
    fn from(text: String) -> Self {
        Self::parse(&text)
    }
}

/// What `surface_failure` can classify: the typed failure itself, or — at a seam
/// still bounded by `String` — its rendering, parsed once.
pub trait AsNativeFailure {
    fn as_native_failure(&self) -> NativeSurfaceError;
}

impl AsNativeFailure for NativeSurfaceError {
    fn as_native_failure(&self) -> NativeSurfaceError {
        self.clone()
    }
}

impl AsNativeFailure for str {
    fn as_native_failure(&self) -> NativeSurfaceError {
        NativeSurfaceError::parse(self)
    }
}

impl AsNativeFailure for String {
    fn as_native_failure(&self) -> NativeSurfaceError {
        NativeSurfaceError::parse(self)
    }
}

#[cfg(test)]
#[path = "native_failure.test.rs"]
mod tests;
