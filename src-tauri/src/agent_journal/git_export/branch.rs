//! Reading an existing export branch (pure): which journal revisions it
//! already covers, from the `VMark-Document`, `VMark-Revision` and
//! `VMark-Collected` trailers of its first-parent history.
//!
//! The branch is accepted only when, oldest first, it is a run of this
//! document's VMark commits (no merges) that covers exactly a prefix of the
//! journal's linear chain starting at its genesis. Collected revisions keep
//! their ids as tombstones, so the prefix check still holds after the
//! journal's collector ran. Anything else is refused:
//! - our run, then only commits VMark did not write: `EXPORT_CONFLICT`
//!   (someone advanced the branch);
//! - no leading run, another document's commits, a VMark commit after a
//!   foreign one, a merge inside our run, or a run that is not a prefix:
//!   `UNRELATED_BRANCH`.
//!
//! @module agent_journal/git_export/branch

use super::error::ExportError;
use crate::agent_journal::ids::{DocId, RevisionId};

/// Fields of one commit in [`LOG_FORMAT`] output.
const FIELDS: usize = 5;

/// `git log -z --format=…` producing what [`parse_log`] reads: NUL between
/// fields and (through `-z`) between commits. A commit message can hold any
/// byte but NUL, so no trailer value can forge a field or a commit.
pub const LOG_FORMAT: &str = "format:%H%x00%P%x00%(trailers:key=VMark-Document,valueonly,separator=%x2c)%x00%(trailers:key=VMark-Revision,valueonly,separator=%x2c)%x00%(trailers:key=VMark-Collected,valueonly,separator=%x2c)";

/// One first-parent commit of the branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchCommit {
    pub id: String,
    pub parents: usize,
    pub document: Option<String>,
    pub revision: Option<String>,
    pub collected: Option<String>,
}

/// Parse [`LOG_FORMAT`] output (newest first). A field count that is not a
/// whole number of commits is refused rather than guessed at.
pub fn parse_log(raw: &str) -> Result<Vec<BranchCommit>, ExportError> {
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let fields: Vec<&str> = raw.split('\0').collect();
    if !fields.len().is_multiple_of(FIELDS) {
        return Err(ExportError::Git(format!(
            "unreadable git log output: {} fields",
            fields.len()
        )));
    }
    let field = |s: &str| Some(s.trim()).filter(|v| !v.is_empty()).map(str::to_owned);
    Ok(fields
        .as_chunks::<FIELDS>()
        .0
        .iter()
        .map(|f| BranchCommit {
            id: f[0].trim().to_owned(),
            parents: f[1].split_whitespace().count(),
            document: field(f[2]),
            revision: field(f[3]),
            collected: field(f[4]),
        })
        .collect())
}

fn unrelated(why: &str) -> ExportError {
    ExportError::UnrelatedBranch(why.to_owned())
}

/// The index of the first `chain` revision the branch does not cover.
/// `log` is newest first; an empty log resumes at 0.
pub fn resume_point(
    log: &[BranchCommit],
    doc: DocId,
    chain: &[RevisionId],
) -> Result<usize, ExportError> {
    let doc_text = doc.to_string();
    let names_doc = |c: &BranchCommit| c.document.as_deref() == Some(doc_text.as_str());
    let oldest_first: Vec<&BranchCommit> = log.iter().rev().collect();
    let k = oldest_first
        .iter()
        .take_while(|c| names_doc(c) && c.parents <= 1)
        .count();
    if log.is_empty() {
        return Ok(0);
    }
    if k == 0 {
        return Err(unrelated(
            "the branch holds commits VMark did not export for this document",
        ));
    }
    let rest = &oldest_first[k..];
    if rest.iter().any(|c| names_doc(c)) {
        return Err(unrelated("the branch history was rewritten or merged"));
    }
    if let Some(top) = rest.last() {
        return Err(ExportError::Conflict(format!(
            "commit {} was added on top of the export",
            top.id
        )));
    }
    covered_prefix(&oldest_first, chain)
}

fn covered_prefix(ours: &[&BranchCommit], chain: &[RevisionId]) -> Result<usize, ExportError> {
    let not_prefix = || unrelated("the branch is not a prefix of this document's journal");
    let mut pos = 0;
    for c in ours {
        match (&c.revision, &c.collected) {
            (Some(rev), None) => {
                if chain.get(pos).map(ToString::to_string).as_deref() != Some(rev.as_str()) {
                    return Err(not_prefix());
                }
                pos += 1;
            }
            (None, Some(range)) => {
                let (first, last) = range.split_once("..").ok_or_else(not_prefix)?;
                if chain.get(pos).map(ToString::to_string).as_deref() != Some(first) {
                    return Err(not_prefix());
                }
                let end = chain[pos..]
                    .iter()
                    .position(|r| r.to_string() == last)
                    .ok_or_else(not_prefix)?;
                pos += end + 1;
            }
            _ => return Err(not_prefix()),
        }
    }
    Ok(pos)
}
