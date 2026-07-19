# Verify-at-Volume — Baseline + Gate Definition

> **What this is:** the measurement half of the coherence runtime work — it
> exercises and measures the *already-shipped* Phase 2b checker (not a new
> feature), and establishes the drift-gauge baseline the runtime layer will be
> judged against. Grounded in a real gauge run, not estimated.

## Baseline (2026-07-19)

Source: `epcho-ai/instruments/drift_metrics.py` run against the repo's own
dogfood ledger (`.vmark/ledger/`, 102 entries, 10.5 h span, 3 sessions). The
gauge refuses to invent a trend on thin data — this is the honest "before".

| Signal | Reading | Note |
|---|---|---|
| Composition | 42 transformation, 40 ratification, 10 object-registered, 4 delegation, **3 check-result**, 2 claim, 1 waiver | — |
| **M1 capture coverage** | 69% provenanced (exact 23 / inferred 6), 31% unknown-external (13) | healthy for a dogfood |
| **M3 contradiction rate** | **INSUFFICIENT DATA** — 3 checks (need ≥10), all `no-contradiction` | **the gap** — the semantic axis has no signal |
| **M4 ratification burden** | sessions `[13, 17, 11]` resolutions/session; mean 13.7 | **all 3 over the ≤10 threshold** (paper §11) |
| Re-coherence tax | overall 1.11; trend reads **RISING** | preliminary only — see below |
| Edge churn | 24 distinct edges resolved, **11 re-opened** (some 4×) | watch |
| **Verdict** | **TOO EARLY for a compound-vs-drift call** | need ≥10 checks + a denser timeline |

## Two findings already visible (flagged preliminary)

1. **M4 resolution burden is over threshold in every session** (`13/17/11` vs
   the ≤10 exit bar). This is the adoption-killer watch. Most likely edge noise
   at file-level granularity (R31 / O9) inflating resolutions — the exact
   granularity concern the runtime design must address. **Not** yet a verdict;
   it is a small, resolution-heavy dogfood. But it is the first real signal and
   should be tracked from here.
2. **Re-coherence tax reads RISING, but on sparse, bursty data.** The trend
   crossed the ≥24-change minimum (37 changes), yet windows w2–w4 are empty —
   the gauge is comparing two activity bursts (w1 ≈ 0.68 vs w5–w6 ≈ 1.70/1.38),
   not a smooth series. Read as "watch", not "the project is rotting".

Neither is actionable as a conclusion at n=102 entries; both become meaningful
once the timeline densifies.

## Corrected Phase-1 gate (per Codex G-B, D2#3 / D5#2)

The earlier draft gated on "≥ N check-result **entries**". That is inflatable —
re-checking the same edge bumps the count without adding signal, and LLM calls
are non-deterministic so "deterministic replay" is misleading. The gate is
redefined to measure *signal*, not *volume*:

| Metric | Gate |
|---|---|
| Distinct **live-edge** coverage | ≥ X distinct `(edge, endpoint-pair, context, claims-fingerprint)` checked — the real denominator, not entry count |
| Verdict error rate | owner-judged M3 precision on a labeled slice (M3 is a human judgment, not an automated number) |
| p95 check latency | recorded (interactive budget) |
| Total cost | within an owner-set budget; per-provider token accounting (providers without usage metadata are estimated + flagged) |
| Resume correctness | a mid-run abort resumes without double-checking or gaps |

M2 / M4 / M5 stay **owner-judged** (they need human sessions); only M1 and the
distinct-edge coverage are automatable. "Re-coherence tax" is a drift-gauge
signal, not a paper M-metric — record it as such.

## Runbook — reaching volume (ACTIVE track)

This is now the active coherence track (the forward-operator layer is banked —
`design-runtime.md`). Growing check-results from 3 → volume is **not
headless-runnable**: the checker (`checker.rs` / `coherence_check`) dispatches to
a real provider through the app/MCP funnel. Turnkey steps:

- **Step 0 — inventory + decide sweep-vs-evolve.** In the running app, list the
  currently version-stale edges (`coherence_edges` MCP / the breakdown view).
  - If **≥ ~15 stale edges** exist → a single **checker sweep** reaches volume
    (≥10 distinct live-edge checks). Go to Step 1.
  - If **too few** → **evolve the corpus first**: a short co-editing session on
    s3-corpus (revise upstream docs so downstream dependents go stale), then
    sweep. The exact stale count is the kernel's breakdown, not an estimate.
- **Step 1 — sweep.** Drive `coherence_check` over each stale edge via the MCP
  funnel with a configured provider (claude-CLI), bounded by the cost budget.
- **Step 2 — measure.** Record distinct **live-edge** coverage + p95 latency +
  total cost (the corrected gate above). Owner-judge M3 precision on a labeled
  slice.
- **Step 3 — re-run the gauge:** `python3 ../epcho-ai/instruments/drift_metrics.py`
  over the grown ledger → the updated baseline + the first real M3
  (contradiction rate) and re-coherence-tax delta.

**Owner inputs needed:** (a) **corpus** — s3-corpus (self-host) vs a real
creative project (the still-open dogfood decision from the 20260718 plan);
(b) a **cost budget**; (c) a **running debug app + provider** session.

**State:** baseline ✅ done; the sweep is ⏳ **owner/app/provider-gated** — hand
me any of Step 0's stale count, a budget, and a live app session and I drive the
rest.
