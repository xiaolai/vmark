//! Where staging reads texts from: the pack, or the pack overlaid with the
//! blobs a staged admission will store. A staged baseline's text exists
//! only in memory until its frame is written, yet the items after it
//! (its linearization, the prepared) derive from that text; reading
//! through `StagedBlobs` gives them the same view the replay will have,
//! without storing anything before the frame is whole.
//!
//! @module agent_journal/admission/blobs

use std::collections::BTreeMap;

use crate::agent_journal::blob_store::BlobStore;
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::BlobHash;

/// Read access to stored (or staged) texts.
pub(crate) trait BlobRead {
    /// Whether `hash` is durably present (`BlobStore::contains`).
    fn contains(&self, hash: &BlobHash) -> bool;
    /// Whether `get` can read `hash` (`BlobStore::readable`).
    fn readable(&self, hash: &BlobHash) -> bool;
    fn get(&mut self, hash: &BlobHash) -> Result<String, TxnError>;
}

impl BlobRead for BlobStore {
    fn contains(&self, hash: &BlobHash) -> bool {
        BlobStore::contains(self, hash)
    }
    fn readable(&self, hash: &BlobHash) -> bool {
        BlobStore::readable(self, hash)
    }
    fn get(&mut self, hash: &BlobHash) -> Result<String, TxnError> {
        BlobStore::get(self, hash)
    }
}

/// The pack with an in-memory overlay of texts not yet stored. Staged
/// texts win; nothing is written through it.
pub(crate) struct StagedBlobs<'a> {
    staged: BTreeMap<BlobHash, String>,
    pack: &'a mut BlobStore,
}

impl<'a> StagedBlobs<'a> {
    pub(crate) fn new(pack: &'a mut BlobStore) -> Self {
        Self {
            staged: BTreeMap::new(),
            pack,
        }
    }

    /// Stage `text` unless the pack already durably holds it.
    pub(crate) fn stage(&mut self, text: &str) {
        let hash = BlobHash::of_text(text);
        if !self.pack.contains(&hash) {
            self.staged.entry(hash).or_insert_with(|| text.to_owned());
        }
    }

    /// The staged texts, in hash order, for the publisher to store.
    pub(crate) fn into_staged(self) -> Vec<(BlobHash, String)> {
        self.staged.into_iter().collect()
    }
}

impl BlobRead for StagedBlobs<'_> {
    fn contains(&self, hash: &BlobHash) -> bool {
        self.staged.contains_key(hash) || self.pack.contains(hash)
    }
    fn readable(&self, hash: &BlobHash) -> bool {
        self.staged.contains_key(hash) || self.pack.readable(hash)
    }
    fn get(&mut self, hash: &BlobHash) -> Result<String, TxnError> {
        match self.staged.get(hash) {
            Some(text) => Ok(text.clone()),
            None => self.pack.get(hash),
        }
    }
}
