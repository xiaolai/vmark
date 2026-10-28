//! Document identity (ADR-AL7): a window names a document by a key
//! (`path:<file>` for a saved file, `tab:<window>/<tab>` for an untitled
//! buffer) and the registry hands back the journal's `DocId`.
//!
//! Key decisions:
//!   - A path key is its referent's directory-entry spelling (`doc_key`),
//!     so a symlink, and another spelling the volume resolves to the same
//!     entry, are one document; a hard link is its own. A key minted while
//!     the file was missing is provisional and is reconciled once the file
//!     exists (`doc_registry_provisional`); two provisional histories that
//!     prove to be one file are refused, never combined, whichever spelling
//!     is resolved first. Path keys are
//!     durable once the journal attaches its index (`doc_index`): a reopened
//!     path gets its document back. Untitled keys live for the session.
//!   - Save As and in-app rename are `bind`: the source's document moves to
//!     the destination in one durable operation, replacing whatever the
//!     destination held — an untouched tab saved over an existing file is its
//!     own document, never the overwritten file's, and the provisional
//!     histories of the destination's other spellings are released with
//!     it. A repeated bind is a no-op, and an untitled key resolved after its Save As (an epoch
//!     closed late) follows the bind instead of minting a document. A path
//!     bound to an untitled key is released durably first (`remove`), so
//!     the path no longer finds the document, now or after a reopen.
//!   - An external rename moves a mapping only with evidence: a rename event
//!     names the new path (or a directory above it), the new file's identity
//!     equals the one recorded for exactly one mapping, and that mapping's
//!     path no longer holds it (a hard link keeps it, so it is a separate
//!     document); a file renamed over an indexed one replaces that
//!     mapping. All the moves one event supports publish as one change
//!     (`doc_renames`), so a swap follows both files. VMark records the identity itself — at first use and after
//!     each save it captures (`note_saved`); a stale identity fails closed
//!     into a new document. A replacement at the SAME path keeps the
//!     document: every external editor saves by replacing the file, and the
//!     journal already records the content it observes there.
//!   - Keys are bounded; one lock serializes resolve, bind and rename.
//!   - An identity index this build cannot read (`refuse`) disables every
//!     identity operation with its reason: no session-only fallback, which
//!     would split each document's history.
//!
//! @module agent_journal/doc_registry

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::agent_journal::doc_index::{DocIndex, IndexEntry, IndexError, IndexOpen};
use crate::agent_journal::doc_key::{parse, Key};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;

// File-following: saved identities and external renames.
#[path = "doc_registry_follow.rs"]
mod follow;

// Provisional keys reconciled with the stored spelling.
#[path = "doc_registry_provisional.rs"]
mod provisional;
use provisional::{entry_at, entry_for};

// A bind's compare-and-set on its source.
#[path = "doc_registry_expect.rs"]
mod expect;
use expect::LastMove;
pub use expect::SourceExpectation;

pub use crate::agent_journal::doc_key::DOC_KEY_MAX_BYTES;

#[derive(Default)]
struct State {
    session: HashMap<String, DocId>,
    /// Untitled keys bound away, to the document they carried.
    redirects: HashMap<String, DocId>,
    /// Path mappings while no index is attached.
    paths: HashMap<String, IndexEntry>,
    /// The last bind of each source identity, for idempotency.
    moves: HashMap<String, LastMove>,
    index: Option<DocIndex>,
    /// Why identity is disabled, when the index could not be vouched for.
    refused: Option<String>,
}

#[derive(Default)]
pub struct DocRegistry {
    state: Mutex<State>,
}

fn index_failure(e: &IndexError) -> TxnError {
    TxnError::Io(e.to_string())
}

impl State {
    fn usable(&self) -> Result<(), TxnError> {
        match &self.refused {
            Some(reason) => Err(TxnError::Corrupt(reason.clone())),
            None => Ok(()),
        }
    }

    fn lookup(&self, key: &Key) -> Option<DocId> {
        match key {
            Key::Session(k) => self.source(key).or_else(|| self.redirects.get(k).copied()),
            Key::Path { .. } => self.source(key),
        }
    }

    /// The document `key` itself carries now. Unlike `lookup`, an untitled
    /// key bound away carries nothing: its redirect is history, so a late
    /// duplicate bind of it is a repeat, never a second move.
    fn source(&self, key: &Key) -> Option<DocId> {
        match key {
            Key::Session(k) => self.session.get(k).copied(),
            Key::Path { id, .. } => match &self.index {
                Some(index) => index.get(id).map(|e| e.doc),
                None => self.paths.get(id).map(|e| e.doc),
            },
        }
    }

    fn put(&mut self, key: &Key, doc: DocId) -> Result<(), TxnError> {
        match key {
            Key::Session(k) => {
                self.session.insert(k.clone(), doc);
            }
            Key::Path { id, entry } => match &mut self.index {
                Some(index) => index
                    .put(id, entry_for(doc, entry))
                    .map_err(|e| index_failure(&e))?,
                None => {
                    self.paths.insert(id.clone(), entry_for(doc, entry));
                }
            },
        }
        Ok(())
    }
}

