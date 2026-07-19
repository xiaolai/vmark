// WI-1.4 — volume-sweep governance: cost/budget/backoff/resume/manifest.
// Exercises the failure paths that only appear at volume (budget exhaustion,
// mid-run abort, partial batch, resume dedup) without any provider call.

use super::*;

fn key(txf: &str, input: u32, against: &str, fp: &str) -> CheckedKey {
    CheckedKey {
        txf: txf.into(),
        input,
        checked_against: against.into(),
        claims_fingerprint: fp.into(),
    }
}

// ---- cost estimation (v4.8) -------------------------------------------------

#[test]
fn tokens_are_roughly_chars_over_four() {
    assert_eq!(estimate_tokens(400, 400), 200);
    assert_eq!(estimate_tokens(0, 0), 0);
    // Sub-token remainder truncates, never rounds up into phantom cost.
    assert_eq!(estimate_tokens(3, 0), 0);
}

#[test]
fn cost_scales_with_tokens_and_rate() {
    let m = CostModel {
        usd_per_1k_tokens: 2.0,
    };
    assert_eq!(estimate_cost_usd(1000, m), 2.0);
    assert_eq!(estimate_cost_usd(500, m), 1.0);
    assert_eq!(estimate_cost_usd(0, m), 0.0);
}

#[test]
fn unknown_model_default_rate_is_never_free() {
    // A non-zero default rate ⇒ an unknown model's cost is never estimated as free.
    assert!(estimate_cost_usd(1000, DEFAULT_RATE) > 0.0);
}

// ---- budget with graceful stop ----------------------------------------------

#[test]
fn budget_stops_before_exceeding_not_after() {
    let mut b = SweepBudget::new(1.0);
    assert!(b.can_afford(0.6));
    b.charge(0.6);
    // 0.6 spent; a 0.6 call would reach 1.2 > 1.0 → refused BEFORE the call.
    assert!(!b.can_afford(0.6));
    // But a call that lands exactly on the ceiling is allowed.
    assert!(b.can_afford(0.4));
    assert_eq!(b.remaining(), 0.4);
}

#[test]
fn budget_remaining_never_negative() {
    let mut b = SweepBudget::new(0.5);
    b.charge(0.9); // overspend can't happen via can_afford, but be defensive
    assert_eq!(b.remaining(), 0.0);
}

// ---- backoff ----------------------------------------------------------------

#[test]
fn backoff_is_exponential_then_capped() {
    let mut bo = Backoff::new(100, 1000);
    assert_eq!(bo.delay_ms(), 100); // 100 * 2^0
    bo.next();
    assert_eq!(bo.delay_ms(), 200); // 2^1
    bo.next();
    assert_eq!(bo.delay_ms(), 400); // 2^2
    bo.next();
    assert_eq!(bo.delay_ms(), 800); // 2^3
    bo.next();
    assert_eq!(bo.delay_ms(), 1000); // 2^4 = 1600 → capped
    bo.reset();
    assert_eq!(bo.delay_ms(), 100);
}

#[test]
fn backoff_never_overflows_at_high_attempt() {
    let mut bo = Backoff::new(1000, 30_000);
    for _ in 0..100 {
        bo.next();
    }
    assert_eq!(bo.delay_ms(), 30_000); // saturating, capped — no panic/overflow
}

// ---- resume cursor ----------------------------------------------------------

#[test]
fn resume_skips_already_checked_edge_at_same_rev_and_fingerprint() {
    let done = key("t1", 0, "rev1:aa", "fp1");
    let plan = SweepPlan::new(SweepBudget::new(10.0), [done.clone()]);
    assert!(!plan.should_check(&done)); // already checked → skip
                                        // Same edge but a NEW upstream revision is a different check → run it.
    assert!(plan.should_check(&key("t1", 0, "rev1:bb", "fp1")));
    // Same edge+rev but a changed claim fingerprint is a different check → run.
    assert!(plan.should_check(&key("t1", 0, "rev1:aa", "fp2")));
}

#[test]
fn within_run_duplicate_is_skipped_after_commit() {
    let mut plan = SweepPlan::new(SweepBudget::new(10.0), []);
    let k = key("t2", 1, "rev1:cc", "fp");
    assert!(plan.should_check(&k));
    plan.commit(k.clone(), 0.5);
    assert!(!plan.should_check(&k)); // committed in-run → not re-checked
    assert_eq!(plan.budget.spent_usd, 0.5);
}

