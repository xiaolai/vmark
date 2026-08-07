//! Capture (WI-1.6, ADR-C4 services tier) — the single write-side entry
//! point of the coherence layer. Implements the plan's capture IPC
//! contract: the caller passes the EXACT content it wrote (never a disk
//! re-read), the kernel assigns identity on first capture (rewriting the
//! file atomically — hash unchanged by §3.3), snapshots, resolves and
//! VALIDATES input revisions (no silent fallback), and appends the
//! transformation. Uncaptured input files are adopted on the fly so first
//! generations still record complete input sets (spec §9.4).

use uuid::Uuid;

use super::canonical::text_content_hash;
use super::capture_input::resolve_input;
use super::frontmatter::{assign_identity, read_identity};
use super::state::WorkspaceKernel;
use super::types::{
    Agent, Confidence, Envelope, InputRole, Intent, ObjectId, OutputRef, RevisionId, Transformation,
};
use crate::atomic_replace::atomic_replace;

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

/// Capture one write (spec §5.4.1). Ordering per the plan contract:
/// content is already on disk; snapshot → ledger append → index apply.
pub fn capture(
    kernel: &mut WorkspaceKernel,
    req: CaptureRequest,
) -> Result<CaptureReceipt, String> {
    // R1 (7th-review 6R-1): the whole read-heads → build-transformation → append
    // runs under the workspace lock, so a concurrent commit that moved this
    // object's head can't leave us appending a stale-parent sibling.
    kernel.with_write_lock(|kernel| capture_locked(kernel, req))
}

