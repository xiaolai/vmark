//! The volume-sweep Tauri command (WI-1.1). Thin async wiring: it composes the
//! unit-tested `check_sweep` governance + `check_sweep_run` helpers with the real
//! provider loop. The control flow mirrors, edge-for-edge, the proven loop in
//! `check_sweep.test.rs::sweep_stops_gracefully_on_budget_exhaustion`; the only
//! additions here are IO (`prepare_check`, the provider call, `record_check`),
//! which are integration and exercised by the WI-1.3 dogfood run, not unit tests.

use std::time::{Duration, Instant};

use uuid::Uuid;

use super::check_commands::{prepare_check, record_check, CHECK_TIMEOUT_SECS, DEFAULT_TAU};
use super::check_sweep::CheckedKey;
use super::check_sweep_run::{
    cost_model_for, cursor_from_index, estimate_check_cost, is_checkable, SweepConfig, SweepReport,
};
use super::checker::{parse_check_response, ParsedCheck};
use super::project::CheckVerdict;

/// Sweep the live stale edges under a cost ceiling, seeded by the resume cursor.
/// Returns the run manifest (WI-1.1). Cost is *estimated* (v4.8).
#[tauri::command]
pub async fn coherence_check_sweep(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    provider: crate::workflow::genie_step::ProviderConfig,
    model: Option<String>,
    ceiling_usd: f64,
) -> Result<SweepReport, String> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state.registry.kernel_for(&root, state.writer)?;
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let model_name = model.clone().unwrap_or_else(|| provider.provider.clone());

    // Snapshot the checkable edge set + resume cursor under one lock, then drop it
    // so the provider calls never hold the kernel.
    let (checkable, cursor): (Vec<(Uuid, u32)>, Vec<CheckedKey>) = {
        let kernel = kernel_arc
            .lock()
            .map_err(|_| "kernel poisoned".to_string())?;
        let rows = kernel.index().breakdown(&now)?;
        let checkable = rows
            .iter()
            .filter(|r| is_checkable(&r.state))
            .map(|r| (r.txf, r.input))
            .collect();
        let cursor = cursor_from_index(kernel.index().checked_cursor()?);
        (checkable, cursor)
    };

    let cfg = SweepConfig {
        ceiling_usd,
        backoff_base_ms: 500,
        backoff_max_ms: 30_000,
        cost_model: cost_model_for(&model_name),
    };
    let mut plan = cfg.new_plan(cursor);
    let mut manifest = super::check_sweep::RunManifest::new(checkable.len());

    for (txf, input) in checkable {
        // Prepare under the lock (loads texts + fed claims), then release.
        let prepared = {
            let mut kernel = kernel_arc
                .lock()
                .map_err(|_| "kernel poisoned".to_string())?;
            match prepare_check(&mut kernel, &txf, input) {
                Ok(p) => p,
                // A now-unresolvable edge (upstream diverged since breakdown) is
                // not an error — skip it, it isn't checkable this run.
                Err(_) => {
                    manifest.record_skipped();
                    continue;
                }
            }
        };
        let key = CheckedKey {
            txf: txf.to_string(),
            input,
            checked_against: prepared.checked_against.as_str().to_string(),
            claims_fingerprint: prepared.claims_fingerprint.clone(),
        };
        if !plan.should_check(&key) {
            manifest.record_skipped();
            continue;
        }
        let est = estimate_check_cost(prepared.prompt.len(), cfg.cost_model);
        if !plan.budget.can_afford(est) {
            manifest.mark_budget_stop();
            break; // graceful stop — never overrun the ceiling
        }

        // Provider call OUTSIDE the lock, timed for the p95 metric.
        let started = Instant::now();
        let cancel = tokio_util::sync::CancellationToken::new();
        let response = tokio::time::timeout(
            Duration::from_secs(CHECK_TIMEOUT_SECS),
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
        let latency_ms = started.elapsed().as_millis() as u64;

        // Timeout/provider error → unknown verdict (checker discipline), but it
        // counts toward the error rate for the Phase-1 gate.
        let (parsed, errored) = match response {
            Ok(Ok(raw)) => (parse_check_response(&raw, DEFAULT_TAU), false),
            Ok(Err(_)) | Err(_) => (
                ParsedCheck {
                    verdict: CheckVerdict::Unknown,
                    confidence: 0.0,
                    evidence: Vec::new(),
                },
                true,
            ),
        };

        // Record the result (so a resume skips this edge) and account for it.
        {
            let mut kernel = kernel_arc
                .lock()
                .map_err(|_| "kernel poisoned".to_string())?;
            record_check(&mut kernel, &prepared, &parsed, &model_name)?;
        }
        plan.commit(key, est);
        if errored {
            manifest.record_errored(est, latency_ms);
        } else {
            manifest.record_checked(est, latency_ms);
        }
    }

    Ok(SweepReport::from_manifest(&manifest))
}
