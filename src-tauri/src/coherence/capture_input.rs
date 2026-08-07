//! Resolving a capture's declared inputs to concrete objects and revisions.
//!
//! Split out of `capture.rs` for size. Input resolution is the step that decides
//! WHAT a capture depends on; the parent owns the append that records it.
//!
//! @coordinates-with capture.rs — the module this was split from
//! @module coherence/capture_input

use super::adopt::adopt_from_disk;
use super::capture::CaptureInputSpec;

use super::state::WorkspaceKernel;
use super::types::InputRef;

/// Resolve one input spec per the plan contract: caller revision wins but
/// is validated (object membership — reject on mismatch, no fallback);
/// otherwise current head; uncaptured input files are adopted.
pub(super) fn resolve_input(
    kernel: &mut WorkspaceKernel,
    spec: &CaptureInputSpec,
) -> Result<InputRef, String> {
    let object = match (spec.object_id, &spec.path) {
        (Some(id), _) => id,
        (None, Some(path)) => match kernel.index().registry_state()?.object_at.get(path) {
            Some(id) => *id,
            None => adopt_from_disk(kernel, path)?.0,
        },
        (None, None) => return Err("input needs a path or an object_id".into()),
    };
    let revision = match &spec.revision {
        Some(rev) => {
            if kernel.index().content_hash_of(&object, rev)?.is_none() {
                return Err(format!(
                    "input revision {} does not belong to object {}",
                    rev.as_str(),
                    object.0
                ));
            }
            rev.clone()
        }
        None => {
            let heads = kernel.index().heads(&object)?;
            match heads.as_slice() {
                [only] => only.clone(),
                [] => return Err(format!("input object {} has no revisions", object.0)),
                _ => {
                    return Err(format!(
                        "input object {} is diverged (multiple heads) — pass an explicit revision",
                        object.0
                    ))
                }
            }
        }
    };
    Ok(InputRef {
        object,
        revision,
        role: spec.role,
        // Carry the spec's kind (defaults to dependency); Extract-Canon is the
        // only path that sets conformance today (Phase 4).
        kind: spec.kind,
    })
}