fn capture_locked(
    kernel: &mut WorkspaceKernel,
    req: CaptureRequest,
) -> Result<CaptureReceipt, String> {
    if req.confidence == Confidence::Unknown {
        return Err("confidence=unknown is scan-only (spec §8)".into());
    }
    // Size preflight BEFORE any side effect (8th-review 8R-9). The document
    // content lives in the CAS, so what drives the ledger line's size is the input
    // set and the intent strings. Unchecked, an oversized payload got as far as
    // rewriting the file, appending a registration and staging CAS content, and
    // only then failed the 16 MiB line cap — reporting a retryable error that
    // could never succeed, with those side effects already durable. Reject up
    // front instead: a bound that can only be violated is checked before the
    // first side effect, never after.
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
    // 9th-review 8R-9: `agent.id` was uncapped, so a huge one still reached the
    // ledger append after the side effects. Bound it, and bound the TOTAL
    // serialized transformation as the catch-all — no field can now push the line
    // past what the ledger will accept, so the failure is always preflight.
    let agent_bytes = req.agent.id.as_deref().map_or(0, str::len);
    if agent_bytes > MAX_CAPTURE_INTENT_BYTES {
        return Err(format!(
            "capture agent id is {agent_bytes} bytes, over the {MAX_CAPTURE_INTENT_BYTES} cap"
        ));
    }
    // IPC boundary guard (audit R1): reject traversal before any effect.
    super::paths::resolve_workspace_rel(kernel.root(), &req.path)?;
    kernel.ensure_initialized()?;
    // Canonical form up front (spec §3.1; audit R14): CRLF content from
    // external clients parses and hashes identically to LF, and any
    // identity rewrite writes canonical bytes.
    let req = CaptureRequest {
        content: super::canonical::canonicalize_text(&req.content),
        ..req
    };

    // Identity: read from the content; for identity-less content REUSE the
    // object registered at this path (editor buffers do not carry the
    // identity block in-session — minting a fresh id per save would churn
    // identity, §2.1/I3); only a genuinely unknown path mints a new id.
    // Either way the file is rewritten atomically with the identity block.
    let (content, identity, rewritten) = match read_identity(&req.content) {
        Some(fi) => (req.content.clone(), fi, None),
        None => {
            let registry = kernel.index().registry_state()?;
            let newly_adopted = !registry.object_at.contains_key(&req.path);
            if newly_adopted && super::frontmatter::has_malformed_frontmatter(&req.content) {
                let env = Envelope::create(
                    "diagnostic",
                    kernel.writer(),
                    serde_json::json!({
                        "code": "malformed-frontmatter",
                        "message": "unterminated frontmatter fence — treated as content, identity block added above it (spec §2.1)",
                        "path": req.path,
                    }),
                );
                kernel.append_and_apply(&env)?;
            }
            let (content, fi) = match registry.object_at.get(&req.path) {
                Some(existing) => {
                    let schema = registry.schema_of.get(existing).cloned().flatten();
                    let content = super::canonical::insert_identity(
                        &req.content,
                        &existing.0.to_string(),
                        schema.as_deref(),
                    );
                    (
                        content,
                        super::frontmatter::FileIdentity {
                            id: *existing,
                            schema,
                        },
                    )
                }
                None => assign_identity(&req.content, None),
            };
            if req.rewrite_identity {
                let abs = super::paths::resolve_workspace_rel(kernel.root(), &req.path)?;
                let parent = abs
                    .parent()
                    .ok_or_else(|| format!("output path has no parent: {}", req.path))?
                    .to_path_buf();
                atomic_replace(&abs, &parent, content.as_bytes())
                    .map_err(|e| format!("identity rewrite failed: {e:?}"))?;
                (content.clone(), fi, Some(content))
            } else {
                (content, fi, None)
            }
        }
    };

    // Duplicate-ID capture hold (spec §2.1, audit R6): a held object is
    // read-only for capture until the human resolves the duplicate set.
    if kernel.index().is_held(&identity.id)? {
        return Err(format!(
            "object {} is capture-held: duplicate vmark.id detected — resolve the duplicate files first",
            identity.id.0
        ));
    }
    register_if_needed(kernel, identity.id, &req.path, identity.schema.as_deref())?;

    let content_hash = text_content_hash(&content);
    let parents = kernel.index().heads(&identity.id)?;
    // No-op: identical content at a single current head AND no inputs —
    // autosave replays. A capture WITH inputs is a distinct provenance
    // event even when the content converges (audit R3): its edges matter.
    if let ([only], true) = (parents.as_slice(), req.inputs.is_empty()) {
        if kernel.index().content_hash_of(&identity.id, only)? == Some(content_hash.clone()) {
            return Ok(CaptureReceipt {
                object: identity.id,
                revision: only.clone(),
                entry_id: None,
                content_with_identity: rewritten,
            });
        }
    }

    let mut inputs = Vec::with_capacity(req.inputs.len());
    for spec in &req.inputs {
        inputs.push(resolve_input(kernel, spec)?);
    }

    let revision = RevisionId::compute(&content_hash, &parents);
    kernel.snapshots().put_text(&content)?;
    let t = Transformation {
        inputs,
        outputs: vec![OutputRef {
            object: identity.id,
            revision: revision.clone(),
            content_hash,
            parents,
        }],
        agent: req.agent,
        intent: req.intent,
        confidence: req.confidence,
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
    // Buffer-lag bookkeeping (spec §2.3 vs. the live-buffer design): with
    // rewrite_identity=false the DISK legitimately still holds the parent
    // content; record those hashes so scan skips exactly that state and
    // nothing else (A → B → A external edits still mint).
    if req.rewrite_identity {
        kernel.index_mut().clear_disk_lag(&identity.id)?;
    } else {
        let mut lag = Vec::new();
        for parent in &t.outputs[0].parents {
            if let Some(h) = kernel.index().content_hash_of(&identity.id, parent)? {
                lag.push(h);
            }
        }
        kernel.index_mut().set_disk_lag(&identity.id, &lag)?;
    }
    Ok(CaptureReceipt {
        object: identity.id,
        revision,
        entry_id: Some(entry_id),
        content_with_identity: rewritten,
    })
}

// Adoption, observed-external synthesis, and registry maintenance live
// in `adopt.rs` (re-exported here so funnels/scan keep one import path).
pub use super::adopt::{adopt_from_disk, observed_external_entry, register_if_needed};

#[cfg(test)]
#[path = "capture.test.rs"]
mod tests;
