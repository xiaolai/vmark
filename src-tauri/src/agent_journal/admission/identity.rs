//! The names a webview page carries on every request: the writer's
//! incarnation, its page generation and its page identity.
//!
//! Key decisions:
//!   - An incarnation and a page identity are 32 lowercase hex digits (a
//!     random v4 UUID, simple form). Anything else is malformed; nothing is
//!     normalized, so one page cannot be named two ways.
//!   - A page generation is a canonical `u64` decimal string (`u64_wire`):
//!     a JavaScript number loses precision above 2^53, so a JSON number is
//!     refused rather than read.
//!
//! @module agent_journal/admission/identity

use std::fmt;

use crate::agent_journal::errors::TxnError;

/// A writer's per-open name: a request that names another incarnation was
/// meant for a writer that no longer exists.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Incarnation(String);

/// A page's random name, minted when the page first registers.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PageIdentity(String);

pub(crate) fn is_hex32(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn fresh() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn malformed(what: &str, s: &str) -> TxnError {
    TxnError::InvalidRequest(format!("{what} must be 32 lowercase hex digits, got {s:?}"))
}

impl Incarnation {
    pub(crate) fn fresh() -> Self {
        Self(fresh())
    }

    pub(crate) fn parse(s: &str) -> Result<Self, TxnError> {
        is_hex32(s)
            .then(|| Self(s.into()))
            .ok_or_else(|| malformed("incarnation", s))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl PageIdentity {
    pub(crate) fn parse(s: &str) -> Result<Self, TxnError> {
        is_hex32(s)
            .then(|| Self(s.into()))
            .ok_or_else(|| malformed("pageIdentity", s))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A page generation from its wire form.
pub(crate) fn parse_generation(s: &str) -> Result<u64, TxnError> {
    crate::agent_journal::u64_wire::parse(s).ok_or_else(|| {
        TxnError::InvalidRequest(format!(
            "webviewGeneration must be a canonical u64 decimal string, got {s:?}"
        ))
    })
}

impl fmt::Display for Incarnation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl fmt::Display for PageIdentity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
