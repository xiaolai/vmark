//! Export one document's journal to `vmark-journal/<document-uuid>` with Git
//! plumbing only (`hash-object`, `mktree`, `commit-tree`, `update-ref`), so
//! the repository's working tree, index and `HEAD` are never touched.
//!
//! Order of a run: snapshot the journal once; read the branch (refusing a
//! symbolic ref, a checked-out branch, a tip VMark did not record, or an
//! unrelated history); plan the commits after the last covered revision;
//! write the objects; record the new tip as pending; move the ref by
//! compare-and-swap; confirm the record. A swap that loses to another writer
//! is a conflict unless that writer produced the identical commit (exports
//! are deterministic for the same journal, file name and ancestry).
//!
//! @module agent_journal/git_export/export

use std::collections::HashMap;

use super::branch::resume_point;
use super::error::ExportError;
use super::git::Git;
use super::names::{branch_name, branch_ref, committer, git_date, tree_file_name, Ident};
use super::plan::{chain_of, plan, ChainLink, Covers, PlannedCommit};
use super::refs::{ensure_not_checked_out, first_parent_log, is_shallow, read_tip, tip_file_name};
use super::state::{Expected, ExportState};
use crate::agent_journal::ids::{BlobHash, DocId};
use crate::agent_journal::writer::Writer;

/// What one export did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub branch: String,
    /// The branch tip after the export (`None`: nothing to export).
    pub head: Option<String>,
    pub commits_created: usize,
    pub synthetic_created: usize,
}

/// Export `doc` (known to the window as `doc_key`) into `git`'s repository.
pub fn export_document(
    w: &Writer,
    doc: DocId,
    doc_key: &str,
    git: &Git,
    state: &ExportState,
) -> Result<ExportReport, ExportError> {
    export_with(w, doc, doc_key, git, state, &mut || {})
}

/// [`export_document`] running `before_swap` after the objects are written
/// and before the ref moves (tests use it to race another writer).
pub fn export_with(
    w: &Writer,
    doc: DocId,
    doc_key: &str,
    git: &Git,
    state: &ExportState,
    before_swap: &mut dyn FnMut(),
) -> Result<ExportReport, ExportError> {
    let refname = branch_ref(doc);
    let mut report = ExportReport {
        branch: branch_name(doc),
        head: None,
        commits_created: 0,
        synthetic_created: 0,
    };
    let chain = chain_of(&w.snapshot().state, doc)?;
    if chain.is_empty() {
        return Ok(report);
    }
    let base = read_base(git, state, doc, doc_key, &refname, &chain)?;
    let commits = plan(doc, &chain, base.start)?;
    report.head = base.tip.clone();
    if commits.is_empty() {
        if let Some(t) = &base.tip {
            confirm(state, doc, &base.repository, t)?;
        }
        return Ok(report);
    }
    let new = write_commits(w, git, &base, &commits, &mut report)?;
    before_swap();
    publish(git, state, doc, &refname, &base, &new)?;
    report.head = Some(new);
    Ok(report)
}

/// Where the export continues: the repository's key, the branch tip, the
/// first chain index the branch does not cover, and the tree's file name.
struct Base {
    repository: String,
    tip: Option<String>,
    start: usize,
    file: String,
}

/// Read and vet the branch: not checked out, a tip VMark recorded (or, with
/// no record, a full history to adopt), a history covering a prefix.
fn read_base(
    git: &Git,
    state: &ExportState,
    doc: DocId,
    doc_key: &str,
    refname: &str,
    chain: &[ChainLink],
) -> Result<Base, ExportError> {
    let repository = git.common_dir()?;
    ensure_not_checked_out(git, refname)?;
    let tip = read_tip(git, refname)?;
    let Some(t) = &tip else {
        let file = tree_file_name(doc_key);
        return Ok(Base {
            repository,
            tip,
            start: 0,
            file,
        });
    };
    match state.expected(doc, &repository)? {
        Some(e) if !e.accepts(t) => {
            return Err(ExportError::Conflict(format!(
                "{refname} points at {t}, not the commit VMark exported"
            )));
        }
        Some(_) => {}
        // Adopting a branch VMark has no record of trusts its history,
        // which a shallow boundary truncates.
        None if is_shallow(git)? => {
            return Err(ExportError::UnrelatedBranch(
                "a shallow clone cannot prove the branch's history".to_owned(),
            ));
        }
        None => {}
    }
    let ids: Vec<_> = chain.iter().map(|l| l.id).collect();
    let start = resume_point(&first_parent_log(git, t)?, doc, &ids)?;
    let file = tip_file_name(git, t)?;
    Ok(Base {
        repository,
        tip,
        start,
        file,
    })
}

