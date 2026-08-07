//! The `git` command surface used by coherence: running the binary, and the
//! small queries built directly on it.
//!
//! Split from `gitops.rs` for the file-size gate, on a real seam — this file
//! talks to the subprocess, `gitops.rs` reasons about what it said.
//!
//! @coordinates-with gitops.rs — the module this was split from
//! @module coherence/gitops_cmd

use std::path::Path;

use crate::ai_provider::build_command;

/// The three outcomes of running `git`, which `git_output`'s `Option` collapses
/// into one.
///
/// The distinction is load-bearing: "git is not installed" is a fact about the
/// MACHINE and must degrade to non-git behaviour, whereas "git ran and refused"
/// is a fact about the REPOSITORY and must stop a scan. Collapsing them made a
/// machine without git unable to reconcile any git-backed workspace at all —
/// every scan classified as unreliable and stopped, so ordinary edits were
/// never captured.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRun {
    /// The binary could not be spawned — not installed, or not on PATH.
    Unavailable,
    /// git ran and exited non-zero.
    Failed,
    Ok(String),
}

pub fn git_run(root: &Path, args: &[&str]) -> GitRun {
    let Ok(out) = build_command("git", args).current_dir(root).output() else {
        return GitRun::Unavailable;
    };
    if !out.status.success() {
        return GitRun::Failed;
    }
    GitRun::Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub(super) fn git_output(root: &Path, args: &[&str]) -> Option<String> {
    match git_run(root, args) {
        GitRun::Ok(s) => Some(s),
        GitRun::Unavailable | GitRun::Failed => None,
    }
}

/// Observe the git state of a workspace. `None` = not a git repo (or git
/// unavailable) — callers then treat every change as an ordinary external
/// edit, which is the safe fallback.
/// D3.1 (spec §6 rev 2): the exact current branch name, or None for
/// detached HEAD / not a git repository. No globs, no normalization.
pub fn current_branch(root: &Path) -> Option<String> {
    let name = git_output(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if name == "HEAD" {
        return None; // detached
    }
    Some(name)
}

/// D3.3 (WI-3.7): the current HEAD commit's SHA iff it is a completed
/// merge (two or more parents). `None` for a linear head, detached HEAD,
/// or a non-git dir. Mid-conflict merges are handled upstream (the scan
/// defers on MERGE_HEAD), so reaching here means the merge concluded.
pub fn merge_commit_sha(root: &Path) -> Option<String> {
    let line = git_output(root, &["rev-list", "--parents", "-n", "1", "HEAD"])?;
    // "<commit> <parent1> <parent2> ..." — 3+ tokens ⇒ a merge.
    let mut tokens = line.split_whitespace();
    let sha = tokens.next()?.to_string();
    if tokens.count() >= 2 {
        Some(sha)
    } else {
        None
    }
}

/// The files a completed merge changed relative to **both** parents — the union
/// of `git diff --name-only <sha>^1 <sha>` and `<sha>^2 <sha>`, so a change from
/// either side is caught (Phase 5, SP4/WI-5.1). For a rename git reports the new
/// path; for a delete, the removed path. Empty for a non-merge, a bad SHA, or a
/// non-git dir. Deterministic (sorted, deduped) so the audit mapping is total.
pub fn merge_changed_files(root: &Path, sha: &str) -> Vec<String> {
    let mut set = std::collections::BTreeSet::new();
    for parent in [format!("{sha}^1"), format!("{sha}^2")] {
        if let Some(out) = git_output(root, &["diff", "--name-only", &parent, sha]) {
            for line in out.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    set.insert(trimmed.to_string());
                }
            }
        }
    }
    set.into_iter().collect()
}
