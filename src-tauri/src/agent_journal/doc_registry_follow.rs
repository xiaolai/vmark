//! File-following for the document registry: the identity a VMark save
//! left (`note_saved`) and the external renames the watcher reports
//! (`note_renames`), each moving a durable mapping only on evidence.
//!
//! A child module of `doc_registry` (split for size), so it shares the
//! registry's private state and lock without widening their visibility.
//!
//! @coordinates-with agent_journal/doc_renames.rs — plans the moves

use std::path::PathBuf;

use super::{entry_at, DocRegistry, State};
use crate::agent_journal::doc_index::IndexEntry;
use crate::agent_journal::doc_key::{file_id, parse, Key};
use crate::agent_journal::doc_renames::{plan_moves, rename_probes, RenameProbe};

impl DocRegistry {
    /// VMark saved `key`: record the file identity the save left. Best
    /// effort — a stale identity only fails an external rename closed.
    pub fn note_saved(&self, key: &str) {
        let Ok(Key::Path { id, entry: at }) = parse(key) else {
            return;
        };
        let mut g = self.lock();
        if g.refused.is_some() {
            return;
        }
        let Some(index) = g.index.as_mut() else {
            return;
        };
        let Some(entry) = index.get(&id).cloned() else {
            return;
        };
        let now = file_id(&at.path);
        if now.is_some() && (now != entry.file_id || entry.provisional) {
            let refreshed = IndexEntry {
                file_id: now,
                provisional: false,
                ..entry
            };
            if let Err(e) = index.put(&id, refreshed) {
                log::warn!("agent journal: could not record a saved file's identity: {e}");
            }
        }
    }

    /// The watcher saw renames naming `paths`: move each mapping the
    /// evidence supports. Returns how many moved. The filesystem is probed
    /// before the lock is taken.
    pub fn note_renames(&self, paths: &[PathBuf]) -> usize {
        self.apply_rename_probes(rename_probes(paths))
    }

    /// Move the mappings `probes` support, under the lock: planned against
    /// the index as it stands (`plan_moves`), then published as one durable
    /// change, so a swap follows both files or neither.
    pub(crate) fn apply_rename_probes(&self, probes: Vec<RenameProbe>) -> usize {
        if probes.is_empty() {
            return 0;
        }
        let mut g = self.lock();
        if g.refused.is_some() {
            return 0;
        }
        let State { index, moves, .. } = &mut *g;
        let Some(index) = index.as_mut() else {
            return 0;
        };
        let plan = plan_moves(index, probes);
        let published = match plan.as_slice() {
            [] => return 0,
            [m] => index.move_key(
                &m.old,
                &m.probe.id,
                entry_at(m.doc, &m.probe.canonical, true),
            ),
            _ => index.remap(|entries| {
                for m in &plan {
                    entries.remove(&m.old);
                }
                for m in &plan {
                    entries.insert(
                        m.probe.id.clone(),
                        entry_at(m.doc, &m.probe.canonical, true),
                    );
                }
            }),
        };
        if let Err(e) = published {
            log::warn!("agent journal: could not follow an external rename: {e}");
            return 0;
        }
        for m in &plan {
            // A tab that follows the file binds the same pair: a no-op.
            let to = m.probe.id.clone();
            let (doc, minted) = (m.doc, false);
            moves.insert(m.old.clone(), super::LastMove { to, doc, minted });
        }
        plan.len()
    }
}
