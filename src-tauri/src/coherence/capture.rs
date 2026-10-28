//! Capture (ADR-C4 services tier) — the single write-side entry
//! point of the coherence layer. Implements the plan's capture IPC
//! contract: the caller passes the EXACT content it wrote (never a disk
//! re-read), the kernel assigns identity on first capture (rewriting the
//! file atomically — hash unchanged by §3.3), snapshots, resolves and
//! VALIDATES input revisions (no silent fallback), and appends the
//! transformation. Uncaptured input files are adopted on the fly so first
//! generations still record complete input sets (spec §9.4). With
//! capture-on-save OFF (`capture_policy.rs`, WI-LX1.4) nothing is created,
//! adopted-by-stamping or rewritten; see `capture_with_policy`.

use uuid::Uuid;

use super::canonical::mask_and_hash_canonical;
use super::capture_input::resolve_inputs;
use super::capture_output::{output_identity, record_disk_lag};
use super::capture_policy::CapturePolicy;
use super::state::WorkspaceKernel;
use super::types::{
    Agent, Confidence, Envelope, InputRole, Intent, ObjectId, OutputRef, RevisionId, Transformation,
};

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CaptureInputSpec {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub object_id: Option<ObjectId>,
    #[serde(default)]
    pub revision: Option<RevisionId>,
    pub role: InputRole,
    /// Origin-edge kind (Phase 2/4, spec §13.6). Optional — defaults to
    /// `dependency` (the only kind ordinary capture records; conformance edges
    /// are minted by the Extract-Canon operator).
    #[serde(default)]
    pub kind: super::edge_kind::OriginEdgeKind,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CaptureRequest {
    /// Workspace-relative output file path.
    pub path: String,
    /// The exact content the caller wrote (plan contract, Codex D3#1).
    pub content: String,
    pub inputs: Vec<CaptureInputSpec>,
    pub agent: Agent,
    pub intent: Intent,
    pub confidence: Confidence,
    /// False for live-buffer captures (AI applies before any save): the
    /// ledger records the revision but the file on disk is left alone;
    /// identity reaches the disk with the next real save. Defaults true.
    #[serde(default = "default_rewrite")]
    pub rewrite_identity: bool,
    /// Spec §5.1: minted once per logical operation by the CALLER and
    /// carried through retries; absent ⇒ the kernel mints one.
    #[serde(default)]
    pub idem: Option<uuid::Uuid>,
}

fn default_rewrite() -> bool {
    true
}

/// Caps on the request fields that drive the ledger line's serialized size
/// (8th-review 8R-9). Checked before any side effect, so a capture that could
/// never be appended fails cleanly instead of leaving a rewritten file, a
/// registration entry and staged CAS content behind. A real capture is far under
/// both; these are fail-closed backstops, not working limits.
const MAX_CAPTURE_INPUTS: usize = 512;
const MAX_CAPTURE_INTENT_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
pub struct CaptureReceipt {
    pub object: ObjectId,
    pub revision: RevisionId,
    /// Absent for a no-op capture (content identical to the current head).
    pub entry_id: Option<Uuid>,
    /// Set when the kernel rewrote the file to assign identity — the
    /// caller must refresh its buffer with this content.
    pub content_with_identity: Option<String>,
}

/// Capture one write (spec §5.4.1) under the `Adopt` policy. Test-only: every
/// production path goes through `capture_with_policy`, which carries the user's
/// capture-on-save setting; this is the setting-ON shorthand the suites use.
#[cfg(test)]
pub fn capture(
    kernel: &mut WorkspaceKernel,
    req: CaptureRequest,
) -> Result<CaptureReceipt, String> {
    let receipt =
        kernel.with_write_lock(|kernel| capture_locked(kernel, req, CapturePolicy::Adopt))?;
    receipt.ok_or_else(|| "capture declined under the adopt policy".to_string())
}

/// Ordering per the plan contract: content is already on disk; snapshot →
/// ledger append → index apply. Runs under the workspace lock (R1, 7th-review
/// 6R-1): the whole read-heads → build-transformation → append is atomic, so a
/// concurrent commit that moved this object's head can't leave us appending a
/// stale-parent sibling.
pub(super) fn capture_locked(
    kernel: &mut WorkspaceKernel,
    req: CaptureRequest,
    policy: CapturePolicy,
) -> Result<Option<CaptureReceipt>, String> {
    preflight(kernel, &req)?;
    // Canonical form up front, and ONCE (spec §3.1): CRLF content
    // from external clients parses and hashes identically to LF, any identity
    // rewrite writes canonical bytes, and every step below — the policy gate,
    // the identity read, the hash, the snapshot — works on this one copy.
    let req = CaptureRequest {
        content: super::canonical::canonicalize_text(&req.content),
        ..req
    };
    // Policy gate BEFORE the first side effect (WI-LX1.4). Re-checked under the
    // lock; `TrackedOnly` also declines a document the ledger does not track.
    if !policy.admits(kernel) || !super::capture_policy::admits_output(kernel, &req, policy)? {
        return Ok(None);
    }
    kernel.ensure_initialized()?;
    // `content` is the canonical request content, or that content with an
    // identity block joined in at line boundaries — canonical either way.
    let (content, identity, rewritten) = output_identity(kernel, &req, policy)?;

    // Duplicate-ID capture hold (spec §2.1): a held object is
    // read-only for capture until the human resolves the duplicate set.
    if kernel.index().is_held(&identity.id)? {
        return Err(format!(
            "object {} is capture-held: duplicate vmark.id detected — resolve the duplicate files first",
            identity.id.0
        ));
    }
    register_if_needed(kernel, identity.id, &req.path, identity.schema.as_deref())?;

    let masked = mask_and_hash_canonical(&content);
    let content_hash = masked.hash.clone();
    let parents = kernel.index().heads(&identity.id)?;
    // Resolved BEFORE the no-op test, so the test sees the inputs that are
    // recorded: an input that was only the capture itself (an alias of the
    // write target) or a repeat leaves none behind. With no request inputs
    // this resolves nothing and has no side effect.
    let resolved = resolve_inputs(
        kernel,
        &req.inputs,
        policy.may_stamp(),
        req.confidence,
        identity.id,
    )?;
    // No-op: identical content at a single current head AND no inputs —
    // autosave replays. A capture WITH inputs is a distinct provenance
    // event even when the content converges: its edges matter. So is one
    // whose input could only have been stamped: its input set is incomplete.
    let no_edges = resolved.inputs.is_empty() && !resolved.declined;
    if let ([only], true) = (parents.as_slice(), no_edges) {
        if kernel.index().content_hash_of(&identity.id, only)? == Some(content_hash.clone()) {
            // A real disk write of the head content ends any live-buffer lag,
            // no-op or not: left in place, a later external revert to the
            // lagged parent would be skipped by the scan as "expected lag".
            if req.rewrite_identity {
                kernel.index_mut().clear_disk_lag(&identity.id)?;
            }
            return Ok(Some(CaptureReceipt {
                object: identity.id,
                revision: only.clone(),
                entry_id: None,
                content_with_identity: rewritten,
            }));
        }
    }

    let revision = RevisionId::compute(&content_hash, &parents);
    kernel.snapshots().put_masked(&masked)?;
    let t = Transformation {
        inputs: resolved.inputs,
        outputs: vec![OutputRef {
            object: identity.id,
            revision: revision.clone(),
            content_hash,
            parents,
        }],
        agent: req.agent,
        intent: req.intent,
        confidence: resolved.confidence,
    };
    let mut env = Envelope::create(
        "transformation",
        kernel.writer(),
        serde_json::to_value(&t).map_err(|e| e.to_string())?,
    );
    if let Some(idem) = req.idem {
        env.idem = idem; // caller-minted, stable across retries (spec §5.1)
    }
    let entry_id = env.id;
    kernel.append_and_apply(&env)?;
    kernel.index_mut().set_absent(&identity.id, false)?;
    record_disk_lag(
        kernel,
        &identity.id,
        req.rewrite_identity,
        &t.outputs[0].parents,
    )?;
    Ok(Some(CaptureReceipt {
        object: identity.id,
        revision,
        entry_id: Some(entry_id),
        content_with_identity: rewritten,
    }))
}

/// Request validation BEFORE any side effect.
///
/// Size caps (8th-review 8R-9): the document content lives in the CAS, so what
/// drives the ledger line's size is the input set and the intent strings.
/// Unchecked, an oversized payload got as far as rewriting the file, appending a
/// registration and staging CAS content, and only then failed the 16 MiB line
/// cap — reporting a retryable error that could never succeed, with those side
/// effects already durable. A bound that can only be violated is checked before
/// the first side effect, never after. 9th-review 8R-9 added `agent.id`.
fn preflight(kernel: &WorkspaceKernel, req: &CaptureRequest) -> Result<(), String> {
    if req.confidence == Confidence::Unknown {
        return Err("confidence=unknown is scan-only (spec §8)".into());
    }
    if req.inputs.len() > MAX_CAPTURE_INPUTS {
        return Err(format!(
            "capture has {} inputs, over the {MAX_CAPTURE_INPUTS} cap",
            req.inputs.len()
        ));
    }
    let intent_bytes = req.intent.kind.len() + req.intent.summary.len();
    if intent_bytes > MAX_CAPTURE_INTENT_BYTES {
        return Err(format!(
            "capture intent is {intent_bytes} bytes, over the {MAX_CAPTURE_INTENT_BYTES} cap"
        ));
    }
    let agent_bytes = req.agent.id.as_deref().map_or(0, str::len);
    if agent_bytes > MAX_CAPTURE_INTENT_BYTES {
        return Err(format!(
            "capture agent id is {agent_bytes} bytes, over the {MAX_CAPTURE_INTENT_BYTES} cap"
        ));
    }
    // IPC boundary guard: reject traversal before any effect.
    super::paths::resolve_workspace_rel(kernel.root(), &req.path)?;
    Ok(())
}

// Adoption, observed-external synthesis, and registry maintenance live
// in `adopt.rs` (re-exported here so funnels/scan keep one import path).
pub use super::adopt::{adopt_from_disk, observed_external_entry, register_if_needed};

#[cfg(test)]
#[path = "capture.test.rs"]
mod tests;

#[cfg(test)]
#[path = "capture_hashing.test.rs"]
mod hashing_tests;
