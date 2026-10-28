//! Collector planning (pure): which revisions a collection tombstones and
//! which cap warnings it raises, from the projection and the pin set.
//!
//! Per document the caps are a revision count and the UTF-8 bytes of the
//! blobs it keeps (each retained revision's postimage and both
//! before-texts, plus the blobs its unresolved transactions and pending
//! observations root); the global cap is the bytes of every kept blob,
//! each counted once however many documents share it. Victims are the
//! oldest unpinned revisions first, taken only while a cap is exceeded. A
//! cap still exceeded once nothing unpinned is left is a `pinnedOverCap`
//! warning that counts what pins it (`blobRoots`: each blob no retained
//! revision keeps, once); a cap at 80% or more is `nearCap`.
//!
//! @module agent_journal/gc_plan

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::pins::PinSet;
use crate::agent_journal::projection::{Projection, RevisionMeta, TxnStatus};

pub use crate::agent_journal::gc_policy::{GcLimit, GcPolicy, GcWarning, GcWarningKind};

#[derive(Debug, Default)]
pub struct Plan {
    /// In journal order.
    pub victims: Vec<RevisionId>,
    pub warnings: Vec<GcWarning>,
}

/// Reference-counted unique blob bytes.
struct Usage<'a> {
    counts: HashMap<BlobHash, usize>,
    bytes: u64,
    size: &'a dyn Fn(&BlobHash) -> u64,
}

impl<'a> Usage<'a> {
    fn new(size: &'a dyn Fn(&BlobHash) -> u64) -> Self {
        Self {
            counts: HashMap::new(),
            bytes: 0,
            size,
        }
    }
    fn add(&mut self, h: &BlobHash) {
        let c = self.counts.entry(h.clone()).or_insert(0);
        if *c == 0 {
            self.bytes += (self.size)(h);
        }
        *c += 1;
    }
    fn remove(&mut self, h: &BlobHash) {
        if let Some(c) = self.counts.get_mut(h) {
            *c -= 1;
            if *c == 0 {
                self.bytes -= (self.size)(h);
                self.counts.remove(h);
            }
        }
    }
}

/// The blobs a retained revision keeps: its postimage and both before-texts.
fn revision_blobs(p: &Projection, m: &RevisionMeta) -> Vec<BlobHash> {
    let mut v = vec![m.postimage.clone()];
    v.extend(m.preimage.clone());
    v.extend(p.postimage_of(m.parent));
    v
}

/// Blobs of `doc` rooted by something other than a revision.
fn blob_roots(p: &Projection, doc: Option<DocId>) -> Vec<BlobHash> {
    let mine = |d: DocId| doc.is_none_or(|x| x == d);
    let mut v: Vec<BlobHash> = p
        .txns
        .values()
        .filter(|t| mine(t.doc) && matches!(t.status, TxnStatus::Prepared | TxnStatus::Uncommitted))
        .map(|t| t.preimage.clone())
        .collect();
    for o in p
        .observations
        .values()
        .filter(|o| mine(o.doc) && o.linearized.is_none())
    {
        v.push(o.postimage.clone());
        v.push(o.observed_preimage.clone());
    }
    v
}

/// Retained revisions of `doc` (all documents for `None`), oldest first.
fn retained(p: &Projection, doc: Option<DocId>) -> Vec<&RevisionMeta> {
    let mut v: Vec<&RevisionMeta> = p
        .revisions
        .values()
        .filter(|m| !m.collected && doc.is_none_or(|d| m.doc == d))
        .collect();
    v.sort_by_key(|m| m.seq);
    v
}

struct Scope<'a> {
    p: &'a Projection,
    doc: Option<DocId>,
    revs: Vec<&'a RevisionMeta>,
    usage: Usage<'a>,
    /// Blobs rooted by something other than a revision, each once.
    roots: BTreeSet<BlobHash>,
}

/// Plan one collection. `exempt` revisions are never victims (counted as
/// `schemaV1` in a warning: a v1 record cannot be rewritten as a tombstone).
/// Victims are chosen first (per document, then globally); every warning
/// then describes usage with the whole victim set removed.
pub fn plan(
    p: &Projection,
    pins: &PinSet,
    policy: &GcPolicy,
    size: &dyn Fn(&BlobHash) -> u64,
    exempt: &BTreeSet<RevisionId>,
) -> Plan {
    let mut out = Plan::default();
    let mut victims: BTreeSet<RevisionId> = BTreeSet::new();
    let collectable =
        |m: &RevisionMeta| !pins.revisions.contains_key(&m.id) && !exempt.contains(&m.id);
    let doc_caps = [
        (GcLimit::Revisions, policy.max_revisions as u64),
        (GcLimit::DocBytes, policy.max_doc_bytes),
    ];
    for &doc in p.docs.keys() {
        let mut s = scope(p, Some(doc), size, &[], &victims);
        select(p, &mut s, &doc_caps, &collectable, &mut victims);
    }
    let extra: Vec<BlobHash> = pins.blobs.iter().cloned().collect();
    let total_caps = [(GcLimit::TotalBytes, policy.max_total_bytes)];
    let mut total = scope(p, None, size, &extra, &victims);
    select(p, &mut total, &total_caps, &collectable, &mut victims);
    for &doc in p.docs.keys() {
        let s = scope(p, Some(doc), size, &[], &victims);
        warn(&s, &doc_caps, pins, exempt, &mut out.warnings);
    }
    warn(&total, &total_caps, pins, exempt, &mut out.warnings);
    let mut ordered: Vec<&RevisionMeta> = victims.iter().map(|v| &p.revisions[v]).collect();
    ordered.sort_by_key(|m| m.seq);
    out.victims = ordered.into_iter().map(|m| m.id).collect();
    out
}

