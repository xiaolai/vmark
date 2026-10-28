//! What the repository says about the export branch, read without moving
//! anything: its tip (refusing a symbolic ref), whether a worktree has it
//! checked out, whether the clone is shallow, its first-parent log and the
//! one file name its tip holds.
//! A failed read is an error, never "the branch is absent".
//!
//! @module agent_journal/git_export/refs

use super::branch::{parse_log, BranchCommit, LOG_FORMAT};
use super::error::ExportError;
use super::git::Git;
use super::names::usable_file_name;

/// The branch tip, `None` when the ref does not exist. A symbolic ref is
/// refused, also a dangling one `for-each-ref` does not list.
pub fn read_tip(git: &Git, refname: &str) -> Result<Option<String>, ExportError> {
    match git.status(&["symbolic-ref", "-q", refname])? {
        Some(0) => {
            return Err(ExportError::UnrelatedBranch(format!(
                "{refname} is a symbolic reference"
            )))
        }
        Some(1) => {}
        other => {
            return Err(ExportError::Git(format!(
                "git symbolic-ref {refname} exited with {other:?}"
            )))
        }
    }
    let out = git.run(
        &[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)%00%(symref)",
            refname,
        ],
        None,
        &[],
    )?;
    for line in out.lines() {
        let mut f = line.split('\0');
        if f.next() != Some(refname) {
            continue;
        }
        let oid = f.next().unwrap_or("").to_owned();
        if !f.next().unwrap_or("").is_empty() {
            return Err(ExportError::UnrelatedBranch(format!(
                "{refname} is a symbolic reference"
            )));
        }
        if oid.is_empty() {
            return Err(ExportError::Git(format!("{refname} has no object id")));
        }
        return Ok(Some(oid));
    }
    Ok(None)
}

/// Refuse when any worktree has `refname` checked out.
pub fn ensure_not_checked_out(git: &Git, refname: &str) -> Result<(), ExportError> {
    let raw = git.run_raw(&["worktree", "list", "--porcelain", "-z"], None)?;
    let wanted = format!("branch {refname}");
    let text = String::from_utf8_lossy(&raw);
    if text.split('\0').any(|field| field == wanted) {
        return Err(ExportError::BranchCheckedOut(refname.to_owned()));
    }
    Ok(())
}

/// The first-parent history from `tip`, newest first.
pub fn first_parent_log(git: &Git, tip: &str) -> Result<Vec<BranchCommit>, ExportError> {
    let format = format!("--format={LOG_FORMAT}");
    let raw = git.run_raw(
        &[
            "log",
            "-z",
            "--encoding=UTF-8",
            "--first-parent",
            &format,
            tip,
            "--",
        ],
        None,
    )?;
    parse_log(&String::from_utf8_lossy(&raw))
}

/// True in a shallow clone, where parent lists stop at the boundary.
pub fn is_shallow(git: &Git) -> Result<bool, ExportError> {
    Ok(git.run(&["rev-parse", "--is-shallow-repository"], None, &[])? == "true")
}

/// The single regular file in `tip`'s tree; anything else is not an export.
pub fn tip_file_name(git: &Git, tip: &str) -> Result<String, ExportError> {
    let raw = git.run_raw(&["ls-tree", "-z", tip], None)?;
    let text = String::from_utf8(raw).map_err(|_| {
        ExportError::UnrelatedBranch("the branch tree has a non-UTF-8 name".to_owned())
    })?;
    let entries: Vec<&str> = text.split('\0').filter(|e| !e.is_empty()).collect();
    let not_ours =
        || ExportError::UnrelatedBranch("the branch tree is not a single exported file".to_owned());
    let [entry] = entries.as_slice() else {
        return Err(not_ours());
    };
    let (meta, name) = entry.split_once('\t').ok_or_else(not_ours)?;
    if !meta.starts_with("100644 blob ") {
        return Err(not_ours());
    }
    usable_file_name(name).ok_or_else(not_ours)
}