impl DocRegistry {
    /// A registry whose path keys persist in `dir`.
    ///
    /// # Errors
    /// The index could not be opened (see [`DocIndex::open`]).
    pub fn open(dir: &Path) -> Result<Self, IndexError> {
        let reg = Self::default();
        reg.attach(dir)?;
        Ok(reg)
    }

    /// Make path keys durable in `dir`, keeping any mapped this session.
    ///
    /// # Errors
    /// The index could not be opened or the session's mappings written.
    pub fn attach(&self, dir: &Path) -> Result<IndexOpen, IndexError> {
        let (mut index, report) = DocIndex::open(dir)?;
        let mut g = self.lock();
        // The session mappings stay until every one is durable: a failure
        // part-way keeps them all, and a retry skips what already landed. A
        // session mapping is a bind made this launch: it replaces the
        // durable one (a Save As over an indexed file is its own document).
        for (id, entry) in &g.paths {
            if index.get(id) != Some(entry) {
                index.put(id, entry.clone())?;
            }
        }
        g.paths.clear();
        g.index = Some(index);
        Ok(report)
    }

    /// Disable identity: every later operation refuses with `reason`
    /// (`JOURNAL_CORRUPT`), and nothing is written.
    pub fn refuse(&self, reason: String) {
        self.lock().refused = Some(reason);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The id for `key`, minted on first use.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for an empty or oversized key; `JOURNAL_IO` when a
    /// new mapping cannot be made durable.
    pub fn resolve(&self, key: &str) -> Result<DocId, TxnError> {
        self.lock().usable()?;
        let key = parse(key)?;
        let mut g = self.lock();
        g.usable()?;
        g.settle(&key)?;
        if let Some(doc) = g.lookup(&key) {
            return Ok(doc);
        }
        let doc = DocId::new();
        g.put(&key, doc)?;
        Ok(doc)
    }

    /// The id `key` already has, without minting one: a read never makes a
    /// document.
    ///
    /// # Errors
    /// `INVALID_REQUEST` for an empty or oversized key.
    pub fn find(&self, key: &str) -> Result<Option<DocId>, TxnError> {
        self.lock().usable()?;
        let key = parse(key)?;
        let g = self.lock();
        g.usable()?;
        g.find_settled(&key)
    }

    /// [`DocRegistry::bind_expecting`] with no expectation of the source.
    #[cfg(test)]
    pub fn bind(&self, from: &str, to: &str) -> Result<DocId, TxnError> {
        self.bind_expecting(from, to, SourceExpectation::Unchecked)
    }

    /// Save As or in-app rename: `to` takes `from`'s document (a fresh one
    /// when `from` has none) and `from` is released. Idempotent.
    ///
    /// `expected` is a compare-and-set on the source: the document the
    /// caller believes `from` carries, or that it carries none. A bind
    /// replayed after `from` was reused (a new document there) and `to`
    /// rebound must not carry the reused key's document over the
    /// destination; it is refused with nothing changed. A repeat of the last
    /// bind stays a no-op only while the destination still holds what that
    /// bind delivered, as expected; otherwise it is refused too.
    ///
    /// # Errors
    /// As [`DocRegistry::resolve`]; `INVALID_REQUEST` when `from` no
    /// longer carries `expected`.
    pub fn bind_expecting(
        &self,
        from: &str,
        to: &str,
        expected: SourceExpectation,
    ) -> Result<DocId, TxnError> {
        self.lock().usable()?;
        let (from, to) = (parse(from)?, parse(to)?);
        let mut g = self.lock();
        g.usable()?;
        g.settle(&from)?;
        let source = g.source(&from);
        // A repeat of the last bind: the source has nothing again (a key that
        // was resolved since is a new document, and binds afresh). It changes
        // nothing, even once the destination moved on (renamed in-app): the
        // untitled key still redirects to the document it carried. The
        // expectation is checked before any no-op: a repeat whose
        // destination now holds another document (rebound since) is refused,
        // never reported as the document this bind moved.
        let last = g
            .moves
            .get(from.id())
            .filter(|last| source.is_none() && last.to == to.id())
            .cloned();
        if from.id() == to.id() || last.is_some() {
            let known = g
                .lookup(&to)
                .or_else(|| last.as_ref().and_then(|_| g.lookup(&from)));
            if let Some(doc) = known {
                return expected.check_repeat(last.as_ref(), doc).map(|()| doc);
            }
        }
        expected.check_source(source)?;
        let minted = source.is_none();
        let doc = source.unwrap_or_default();
        g.publish_bind(&from, &to, doc)?;
        let to = to.id().to_owned();
        g.moves
            .insert(from.id().to_owned(), LastMove { to, doc, minted });
        Ok(doc)
    }
}
