//! Revision DAG and context-relative selection resolution (pure — ADR-C4).
//! Spec §9.2/§9.3: per-object hash+parents DAG, head sets (never a global
//! "latest"), strict-ancestor queries, and `resolve(C, U)`.

use std::collections::{HashMap, HashSet, VecDeque};

use super::types::{ObjectId, RevisionId};

/// Per-object revision graph. Built from ledger `outputs[].parents`
/// (append-only inputs ⇒ the graph only ever gains nodes).
#[derive(Debug, Default, Clone)]
pub struct RevisionDag {
    /// object → revision → parents
    parents: HashMap<ObjectId, HashMap<RevisionId, Vec<RevisionId>>>,
    /// object → revisions that appear as somebody's parent
    non_heads: HashMap<ObjectId, HashSet<RevisionId>>,
}

impl RevisionDag {
    /// Record one output revision. Idempotent — replaying the same ledger
    /// entry changes nothing (spec §5.1 replays are harmless).
    pub fn record_output(
        &mut self,
        object: ObjectId,
        revision: RevisionId,
        parents: Vec<RevisionId>,
    ) {
        let nh = self.non_heads.entry(object).or_default();
        for p in &parents {
            nh.insert(p.clone());
        }
        self.parents
            .entry(object)
            .or_default()
            .entry(revision)
            .or_insert(parents);
    }

    pub fn contains(&self, object: &ObjectId, revision: &RevisionId) -> bool {
        self.parents
            .get(object)
            .is_some_and(|m| m.contains_key(revision))
    }

    pub fn revision_count(&self, object: &ObjectId) -> usize {
        self.parents.get(object).map_or(0, |m| m.len())
    }

    /// Total revisions across all objects — the materialized size of the dag.
    /// Used to prove a preview loads a BOUNDED sub-dag, not the whole corpus
    /// (WI-3.4 perf).
    pub fn total_revisions(&self) -> usize {
        self.parents.values().map(|m| m.len()).sum()
    }

    /// Head set: revisions no other revision lists as a parent. Sorted for
    /// deterministic output. Empty ⇔ object unknown.
    /// Parent links of one revision (WI-3.1 ancestry walk). `None` for
    /// unknown revisions; a root revision returns an empty vector.
    pub fn parents_of(&self, object: &ObjectId, revision: &RevisionId) -> Option<Vec<RevisionId>> {
        self.parents.get(object)?.get(revision).cloned()
    }

    pub fn heads(&self, object: &ObjectId) -> Vec<RevisionId> {
        let Some(revs) = self.parents.get(object) else {
            return Vec::new();
        };
        let empty = HashSet::new();
        let non_heads = self.non_heads.get(object).unwrap_or(&empty);
        let mut heads: Vec<RevisionId> = revs
            .keys()
            .filter(|r| !non_heads.contains(*r))
            .cloned()
            .collect();
        heads.sort();
        heads
    }

    /// Strict ancestry: BFS from `descendant` along parent links. A
    /// revision is not its own ancestor. Bounded by the object's revision
    /// count (spec §9.3).
    pub fn is_ancestor(
        &self,
        object: &ObjectId,
        ancestor: &RevisionId,
        descendant: &RevisionId,
    ) -> bool {
        if ancestor == descendant {
            return false;
        }
        let Some(revs) = self.parents.get(object) else {
            return false;
        };
        let mut seen: HashSet<&RevisionId> = HashSet::new();
        let mut queue: VecDeque<&RevisionId> = VecDeque::new();
        queue.push_back(descendant);
        while let Some(current) = queue.pop_front() {
            let Some(parents) = revs.get(current) else {
                continue;
            };
            for p in parents {
                if p == ancestor {
                    return true;
                }
                if seen.insert(p) {
                    queue.push_back(p);
                }
            }
        }
        false
    }
}

/// A context's selection for one object, single-inheritance already
/// flattened by the caller (spec §6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    Live,
    Pinned(RevisionId),
}

/// Flattened context view: absent objects are implicitly live (spec §6).
#[derive(Debug, Clone, Default)]
pub struct ContextView {
    selections: HashMap<ObjectId, Selection>,
}

impl ContextView {
    pub fn all_live() -> Self {
        Self::default()
    }

    pub fn pin(&mut self, object: ObjectId, revision: RevisionId) {
        self.selections.insert(object, Selection::Pinned(revision));
    }

    pub fn selection(&self, object: &ObjectId) -> &Selection {
        self.selections.get(object).unwrap_or(&Selection::Live)
    }
}

/// Outcome of `resolve(C, U)` (spec §9.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolved {
    Single(RevisionId),
    /// Live selection over a multi-head object — first-class, surfaced,
    /// never guessed (R10).
    DivergedHeads,
    /// The context pins a revision this object never had — surfaced, never
    /// guessed (Codex D4#4: no silent fallback).
    UnknownPin,
    /// Object has no revisions at all (never captured or history empty).
    Absent,
}

pub fn resolve(ctx: &ContextView, dag: &RevisionDag, object: &ObjectId) -> Resolved {
    match ctx.selection(object) {
        Selection::Pinned(r) => {
            if dag.contains(object, r) {
                Resolved::Single(r.clone())
            } else {
                Resolved::UnknownPin
            }
        }
        Selection::Live => {
            let heads = dag.heads(object);
            match heads.len() {
                0 => Resolved::Absent,
                1 => Resolved::Single(heads.into_iter().next().expect("len checked")),
                _ => Resolved::DivergedHeads,
            }
        }
    }
}

#[cfg(test)]
#[path = "dag.test.rs"]
mod tests;
