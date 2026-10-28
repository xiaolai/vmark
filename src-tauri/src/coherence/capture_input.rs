//! Resolving a capture's declared inputs to concrete objects and revisions.
//!
//! Split out of `capture.rs` for size. Input resolution is the step that decides
//! WHAT a capture depends on; the parent owns the append that records it.
//!
//! @coordinates-with capture.rs — the module this was split from
//! @module coherence/capture_input

use super::adopt::{adopt_from_disk, adopt_identified_from_disk};
use super::canonical::canonicalize_text;
use super::capture::CaptureInputSpec;
use super::frontmatter::read_identity;
use super::index_row::RegistryState;
use super::paths::resolve_workspace_rel;
use crate::files::path_identity::file_id;

use super::state::WorkspaceKernel;
use super::types::{Confidence, InputRef, InputRole, ObjectId, RevisionId};

/// What a capture depends on, once its declared inputs are resolved.
pub(super) struct ResolvedInputs {
    pub inputs: Vec<InputRef>,
    pub confidence: Confidence,
    /// An input was dropped because it could only have been stamped: the
    /// input set is known to be incomplete.
    pub declined: bool,
}

/// Resolve every input of a capture whose output is `output`. An input
/// `resolve_input` declined (it would have had to be stamped) is dropped, and
/// an `exact` capture whose input set is therefore known to be incomplete is
/// lowered to `inferred` (WI-LX1.4).
///
/// Inputs are kept by OBJECT and edge kind, after resolution: one naming
/// `output` itself is dropped (an edge from a document to itself is stale the
/// moment it is written, and the caller can only exclude the target by path,
/// so an alias reaches here), and an object named twice under one kind is
/// kept once (see `keep_strongest`). Neither drop loses a dependency, so
/// neither lowers confidence.
pub(super) fn resolve_inputs(
    kernel: &mut WorkspaceKernel,
    specs: &[CaptureInputSpec],
    may_stamp: bool,
    confidence: Confidence,
    output: ObjectId,
) -> Result<ResolvedInputs, String> {
    let mut inputs: Vec<InputRef> = Vec::with_capacity(specs.len());
    let mut dropped = false;
    for spec in specs {
        match resolve_input(kernel, spec, may_stamp)? {
            Some(input) if input.object == output => {}
            Some(input) => keep_strongest(&mut inputs, input),
            None => dropped = true,
        }
    }
    let confidence = if dropped && confidence == Confidence::Exact {
        Confidence::Inferred
    } else {
        confidence
    };
    Ok(ResolvedInputs {
        inputs,
        confidence,
        declined: dropped,
    })
}

/// Add `input` unless its object is already an input of the same kind. A
/// direct spelling replaces an earlier contextual one: contextual edges carry
/// no staleness, so keeping the first would silently drop a dependency.
/// Otherwise the first spelling wins.
fn keep_strongest(inputs: &mut Vec<InputRef>, input: InputRef) {
    match inputs
        .iter_mut()
        .find(|i| i.object == input.object && i.kind == input.kind)
    {
        Some(kept) if kept.role == InputRole::Contextual && input.role == InputRole::Direct => {
            *kept = input;
        }
        Some(_) => {}
        None => inputs.push(input),
    }
}

/// Resolve one input spec per the plan contract: caller revision wins but
/// is validated (object membership — reject on mismatch, no fallback);
/// otherwise current head; uncaptured input files are adopted.
///
/// `may_stamp = false` (capture-on-save OFF, WI-LX1.4): an uncaptured input is
/// adopted only when its file already carries a `vmark:` block. One that would
/// have to be stamped is left alone and reported as `None` — the caller drops
/// it and lowers the capture's confidence.
fn resolve_input(
    kernel: &mut WorkspaceKernel,
    spec: &CaptureInputSpec,
    may_stamp: bool,
) -> Result<Option<InputRef>, String> {
    let Some(object) = resolve_object(kernel, spec, may_stamp)? else {
        return Ok(None);
    };
    let revision = resolve_revision(kernel, &object, spec.revision.as_ref())?;
    Ok(Some(InputRef {
        object,
        revision,
        role: spec.role,
        // Carry the spec's kind (defaults to dependency); Extract-Canon is the
        // only path that sets conformance today (Phase 4).
        kind: spec.kind,
    }))
}

/// The input's object: named outright, registered at its path, or adopted from
/// disk — by stamping only when `may_stamp`, else only if the file already
/// carries its own identity. `None` = it could only have been stamped.
fn resolve_object(
    kernel: &mut WorkspaceKernel,
    spec: &CaptureInputSpec,
    may_stamp: bool,
) -> Result<Option<ObjectId>, String> {
    match (spec.object_id, &spec.path) {
        (Some(id), _) => Ok(Some(id)),
        (None, Some(path)) => {
            let registry = kernel.index().registry_state()?;
            if let Some(id) = registry.object_at.get(path) {
                return Ok(Some(*id));
            }
            if let Some(id) = registered_alias(kernel, &registry, path) {
                return Ok(Some(id));
            }
            if may_stamp {
                return Ok(Some(adopt_from_disk(kernel, path)?.0));
            }
            Ok(adopt_identified_from_disk(kernel, path)?.map(|(id, _)| id))
        }
        (None, None) => Err("input needs a path or an object_id".into()),
    }
}

/// The registered object `rel_path` is another spelling of — a symlink, a
/// hard link, or a case variant on a case-insensitive volume — or `None`.
///
/// The file names an object by its `vmark:` block; it is an ALIAS of that
/// object, not a copy, when the object's registered path resolves to the very
/// same file (volume and file index). Adopting it instead would treat it as a
/// copy: capture-hold the object and refuse, or repoint the registry at the
/// alias. Anything unreadable is left to adoption to report.
fn registered_alias(
    kernel: &WorkspaceKernel,
    registry: &RegistryState,
    rel_path: &str,
) -> Option<ObjectId> {
    let root = kernel.root();
    let abs = resolve_workspace_rel(root, rel_path).ok()?;
    let text = std::fs::read_to_string(&abs).ok()?;
    let object = read_identity(&canonicalize_text(&text))?.id;
    let prior = resolve_workspace_rel(root, registry.path_of.get(&object)?).ok()?;
    let same_file = file_id(&abs)?;
    (file_id(&prior)? == same_file).then_some(object)
}

/// The caller's revision, validated to belong to `object` (reject on mismatch,
/// no fallback); otherwise the object's single current head.
fn resolve_revision(
    kernel: &WorkspaceKernel,
    object: &ObjectId,
    requested: Option<&RevisionId>,
) -> Result<RevisionId, String> {
    if let Some(rev) = requested {
        if kernel.index().content_hash_of(object, rev)?.is_none() {
            return Err(format!(
                "input revision {} does not belong to object {}",
                rev.as_str(),
                object.0
            ));
        }
        return Ok(rev.clone());
    }
    let heads = kernel.index().heads(object)?;
    match heads.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err(format!("input object {} has no revisions", object.0)),
        _ => Err(format!(
            "input object {} is diverged (multiple heads) — pass an explicit revision",
            object.0
        )),
    }
}
