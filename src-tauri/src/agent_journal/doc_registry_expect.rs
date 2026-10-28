//! A bind's compare-and-set on its source (`DocRegistry::bind_expecting`):
//! what the caller believes the source carries, checked against the source
//! for a fresh bind and against the destination for a repeat.
//!
//! Key decisions:
//!   - Three states, not an optional id: a caller that does not know
//!     (`Unchecked`, the legacy payload) differs from one that knows the
//!     source carries nothing (`Nothing`), whose bind mints a document.
//!   - A repeat fits only while the destination still holds the document
//!     the last bind delivered — for `Nothing`, one minted because the
//!     source carried none. A destination rebound since is refused, never
//!     reported as the document the bind moved.
//!
//! @module agent_journal/doc_registry_expect

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;

/// Where a source's last bind took it: the destination, the document it
/// delivered, and whether that document was minted for it (the source
/// carried none).
#[derive(Clone)]
pub(crate) struct LastMove {
    pub to: String,
    pub doc: DocId,
    pub minted: bool,
}

/// What a bind's caller believes its source carries (a compare-and-set).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceExpectation {
    /// No belief: the bind is not checked (a caller that does not know).
    Unchecked,
    /// The source carries no document.
    Nothing,
    /// The source carries this document.
    Doc(DocId),
}

fn refused() -> TxnError {
    TxnError::InvalidRequest("the source key no longer carries the expected document".into())
}

impl SourceExpectation {
    /// A fresh bind: `source` is what the source key carries now.
    pub(super) fn check_source(self, source: Option<DocId>) -> Result<(), TxnError> {
        let fits = match self {
            SourceExpectation::Unchecked => true,
            SourceExpectation::Nothing => source.is_none(),
            SourceExpectation::Doc(e) => source == Some(e),
        };
        fits.then_some(()).ok_or_else(refused)
    }

    /// A repeat of `last` (or a bind of a key to itself, with no `last`)
    /// whose destination holds `doc`.
    pub(super) fn check_repeat(self, last: Option<&LastMove>, doc: DocId) -> Result<(), TxnError> {
        let delivered = last.map(|m| (m.doc == doc, m.minted));
        let fits = match (self, delivered) {
            (SourceExpectation::Unchecked, _) => true,
            (SourceExpectation::Doc(e), None) => e == doc,
            (SourceExpectation::Doc(e), Some((held, _))) => e == doc && held,
            (SourceExpectation::Nothing, Some((held, minted))) => held && minted,
            (SourceExpectation::Nothing, None) => false,
        };
        fits.then_some(()).ok_or_else(refused)
    }
}
