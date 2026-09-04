//! The closed vocabulary of native surface failures (audit 20260903 round 3, #31).
//!
//! `surface::create_with_mode`, `surface::navigate`, `surface::dialog_respond` and
//! the rest of the native API are `Result<_, String>` on every platform, and a
//! failure crosses the main-thread hop as that string; the stable tokens in
//! [`crate::browser::surface::fail`] are the only structure it carries. This enum is
//! the TYPED form of that vocabulary. A producer renders a variant
//! ([`NativeSurfaceError::tagged`]), the classifier reads one back
//! ([`NativeSurfaceError::parse`]), and `surface_failure.rs` maps each variant to its
//! `CommandError` with an EXHAUSTIVE match — so a class that gains a token without a
//! classification, or a classification without a token, is a compile error or a
//! failing test rather than a quiet fallthrough to `internal`.
//!
//! Before this, the classifier was a nine-way `if tagged(..) else if` chain over
//! string prefixes, and nothing joined the producers' constants to the arms that read
//! them. `native_failure.test.rs` reads `mod fail` from source and pins that every
//! constant has exactly one variant and every variant round-trips through its own
//! rendering — which also covers the producers this crate does not route through
//! here (`surface_view_macos.rs`, `content_rules_macos.rs`, `browser_store_macos.rs`
//! name the constants directly).
//!
//! @coordinates-with browser/surface.rs — `mod fail`, the wire tokens (the contract)
//! @coordinates-with browser/surface_failure.rs — the exhaustive classification
//! @coordinates-with browser/surface_macos.rs, browser/surface_stub.rs — producers

use crate::browser::surface::fail;
use std::fmt;

/// One class of native surface failure. `Untagged` is the class of a string that
/// carries no token — it degrades to `internal` rather than being guessed at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeSurfaceError {
    /// The window a tab was to be attached to is gone (or has no content view).
    WindowGone,
    /// No native webview is registered for that tab id.
    NoWebview,
    /// The platform URL type rejected the string.
    InvalidUrl,
    /// The named-profile data-store cap is exhausted (WI-P6.1 H2).
    ProfileStoreLimit,
    /// This build has no native browser surface.
    UnsupportedPlatform,
    /// The main-thread hop did not answer within its deadline, and the body never
    /// ran (`main_thread_hop`).
    MainThreadTimeout,
    /// The AI destination rule list did not compile; no AI webview was created.
    ContentRulesFailed,
    /// The authorized generation was superseded before a native submit.
    StaleCommand,
    /// A page dialog was answered from a window that does not own its tab.
    DialogNotOwned,
    /// A failure nobody tagged.
    Untagged,
}

impl NativeSurfaceError {
    /// Every tagged class — the order the classifier consults them in.
    pub const TAGGED: [Self; 9] = [
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

    /// The wire token this class travels under, from `surface::fail` — the ONE place
    /// a producer and this classifier can agree on the spelling.
    pub fn token(self) -> Option<&'static str> {
        match self {
            Self::WindowGone => Some(fail::WINDOW_GONE),
            Self::NoWebview => Some(fail::NO_WEBVIEW),
            Self::InvalidUrl => Some(fail::INVALID_URL),
            Self::ProfileStoreLimit => Some(fail::PROFILE_STORE_LIMIT),
            Self::UnsupportedPlatform => Some(fail::UNSUPPORTED_PLATFORM),
            Self::MainThreadTimeout => Some(fail::MAIN_THREAD_TIMEOUT),
            Self::ContentRulesFailed => Some(fail::CONTENT_RULES_FAILED),
            Self::StaleCommand => Some(fail::STALE_COMMAND),
            Self::DialogNotOwned => Some(fail::DIALOG_NOT_OWNED),
            Self::Untagged => None,
        }
    }

    /// Render a failure the classifier can read back: `TOKEN: detail`, or the bare
    /// token when `detail` is empty (the form `PROFILE_STORE_LIMIT` ships as). An
    /// untagged class renders as its detail alone — no token is invented for it.
    pub fn tagged(self, detail: impl fmt::Display) -> String {
        let detail = detail.to_string();
        match self.token() {
            Some(token) if detail.is_empty() => token.to_string(),
            Some(token) => format!("{token}: {detail}"),
            None => detail,
        }
    }

    /// Read the class off a native failure string.
    ///
    /// Anchored and delimited on purpose: a bare `contains()` would let a URL
    /// carrying a token in its query string reclassify its own failure, which is
    /// precisely the substring-sniff defect WI-14 exists to remove.
    pub fn parse(error: &str) -> Self {
        Self::TAGGED
            .into_iter()
            .find(|class| {
                class
                    .token()
                    .is_some_and(|token| starts_with_tag(error, token))
            })
            .unwrap_or(Self::Untagged)
    }
}

/// Does `error` begin with `token` as a whole tag (`TOKEN` or `TOKEN: …`)?
fn starts_with_tag(error: &str, token: &str) -> bool {
    match error.strip_prefix(token) {
        Some("") => true,
        Some(rest) => rest.starts_with(':'),
        None => false,
    }
}

#[cfg(test)]
#[path = "native_failure.test.rs"]
mod tests;