/// Write every planned commit on top of the tip; the new tip's id.
fn write_commits(
    w: &Writer,
    git: &Git,
    base: &Base,
    commits: &[PlannedCommit],
    report: &mut ExportReport,
) -> Result<String, ExportError> {
    let mut blobs = HashMap::new();
    let mut parent = base.tip.clone();
    for c in commits {
        let id = write_commit(w, git, &mut blobs, &base.file, c, parent.as_deref())?;
        report.commits_created += 1;
        if matches!(c.covers, Covers::Collected { .. }) {
            report.synthetic_created += 1;
        }
        parent = Some(id);
    }
    parent.ok_or_else(|| ExportError::Journal("no commit was written".to_owned()))
}

/// Record `new` as pending, move the ref by compare-and-swap, confirm.
fn publish(
    git: &Git,
    state: &ExportState,
    doc: DocId,
    refname: &str,
    base: &Base,
    new: &str,
) -> Result<(), ExportError> {
    let pending = Expected {
        commit: base.tip.clone().unwrap_or_default(),
        pending: Some(new.to_owned()),
    };
    state.store(doc, &base.repository, pending)?;
    // A checkout since the first check would leave that worktree's index
    // behind its moved HEAD. Git offers no ref update that refuses a
    // checked-out branch, so this check sits immediately before the swap:
    // the window is narrowed, not closed. A refusal here leaves only a
    // pending record naming an unswapped commit, which the next run accepts.
    ensure_not_checked_out(git, refname)?;
    swap(git, refname, new, base.tip.as_deref())?;
    confirm(state, doc, &base.repository, new)
}

fn confirm(
    state: &ExportState,
    doc: DocId,
    repository: &str,
    tip: &str,
) -> Result<(), ExportError> {
    state.store(
        doc,
        repository,
        Expected {
            commit: tip.to_owned(),
            pending: None,
        },
    )
}

/// Compare-and-swap the ref. Losing to a writer that produced the same
/// commit is success; losing to anything else is a conflict.
fn swap(git: &Git, refname: &str, new: &str, old: Option<&str>) -> Result<(), ExportError> {
    let msg = "vmark: export edit history";
    let swapped = git.run(
        &[
            "update-ref",
            "--no-deref",
            "-m",
            msg,
            refname,
            new,
            old.unwrap_or(""),
        ],
        None,
        &[],
    );
    let Err(err) = swapped else { return Ok(()) };
    match read_tip(git, refname)? {
        Some(now) if now == new => Ok(()),
        now if now.as_deref() != old => Err(ExportError::Conflict(format!(
            "{refname} moved during the export"
        ))),
        _ => Err(err),
    }
}

fn blob_text(w: &Writer, hash: &BlobHash) -> Result<String, ExportError> {
    if *hash == BlobHash::of_text("") {
        return Ok(String::new());
    }
    w.blob_text(hash).map_err(|e| {
        ExportError::Journal(format!(
            "a text is no longer in the journal ({e}); the journal changed during the export, try again"
        ))
    })
}

/// The blob id of `hash`'s text, written once per export.
fn blob_id(
    w: &Writer,
    git: &Git,
    blobs: &mut HashMap<BlobHash, String>,
    hash: &BlobHash,
) -> Result<String, ExportError> {
    if let Some(b) = blobs.get(hash) {
        return Ok(b.clone());
    }
    let text = blob_text(w, hash)?;
    let b = git.run(
        &["hash-object", "-w", "--stdin"],
        Some(text.as_bytes()),
        &[],
    )?;
    blobs.insert(hash.clone(), b.clone());
    Ok(b)
}

/// The author and committer identity and dates `commit-tree` reads.
fn commit_env<'a>(
    author: &'a Ident,
    committer: &'a Ident,
    date: &'a str,
) -> [(&'static str, &'a str); 6] {
    [
        ("GIT_AUTHOR_NAME", author.name.as_str()),
        ("GIT_AUTHOR_EMAIL", author.email.as_str()),
        ("GIT_AUTHOR_DATE", date),
        ("GIT_COMMITTER_NAME", committer.name.as_str()),
        ("GIT_COMMITTER_EMAIL", committer.email.as_str()),
        ("GIT_COMMITTER_DATE", date),
    ]
}

fn write_commit(
    w: &Writer,
    git: &Git,
    blobs: &mut HashMap<BlobHash, String>,
    file: &str,
    c: &PlannedCommit,
    parent: Option<&str>,
) -> Result<String, ExportError> {
    let blob = blob_id(w, git, blobs, &c.text)?;
    let entry = format!("100644 blob {blob}\t{file}\0");
    let tree = git.run(&["mktree", "-z"], Some(entry.as_bytes()), &[])?;
    let (date, vmark) = (git_date(c.at), committer());
    let env = commit_env(&c.author, &vmark, &date);
    let mut args = vec!["commit-tree", "--no-gpg-sign", tree.as_str()];
    if let Some(p) = parent {
        args.extend(["-p", p]);
    }
    args.extend(["-F", "-"]);
    git.run(&args, Some(c.message.as_bytes()), &env)
}
