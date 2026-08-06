//! Scan reconciliation (WI-1.6, ADR-C4 services tier). Spec §9.4: compare
//! disk state against the index for known objects, synthesize honest
//! history for what happened outside VMark (R9), classify git operations
//! first (R18 — navigation NEVER mints revisions), surface duplicates as
//! diagnostics + capture holds, and mark deleted objects absent —
//! but only when the walk was complete (an incomplete walk must never
//! reconcile deletions it could not verify).

use std::collections::{HashMap, HashSet};

use super::canonical::text_content_hash;
use super::capture::{adopt_from_disk, observed_external_entry, register_if_needed};
use super::frontmatter::read_identity;
use super::gitops::{observe, GitClass};
use super::scan_git::{run_git_phase, GitObserver, GitPhase};
pub use super::scan_report::ScanReport;
use super::state::WorkspaceKernel;
use super::types::{ObjectId, RevisionId};

/// Directory names never scanned (mirrors the watcher's ignore list).
pub(super) const IGNORED_DIRS: [&str; 8] = [
    ".vmark",
    ".git",
    ".obsidian",
    ".svn",
    ".hg",
    "node_modules",
    "__pycache__",
    ".Trash",
];

/// Workspace-relative directory PATHS never scanned. Unlike `IGNORED_DIRS`
/// (bare names, matched at any depth) these are anchored at the workspace
/// root, so the rest of `.claude/` stays ordinary scannable content.
///
/// A git worktree checked out inside the repo is a second checkout of the
/// SAME tracked files, so every doc in it carries its main-checkout twin's
/// `vmark.id`: scanning both emits a `duplicate-id` diagnostic per doc and
/// registers phantom objects at paths that exist on one machine only. The
/// prefix is anchored rather than name-based for the same reason
/// `CACHEDIR.TAG` is exact — no guessing at directories called "worktrees".
pub(super) const IGNORED_REL_PREFIXES: [&str; 1] = [".claude/worktrees"];

/// DoS guards for kernels opened on arbitrary roots (MCP surface): a walk
/// that trips either cap is INCOMPLETE — reported, and deletion
/// reconciliation is skipped.
pub(super) const MAX_SCAN_FILES: usize = 20_000;
pub(super) const MAX_SCAN_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// One reconciliation pass (spec §9.4). Serialized with captures through
/// the per-workspace kernel instance.
pub fn scan_workspace(kernel: &mut WorkspaceKernel) -> Result<ScanReport, String> {
    // R1 (7th-review 6R-1, completed): a scan reconciles git observations against
    // the index and appends observed-external revisions + diagnostics. It read and
    // BUILT those transformations from an unlocked index while each append locked
    // only afterwards — the same stale-sibling TOCTOU as capture. The whole span
    // now runs under the workspace lock.
    scan_workspace_with(kernel, observe)
}

/// `scan_workspace` with the git observation injected. Production always passes
/// `gitops::observe`; only tests substitute.
pub(super) fn scan_workspace_with(
    kernel: &mut WorkspaceKernel,
    observe_git: GitObserver,
) -> Result<ScanReport, String> {
    kernel.with_write_lock(|k| scan_workspace_locked(k, observe_git))
}

