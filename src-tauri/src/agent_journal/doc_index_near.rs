//! Provisional mappings grouped by a broad fold of their path, so that
//! reconciling an existing file looks up only the mappings that could be
//! another spelling of it, however many provisional mappings the index
//! holds.
//!
//! Key decisions:
//!   - The grouping key is the write lock's fold (`files/write/lock_key.rs`):
//!     deliberately broader than any supported volume's name matching, so
//!     every spelling a volume treats as one entry lands in one group. It
//!     only narrows the candidates; whether a candidate names the entry is
//!     still asked of the filesystem. A spelling outside the group (a
//!     missing folder later created as a link elsewhere) is not found: a
//!     split, never a merge.
//!   - Kept in step with every change to the entries: built at open and
//!     after a rewrite, updated per appended operation.
//!
//! A child module of `doc_index` (split for size).
//!
//! @coordinates-with agent_journal/doc_registry_provisional.rs — its reader
//! @module agent_journal/doc_index_near

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::format::{apply, Op};
use super::IndexEntry;
use crate::files::write::lock_key::fold;

/// The group a path's mappings fall in.
pub(crate) fn near_key(path: &str) -> String {
    fold(path, cfg!(windows))
}

/// Provisional keys by the group of their path.
#[derive(Default)]
pub(super) struct Near(HashMap<String, BTreeSet<String>>);

impl Near {
    pub(super) fn of(entries: &BTreeMap<String, IndexEntry>) -> Self {
        let mut near = Self::default();
        for (key, entry) in entries {
            near.learn(key, entry);
        }
        near
    }

    fn learn(&mut self, key: &str, entry: &IndexEntry) {
        if entry.provisional {
            let group = self.0.entry(near_key(&entry.path)).or_default();
            group.insert(key.to_owned());
        }
    }

    fn forget(&mut self, key: &str, entry: &IndexEntry) {
        let group = near_key(&entry.path);
        if let Some(keys) = self.0.get_mut(&group) {
            keys.remove(key);
            if keys.is_empty() {
                self.0.remove(&group);
            }
        }
    }

    /// The provisional keys in `group`.
    pub(super) fn keys(&self, group: &str) -> impl Iterator<Item = &String> {
        self.0.get(group).into_iter().flatten()
    }

    /// Apply `op` to `entries`, keeping the groups in step.
    pub(super) fn apply(&mut self, entries: &mut BTreeMap<String, IndexEntry>, op: Op) {
        let touched = match &op {
            Op::Put { key, .. } => vec![key.clone()],
            Op::Move { from, to, .. } => vec![from.clone(), to.clone()],
        };
        for key in &touched {
            if let Some(entry) = entries.get(key) {
                self.forget(key, entry);
            }
        }
        apply(entries, op);
        for key in &touched {
            if let Some(entry) = entries.get(key) {
                self.learn(key, entry);
            }
        }
    }
}

#[cfg(test)]
#[path = "doc_index_near.test.rs"]
mod tests;
