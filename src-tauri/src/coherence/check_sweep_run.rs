//! Volume-sweep driver (WI-1.1, service tier). Composes the tested
//! `check_sweep` governance primitives with the real provider call: it sweeps
//! the live stale edges, seeded by the resume cursor, under a cost ceiling and
//! backoff, and returns a run manifest. The loop shape is exactly the one proven
//! in `check_sweep.test.rs` (`sweep_stops_gracefully_on_budget_exhaustion`);
//! this file adds only the IO (provider call + `record_check`), which is
//! integration, not unit-tested logic.

use serde::Serialize;

use super::check_sweep::{
    estimate_cost_usd, estimate_tokens, Backoff, CheckedKey, CostModel, RunManifest, SweepBudget,
    SweepPlan, DEFAULT_RATE,
};
use super::project::EdgeState;

/// Serializable summary of a completed sweep (the committed WI-1.1 artifact).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SweepReport {
    pub coverage_denominator: usize,
    pub checked: usize,
    pub skipped_resume: usize,
    pub errored: usize,
    pub stopped_on_budget: bool,
    /// Labelled ESTIMATED — the provider returns no token usage (v4.8).
    pub estimated_cost_usd: f64,
    pub coverage: f64,
    pub error_rate: f64,
    pub p95_latency_ms: u64,
}

impl SweepReport {
    pub fn from_manifest(m: &RunManifest) -> Self {
        Self {
            coverage_denominator: m.coverage_denominator,
            checked: m.checked,
            skipped_resume: m.skipped_resume,
            errored: m.errored,
            stopped_on_budget: m.stopped_on_budget,
            estimated_cost_usd: m.estimated_cost_usd,
            coverage: m.coverage(),
            error_rate: m.error_rate(),
            p95_latency_ms: m.p95_latency_ms(),
        }
    }
}

/// Is this edge state one the checker can act on? Only version-stale edges (with
/// or without a prior verdict) are checkable; Fresh/Waived/Diverged/Unpinnable
/// are not (Diverged/Unpinnable have no single upstream revision to check).
pub fn is_checkable(state: &EdgeState) -> bool {
    matches!(
        state,
        EdgeState::VersionStale
            | EdgeState::StaleValid
            | EdgeState::StaleContradicted
            | EdgeState::StaleUnknown
    )
}

/// The cost model for a model name. A short built-in table (blended input+output
/// rate, coarse — see `check_sweep`); anything unlisted falls back to
/// `DEFAULT_RATE` so an unknown model never reads as free.
pub fn cost_model_for(model: &str) -> CostModel {
    match model {
        m if m.contains("haiku") => CostModel {
            usd_per_1k_tokens: 0.004,
        },
        m if m.contains("sonnet") => CostModel {
            usd_per_1k_tokens: 0.009,
        },
        m if m.contains("opus") => CostModel {
            usd_per_1k_tokens: 0.03,
        },
        _ => DEFAULT_RATE,
    }
}

/// Build the resume-cursor set from the index's raw check-result tuples.
pub fn cursor_from_index(rows: Vec<(uuid::Uuid, u32, String, String)>) -> Vec<CheckedKey> {
    rows.into_iter()
        .map(
            |(txf, input, checked_against, claims_fingerprint)| CheckedKey {
                txf: txf.to_string(),
                input,
                checked_against,
                claims_fingerprint,
            },
        )
        .collect()
}

/// Estimate the cost of one check from its prompt + (bounded) response size.
/// Used for the budget's *pre-call* affordability check, so the sweep stops
/// before a call it cannot afford (v4.8, graceful stop).
pub fn estimate_check_cost(prompt_chars: usize, model: CostModel) -> f64 {
    // A verdict response is small and bounded (checker.rs caps evidence);
    // assume ~600 response chars for the estimate.
    const EST_RESPONSE_CHARS: usize = 600;
    estimate_cost_usd(estimate_tokens(prompt_chars, EST_RESPONSE_CHARS), model)
}

/// The parameters a sweep run is configured with.
pub struct SweepConfig {
    pub ceiling_usd: f64,
    pub backoff_base_ms: u64,
    pub backoff_max_ms: u64,
    pub cost_model: CostModel,
}

impl SweepConfig {
    pub fn new_plan(&self, cursor: Vec<CheckedKey>) -> SweepPlan {
        SweepPlan::new(SweepBudget::new(self.ceiling_usd), cursor)
    }
    pub fn new_backoff(&self) -> Backoff {
        Backoff::new(self.backoff_base_ms, self.backoff_max_ms)
    }
}

#[cfg(test)]
#[path = "check_sweep_run.test.rs"]
mod tests;
