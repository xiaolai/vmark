//! Operator verify step (Phase 3, WI-3.3). The **advisory, non-blocking**
//! transient check over a candidate (design D3): does the *proposal* contradict
//! its declared inputs or the fed claims? Reuses the D3 prompt
//! (`build_candidate_check_prompt`) and the verdict discipline
//! (`parse_check_response`). The verdict is **transient** — never appended (a
//! candidate isn't committed), never blocks accept (I3/§14).
//!
//! The prompt-assembly (`build_candidate_prompt`) is unit-tested against a real
//! kernel + CAS; the provider call is integration (a live provider).

use uuid::Uuid;

use super::check_commands::{snapshot_text, CHECK_TIMEOUT_SECS, DEFAULT_TAU};
use super::checker::{build_candidate_check_prompt, parse_check_response, CandidateCheckInput};
use super::claims::ClaimStore;
use super::contexts::{ContextSet, DEFAULT_CONTEXT_ID};
use super::operator::Candidate;
use super::operator_commands::OperatorCandidate;
use super::project::CheckVerdict;
use super::state::WorkspaceKernel;

/// The advisory verdict a verify returns (never persisted).
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryVerdict {
    pub verdict: String,
    pub confidence: f64,
}

/// Assemble the D3 candidate-check prompt: the proposal, its declared-input
/// texts (from the CAS at their current revisions), and the fed claims of the
/// default context. Pure over the kernel state (reads CAS/claims; writes nothing).
pub(super) fn build_candidate_prompt(
    kernel: &mut WorkspaceKernel,
    candidate: &Candidate,
    nonce: &str,
) -> Result<String, String> {
    kernel.ensure_available()?; // 9R-4: never serve a poisoned, half-rebuilt index
    let registry = kernel.index().registry_state()?;
    let path_of = |o: &super::types::ObjectId| {
        registry
            .path_of
            .get(o)
            .cloned()
            .unwrap_or_else(|| o.0.to_string())
    };
    let proposal_path = path_of(&candidate.object);

    let mut input_texts: Vec<(String, String)> = Vec::new();
    for input in &candidate.inputs {
        let path = path_of(&input.object);
        let text = snapshot_text(kernel, &input.object, &input.revision)?;
        input_texts.push((path, text));
    }

    // D4: fed claims of the default (v1) context.
    let read = kernel.ledger().read_all()?;
    let store = ClaimStore::from_entries(&read.entries);
    let contexts = ContextSet::load(&kernel.root().join(".vmark").join("contexts"));
    let visible = contexts.effective_claims(DEFAULT_CONTEXT_ID);
    let claims: Vec<String> = store
        .fed_claims(&visible)
        .into_iter()
        .map(|c| c.statement.clone())
        .collect();

    let inputs_ref: Vec<(&str, &str)> = input_texts
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    Ok(build_candidate_check_prompt(&CandidateCheckInput {
        proposal_path: &proposal_path,
        proposal_text: &candidate.content,
        inputs: &inputs_ref,
        claims: &claims,
        nonce,
    }))
}

fn verdict_str(v: CheckVerdict) -> &'static str {
    match v {
        CheckVerdict::NoContradiction => "no-contradiction",
        CheckVerdict::Contradiction => "contradiction",
        CheckVerdict::Unknown => "unknown",
    }
}

/// Verify a candidate (advisory, read-only, MCP-safe). Runs the provider over the
/// D3 prompt and returns a transient verdict — nothing is appended, and a
/// contradiction never blocks a subsequent accept (I3/§14).
#[tauri::command]
pub async fn coherence_operator_verify(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    candidate: OperatorCandidate,
    provider: crate::workflow::genie_step::ProviderConfig,
    model: Option<String>,
) -> Result<AdvisoryVerdict, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let nonce = Uuid::now_v7().simple().to_string();
    let prompt = {
        let mut kernel = kernel_arc
            .lock()
            .map_err(|_| "kernel poisoned".to_string())?;
        build_candidate_prompt(&mut kernel, &candidate.to_candidate(), &nonce)?
    };
    // Provider call outside the lock — a slow model must not block captures.
    let cancel = tokio_util::sync::CancellationToken::new();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(CHECK_TIMEOUT_SECS),
        crate::ai_provider::run_ai_prompt_collect(
            cancel,
            &provider.provider,
            &prompt,
            model.as_deref(),
            provider.api_key.as_deref(),
            provider.endpoint.as_deref(),
            provider.cli_path.as_deref(),
            None,
        ),
    )
    .await;
    // Timeout/provider error → unknown (advisory; D5.3), never an error path.
    let parsed = match response {
        Ok(Ok(raw)) => parse_check_response(&raw, DEFAULT_TAU),
        Ok(Err(_)) | Err(_) => super::checker::ParsedCheck {
            verdict: CheckVerdict::Unknown,
            confidence: 0.0,
            evidence: Vec::new(),
            downgrade: None,
        },
    };
    Ok(AdvisoryVerdict {
        verdict: verdict_str(parsed.verdict).to_string(),
        confidence: parsed.confidence,
    })
}

#[cfg(test)]
#[path = "operator_verify.test.rs"]
mod tests;
