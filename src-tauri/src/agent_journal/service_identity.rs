//! The app journal's document identity: attaching the durable index when
//! startup finishes, binding a document to a new key on Save As or in-app
//! rename, and following external renames the file watcher reports.
//!
//! Key decisions:
//!   - Binding works before the journal is ready: the registry holds the
//!     mapping for the session and makes it durable when the index attaches.
//!   - An index that cannot be used — one this build cannot vouch for
//!     (`Incompatible`: another format or key policy), an unreadable line
//!     (`Corrupt`), or an open or write failure — disables identity: every
//!     identity-dependent operation refuses with its reason
//!     (`JOURNAL_CORRUPT`) and nothing is written to the index. Falling back
//!     to fresh session-only documents would give every path the index
//!     already maps a new identity and split its history. Saving a file
//!     never goes through identity, so it continues.
//!   - The status reports the mode (`IdentityMode`) beside the reason.
//!
//! @module agent_journal/service_identity

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::agent_journal::doc_registry::SourceExpectation;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::{DocId, RevisionId};
use crate::agent_journal::refusal::refusal;
use crate::agent_journal::service::AgentJournalState;
use crate::command_error::CommandError;

/// How document identity is held: session-only until the index attaches
/// (and for a journal that never started), durable once it attaches,
/// disabled when it could not be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityMode {
    Durable,
    SessionOnly,
    Disabled,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindRequest {
    from: String,
    to: String,
    /// The document the caller believes `from` carries: a compare-and-set
    /// on the source. Absent for a caller that does not know it (`None`);
    /// `null` when `from` must carry none (`Some(None)`).
    #[serde(default, deserialize_with = "present")]
    expected_doc: Option<Option<DocId>>,
}

/// A field that is present, `null` included: absent stays `None` (serde's
/// default), so `null` and absence stay distinct.
fn present<'de, D>(d: D) -> Result<Option<Option<DocId>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<DocId>::deserialize(d).map(Some)
}

impl BindRequest {
    fn expectation(&self) -> SourceExpectation {
        match self.expected_doc {
            None => SourceExpectation::Unchecked,
            Some(None) => SourceExpectation::Nothing,
            Some(Some(doc)) => SourceExpectation::Doc(doc),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FindRequest {
    doc_key: String,
}

impl AgentJournalState {
    pub(super) fn attach_identity(&self, journal_dir: &Path) {
        let outcome = match self.docs.attach(journal_dir) {
            Ok(report) => {
                if report.repaired_tail_bytes > 0 {
                    log::warn!("agent journal: identity index tail repaired at startup");
                }
                Ok(())
            }
            Err(e) => {
                log::error!("agent journal: document identity is disabled: {e}");
                self.docs.refuse(e.to_string());
                Err(e.to_string())
            }
        };
        let _ = self.identity.set(outcome);
    }

    /// The identity mode and, when disabled, why: for the status.
    pub(super) fn identity_status(&self) -> (IdentityMode, Option<String>) {
        match self.identity.get() {
            None => (IdentityMode::SessionOnly, None),
            Some(Ok(())) => (IdentityMode::Durable, None),
            Some(Err(e)) => (IdentityMode::Disabled, Some(e.clone())),
        }
    }

    /// Carry a document to a new key (`payload`: JSON `{from, to,
    /// expectedDoc?}`; `expectedDoc` absent is unchecked, `null` requires
    /// `from` to carry no document, an id requires that one). Returns the
    /// document `to` carries now (minted when `from` carried none).
    ///
    /// # Errors
    /// `INVALID_REQUEST` for a malformed payload or key, or when `from` no
    /// longer carries what `expectedDoc` states; `JOURNAL_IO` when the bind cannot be
    /// made durable.
    pub fn bind_document(&self, payload: &str) -> Result<DocId, CommandError> {
        let req: BindRequest = serde_json::from_str(payload)
            .map_err(|e| refusal(&TxnError::InvalidRequest(e.to_string())))?;
        self.docs
            .bind_expecting(&req.from, &req.to, req.expectation())
            .map_err(|e| refusal(&e))
    }

    /// The document `payload`'s key carries (JSON `{docKey}`), without
    /// minting one: a read has no side effect. Works before the journal is
    /// ready.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for a malformed payload or key.
    pub fn find_document(&self, payload: &str) -> Result<Option<DocId>, CommandError> {
        let req: FindRequest = serde_json::from_str(payload)
            .map_err(|e| refusal(&TxnError::InvalidRequest(e.to_string())))?;
        self.docs.find(&req.doc_key).map_err(|e| refusal(&e))
    }

    /// The settled head of the document a key carries (`payload`: JSON
    /// `{docKey}`), without minting one; `None` is genesis. A tab with no
    /// expected head reads it here before a controlled write (R32): it is
    /// the head that write's compare-and-set is checked against.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for a malformed payload or key; the off refusal
    /// when the journal is not running (never a guessed genesis).
    pub fn head(&self, payload: &str) -> Result<Option<RevisionId>, CommandError> {
        let req: FindRequest = serde_json::from_str(payload)
            .map_err(|e| refusal(&TxnError::InvalidRequest(e.to_string())))?;
        let c = self.controller().ok_or_else(|| self.off_refusal())?;
        let doc = self.docs.find(&req.doc_key).map_err(|e| refusal(&e))?;
        Ok(doc.and_then(|d| c.writer.head(d)))
    }

    /// The watcher saw renames naming `paths`. Returns how many documents
    /// followed.
    pub fn note_renames(&self, paths: &[PathBuf]) -> usize {
        self.docs.note_renames(paths)
    }
}

#[cfg(test)]
#[path = "identity_refusal.test.rs"]
mod refusal_tests;

#[cfg(test)]
#[path = "identity_unreadable.test.rs"]
mod unreadable_tests;

#[cfg(test)]
#[path = "journal_head.test.rs"]
mod journal_head_tests;