// ---- run manifest -----------------------------------------------------------

#[test]
fn coverage_is_checked_over_denominator() {
    let mut m = RunManifest::new(10);
    for _ in 0..9 {
        m.record_checked(0.1, 100);
    }
    assert_eq!(m.checked, 9);
    assert!((m.coverage() - 0.9).abs() < 1e-9);
}

#[test]
fn empty_corpus_is_fully_covered() {
    let m = RunManifest::new(0);
    assert_eq!(m.coverage(), 1.0); // nothing to cover
    assert_eq!(m.error_rate(), 0.0);
    assert_eq!(m.p95_latency_ms(), 0);
}

#[test]
fn error_rate_is_over_attempted_calls() {
    let mut m = RunManifest::new(100);
    for _ in 0..8 {
        m.record_checked(0.1, 50);
    }
    m.record_errored(0.1, 50);
    m.record_errored(0.1, 50);
    // 2 errors / 10 attempted = 0.2 (NOT 2/100 — skips don't count as attempts).
    assert!((m.error_rate() - 0.2).abs() < 1e-9);
    // Errored calls still add their (estimated) cost: 8×0.1 + 2×0.1 = 1.0.
    assert!((m.estimated_cost_usd - 1.0).abs() < 1e-9);
}

#[test]
fn p95_latency_nearest_rank() {
    let mut m = RunManifest::new(100);
    for i in 1..=100u64 {
        m.record_checked(0.0, i * 10); // latencies 10..1000
    }
    // nearest-rank p95 over 100 samples = the 95th ordered value = 950.
    assert_eq!(m.p95_latency_ms(), 950);
}

#[test]
fn p95_single_sample() {
    let mut m = RunManifest::new(1);
    m.record_checked(0.0, 42);
    assert_eq!(m.p95_latency_ms(), 42);
}

// ---- the volume failure paths (WI-1.4) --------------------------------------

/// Budget exhaustion mid-sweep: the driver stops at the first unaffordable call,
/// records the partial run, and the manifest shows a budget stop with < full
/// coverage — never an overrun.
#[test]
fn sweep_stops_gracefully_on_budget_exhaustion() {
    let denom = 10;
    let mut plan = SweepPlan::new(SweepBudget::new(1.0), []);
    let mut manifest = RunManifest::new(denom);
    let per_call = 0.3;

    for i in 0..denom {
        let k = key("t", i as u32, "rev1:xx", "fp");
        if !plan.should_check(&k) {
            manifest.record_skipped();
            continue;
        }
        if !plan.budget.can_afford(per_call) {
            manifest.mark_budget_stop();
            break; // graceful stop — no overrun
        }
        plan.commit(k, per_call);
        manifest.record_checked(per_call, 100);
    }

    // 3 calls (0.9) fit under 1.0; a 4th (1.2) would exceed → stop.
    assert_eq!(manifest.checked, 3);
    assert!(manifest.stopped_on_budget);
    assert!(plan.budget.spent_usd <= 1.0, "never overran the ceiling");
    assert!(manifest.coverage() < 1.0); // partial by design
}

/// Mid-run abort then resume: the resumed run seeds its cursor from the first
/// run's completed keys and adds ZERO duplicates (the Phase-1 resume gate).
#[test]
fn resume_after_abort_adds_no_duplicates() {
    let edges: Vec<CheckedKey> = (0..6).map(|i| key("t", i, "rev1:yy", "fp")).collect();

    // Run 1 aborts after 4 edges (e.g. crash / cost stop).
    let mut done = Vec::new();
    let mut plan1 = SweepPlan::new(SweepBudget::new(100.0), []);
    for k in edges.iter().take(4) {
        assert!(plan1.should_check(k));
        plan1.commit(k.clone(), 0.1);
        done.push(k.clone());
    }

    // Run 2 resumes: seed the cursor from run 1's completed keys.
    let mut plan2 = SweepPlan::new(SweepBudget::new(100.0), done);
    let mut checked_in_run2 = 0;
    let mut skipped = 0;
    for k in &edges {
        if plan2.should_check(k) {
            plan2.commit(k.clone(), 0.1);
            checked_in_run2 += 1;
        } else {
            skipped += 1;
        }
    }
    assert_eq!(skipped, 4, "the 4 already-done edges are skipped");
    assert_eq!(checked_in_run2, 2, "only the 2 remaining edges are checked");
}
