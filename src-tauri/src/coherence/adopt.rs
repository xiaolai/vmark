//! Object adoption, observed-external synthesis, and registry
//! maintenance (WI-1.6, ADR-C4 services tier). Split from `capture.rs`
//! for the file-size gate; `capture.rs` re-exports these, so callers
//! import from `capture` unchanged.

use serde_json::json;

use super::canonical::text_content_hash;
use super::frontmatter::{assign_identity, read_identity};
use super::state::WorkspaceKernel;
use super::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, Intent, ObjectId, OutputRef, RevisionId,
    Transformation,
};
use crate::atomic_replace::atomic_replace;

/// Adopt an on-disk file as an object (spec §9.4): register it and record
/// an observed-external root transformation from its current content.
pub fn adopt_from_disk(
    kernel: &mut WorkspaceKernel,
    rel_path: &str,
) -> Result<(ObjectId, RevisionId), String> {
    // R1 (7th-review 6R-1): read-heads → build → append atomic under the lock.
    kernel.with_write_lock(|kernel| adopt_from_disk_locked(kernel, rel_path))
}

fn adopt_from_disk_locked(
    kernel: &mut WorkspaceKernel,
    rel_path: &str,
) -> Result<(ObjectId, RevisionId), String> {
    kernel.ensure_initialized()?;
    let abs = super::paths::resolve_workspace_rel(kernel.root(), rel_path)?;
    let bytes =
        std::fs::read(&abs).map_err(|e| format!("input file unreadable ({rel_path}): {e}"))?;
    let text = String::from_utf8(bytes)
        .map_err(|_| format!("input file is not UTF-8 text ({rel_path})"))?;
    let text = super::canonical::canonicalize_text(&text);
    let (content, identity) = match read_identity(&text) {
        Some(fi) => (text, fi),
        None => {
            let (content, fi) = assign_identity(&text, None);
            let parent = abs
                .parent()
                .ok_or_else(|| format!("input path has no parent: {rel_path}"))?
                .to_path_buf();
            atomic_replace(&abs, &parent, content.as_bytes())
                .map_err(|e| format!("identity rewrite failed: {e:?}"))?;
            (content, fi)
        }
    };
    register_if_needed(kernel, identity.id, rel_path, identity.schema.as_deref())?;
    let content_hash = text_content_hash(&content);
    if let Some(existing) = kernel
        .index()
        .revision_by_content(&identity.id, &content_hash)?
    {
        return Ok((identity.id, existing));
    }
    let parents = kernel.index().heads(&identity.id)?;
    let revision = RevisionId::compute(&content_hash, &parents);
    kernel.snapshots().put_text(&content)?;
    let env = observed_external_entry(kernel, identity.id, &revision, &content_hash, parents);
    kernel.append_and_apply(&env)?;
    Ok((identity.id, revision))
}

/// Build an observed-external transformation (R9: honest empty inputs,
/// confidence unknown). Shared by adoption and scan reconciliation.
pub fn observed_external_entry(
    kernel: &WorkspaceKernel,
    object: ObjectId,
    revision: &RevisionId,
    content_hash: &ContentHash,
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
            kind: AgentType::External,
            id: None,
        },
        intent: Intent {
            kind: "observed-external-edit".into(),
            summary: "content changed outside VMark".into(),
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

/// Append an `object-registered` entry when the object is new, moved, or
/// its schema changed (spec §5.4.6).
pub fn register_if_needed(
    kernel: &mut WorkspaceKernel,
    object: ObjectId,
    path: &str,
    schema: Option<&str>,
) -> Result<(), String> {
    // R1 (7th-review 6R-1): registry read + append atomic. Nested inside a wrapped
    // capture/adopt this is a no-op re-entry (the lock is already held).
    kernel.with_write_lock(|kernel| {
        let registry = kernel.index().registry_state()?;
        register_if_needed_locked(kernel, &registry, object, path, schema)
    })
}

/// `register_if_needed` for a caller that ALREADY holds a registry snapshot.
///
/// The scan calls this once per file, and the only thing the registry is used
/// for is two `get`s. Re-reading it per file made the scan O(files × registry):
/// `registry_state` is `SELECT * FROM registry` with a UUID and a timestamp
/// parsed per row, so a 300-file workspace parsed ~90,000 rows to answer 300
/// two-key lookups. That was ~99% of a breakdown refresh.
///
/// Safe to pass a pre-walk snapshot: the scan visits each object at most once
/// (duplicates `continue` before reaching here), so no earlier iteration of the
/// same walk can have moved the row this call is about. Other objects being
/// adopted mid-walk do not affect this object's two lookups.
pub fn register_if_needed_with(
    kernel: &mut WorkspaceKernel,
    registry: &super::index_row::RegistryState,
    object: ObjectId,
    path: &str,
    schema: Option<&str>,
) -> Result<(), String> {
    kernel
        .with_write_lock(|kernel| register_if_needed_locked(kernel, registry, object, path, schema))
}

fn register_if_needed_locked(
    kernel: &mut WorkspaceKernel,
    registry: &super::index_row::RegistryState,
    object: ObjectId,
    path: &str,
    schema: Option<&str>,
) -> Result<(), String> {
    let known_path = registry.path_of.get(&object);
    let known_schema = registry.schema_of.get(&object);
    let unchanged = known_path.map(String::as_str) == Some(path)
        && known_schema.map(|s| s.as_deref()) == Some(schema);
    if unchanged {
        return Ok(());
    }
    let env = Envelope::create(
        "object-registered",
        kernel.writer(),
        json!({ "object": object, "path": path, "schema": schema }),
    );
    kernel.append_and_apply(&env)
}

/// Git-attributed mutation entry (revert/merge minted new content —
/// spec §9.4). Lives beside the other entry builders.
pub(super) fn git_mutation_entry(
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
