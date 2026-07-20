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

## Live sweep + M-metric session (2026-07-20)

Ran against **this repo's own ledger** (owner's corpus choice), Claude-CLI
provider, in the live debug app. Budget: minimum-to-pass.

### Gate metrics

| Metric | Reading |
|---|---|
| Distinct live-edge coverage | **11** (was 8) — clears the ≥10 bar |
| M3 signal | **exists now**: 21 checks → 13 no-contradiction, 3 contradiction, 5 unknown (baseline said INSUFFICIENT DATA at 3 checks) |
| p95 check latency | ~8–11 s per check (Claude CLI) |
| Total cost | subscription (CLI provider); no API spend |
| Resume correctness | **failed, then fixed + verified.** One sweep produced 9 check-results over 5 distinct edges — two concurrent runs ~0.5 s apart. Guard added; re-run now reports `checked: 0` (cursor correctly skips) and a second concurrent sweep is refused. |

### M3 — the "unknown" rate was OUR bug, not the checker's

5 of 21 checks returned `unknown`. Investigation: confidences split **perfectly**
at τ=0.9 — determinate 0.90–0.99 (n=16), unknown 0.82–0.86 (n=5), nothing
between. Every `unknown` was a τ downgrade of a verdict the model had reached,
and the old parser discarded the verdict *and its evidence*, making the τ choice
irreversible. Now preserved (`downgraded` in the check-result) and τ is a
per-call parameter, so τ is retunable **offline against existing data**.

### M2 — owner-judged: 0 relevant / 5 noise

Codex prepared a labeled slice (thread `019f7de7…`) reading each edge's actual
document pair; the **owner** supplied the fact that decided every row: all four
downstream documents are **frozen history**. Applying that to Codex's own
"what would change my label" column flips or holds all five to `noise` —
including the two it had drafted `relevant`, which it had qualified with "if the
plan is now immutable completion history… repeated interruption becomes noise."

Recorded as five `flag-judgment` entries. Logbook reading: **relevant 0, noise 5,
unsure 0, unjudged 23.**

**The finding is stronger than the ratio: the coherence layer has no
document-lifecycle model.** It flags an edge into a finished plan exactly as
loudly as an edge into a living spec. Three of these five flags would never have
fired if it knew the downstream was done.

### M4 — burden is CHURN, and it is spent on frozen documents

Logbook: **11 of 28 edges reopened**, several 4×. This independently reproduces
the drift gauge's "24 distinct edges resolved, 11 re-opened (some 4×)" — two
separate measurements agreeing. Combined with M2: the 13/17/11-per-session
burden was largely **re-ratifying edges into documents that will never change
again**. Owner response to the ≤10 threshold: "configurable in settings?" —
recorded as a request, not as an accept/reject verdict on the burden.

Codex's churn proposal (concrete, matches the plan's own R31 note that file-level
granularity is too coarse): anchor edges to **sections** — R27; O1/O5/O8/R33;
D1–D4 + the WI decomposition — and reopen only when that anchor's normalised
hash changes, rather than on any file edit.

### M5 — insufficient data

Owner: "don't know." Time-to-confidence is inherently longitudinal; one session
cannot produce it. Recorded as insufficient-data, the same honest outcome the
baseline recorded for M3 at n=3.

### Corpus caveat (do not over-read the 0% relevance)

This repo's dev-docs are overwhelmingly **finished** plans and design records, so
"all frozen" is a property of the corpus as much as of the tool. A live creative
project — the actual target use case — would exercise M2 very differently. What
DOES generalise is the missing lifecycle model and the section-anchoring
proposal; both would matter in any corpus.

### Defects found by running it (five; nine code reviews found none of them)

`2af24fe5` status reported a healthy 119-entry workspace as uninitialized ·
`d6fd88ee` concurrent sweeps double-spent · `62d7555f` τ discarded paid-for
verdicts irreversibly · `8901839f` + `d021d87c` logbook (the M2/M4 instrument
that did not exist).

### WI-1.3 status — owner sign-off (2026-07-20)

**live sweep: ✅ done** — owner-signed-off on the readings below. Recorded with
their qualifications intact so "done" is never mistaken for "all green":

| Metric | Signed off as |
|---|---|
| Live sweep | Real run: 5 stale edges swept, distinct live-edge coverage **11** (≥10 bar), p95 ~8–11 s, subscription cost, resume-correctness failure found → fixed → re-verified (`checked: 0` on re-run, concurrent sweep refused). |
| **M2** staleness relevance | **Genuinely judged: 0 relevant / 5 noise.** Owner supplied the deciding fact (all four downstream docs are frozen history). Finding: no document-lifecycle model. |
| **M3** semantic-check precision | Signal exists (21 checks: 13/3/5). The 5 `unknown` were OUR τ data loss, now fixed and retunable offline. |
| **M4** resolution burden | **Signed off as recorded**, not as an accept/reject of the burden: 11 of 28 edges reopened (several 4×), 13/17/11 per session vs the ≤10 bar, and now characterised — the burden is *churn on frozen documents*, not breadth. Owner asked for the threshold to be configurable; that remains open work. |
| **M5** time-to-confidence | **Signed off as recorded: insufficient data.** Inherently longitudinal; one session cannot produce it. Same honest outcome the baseline recorded for M3 at n=3. |

**What this sign-off does NOT claim:** that the coherence layer is useful as-is.
M2 read 0/5 on this corpus. The actionable output of Phase 1 is the two design
findings — a missing document-lifecycle model, and section-anchored edges
instead of file-level granularity (matching the plan's own R31 note) — plus the
five defects the session found. Those, not a green marker, are the result worth
carrying into the next phase.
