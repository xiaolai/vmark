//! Scan reconciliation (WI-1.6, ADR-C4 services tier). Spec §9.4: compare
//! disk state against the index for known objects, synthesize honest
//! history for what happened outside VMark (R9), classify git operations
//! first (R18 — navigation NEVER mints revisions), surface duplicates and
//! unreadables as diagnostics, and mark deleted objects absent.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde_json::json;

use super::canonical::text_content_hash;
use super::capture::{adopt_from_disk, observed_external_entry, register_if_needed};
use super::frontmatter::read_identity;
use super::gitops::{classify, observe, GitClass};
use super::state::WorkspaceKernel;
use super::types::{
    Agent, AgentType, Confidence, Envelope, Intent, ObjectId, OutputRef, RevisionId,
    Transformation, TypedBody,
};

/// Directory names never scanned (mirrors the watcher's ignore list).
const IGNORED_DIRS: [&str; 8] = [
    ".vmark",
    ".git",
    ".obsidian",
    ".svn",
    ".hg",
    "node_modules",
    "__pycache__",
    ".Trash",
];

#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub struct ScanReport {
    pub navigations: usize,
    pub git_mutations: usize,
    pub external_edits: usize,
    pub adopted: usize,
    pub absent_marked: usize,
    pub diagnostics: usize,
    pub merge_deferred: bool,
}

/// One reconciliation pass (spec §9.4). Serialized with captures through
/// the per-workspace kernel instance.
pub fn scan_workspace(kernel: &mut WorkspaceKernel) -> Result<ScanReport, String> {
    let mut report = ScanReport::default();

    // Git first (R18): classify before touching content.
    let current_git = observe(kernel.root());
    let class = classify(kernel.last_git.as_ref(), current_git.as_ref());
    if class == GitClass::MergeInProgress {
        // Defer: reconcile once the merge concludes.
        kernel.last_git = current_git;
        report.merge_deferred = true;
        return Ok(report);
    }
    if let GitClass::Navigation { from, to } = &class {
        if kernel.is_initialized() {
            let env = Envelope::create(
                "navigation",
                kernel.writer(),
                json!({ "git": { "op": "checkout", "from": from, "to": to } }),
            );
            kernel.append_and_apply(&env)?;
            report.navigations += 1;
        }
    }

    let registry = kernel.index().registry_state()?;
    let existing_diagnostics = existing_diagnostic_keys(kernel)?;
    let root = kernel.root().to_path_buf();
    let files = walk_markdown(&root, &mut report, kernel, &existing_diagnostics)?;

    let mut seen_objects: HashSet<ObjectId> = HashSet::new();
    let mut seen_at: HashMap<ObjectId, String> = HashMap::new();
    for (rel_path, text) in &files {
        let Some(identity) = read_identity(text) else {
            continue; // not yet an object (spec §9.4)
        };
        if let Some(first_path) = seen_at.get(&identity.id) {
            // Duplicate ID: surfaced, never auto-resolved (I3).
            emit_diagnostic(
                kernel,
                &existing_diagnostics,
                &mut report,
                "duplicate-id",
                &format!(
                    "objects at {first_path} and {rel_path} share vmark.id {}",
                    identity.id.0
                ),
                rel_path,
            )?;
            continue;
        }
        seen_at.insert(identity.id, rel_path.clone());
        seen_objects.insert(identity.id);

        if !registry.contains(&identity.id) {
            // Moved in from elsewhere: adopt (spec §9.4).
            adopt_from_disk(kernel, rel_path)?;
            report.adopted += 1;
            continue;
        }
        kernel.index_mut().set_absent(&identity.id, false)?;
        if registry.path_of.get(&identity.id).map(String::as_str) != Some(rel_path.as_str()) {
            register_if_needed(kernel, identity.id, rel_path, identity.schema.as_deref())?;
        }

        let disk_hash = text_content_hash(text);
        if kernel
            .index()
            .revision_by_content(&identity.id, &disk_hash)?
            .is_some()
        {
            continue; // known content: unchanged, or git navigation (no minting)
        }
        // New content: attribute it (spec §9.4 rows).
        let parents = kernel.index().heads(&identity.id)?;
        let revision = RevisionId::compute(&disk_hash, &parents);
        kernel.snapshots().put_text(text)?;
        let env = if matches!(class, GitClass::Mutation { .. }) {
            report.git_mutations += 1;
            git_mutation_entry(kernel, identity.id, &revision, &disk_hash, parents)
        } else {
            report.external_edits += 1;
            observed_external_entry(kernel, identity.id, &revision, &disk_hash, parents)
        };
        kernel.append_and_apply(&env)?;
    }

    // Deletions: registered objects whose files are gone (spec §9.4).
    for object in registry.path_of.keys() {
        if !seen_objects.contains(object) {
            kernel.index_mut().set_absent(object, true)?;
            report.absent_marked += 1;
        }
    }

    kernel.last_git = current_git;
    Ok(report)
}

