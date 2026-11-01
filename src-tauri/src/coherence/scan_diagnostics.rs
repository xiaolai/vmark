//! Diagnostic emission, ignored-path helpers and deletion marking split from `scan.rs` for the
//! file-size gate. Diagnostics are deduped against the ledger by (code,
//! path) so repeated scans never spam append-only history (spec §5.6);
//! ignored-dir paths are the walk's blind spots.

use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::index_row::RegistryState;
use super::scan::{ScanReport, IGNORED_DIRS, IGNORED_REL_PREFIXES};
use super::state::WorkspaceKernel;
use super::types::{Envelope, ObjectId, TypedBody};

/// A workspace-relative path that lives UNDER an ignored directory — the
/// walk never descends there, so its files can't be verified present or
/// absent. Only a NON-LEAF segment counts: a real object whose
/// own filename is `node_modules` is not under an ignored dir,
/// and both `/` and `\` are honored so a Windows-style path isn't misread
/// as a single unignored segment.
pub(super) fn path_under_ignored_dir(path: &str) -> bool {
    let mut segments: Vec<&str> = path.split(['/', '\\']).collect();
    segments.pop(); // drop the leaf — the file itself, not a parent dir
    segments.into_iter().any(|seg| IGNORED_DIRS.contains(&seg))
        || path_at_or_under_ignored_prefix(&path.replace('\\', "/"))
}

/// A workspace-relative path that IS an ignored path-prefix directory or
/// lives under one (`IGNORED_REL_PREFIXES`). Anchored at the workspace root,
/// so `docs/.claude/worktrees/a.md` is real content. `rel` must already use `/`:
/// the walk's paths do, on every OS, and a backslash left in one is part of a
/// real name. The boundary is a full segment: `.claude/worktrees.md` is a
/// sibling file, not a match.
pub(super) fn path_at_or_under_ignored_prefix(rel: &str) -> bool {
    IGNORED_REL_PREFIXES.iter().any(|prefix| {
        rel == *prefix
            || rel
                .strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// Deletions: registered objects whose paths are gone — only when the walk saw
/// everything. A path under an ignored directory (node_modules,
/// .Trash, …) is never walked, so its absence from `present` is not evidence
/// of deletion — skip it.
pub(super) fn mark_absent(
    kernel: &mut WorkspaceKernel,
    registry: &RegistryState,
    present: &HashSet<&str>,
    seen_at: &HashMap<ObjectId, String>,
    report: &mut ScanReport,
) -> Result<(), String> {
    if !report.complete {
        return Ok(());
    }
    for (object, path) in registry.path_of.iter() {
        if path_under_ignored_dir(path) {
            continue;
        }
        if !present.contains(path.as_str()) && !seen_at.contains_key(object) {
            kernel.index_mut().set_absent(object, true)?;
            report.absent_marked += 1;
        }
    }
    Ok(())
}

/// Diagnostics are deduped against the ledger by (code, path) so repeated
/// scans do not spam append-only history (spec §5.6).
pub(super) fn existing_diagnostic_keys(entries: &[Envelope]) -> HashSet<(String, String)> {
    let mut keys = HashSet::new();
    for entry in entries {
        if let Ok(TypedBody::Diagnostic(d)) = entry.typed() {
            keys.insert((d.code, d.path.unwrap_or_default()));
        }
    }
    keys
}

pub(super) fn emit_diagnostic(
    kernel: &mut WorkspaceKernel,
    existing: &mut HashSet<(String, String)>,
    report: &mut ScanReport,
    code: &str,
    message: &str,
    path: &str,
) -> Result<(), String> {
    report.diagnostics += 1;
    if !existing.insert((code.to_string(), path.to_string())) || !kernel.is_initialized() {
        return Ok(());
    }
    let env = Envelope::create(
        "diagnostic",
        kernel.writer(),
        json!({ "code": code, "message": message, "path": path }),
    );
    kernel.append_and_apply(&env)
}