fn scan_workspace_locked(
    kernel: &mut WorkspaceKernel,
    observe_git: GitObserver,
) -> Result<ScanReport, String> {
    let mut report = ScanReport {
        complete: true,
        ..Default::default()
    };

    // Multi-writer sync (audit R11): segments written by other writers
    // (git pull, second installation) land mid-session; fold any
    // un-applied entries into the index before reconciling. Cheap count
    // guard; apply_entry is idempotent by entry id.
    let ledger_read = kernel.ledger().read_all()?;
    if ledger_read.entries.len() != kernel.index().applied_count()? {
        for entry in &ledger_read.entries {
            kernel.index_mut().apply_entry(entry)?;
        }
    }

    // Git first (R18): classify before touching content. Two of the three
    // outcomes stop the scan outright — see scan_git.rs.
    let (class, current_git) = match run_git_phase(kernel, &mut report, observe_git)? {
        GitPhase::Stop => return Ok(report),
        GitPhase::Continue { class, observation } => (class, observation),
    };

    let registry = kernel.index().registry_state()?;
    let mut existing_diagnostics = existing_diagnostic_keys(&ledger_read.entries);

    // D3.3 (WI-3.7): record a completed-merge diagnostic (deduped, pull-only).
    super::merge_surface::record_completed_merge(kernel, &mut existing_diagnostics, &mut report)?;

    // Durable quarantine diagnostics (spec §5.6, audit R10), deduped by
    // segment:line so repeated scans never spam history.
    for q in &ledger_read.quarantined {
        let key_path = format!("{}:{}", q.segment, q.line);
        emit_diagnostic(
            kernel,
            &mut existing_diagnostics,
            &mut report,
            "quarantined-entry",
            &format!("malformed ledger line quarantined: {}", q.reason),
            &key_path,
        )?;
    }

    let root = kernel.root().to_path_buf();
    let mut skipped_md: Vec<String> = Vec::new();
    let files = walk_markdown(
        &root,
        &mut report,
        kernel,
        &mut existing_diagnostics,
        &mut skipped_md,
    )?;

    // Path -> present-on-disk map for absence checks: a registered path
    // that still exists is never absent, even when its identity block is
    // missing, unreadable, oversized, or non-UTF-8 (audit R2/A14 — a
    // diagnosed skip is still PRESENT).
    let mut present_paths: HashSet<&str> = files.iter().map(|(rel, _)| rel.as_str()).collect();
    present_paths.extend(skipped_md.iter().map(String::as_str));

    let mut seen_at: HashMap<ObjectId, String> = HashMap::new();
    let mut duplicates: HashSet<ObjectId> = HashSet::new();
    for (rel_path, text) in &files {
        // Identity: from frontmatter, else fall back to the registry by
        // path (a known file whose frontmatter went missing/malformed is
        // still that object — audit A21).
        let identity = match read_identity(text) {
            Some(fi) => Some((fi.id, fi.schema)),
            None => registry
                .object_at
                .get(rel_path)
                .map(|id| (*id, registry.schema_of.get(id).cloned().flatten())),
        };
        let Some((object, schema)) = identity else {
            continue; // not yet an object (spec §9.4)
        };
        if read_identity(text).is_none() && registry.contains(&object) {
            emit_diagnostic(
                kernel,
                &mut existing_diagnostics,
                &mut report,
                "identity-unreadable",
                "known object's frontmatter identity is missing or malformed",
                rel_path,
            )?;
        }
        if let Some(first_path) = seen_at.get(&object) {
            // Duplicate ID: surfaced + capture-held, never auto-resolved (I3).
            emit_diagnostic(
                kernel,
                &mut existing_diagnostics,
                &mut report,
                "duplicate-id",
                &format!(
                    "objects at {first_path} and {rel_path} share vmark.id {}",
                    object.0
                ),
                rel_path,
            )?;
            duplicates.insert(object);
            continue;
        }
        seen_at.insert(object, rel_path.clone());

        if !registry.contains(&object) {
            // Moved in from elsewhere: adopt (spec §9.4).
            adopt_from_disk(kernel, rel_path)?;
            report.adopted += 1;
            continue;
        }
        kernel.index_mut().set_absent(&object, false)?;
        if registry.path_of.get(&object).map(String::as_str) != Some(rel_path.as_str()) {
            register_if_needed(kernel, object, rel_path, schema.as_deref())?;
        }

        let disk_hash = text_content_hash(text);
        let heads = kernel.index().heads(&object)?;
        let at_head = {
            let mut found = false;
            for h in &heads {
                if kernel.index().content_hash_of(&object, h)? == Some(disk_hash.clone()) {
                    found = true;
                    break;
                }
            }
            found
        };
        if at_head {
            kernel.index_mut().clear_disk_lag(&object)?;
            continue; // unchanged
        }
        // Live-buffer lag: the disk holds exactly the pre-apply content of
        // a buffer capture — expected, not an external edit.
        if kernel.index().disk_lag_contains(&object, &disk_hash)? {
            continue;
        }
        // Git navigation restores KNOWN revisions without minting (R18);
        // everything else — including content matching an OLD revision
        // (A → B → A) — mints a new revision with the current heads as
        // parents (spec §2.3; audit R5).
        if matches!(class, GitClass::Navigation { .. })
            && kernel
                .index()
                .revision_by_content(&object, &disk_hash)?
                .is_some()
        {
            continue;
        }
        kernel.index_mut().clear_disk_lag(&object)?;
        let revision = RevisionId::compute(&disk_hash, &heads);
        kernel.snapshots().put_text(text)?;
        let env = if matches!(class, GitClass::Mutation { .. }) {
            report.git_mutations += 1;
            super::adopt::git_mutation_entry(kernel, object, &revision, &disk_hash, heads)
        } else {
            report.external_edits += 1;
            observed_external_entry(kernel, object, &revision, &disk_hash, heads)
        };
        kernel.append_and_apply(&env)?;
    }

    // Capture holds track the CURRENT duplicate state (spec §2.1): held
    // while duplicated, released once the duplicate set is resolved.
    for object in &duplicates {
        kernel.index_mut().set_held(object, true)?;
    }
    for object in registry.path_of.keys() {
        if !duplicates.contains(object) {
            kernel.index_mut().set_held(object, false)?;
        }
    }

    // Deletions: registered objects whose paths are gone — only when the
    // walk saw everything (audit R9). A path under an ignored directory
    // (node_modules, .Trash, …) is never walked, so its absence from
    // `present_paths` is not evidence of deletion — skip it (audit C8).
    if report.complete {
        for (object, path) in registry.path_of.iter() {
            if path_under_ignored_dir(path) {
                continue;
            }
            if !present_paths.contains(path.as_str()) && !seen_at.contains_key(object) {
                kernel.index_mut().set_absent(object, true)?;
                report.absent_marked += 1;
            }
        }
    }

    kernel.last_git = current_git;
    Ok(report)
}

pub(super) use super::scan_diagnostics::{
    emit_diagnostic, existing_diagnostic_keys, path_at_or_under_ignored_prefix,
    path_under_ignored_dir,
};
pub(super) use super::scan_walk::walk_markdown;

#[cfg(test)]
#[path = "scan.test.rs"]
mod tests;
