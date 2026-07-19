# Drift-gauge baseline — 2026-07-20 (WI-1.2)

> **Status: REAL RUN (deterministic, no LLM).** The Phase-1 drift-gauge baseline,
> produced by running the external gauge against this repo's own coherence
> ledger. **The M3 gap is closed:** the semantic axis now has signal (12 checks ≥
> the ≥10 threshold), up from the 3-check INSUFFICIENT-DATA reading in
> `verify-at-volume-baseline.md`.

## Provenance (content-hash pinned)

- **Gauge:** `../epcho-ai/instruments/drift_metrics.py` — **not a git repo**, so
  it is pinned by **content hash** (G-B round-3 PARTIAL #15):
  `sha256:84e4686c258f04e445df27e7bf600fdcda47bf896f30e0006e7c9d97664a5676`
- **Ledger:** `.vmark/ledger/` — 1 segment, **119 entries**, 0 malformed.
- **Span:** 2026-07-18T14:05 → 2026-07-19T14:58 (24.9 h), 5 sessions.
- **Command:** `python3 drift_metrics.py --ledger .vmark/ledger`

## Readings

| Signal | Reading | Note vs the earlier baseline |
|---|---|---|
| Composition | 44 transformation, 45 ratification, **12 check-result**, 10 object-registered, 5 delegation, 2 claim, 1 waiver | check-results 3 → **12** |
| **M1 capture coverage** | 66% provenanced (exact 23 / inferred 6), 34% unknown-external (15) | steady, healthy for a dogfood |
| **M3 contradiction rate** | **12 checks, 3 contradiction (25%)** — mix 9 no-contradiction / 3 contradiction | **GAP CLOSED** — was INSUFFICIENT DATA (3 checks); the semantic axis now has signal |
| **Re-coherence tax** | overall **1.18** / content-changing txn; trend **RISING** (w1 0.68 → w6 2.50) | preliminary; the tax lever (canon-hub) is the intended counter |
| Edge churn | 28 distinct edges resolved, **11 re-opened** (up to 4×) | watch — the granularity/false-positive concern |
| **M4 ratification burden** | sessions `[13, 17, 11, 0, 5]`; mean **9.2**; **3 sessions over** the ≤10 bar | mean now under threshold (was 13.7); tail still over |

## What this baseline establishes

1. **M3 has signal** — the verify-at-volume checks (the 12 recorded check-results)
   moved the contradiction rate off INSUFFICIENT DATA to a real **25%**. That is
   the reading the whole design is judged by (does the semantic axis surface real
   incoherence?), and it now exists.
2. **The re-coherence tax is RISING (1.18, trending up)** — the load-bearing
   number the canon-hub (Phase 4) is meant to bring down. This baseline is the
   *before*; a post-canon run is the test of Phase 4's justification.
3. **M4 tail still over threshold** — 3 of 5 sessions exceed ≤10 resolutions;
   most-churned edges hit 4× reopens. This is the false-positive-staleness /
   granularity concern (R31 / facet-level canon, WI-4.4) made concrete.

## Honest limit

This is the gauge's **deterministic** read of the *existing* ledger — real, not
estimated. What it is **not**: a fresh *volume sweep* producing *new* checks. The
`coherence_check_sweep` harness (WI-1.1) is built and tested, but running it at
volume to grow the check count needs `pnpm tauri:dev` + a configured AI provider
(a live dogfood session). This baseline is the honest "before" from what the
dogfood has already produced.

## Re-run

```
python3 ../epcho-ai/instruments/drift_metrics.py --ledger .vmark/ledger
# pin: sha256:84e4686c258f04e445df27e7bf600fdcda47bf896f30e0006e7c9d97664a5676
```
