//! Semantic-check service (WI-2b.4; design-2a.md D5). Service tier
//! (ADR-C4): loads the edge's texts from the CAS, feeds the default
//! context's claims (D4), calls the AI provider through the same atom
//! genie steps use, and appends a D5.6-complete `check-result`. Pull
//! only (D5.1) — nothing here runs without an explicit human ask.

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::checker::{build_check_prompt, CheckPromptInput, ParsedCheck};
use super::claims::ClaimStore;
use super::contexts::{ContextSet, DEFAULT_CONTEXT_ID};
use super::dag::Resolved;
use super::project::CheckVerdict;
use super::state::WorkspaceKernel;
use super::types::{Envelope, RevisionId};

/// D5.3: τ default per spike S4 — tunable policy, recorded per result.
pub const DEFAULT_TAU: f64 = 0.9;

/// Provider timeout: past this the verdict is `unknown` (D5.3), never
/// an error — a slow provider must not read as a failed check.
pub const CHECK_TIMEOUT_SECS: u64 = 120;

#[derive(Debug)]
pub struct PreparedCheck {
    pub prompt: String,
    pub txf: Uuid,
    pub input: u32,
    pub pinned: RevisionId,
    pub checked_against: RevisionId,
    pub context: Uuid,
    pub claims_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReceipt {
    pub entry_id: Uuid,
    pub verdict: String,
    pub confidence: f64,
}

pub(super) fn snapshot_text(
    kernel: &mut WorkspaceKernel,
    object: &super::types::ObjectId,
    revision: &RevisionId,
) -> Result<String, String> {
    let hash = kernel
        .index()
        .content_hash_of(object, revision)?
        .ok_or_else(|| format!("no content hash for {object:?} @ {revision:?}"))?;
    let bytes = kernel.read_snapshot(&hash)?;
    String::from_utf8(bytes)
        .map_err(|_| "snapshot is not UTF-8 text (binary objects are not checkable in 2b)".into())
}

/// Load everything a check needs. Fails loud when the upstream has no
/// single current revision (Diverged edges are unwaivable AND
/// uncheckable until a defined revision exists — D3.3 posture).
pub fn prepare_check(
    kernel: &mut WorkspaceKernel,
    txf: &Uuid,
    input: u32,
) -> Result<PreparedCheck, String> {
    let edge = kernel
        .index()
        .edge_by(txf, input)?
        .ok_or_else(|| format!("no such edge: {txf}#{input}"))?;
    let current = match kernel.index().resolve_live(&edge.upstream)? {
        Resolved::Single(rev) => rev,
        Resolved::DivergedHeads => {
            return Err(
                "upstream has multiple live heads — no single revision to check against".into(),
            )
        }
        Resolved::UnknownPin | Resolved::Absent => {
            return Err("upstream object is not resolvable".into())
        }
    };
    let registry = kernel.index().registry_state()?;
    let upstream_path = registry
        .path_of
        .get(&edge.upstream)
        .cloned()
        .unwrap_or_else(|| edge.upstream.0.to_string());
    let downstream_path = registry
        .path_of
        .get(&edge.downstream)
        .cloned()
        .unwrap_or_else(|| edge.downstream.0.to_string());

    let pinned_text = snapshot_text(kernel, &edge.upstream, &edge.pinned)?;
    let current_text = snapshot_text(kernel, &edge.upstream, &current)?;
    let downstream_text = snapshot_text(kernel, &edge.downstream, &edge.downstream_rev)?;

    // D4: fed claims of the default context (the v1 UI surface).
    let read = kernel.ledger().read_all()?;
    let store = ClaimStore::from_entries(&read.entries);
    let contexts = ContextSet::load(&kernel.root().join(".vmark").join("contexts"));
    let visible = contexts.effective_claims(DEFAULT_CONTEXT_ID);
    let statements: Vec<String> = store
        .fed_claims(&visible)
        .into_iter()
        .map(|c| c.statement.clone())
        .collect();
    let claims_fingerprint = store.claims_fingerprint(&visible);

    let nonce = Uuid::now_v7().simple().to_string();
    let prompt = build_check_prompt(&CheckPromptInput {
        upstream_path: &upstream_path,
        pinned_text: &pinned_text,
        current_text: &current_text,
        downstream_path: &downstream_path,
        downstream_text: &downstream_text,
        claims: &statements,
        nonce: &nonce,
    });
    Ok(PreparedCheck {
        prompt,
        txf: *txf,
        input,
        pinned: edge.pinned,
        checked_against: current,
        context: DEFAULT_CONTEXT_ID,
        claims_fingerprint,
    })
}

fn verdict_str(v: CheckVerdict) -> &'static str {
    match v {
        CheckVerdict::NoContradiction => "no-contradiction",
        CheckVerdict::Contradiction => "contradiction",
        CheckVerdict::Unknown => "unknown",
    }
}

