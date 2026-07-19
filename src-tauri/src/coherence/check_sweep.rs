//! Volume-sweep governance for the semantic checker (WI-1.1/WI-1.4, service
//! tier). The checker core (`checker.rs`) is pure and the per-edge provider call
//! lives in `check_commands.rs`; this module adds the *governance* a batch sweep
//! at volume needs — everything the deep research named the binding constraint:
//!
//! - **Estimated cost** (v4.8): the provider wrapper returns no token usage, so
//!   cost is a `char → token → $` estimate, and every surface labels it
//!   *estimated*. Never presented as measured.
//! - **Budget ceiling with graceful stop**: the sweep stops *before* a call that
//!   would exceed the ceiling, rather than overrunning it.
//! - **Resume cursor**: an edge already checked at its current
//!   `(txf, input, checked_against, claims_fingerprint)` is skipped, so a resumed
//!   run adds zero duplicate check-results (the Phase-1 DoD's resume gate).
//! - **Backoff**: exponential-with-cap between retries after a rate-limit/error.
//! - **Run manifest**: the committed record — coverage denominator, checked /
//!   skipped / errored counts, estimated cost, and p95 latency.
//!
//! All of this is pure and unit-testable; the async provider call is *not* here
//! — the driver in `check_commands.rs` consults these primitives and performs the
//! IO, so the failure paths (partial batch, mid-run abort, budget exhaustion) are
//! exercised without a network call.

use std::collections::HashSet;

/// ~4 characters per token — a deliberately coarse public estimate (v4.8). Not
/// a billing figure; it exists only to keep a volume run under a ceiling.
pub const CHARS_PER_TOKEN: usize = 4;

/// Estimated token count for a prompt + response of the given character lengths.
pub fn estimate_tokens(prompt_chars: usize, response_chars: usize) -> u64 {
    ((prompt_chars + response_chars) / CHARS_PER_TOKEN) as u64
}

/// Per-model price. `usd_per_1k_tokens` is a blended input+output rate — coarse
/// on purpose (see the module note). A model with no entry falls back to
/// `DEFAULT_RATE` so an unknown model never silently reads as free.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CostModel {
    pub usd_per_1k_tokens: f64,
}

/// Conservative default for an unlisted model (errs high, never free).
pub const DEFAULT_RATE: CostModel = CostModel {
    usd_per_1k_tokens: 0.01,
};

pub fn estimate_cost_usd(tokens: u64, model: CostModel) -> f64 {
    (tokens as f64 / 1000.0) * model.usd_per_1k_tokens
}

/// A budget ceiling with a graceful stop. The sweep asks `can_afford` *before*
/// each call and stops at the first call it cannot afford — it never overruns.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SweepBudget {
    pub ceiling_usd: f64,
    pub spent_usd: f64,
}

impl SweepBudget {
    pub fn new(ceiling_usd: f64) -> Self {
        Self {
            ceiling_usd,
            spent_usd: 0.0,
        }
    }
    /// True iff charging `next_est` would keep the total at or under the ceiling.
    pub fn can_afford(&self, next_est: f64) -> bool {
        self.spent_usd + next_est <= self.ceiling_usd
    }
    pub fn charge(&mut self, cost: f64) {
        self.spent_usd += cost;
    }
    pub fn remaining(&self) -> f64 {
        (self.ceiling_usd - self.spent_usd).max(0.0)
    }
}

/// Exponential backoff with a cap, for rate-limit / transient provider errors.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Backoff {
    pub base_ms: u64,
    pub max_ms: u64,
    pub attempt: u32,
}

impl Backoff {
    pub fn new(base_ms: u64, max_ms: u64) -> Self {
        Self {
            base_ms,
            max_ms,
            attempt: 0,
        }
    }
    /// Delay for the current attempt: `base * 2^attempt`, capped at `max_ms`.
    /// Saturating so a large attempt count can never overflow.
    pub fn delay_ms(&self) -> u64 {
        let factor = 2u64.saturating_pow(self.attempt);
        self.base_ms.saturating_mul(factor).min(self.max_ms)
    }
    pub fn next(&mut self) {
        self.attempt = self.attempt.saturating_add(1);
    }
    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

/// Resume-cursor identity of one check: the same edge at the same upstream
/// revision and the same fed-claim fingerprint is the *same* check and must not
/// be re-run on a resume (idempotent by this key — the Phase-1 resume gate).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CheckedKey {
    pub txf: String,
    pub input: u32,
    pub checked_against: String,
    pub claims_fingerprint: String,
}

