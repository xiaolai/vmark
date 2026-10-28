//! Provisional path keys reconciled with the stored spelling.
//!
//! A path key minted while its file (or a folder above it) was missing
//! keeps the spelling the caller asked for (`files/entry_spelling.rs`).
//! Once the file exists its key is the stored spelling, which may differ
//! (another case on a case-insensitive volume). Which earlier spellings
//! named this entry is asked of the filesystem, never guessed from the
//! request's text: each provisional mapping in the entry's group
//! (`doc_index_near.rs`, a broad fold that only narrows) is looked up
//! again, and those that now reach the same entry are its aliases,
//! whichever spelling is resolved first. Their mapping is moved to the stored key in one durable
//! operation (a `move` line, or one atomic rewrite for several), so a crash
//! leaves it wholly at the old key or wholly at the new one. Two different
//! documents among those mappings (and the key's own) are two histories:
//! they are refused (`INVALID_REQUEST`) for every spelling, never combined.
//! A provisional mapping whose lookup the filesystem refuses is not an
//! alias (a split, never a merge), and is logged.
//!
//! Save As onto an existing entry (`publish_bind`) replaces the entry whole,
//! so its provisional aliases are released in the same durable operation.
//!
//! A child module of `doc_registry` (split for size), sharing its private
//! state and lock.
//!
//! @coordinates-with files/entry_spelling.rs — looks each mapping up again
//! @module agent_journal/doc_registry_provisional

use std::path::Path;

use super::{index_failure, State};
use crate::agent_journal::doc_index::{near_key, IndexEntry};
use crate::agent_journal::doc_key::{file_id, Key};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::DocId;
use crate::files::entry_spelling::{entry_path, EntryPath};

/// The mapping of `doc` at `path`: provisional while the file is missing.
pub(super) fn entry_at(doc: DocId, path: &Path, exists: bool) -> IndexEntry {
    IndexEntry {
        doc,
        path: path.to_string_lossy().into_owned(),
        file_id: file_id(path),
        provisional: !exists,
    }
}

pub(super) fn entry_for(doc: DocId, entry: &EntryPath) -> IndexEntry {
    entry_at(doc, &entry.path, entry.exists)
}

/// The provisional mappings of a key's aliases, and the one document they
/// and the key's own mapping carry.
struct Aliases {
    keys: Vec<String>,
    doc: Option<DocId>,
}

impl State {
    fn path_entry(&self, id: &str) -> Option<&IndexEntry> {
        match &self.index {
            Some(index) => index.get(id),
            None => self.paths.get(id),
        }
    }

    /// The provisional mappings, other than `id`'s own, that now reach the
    /// existing entry `entry` names. Only an existing entry has aliases: a
    /// missing one is still spelled as each request asked.
    fn alias_keys(&self, id: &str, entry: &EntryPath) -> Vec<(String, DocId)> {
        if !entry.exists {
            return Vec::new();
        }
        // Only mappings in the entry's group are looked up again, so the
        // cost follows the group, not every provisional mapping. Without an
        // index (before attach) the session's few mappings are filtered.
        let path = entry.path.to_string_lossy();
        let mappings: Box<dyn Iterator<Item = (&String, &IndexEntry)>> = match &self.index {
            Some(index) => Box::new(
                index
                    .provisional_near(&path)
                    .filter_map(|k| index.get(k).map(|e| (k, e))),
            ),
            None => {
                let group = near_key(&path);
                Box::new(
                    self.paths
                        .iter()
                        .filter(move |(_, e)| near_key(&e.path) == group),
                )
            }
        };
        mappings
            .filter(|(key, e)| e.provisional && key.as_str() != id)
            .filter(|(key, e)| match entry_path(Path::new(&e.path)) {
                Ok(now) => now.path == entry.path,
                Err(err) => {
                    log::warn!("[agent-journal] {key} not reconciled: {err}");
                    false
                }
            })
            .map(|(key, e)| (key.clone(), e.doc))
            .collect()
    }