/// Append the D5.6-complete `check-result` for a parsed model response.
pub fn record_check(
    kernel: &mut WorkspaceKernel,
    prepared: &PreparedCheck,
    parsed: &ParsedCheck,
    model: &str,
) -> Result<CheckReceipt, String> {
    // R1 (7th-review 6R-1): resolve current head + registry → build check → append
    // under the workspace lock.
    kernel.with_write_lock(|kernel| record_check_locked(kernel, prepared, parsed, model))
}

fn record_check_locked(
    kernel: &mut WorkspaceKernel,
    prepared: &PreparedCheck,
    parsed: &ParsedCheck,
    model: &str,
) -> Result<CheckReceipt, String> {
    kernel.ensure_initialized()?;
    let body = json!({
        "edge": { "txf": prepared.txf.to_string(), "input": prepared.input },
        "pinned": prepared.pinned.as_str(),
        "checked_against": prepared.checked_against.as_str(),
        "verdict": verdict_str(parsed.verdict),
        "model": model,
        "prompt_version": "check-v1",
        "evidence": parsed.evidence.iter().map(|e| json!({
            "quote": e.quote, "loc": e.loc,
        })).collect::<Vec<_>>(),
        "confidence": parsed.confidence,
        "context": prepared.context.to_string(),
        "claims_fingerprint": prepared.claims_fingerprint,
    });
    let env = Envelope::create("check-result", kernel.writer(), body);
    let entry_id = env.id;
    kernel.append_and_apply(&env)?;
    Ok(CheckReceipt {
        entry_id,
        verdict: verdict_str(parsed.verdict).to_string(),
        confidence: parsed.confidence,
    })
}

#[tauri::command]
pub async fn coherence_check(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    txf: Uuid,
    input: u32,
    provider: crate::workflow::genie_step::ProviderConfig,
    model: Option<String>,
) -> Result<CheckReceipt, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let prepared = {
        let mut kernel = kernel_arc
            .lock()
            .map_err(|_| "kernel poisoned".to_string())?;
        prepare_check(&mut kernel, &txf, input)?
    };
    // Provider call OUTSIDE the kernel lock — a slow model must never
    // block captures or breakdown pulls.
    let cancel = tokio_util::sync::CancellationToken::new();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(CHECK_TIMEOUT_SECS),
        crate::ai_provider::run_ai_prompt_collect(
            cancel,
            &provider.provider,
            &prepared.prompt,
            model.as_deref(),
            provider.api_key.as_deref(),
            provider.endpoint.as_deref(),
            provider.cli_path.as_deref(),
            None,
        ),
    )
    .await;
    // D5.3: timeout or provider error → unknown, recorded as such.
    let parsed = match response {
        Ok(Ok(raw)) => super::checker::parse_check_response(&raw, DEFAULT_TAU),
        Ok(Err(_)) | Err(_) => ParsedCheck {
            verdict: CheckVerdict::Unknown,
            confidence: 0.0,
            evidence: Vec::new(),
        },
    };
    let model_name = model.as_deref().unwrap_or(provider.provider.as_str());
    let mut kernel = kernel_arc
        .lock()
        .map_err(|_| "kernel poisoned".to_string())?;
    record_check(&mut kernel, &prepared, &parsed, model_name)
}

#[cfg(test)]
#[path = "check_commands.test.rs"]
mod tests;