/// The committed record of a volume run (WI-1.1). `estimated_cost_usd` is
/// labelled estimated everywhere it is surfaced.
#[derive(Debug, Clone, PartialEq)]
pub struct RunManifest {
    /// Distinct live stale edges available to check — the coverage *denominator*.
    pub coverage_denominator: usize,
    pub checked: usize,
    pub skipped_resume: usize,
    pub errored: usize,
    pub stopped_on_budget: bool,
    pub estimated_cost_usd: f64,
    latencies_ms: Vec<u64>,
}

impl RunManifest {
    pub fn new(coverage_denominator: usize) -> Self {
        Self {
            coverage_denominator,
            checked: 0,
            skipped_resume: 0,
            errored: 0,
            stopped_on_budget: false,
            estimated_cost_usd: 0.0,
            latencies_ms: Vec::new(),
        }
    }

    pub fn record_checked(&mut self, cost_usd: f64, latency_ms: u64) {
        self.checked += 1;
        self.estimated_cost_usd += cost_usd;
        self.latencies_ms.push(latency_ms);
    }
    pub fn record_skipped(&mut self) {
        self.skipped_resume += 1;
    }
    pub fn record_errored(&mut self, latency_ms: u64) {
        self.errored += 1;
        self.latencies_ms.push(latency_ms);
    }
    pub fn mark_budget_stop(&mut self) {
        self.stopped_on_budget = true;
    }

    /// Distinct live-edge coverage: checked / denominator. The Phase-1 gate
    /// asserts this ≥ threshold. Zero denominator ⇒ 1.0 (nothing to cover).
    pub fn coverage(&self) -> f64 {
        if self.coverage_denominator == 0 {
            return 1.0;
        }
        self.checked as f64 / self.coverage_denominator as f64
    }

    /// Error rate over *attempted* calls (checked + errored), not the whole set.
    pub fn error_rate(&self) -> f64 {
        let attempted = self.checked + self.errored;
        if attempted == 0 {
            return 0.0;
        }
        self.errored as f64 / attempted as f64
    }

    /// p95 latency (ms) over attempted calls, nearest-rank. 0 if none.
    pub fn p95_latency_ms(&self) -> u64 {
        percentile(&self.latencies_ms, 95)
    }
}

/// Nearest-rank percentile over an unsorted slice. `p` in 0..=100. Empty ⇒ 0.
fn percentile(values: &[u64], p: u8) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    // nearest-rank: ceil(p/100 * n), 1-indexed, clamped to the last element.
    let n = sorted.len();
    let rank = (p as usize * n).div_ceil(100); // ceil(p*n/100)
    let idx = rank.saturating_sub(1).min(n - 1);
    sorted[idx]
}

/// The sweep plan: what has already been checked (resume) and the live budget.
/// The driver consults `should_check` / `can_afford` before each provider call.
#[derive(Debug, Clone)]
pub struct SweepPlan {
    pub budget: SweepBudget,
    seen: HashSet<CheckedKey>,
}

impl SweepPlan {
    /// `already_checked` seeds the resume cursor from the ledger's existing
    /// check-results, so a resumed run skips them.
    pub fn new(budget: SweepBudget, already_checked: impl IntoIterator<Item = CheckedKey>) -> Self {
        Self {
            budget,
            seen: already_checked.into_iter().collect(),
        }
    }
    /// Skip an edge already checked at this revision + fingerprint (resume).
    pub fn should_check(&self, key: &CheckedKey) -> bool {
        !self.seen.contains(key)
    }
    /// Charge the budget and mark the key done (so a within-run duplicate is also
    /// skipped, not just a cross-run resume).
    pub fn commit(&mut self, key: CheckedKey, cost_usd: f64) {
        self.budget.charge(cost_usd);
        self.seen.insert(key);
    }
}

#[cfg(test)]
#[path = "check_sweep.test.rs"]
mod tests;
