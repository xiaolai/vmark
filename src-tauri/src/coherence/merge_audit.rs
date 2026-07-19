//! Semantic-merge auditor mapping (Phase 5, WI-5.1; ADR-C7). Composes the SP4
//! chain into one function: a completed merge's touched edges, derived
//! deterministically from the merge SHA. No new algorithm — it wires the git
//! diff, the registry inversion, and the index's `edges_affected_by` (ADR-P4).
//!
//! `merge SHA ─(git)▶ changed files ─(registry)▶ objects ─(index)▶ edges`
//!
//! The auditor then runs the **existing** checker over these edges (WI-5.2,
//! reusing the Phase-1 `check_sweep` governance) and surfaces contradictions for
//! human resolution (WI-5.3) — it **never** auto-reconciles (§14).

use std::collections::HashMap;
use std::path::Path;

use super::gitops;
use super::index::CoherenceIndex;
use super::project::OriginEdge;
use super::types::ObjectId;

/// The edges a completed merge at `root`'s HEAD touched. Empty when HEAD is not
/// a merge. An unregistered changed file is skipped (a full impl emits a
/// diagnostic — the mapping stays total by never silently corrupting, only
/// omitting the unmapped). Deterministic + deduped (via `edges_affected_by`).
pub fn merge_affected_edges(
    index: &CoherenceIndex,
    root: &Path,
) -> Result<Vec<OriginEdge>, String> {
    let Some(sha) = gitops::merge_commit_sha(root) else {
        return Ok(Vec::new());
    };
    let files = gitops::merge_changed_files(root, &sha);
    if files.is_empty() {
        return Ok(Vec::new());
    }

    // Invert the registry (object→path) into path→object.
    let registry = index.registry_state()?;
    let by_path: HashMap<&str, ObjectId> = registry
        .path_of
        .iter()
        .map(|(obj, path)| (path.as_str(), *obj))
        .collect();

    let objects: Vec<ObjectId> = files
        .iter()
        .filter_map(|f| by_path.get(f.as_str()).copied())
        .collect();

    index.edges_affected_by(&objects)
}

#[cfg(test)]
#[path = "merge_audit.test.rs"]
mod tests;
