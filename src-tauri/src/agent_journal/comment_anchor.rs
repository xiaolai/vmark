//! Comment anchors — where a comment points in a document's canonical
//! Markdown, kept findable as the document changes.
//!
//! An anchor is the quoted text, up to 32 UTF-16 units of context on each
//! side, the path of section headings enclosing it, and an offset hint
//! naming the revision it was created on. All offsets are UTF-16 code units.
//!
//! Key decisions:
//!   - Resolution is deterministic, in tiers: the quote with its exact
//!     context, then the quote inside the stored heading path, then the
//!     quote anywhere. The first tier with any candidate decides: one is
//!     `Resolved`, several are `Ambiguous`, none in any tier is `Orphaned`.
//!     Never "pick the first".
//!   - The offset hint breaks a tie only on the creation revision, where it
//!     is a fact about that very text, and only when it is exactly a
//!     candidate. On a later revision an identical block inserted at the old
//!     offset would capture the comment, so ties stay ambiguous.
//!   - Headings are CommonMark ATX and setext headings at the document's
//!     root, read the way the production parser reads them (`outline`); the
//!     shared goldens hold both sides to the same answers.
//!   - A selection the editor could not map exactly widens to the whole
//!     root blocks it touches and says so (`Mapping::Widened`). A quote over
//!     4,096 UTF-8 bytes, exact or widened, is refused, never truncated.
//!   - Anchors locate comments only. Nothing here decides whether a span
//!     may be reverted, and the revert path does not read anchors.
//!
//! @module agent_journal/comment_anchor

mod container;
mod create;
mod definition;
mod html;
mod lines;
mod math;
mod multi;
mod outline;
mod resolve;
mod scan;
pub(crate) mod work;

use serde::{Deserialize, Serialize};

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::RevisionId;

pub use create::create_anchor;
pub use outline::{headings, Heading};
pub use resolve::{resolve, resolve_all};

/// Context kept on each side of a quote, in UTF-16 code units.
pub const CONTEXT_UNITS: usize = 32;
/// The largest quote an anchor may store, in UTF-8 bytes.
pub const MAX_QUOTE_UTF8_BYTES: usize = 4096;

/// Where an anchor was created: the revision and the quote's start in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OffsetHint {
    pub revision: RevisionId,
    pub offset: u64,
}

/// What a comment stores to find its passage again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredAnchor {
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub heading_path: Vec<String>,
    pub hint: Option<OffsetHint>,
}

/// The tier that decided a resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tier {
    /// The quote with its exact prefix and suffix.
    Context,
    /// The quote inside the stored heading path.
    HeadingPath,
    /// The quote anywhere in the document.
    Anywhere,
}

/// Where a stored anchor is in a revision's text, in UTF-16 units.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum Resolution {
    /// One candidate, or the creation offset among several on the creation revision (`by_hint`).
    Resolved {
        tier: Tier,
        start: u64,
        end: u64,
        #[serde(rename = "byHint")]
        by_hint: bool,
    },
    /// Several candidates in the deciding tier, by start offset.
    Ambiguous { tier: Tier, candidates: Vec<u64> },
    /// The quote is nowhere in the text.
    Orphaned,
}

/// Why an anchor could not be created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnchorError {
    /// The quote, exact or widened, is over `MAX_QUOTE_UTF8_BYTES`.
    AnchorTooLong { bytes: usize, limit: usize },
    /// Offsets past the end, reversed, or nothing to widen to.
    InvalidSelection(String),
}

impl AnchorError {
    /// The wire token: `COMMENT_ANCHOR_TOO_LONG` or `INVALID_REQUEST`.
    pub fn code(&self) -> &'static str {
        TxnError::from(self.clone()).code()
    }
}

impl From<AnchorError> for TxnError {
    fn from(e: AnchorError) -> Self {
        match e {
            AnchorError::AnchorTooLong { bytes, limit } => {
                TxnError::CommentAnchorTooLong { bytes, limit }
            }
            AnchorError::InvalidSelection(why) => TxnError::InvalidRequest(why),
        }
    }
}

/// How a selection became an anchor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mapping {
    /// The quote is exactly the selected text (bounds moved only out of a surrogate pair).
    Exact,
    /// The quote is the whole root blocks the selection touched.
    Widened,
}

/// Whether the editor mapped the selection's bounds onto the Markdown exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SelectionPrecision {
    Exact,
    Approximate,
}

/// A selection in canonical Markdown, in UTF-16 units.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnchorSelection {
    pub start: u64,
    pub end: u64,
    pub precision: SelectionPrecision,
}

/// A new anchor and the range its quote covers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedAnchor {
    pub anchor: StoredAnchor,
    pub start: u64,
    pub end: u64,
    pub mapping: Mapping,
}

/// Admit a quote against the size bound; `Ok` carries its UTF-8 size.
pub fn admit_quote(quote: &str) -> Result<usize, AnchorError> {
    match quote.len() {
        bytes if bytes > MAX_QUOTE_UTF8_BYTES => Err(AnchorError::AnchorTooLong {
            bytes,
            limit: MAX_QUOTE_UTF8_BYTES,
        }),
        bytes => Ok(bytes),
    }
}

#[cfg(test)]
#[path = "comment_anchor.test.rs"]
mod tests;

#[cfg(test)]
#[path = "comment_anchor_multi.test.rs"]
mod multi_tests;

#[cfg(test)]
#[path = "comment_anchor_work.test.rs"]
mod work_tests;