    fn aliases(&self, id: &str, entry: &EntryPath) -> Result<Aliases, TxnError> {
        let mut found = Aliases {
            keys: Vec::new(),
            doc: self.path_entry(id).map(|e| e.doc),
        };
        for (alias, doc) in self.alias_keys(id, entry) {
            if found.doc.is_some_and(|own| own != doc) {
                return Err(TxnError::InvalidRequest(format!(
                    "{id} and {alias} were recorded as two documents before the file existed; \
                     their histories are not combined"
                )));
            }
            found.doc = Some(doc);
            found.keys.push(alias);
        }
        Ok(found)
    }

    /// The document `key` carries, counting a provisional alias's. Reads
    /// only.
    pub(super) fn find_settled(&self, key: &Key) -> Result<Option<DocId>, TxnError> {
        match key {
            Key::Path { id, entry } => Ok(self.aliases(id, entry)?.doc),
            Key::Session(_) => Ok(self.lookup(key)),
        }
    }

    /// Move a provisional alias's mapping to `key`, and mark the key's own
    /// mapping existing once its file exists. Nothing changes on failure.
    pub(super) fn settle(&mut self, key: &Key) -> Result<(), TxnError> {
        let Key::Path { id, entry } = key else {
            return Ok(());
        };
        let found = self.aliases(id, entry)?;
        let Some(doc) = found.doc else {
            return Ok(());
        };
        let stale = self
            .path_entry(id)
            .is_some_and(|e| e.provisional && entry.exists);
        if found.keys.is_empty() && !stale {
            return Ok(());
        }
        let settled = entry_for(doc, entry);
        let failure = |e| index_failure(&e);
        match (&mut self.index, found.keys.as_slice()) {
            (Some(index), []) => index.put(id, settled).map_err(failure),
            (Some(index), [one]) => index.move_key(one, id, settled).map_err(failure),
            (Some(index), many) => index
                .remap(|entries| {
                    for k in many {
                        entries.remove(k);
                    }
                    entries.insert(id.clone(), settled);
                })
                .map_err(failure),
            (None, many) => {
                for k in many {
                    self.paths.remove(k);
                }
                self.paths.insert(id.clone(), settled);
                Ok(())
            }
        }
    }

    /// Publish a bind: `to` takes `doc` and `from` is released, together
    /// with the provisional aliases of an existing destination, durably in
    /// one operation where the index allows it.
    pub(super) fn publish_bind(
        &mut self,
        from: &Key,
        to: &Key,
        doc: DocId,
    ) -> Result<(), TxnError> {
        let stale: Vec<String> = match to {
            Key::Path { id, entry } => self
                .alias_keys(id, entry)
                .into_iter()
                .map(|(k, _)| k)
                .collect(),
            Key::Session(_) => Vec::new(),
        };
        let failure = |e| index_failure(&e);
        match (from, to, &mut self.index) {
            (Key::Path { id: old, .. }, Key::Path { id, entry }, Some(index))
                if stale.is_empty() =>
            {
                index
                    .move_key(old, id, entry_for(doc, entry))
                    .map_err(failure)?;
            }
            (_, Key::Path { id, entry }, Some(index)) if !stale.is_empty() => {
                let settled = entry_for(doc, entry);
                index
                    .remap(|entries| {
                        if let Key::Path { id: old, .. } = from {
                            entries.remove(old);
                        }
                        for k in &stale {
                            entries.remove(k);
                        }
                        entries.insert(id.clone(), settled);
                    })
                    .map_err(failure)?;
            }
            _ => {
                // A durable source is released before the destination is
                // published: a failed release changes no mapping.
                if let (Key::Path { id, .. }, Some(index)) = (from, &mut self.index) {
                    index.remove(id).map_err(failure)?;
                }
                for k in &stale {
                    self.paths.remove(k);
                }
                self.put(to, doc)?;
                if let Key::Path { id, .. } = from {
                    self.paths.remove(id);
                }
            }
        }
        if let Key::Session(k) = from {
            self.session.remove(k);
            self.redirects.insert(k.clone(), doc);
        }
        Ok(())
    }
}
