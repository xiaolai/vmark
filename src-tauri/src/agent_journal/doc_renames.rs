//! The files an external rename event names, for `doc_registry` to match
//! against recorded file identities: each existing file, and the files under
//! each existing directory, walked with a bound.
//!
//! Key decisions:
//!   - Everything that touches the filesystem in bulk (the walk, entry
//!     spellings, file identities) runs in `rename_probes`, before the registry
//!     takes its lock; under the lock only the matched mappings are checked,
//!     and each matched probe is re-probed (`still_current`) just before
//!     its move, so a path replaced meanwhile binds nothing.
//!   - Every move is planned against one unmodified view of the index
//!     (`plan_moves`) and the registry publishes the plan as one change, so
//!     a cycle (two files swapped) follows every file in any probe order:
//!     no move consumes the mapping another move is about to read. Two
//!     probes claiming one mapping, or one key for two mappings, are
//!     ambiguous and move nothing.
//!   - A path is walked once however many roots reach it, so overlapping
//!     parent and child events neither repeat files nor spend the budget
//!     twice.
//!
//! @module agent_journal/doc_renames

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::agent_journal::doc_index::DocIndex;
use crate::agent_journal::doc_key::{file_id, probe_entry, FileId};
use crate::agent_journal::ids::DocId;

/// Most files a renamed directory is searched for indexed documents.
const MAX_RENAME_WALK: usize = 10_000;

/// The files a rename event's paths name: each existing file, and the files
/// under each existing directory (bounded), each once.
pub(crate) fn rename_candidates(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = paths
        .iter()
        .filter(|p| seen.insert((*p).clone()))
        .cloned()
        .collect();
    stack.reverse();
    let mut budget = MAX_RENAME_WALK;
    while let Some(p) = stack.pop() {
        if budget == 0 {
            log::warn!(
                "agent journal: a renamed directory is too large to follow every document in it"
            );
            break;
        }
        budget -= 1;
        match std::fs::symlink_metadata(&p) {
            Ok(m) if m.is_dir() => {
                if let Ok(read) = std::fs::read_dir(&p) {
                    stack.extend(
                        read.flatten()
                            .map(|e| e.path())
                            .filter(|c| seen.insert(c.clone())),
                    );
                }
            }
            Ok(m) if m.is_file() || m.file_type().is_symlink() => out.push(p),
            _ => {}
        }
    }
    out
}

/// A renamed file as the registry matches it.
pub(crate) struct RenameProbe {
    pub canonical: PathBuf,
    /// Its path key.
    pub id: String,
    pub fid: FileId,
}

impl RenameProbe {
    /// The probed path is still spelled as its entry, under the same key,
    /// and still holds the probed file. Checked under the registry lock just before a move:
    /// the probe was taken without it, and the path may have been replaced
    /// (another file, or a link elsewhere) since.
    pub(crate) fn still_current(&self) -> bool {
        probe_entry(&self.canonical).is_some_and(|(path, id)| {
            path == self.canonical && id == self.id && file_id(&path) == Some(self.fid)
        })
    }
}

/// Every candidate with a file identity, probed without any lock held.
pub(crate) fn rename_probes(paths: &[PathBuf]) -> Vec<RenameProbe> {
    rename_candidates(paths)
        .into_iter()
        .filter_map(|file| {
            let (canonical, id) = probe_entry(&file)?;
            let fid = file_id(&canonical)?;
            Some(RenameProbe { canonical, id, fid })
        })
        .collect()
}

/// The keys mapped to each recorded file identity, in one pass.
fn keys_by_file_id(index: &DocIndex) -> HashMap<FileId, Vec<String>> {
    let mut by = HashMap::<FileId, Vec<String>>::new();
    for (key, entry) in index.entries() {
        if let Some(fid) = entry.file_id {
            by.entry(fid).or_default().push(key.clone());
        }
    }
    by
}

/// The one mapping among `keys` that recorded `fid` and whose path no
/// longer holds it, checked against the index as it is now.
fn moved_from(index: &DocIndex, keys: &[String], fid: FileId) -> Option<(String, DocId)> {
    let mut matches = keys.iter().filter_map(|key| {
        let e = index.get(key)?;
        (e.file_id == Some(fid) && file_id(Path::new(&e.path)) != Some(fid))
            .then(|| (key.clone(), e.doc))
    });
    match (matches.next(), matches.next()) {
        (Some(found), None) => Some(found),
        _ => None,
    }
}

/// One mapping an external rename moves: `old`'s document to the probe's key.
pub(crate) struct PlannedMove {
    pub old: String,
    pub doc: DocId,
    pub probe: RenameProbe,
}

/// Every move `probes` support, judged against `index` as it stands, with
/// ambiguous claims dropped. A probe whose key already records its file, or
/// whose path changed since it was probed (`still_current`), plans nothing.
pub(crate) fn plan_moves(index: &DocIndex, probes: Vec<RenameProbe>) -> Vec<PlannedMove> {
    let by_fid = keys_by_file_id(index);
    let mut plan: Vec<PlannedMove> = Vec::new();
    for probe in probes {
        if index
            .get(&probe.id)
            .is_some_and(|e| e.file_id == Some(probe.fid))
        {
            continue;
        }
        let keys = by_fid.get(&probe.fid).map_or(&[][..], Vec::as_slice);
        let Some((old, doc)) = moved_from(index, keys, probe.fid) else {
            continue;
        };
        let duplicate = plan.iter().any(|m| m.old == old && m.probe.id == probe.id);
        if !duplicate && probe.still_current() {
            plan.push(PlannedMove { old, doc, probe });
        }
    }
    let count = |pick: &dyn Fn(&PlannedMove) -> &str| {
        let mut n = HashMap::<String, usize>::new();
        for m in &plan {
            *n.entry(pick(m).to_owned()).or_default() += 1;
        }
        n
    };
    let (olds, keys) = (count(&|m| &m.old), count(&|m| &m.probe.id));
    plan.retain(|m| olds[&m.old] == 1 && keys[&m.probe.id] == 1);
    plan
}
