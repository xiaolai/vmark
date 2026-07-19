//! Git reconciliation (ADR-C4 services tier). R18 / Gate G2: scan-time
//! before/after classification — the file watcher ignores `.git`, so
//! this is deliberately observation-based, not event-based. Order
//! matters (G2 findings): MERGE_HEAD first (mid-conflict merges are
//! invisible to sha observables), then new-sha mutation detection, then
//! known-sha navigation; the sha set is not monotonic (`reset --hard`
//! shrinks it). Navigation NEVER mints revisions; mutations are captured
//! as git-attributed transformations by `scan.rs`.

use std::collections::HashSet;
use std::path::Path;

use crate::ai_provider::build_command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitObservation {
    /// `rev-parse --abbrev-ref HEAD` — "HEAD" when detached.
    pub head_ref: String,
    pub head_sha: Option<String>,
    /// `rev-list --all` — every commit currently reachable from any ref.
    pub known_shas: HashSet<String>,
    /// MERGE_HEAD present — a merge is mid-flight.
    pub merge_in_progress: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitClass {
    NotGit,
    NoOp,
    /// HEAD moved to previously known content — record, never mint (R18).
    /// `op` preserves the detected operation type (spec §5.4.2).
    Navigation {
        op: String,
        from: String,
        to: String,
    },
    /// New commits minted with HEAD on one (revert, merge commit): real
    /// new content, captured as git-attributed transformations.
    Mutation {
        new_shas: Vec<String>,
    },
    /// Mid-conflict merge: defer reconciliation until it concludes.
    MergeInProgress,
    /// Observation gap (repo appeared/disappeared, unreadable HEAD):
    /// fall back to observed-external handling — honest, never guessed.
    ExternalUnknown,
}

fn git_output(root: &Path, args: &[&str]) -> Option<String> {
    let out = build_command("git", args).current_dir(root).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
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

pub fn observe(root: &Path) -> Option<GitObservation> {
    if !root.join(".git").exists() {
        return None; // covers dirs and worktree .git files alike
    }
    let head_ref = git_output(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let head_sha = git_output(root, &["rev-parse", "HEAD"]);
    // Include HEAD explicitly: a detached HEAD on an unreachable commit
    // (checked out from a dropped branch) is not in `--all`, and omitting
    // it makes git navigation look like an external revision (audit C7).
    let known_shas: HashSet<String> = git_output(root, &["rev-list", "--all", "HEAD"])
        .map(|s| s.lines().map(str::to_string).collect())
        .unwrap_or_default();
    let merge_in_progress =
        git_output(root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_some();
    Some(GitObservation {
        head_ref,
        head_sha,
        known_shas,
        merge_in_progress,
    })
}

/// Classify what happened between two observations (G2 matrix).
pub fn classify(before: Option<&GitObservation>, after: Option<&GitObservation>) -> GitClass {
    // A merge in progress must defer regardless of whether we have a
    // prior observation — the FIRST scan of a workspace already mid-merge
    // must not reconcile conflict-state files (audit C5).
    if after.is_some_and(|a| a.merge_in_progress) {
        return GitClass::MergeInProgress;
    }
    let (b, a) = match (before, after) {
        (None, None) => return GitClass::NotGit,
        (Some(_), None) | (None, Some(_)) => return GitClass::ExternalUnknown,
        (Some(b), Some(a)) => (b, a),
    };
    let Some(head) = &a.head_sha else {
        return GitClass::ExternalUnknown;
    };
    let new_shas: Vec<String> = {
        let mut v: Vec<String> = a.known_shas.difference(&b.known_shas).cloned().collect();
        v.sort();
        v
    };
    if new_shas.contains(head) {
        return GitClass::Mutation { new_shas };
    }
    if b.known_shas.contains(head) {
        let same_position = b.head_sha.as_deref() == Some(head) && b.head_ref == a.head_ref;
        if same_position {
            return GitClass::NoOp;
        }
        // Operation fidelity (spec §5.4.2): detached HEAD, branch switch,
        // or a same-ref jump (checkout/reset — indistinguishable from
        // scan-time observables, recorded as checkout).
        let op = if a.head_ref == "HEAD" {
            "detach"
        } else if a.head_ref != b.head_ref {
            "branch-switch"
        } else {
            "checkout"
        };
        return GitClass::Navigation {
            op: op.to_string(),
            from: b.head_sha.clone().unwrap_or_default(),
            to: head.clone(),
        };
    }
    if b.head_sha.as_deref() == Some(head) && b.head_ref == a.head_ref {
        // Head untouched; shas may have appeared elsewhere (fetch).
        return GitClass::NoOp;
    }
    GitClass::ExternalUnknown
}

#[cfg(test)]
#[path = "gitops.test.rs"]
mod tests;
