//! Export planning (pure): the document's linear chain read from a journal
//! snapshot, and the commits that represent it on the export branch.
//!
//! Export follows the linear history (`parent → postimage`), the same chain
//! review and revert use. Each retained revision becomes one commit whose
//! file is its postimage. Each maximal run of collected revisions (their
//! texts are gone, their tombstones keep id, actor and time) becomes one
//! synthetic commit whose file is the next retained revision's linear
//! before-text: the parent's postimage, which the collector keeps for every
//! retained revision. A run that reaches the head cannot exist (the head is
//! a collector root), so meeting one is a journal error, not a guess.
//!
//! @module agent_journal/git_export/plan

use std::collections::{BTreeSet, HashSet};

use super::error::ExportError;
use super::names::{actor_label, committer, ident_for, one_line, Ident};
use crate::agent_journal::actor::Actor;
use crate::agent_journal::ids::{BlobHash, DocId, RevisionId};
use crate::agent_journal::projection::{Projection, RevisionKind};
use crate::agent_journal::review::ReviewOp;

/// Byte cap for an untrusted value copied into a trailer.
const MAX_TRAILER_VALUE: usize = 128;

/// One revision of the linear chain, with what export needs from it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainLink {
    pub id: RevisionId,
    pub parent: Option<RevisionId>,
    pub collected: bool,
    /// The linear before-text: the parent's postimage (`""` at genesis).
    pub before: BlobHash,
    pub postimage: BlobHash,
    pub actor: Actor,
    pub kind: RevisionKind,
    pub review_op: ReviewOp,
    /// The MCP tool of a controlled revision.
    pub tool: Option<String>,
    pub at: u64,
}

/// What one exported commit stands for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Covers {
    Revision(RevisionId),
    Collected { first: RevisionId, last: RevisionId },
}

/// A commit to create, oldest first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedCommit {
    /// The blob whose text is the commit's only file.
    pub text: BlobHash,
    pub message: String,
    pub author: Ident,
    pub at: u64,
    pub covers: Covers,
}

/// `doc`'s chain from genesis to head. A missing parent or a cycle fails.
pub fn chain_of(p: &Projection, doc: DocId) -> Result<Vec<ChainLink>, ExportError> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut cursor = p.head(doc);
    while let Some(id) = cursor {
        if !seen.insert(id) {
            return Err(ExportError::Journal(format!(
                "revision chain loops at {id}"
            )));
        }
        let meta = p
            .revisions
            .get(&id)
            .filter(|m| m.doc == doc)
            .ok_or_else(|| ExportError::Journal(format!("revision {id} is missing")))?;
        let before = p
            .postimage_of(meta.parent)
            .ok_or_else(|| ExportError::Journal(format!("parent of {id} is missing")))?;
        out.push(ChainLink {
            id,
            parent: meta.parent,
            collected: meta.collected,
            before,
            postimage: meta.postimage.clone(),
            actor: meta.actor.clone(),
            kind: meta.kind,
            review_op: meta.review_op.clone(),
            tool: p.txns.get(&meta.txn).map(|t| t.tool.clone()),
            at: meta.at,
        });
        cursor = meta.parent;
    }
    out.reverse();
    Ok(out)
}

/// The commits for `chain[start..]`. `start` is the first link the branch
/// does not cover yet; a resume inside a collected run covers its tail.
pub fn plan(
    doc: DocId,
    chain: &[ChainLink],
    start: usize,
) -> Result<Vec<PlannedCommit>, ExportError> {
    let mut out = Vec::new();
    let mut i = start;
    while i < chain.len() {
        if !chain[i].collected {
            out.push(revision_commit(doc, &chain[i]));
            i += 1;
            continue;
        }
        let first = i;
        while i < chain.len() && chain[i].collected {
            i += 1;
        }
        let next = chain
            .get(i)
            .ok_or_else(|| ExportError::Journal("a collected run reaches the head".to_owned()))?;
        out.push(synthetic_commit(doc, &chain[first..i], next));
    }
    Ok(out)
}