/// The usage of `doc` (every document for `None`) with `victims` gone.
fn scope<'a>(
    p: &'a Projection,
    doc: Option<DocId>,
    size: &'a dyn Fn(&BlobHash) -> u64,
    extra: &[BlobHash],
    victims: &BTreeSet<RevisionId>,
) -> Scope<'a> {
    let mut revs = retained(p, doc);
    revs.retain(|m| !victims.contains(&m.id));
    let mut usage = Usage::new(size);
    for m in &revs {
        revision_blobs(p, m).iter().for_each(|h| usage.add(h));
    }
    let roots: BTreeSet<BlobHash> = blob_roots(p, doc)
        .into_iter()
        .chain(extra.iter().cloned())
        .collect();
    roots.iter().for_each(|h| usage.add(h));
    Scope {
        p,
        doc,
        revs,
        usage,
        roots,
    }
}

fn used(s: &Scope<'_>, limit: GcLimit) -> u64 {
    used_by(s.revs.len(), s.usage.bytes, limit)
}

fn used_by(revisions: usize, bytes: u64, limit: GcLimit) -> u64 {
    match limit {
        GcLimit::Revisions => revisions as u64,
        GcLimit::DocBytes | GcLimit::TotalBytes => bytes,
    }
}

/// Take the oldest collectable revisions while any cap is exceeded. One
/// pass in age order, then one `retain`: linear in the scope's revisions.
fn select(
    p: &Projection,
    s: &mut Scope<'_>,
    caps: &[(GcLimit, u64)],
    collectable: &dyn Fn(&RevisionMeta) -> bool,
    victims: &mut BTreeSet<RevisionId>,
) {
    let over = |left: usize, bytes: u64| caps.iter().any(|&(l, cap)| used_by(left, bytes, l) > cap);
    let mut left = s.revs.len();
    let mut taken: BTreeSet<RevisionId> = BTreeSet::new();
    for m in &s.revs {
        if !over(left, s.usage.bytes) {
            break;
        }
        if !collectable(m) {
            continue;
        }
        revision_blobs(p, m).iter().for_each(|h| s.usage.remove(h));
        victims.insert(m.id);
        taken.insert(m.id);
        left -= 1;
    }
    if !taken.is_empty() {
        s.revs.retain(|m| !taken.contains(&m.id));
    }
}

/// A warning for each cap still exceeded (`pinnedOverCap`) or near.
fn warn(
    s: &Scope<'_>,
    caps: &[(GcLimit, u64)],
    pins: &PinSet,
    exempt: &BTreeSet<RevisionId>,
    warnings: &mut Vec<GcWarning>,
) {
    for &(limit, cap) in caps {
        let used = used(s, limit);
        let kind = if used > cap {
            GcWarningKind::PinnedOverCap
        } else if near_cap(used, cap) {
            GcWarningKind::NearCap
        } else {
            continue;
        };
        warnings.push(GcWarning {
            doc: s.doc,
            kind,
            limit,
            used,
            cap,
            pinned_by: pinned_by(s, pins, exempt),
        });
    }
}

/// `used` is at least 80% of `cap`, exactly (no saturation). A zero cap is
/// never near: usage is over it or there is nothing to warn about.
pub(crate) fn near_cap(used: u64, cap: u64) -> bool {
    cap > 0 && u128::from(used) * 5 >= u128::from(cap) * 4
}

fn pinned_by(
    s: &Scope<'_>,
    pins: &PinSet,
    exempt: &BTreeSet<RevisionId>,
) -> BTreeMap<String, usize> {
    let mut by: BTreeMap<String, usize> = BTreeMap::new();
    for m in &s.revs {
        let reasons = pins.revisions.get(&m.id).into_iter().flatten();
        let names: BTreeSet<&str> = reasons.map(|r| r.name()).collect();
        for n in names {
            *by.entry(n.to_owned()).or_default() += 1;
        }
        if exempt.contains(&m.id) {
            *by.entry("schemaV1".to_owned()).or_default() += 1;
        }
    }
    let kept: BTreeSet<BlobHash> = s.revs.iter().flat_map(|m| revision_blobs(s.p, m)).collect();
    let roots = s.roots.difference(&kept).count();
    if roots > 0 {
        by.insert("blobRoots".to_owned(), roots);
    }
    by
}

/// Every blob a projection still needs: the pin set's (unresolved
/// transactions, pending observations, legacy checkpoints, the queue) and
/// each retained revision's postimage and both before-texts.
pub fn keep_set(p: &Projection, pins: &PinSet) -> BTreeSet<BlobHash> {
    let mut keep = pins.blobs.clone();
    for m in p.revisions.values().filter(|m| !m.collected) {
        keep.extend(revision_blobs(p, m));
    }
    keep
}

#[cfg(test)]
#[path = "gc_plan.test.rs"]
mod tests;
