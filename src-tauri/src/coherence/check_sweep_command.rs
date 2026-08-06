//! The volume-sweep Tauri command (WI-1.1). Thin async wiring: it composes the
//! unit-tested `check_sweep` governance + `check_sweep_run` helpers with the real
//! provider loop. The control flow mirrors, edge-for-edge, the proven loop in
//! `check_sweep.test.rs::sweep_stops_gracefully_on_budget_exhaustion`; the only
//! additions here are IO (`prepare_check`, the provider call, `record_check`),
//! which are integration and exercised by the WI-1.3 dogfood run, not unit tests.

use super::command_errors::{
    kernel_poisoned, ledger_unavailable, state_conflict, workspace_unavailable,
};
use crate::command_error::CommandError;
use std::time::{Duration, Instant};

use uuid::Uuid;

use super::check_commands::{prepare_check, record_check, CHECK_TIMEOUT_SECS};
use super::check_sweep::CheckedKey;
use super::check_sweep_run::{
    cost_model_for, cursor_from_index, estimate_check_cost, is_checkable, SweepConfig, SweepReport,
};
use super::checker::{parse_check_response, ParsedCheck};
use super::index_row::EdgeRow;
use super::project::CheckVerdict;

/// The edges a sweep will spend money checking: version-stale AND actionable.
///
/// Extracted from the sweep body so the money-gating predicate is testable
/// without a live provider. `actionable` excludes frozen downstreams and
/// unchanged anchors — work `perform_status` already hides — so the sweep does
/// not pay an LLM to re-check a dependency the owner is not being asked about.
fn select_checkable(rows: &[EdgeRow]) -> Vec<(Uuid, u32)> {
    rows.iter()
        .filter(|r| r.actionable && is_checkable(&r.state))
        .map(|r| (r.txf, r.input))
        .collect()
}

/// Sweep the live stale edges under a cost ceiling, seeded by the resume cursor.
/// Returns the run manifest (WI-1.1). Cost is *estimated* (v4.8).
#[tauri::command]
pub async fn coherence_check_sweep(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    provider: crate::workflow::genie_step::ProviderConfig,
    model: Option<String>,
    ceiling_usd: f64,
    tau: Option<f64>,
) -> Result<SweepReport, CommandError> {
    let tau = super::check_commands::resolve_tau(tau);
    // Refuse a CONCURRENT sweep (dogfood finding, 2026-07-20). The sweep drops the
    // kernel lock across every provider call, so two invocations both snapshot
    // "not yet checked" and both pay for the SAME edges — observed live as 9
    // check-results over 5 distinct edges, two runs interleaved ~0.5s apart. That
    // is real money and it fails the Phase-1 gate's "resumes without
    // double-checking" metric. The guard is RAII so it clears on every exit path,
    // including an early `?` return or a panic.
    use std::sync::atomic::Ordering;
    if state.sweep_in_flight.swap(true, Ordering::SeqCst) {
        return Err(state_conflict(
            "a coherence check sweep is already running — wait for it to finish".to_string(),
        ));
    }
    struct SweepGuard<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for SweepGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _sweep_guard = SweepGuard(&state.sweep_in_flight);

    let root = std::path::PathBuf::from(&workspace_root);
    let kernel_arc = state
        .registry
        .kernel_for(&root, state.writer)
        .map_err(workspace_unavailable)?;
    let model_name = model.clone().unwrap_or_else(|| provider.provider.clone());

    // Snapshot the checkable edge set + resume cursor under one lock, then drop it
    // so the provider calls never hold the kernel.
    let (checkable, cursor): (Vec<(Uuid, u32)>, Vec<CheckedKey>) = {
        let mut kernel = kernel_arc.lock().map_err(|_| kernel_poisoned())?;
        kernel.ensure_available().map_err(ledger_unavailable)?; // 9R-4: never serve a poisoned index
                                                                // Go through the ENRICHED breakdown, not the raw index projection: the
                                                                // raw one has no lifecycle or anchor knowledge, so the sweep was paying
                                                                // for real LLM calls on frozen downstreams and on edges whose anchored
                                                                // section had not moved — work `perform_status` already considered
                                                                // non-actionable. `anchor-changed` and `anchor-lost` stay in scope.
        let rows =
            super::commands::perform_breakdown_in(&mut kernel, None).map_err(ledger_unavailable)?;
        // Refuse BEFORE spending money. The breakdown now degrades rather than
        // failing when the ledger holds entries this build cannot read, which is
        // right for a panel but wrong here: the sweep would call paid providers
        // over a partial edge set and then fail at `record_check`, which still
        // takes the write lock and is still refused. Worse, a partial projection
        // with no checkable rows returns a "successful" empty sweep, reporting
        // clean coverage of a history it never read.
        if kernel.refused_for_short_read() {
            return Err(CommandError::unsupported(
                "ledger contains entries in a newer format this build cannot read; \
                 refusing to run a paid check sweep over a partial projection — \
                 upgrade VMark to continue",
            ));
        }
        let checkable = select_checkable(&rows);
        let cursor = cursor_from_index(
            kernel
                .index()
                .checked_cursor()
                .map_err(ledger_unavailable)?,
        );
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
            let mut kernel = kernel_arc.lock().map_err(|_| kernel_poisoned())?;
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
            Ok(Ok(raw)) => (parse_check_response(&raw, tau), false),
            Ok(Err(_)) | Err(_) => (
                ParsedCheck {
                    verdict: CheckVerdict::Unknown,
                    confidence: 0.0,
                    evidence: Vec::new(),
                    downgrade: None,
                },
                true,
            ),
        };

        // Record the result (so a resume skips this edge) and account for it.
        {
            let mut kernel = kernel_arc.lock().map_err(|_| kernel_poisoned())?;
            record_check(&mut kernel, &prepared, &parsed, &model_name)
                .map_err(ledger_unavailable)?;
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

#[cfg(test)]
#[path = "check_sweep_command.test.rs"]
mod tests;