fn kind_name(kind: RevisionKind) -> &'static str {
    match kind {
        RevisionKind::Controlled => "controlled",
        RevisionKind::Observed => "observed",
        RevisionKind::Concurrent => "concurrent",
        RevisionKind::Gap => "gap",
        RevisionKind::Tombstone => "tombstone",
    }
}

fn subject(link: &ChainLink, label: &str) -> String {
    match (&link.review_op, link.kind) {
        (ReviewOp::Restore { .. }, _) => format!("Restore an earlier version ({label})"),
        (ReviewOp::HunkRevert { .. }, _) => format!("Revert a change ({label})"),
        (_, RevisionKind::Controlled) => format!("Edit by {label}"),
        (_, RevisionKind::Concurrent) => format!("Concurrent change saved by {label}"),
        (_, RevisionKind::Gap) => "Change made outside VMark".to_owned(),
        _ => format!("Save by {label}"),
    }
}

/// Trailers every revision commit carries.
fn common_trailers(doc: DocId, link: &ChainLink, label: &str) -> Vec<(&'static str, String)> {
    let parent = link
        .parent
        .map_or_else(|| "none".to_owned(), |p| p.to_string());
    vec![
        ("VMark-Document", doc.to_string()),
        ("VMark-Revision", link.id.to_string()),
        ("VMark-Parent", parent),
        ("VMark-Actor", label.to_owned()),
        ("VMark-Kind", kind_name(link.kind).to_owned()),
    ]
}

/// The optional tool, session and client trailers, each one line.
fn agent_trailers(link: &ChainLink) -> Vec<(&'static str, String)> {
    let clean = |v: Option<&str>| v.and_then(|s| one_line(s, MAX_TRAILER_VALUE));
    let mut out = Vec::new();
    if let Some(tool) = clean(link.tool.as_deref()) {
        out.push(("VMark-Tool", tool));
    }
    if let Actor::Mcp {
        session_label,
        display_name,
        ..
    } = &link.actor
    {
        if let Some(s) = clean(session_label.as_deref()) {
            out.push(("VMark-Session", s));
        }
        if let Some(c) = clean(display_name.as_deref()) {
            out.push(("VMark-Client", c));
        }
    }
    out
}

fn revision_commit(doc: DocId, link: &ChainLink) -> PlannedCommit {
    let label = actor_label(&link.actor);
    let mut trailers = common_trailers(doc, link, &label);
    trailers.extend(agent_trailers(link));
    PlannedCommit {
        text: link.postimage.clone(),
        message: message(&subject(link, &label), &trailers),
        author: ident_for(&link.actor),
        at: link.at,
        covers: Covers::Revision(link.id),
    }
}

fn synthetic_commit(doc: DocId, run: &[ChainLink], next: &ChainLink) -> PlannedCommit {
    let (first, last) = (&run[0], &run[run.len() - 1]);
    let actors: BTreeSet<String> = run.iter().map(|l| actor_label(&l.actor)).collect();
    let actors = actors.into_iter().collect::<Vec<_>>().join(", ");
    let trailers = [
        ("VMark-Document", doc.to_string()),
        ("VMark-Collected", format!("{}..{}", first.id, last.id)),
        ("VMark-Actors", actors),
    ];
    let n = run.len();
    let noun = if n == 1 { "revision" } else { "revisions" };
    PlannedCommit {
        text: next.before.clone(),
        message: message(&format!("Collected history ({n} {noun})"), &trailers),
        author: committer(),
        at: last.at,
        covers: Covers::Collected {
            first: first.id,
            last: last.id,
        },
    }
}

fn message(subject: &str, trailers: &[(&str, String)]) -> String {
    let mut m = format!("{subject}\n\n");
    for (k, v) in trailers {
        m.push_str(&format!("{k}: {v}\n"));
    }
    m
}