fn git_mutation_entry(
    kernel: &WorkspaceKernel,
    object: ObjectId,
    revision: &RevisionId,
    content_hash: &super::types::ContentHash,
    parents: Vec<RevisionId>,
) -> Envelope {
    let t = Transformation {
        inputs: vec![],
        outputs: vec![OutputRef {
            object,
            revision: revision.clone(),
            content_hash: content_hash.clone(),
            parents,
        }],
        agent: Agent {
            kind: AgentType::Git,
            id: Some("merge-or-revert".into()),
        },
        intent: Intent {
            kind: "git-mutation".into(),
            summary: "content minted by a git operation".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Unknown,
    };
    Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(&t).expect("serializable"),
    )
}

/// Diagnostics are deduped against the ledger by (code, path) so repeated
/// scans do not spam append-only history (spec §5.6).
fn existing_diagnostic_keys(kernel: &WorkspaceKernel) -> Result<HashSet<(String, String)>, String> {
    let mut keys = HashSet::new();
    for entry in kernel.ledger().read_all()?.entries {
        if let Ok(TypedBody::Diagnostic(d)) = entry.typed() {
            keys.insert((d.code, d.path.unwrap_or_default()));
        }
    }
    Ok(keys)
}

fn emit_diagnostic(
    kernel: &mut WorkspaceKernel,
    existing: &HashSet<(String, String)>,
    report: &mut ScanReport,
    code: &str,
    message: &str,
    path: &str,
) -> Result<(), String> {
    report.diagnostics += 1;
    if existing.contains(&(code.to_string(), path.to_string())) || !kernel.is_initialized() {
        return Ok(());
    }
    let env = Envelope::create(
        "diagnostic",
        kernel.writer(),
        json!({ "code": code, "message": message, "path": path }),
    );
    kernel.append_and_apply(&env)
}

/// Recursive markdown walk: skip ignored dirs, never follow symlinks
/// (diagnostic), surface unreadable/non-UTF-8 files (diagnostic).
fn walk_markdown(
    root: &Path,
    report: &mut ScanReport,
    kernel: &mut WorkspaceKernel,
    existing: &HashSet<(String, String)>,
) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            let Ok(meta) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                emit_diagnostic(
                    kernel,
                    existing,
                    report,
                    "symlink-skipped",
                    "symlinks are never followed",
                    &rel,
                )?;
                continue;
            }
            if meta.is_dir() {
                if !IGNORED_DIRS.contains(&name.as_str()) {
                    stack.push(path);
                }
                continue;
            }
            if path.extension().is_none_or(|e| e != "md") {
                continue;
            }
            match std::fs::read(&path) {
                Ok(bytes) => match String::from_utf8(bytes) {
                    Ok(text) => out.push((rel, text)),
                    Err(_) => emit_diagnostic(
                        kernel,
                        existing,
                        report,
                        "invalid-utf8",
                        "expected UTF-8 text",
                        &rel,
                    )?,
                },
                Err(e) => emit_diagnostic(
                    kernel,
                    existing,
                    report,
                    "unreadable",
                    &format!("read failed: {e}"),
                    &rel,
                )?,
            }
        }
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
#[path = "scan.test.rs"]
mod tests;
