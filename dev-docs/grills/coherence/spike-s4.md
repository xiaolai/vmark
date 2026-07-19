# Spike S4 — Semantic-check precision on a seeded-contradiction corpus (M3 baseline)

> Status: **PASS** — M3 baseline: contradiction precision 88.9% (8/9), recall 100%

- **Plan:** `dev-docs/plans/20260718-coherence-layer.md` WI-0.7.
- **Traces:** R25 (check-result schema, spec §5.4.4), M3 (spec §11).
- **Question:** when an upstream doc changes, can an LLM correctly judge
  whether a downstream scene is now contradicted? The contradiction-verdict
  precision on a corpus with contradictions seeded by construction *is*
  the M3 baseline.
- **Probe:** `probes/s4-semantic-check.mjs` → `probes/s4-results.json`
  (raw per-case model output preserved — auditable). Corpus:
  `probes/s4-corpus/cases.json` (shares the S3 story world).
- **Model:** `claude-fable-5` via the local `claude` CLI, one sequential
  call per case, strict one-line JSON answer per spec §5.4.4 semantics.
  Total cost US$11.63 (~$0.48/case) — relevant to Phase 2b's on-demand
  (never background) design.
- **Date:** 2026-07-18

## Corpus

24 cases, each = (upstream OLD revision, upstream NEW revision, downstream
scene written against OLD, ground truth by construction):

| Seeded class | Count | Examples |
|---|---|---|
| Contradiction | 8 | eye color changed, timeline event moved, law inverted |
| No contradiction | 12 | rewording, added unrelated detail, changes the scene never touches |
| Genuinely ambiguous | 4 | arguable both ways (calibration probes) |

## Results

| Metric | Value |
|---|---|
| **M3 baseline — contradiction precision (ambiguous excluded)** | **88.9% (8/9)** |
| Contradiction precision, strict (ambiguous flagged counted as FP) | 66.7% (8/12) |
| Contradiction recall on the 8 seeded contradictions | 100% (8/8) |
| Missed contradictions (as no-contradiction / as unknown) | 0 / 0 |
| `unknown` verdicts issued by the model | 0 of 24 |
| Malformed outputs (strict-JSON parse failures) | 0 of 24 |
| Mean confidence when correct / when wrong | 0.963 / 0.85 |
| Mean confidence on the 4 ambiguous cases | 0.838 |

Ambiguous-case handling: 3 → contradiction (conf 0.80–0.95), 1 →
no-contradiction (conf 0.70), 0 → unknown.

## Failure analysis

- **The single clean false positive (c20)** flagged a *style-guide* drift
  (sentence-length preference 25 → 15 words) as a contradiction, citing a
  22-word sentence. That is divergence, not factual contradiction — the
  checker prompt must draw the semantic-vs-stylistic line explicitly.
  Structural mitigation already in the spec: style guides are `contextual`
  inputs under the §7 taxonomy, and contextual inputs create no edges —
  so this whole class of check should never run. Two independent fixes.
- **The model never volunteers `unknown`.** All 24 verdicts were binary,
  even on cases built to be arguable. R25's first-class `unknown` must be
  *imposed* by the caller, not hoped for from the model. The calibration
  gap supports a threshold: correct verdicts averaged 0.963 confidence,
  the one clean error sat at 0.85, and ambiguous cases at 0.838. Applying
  the spec's low-confidence rule with τ = 0.9 to this corpus maps the
  clean FP (0.85) and two of four ambiguous flags (0.80, 0.70) to
  `unknown`, lifting clean-corpus precision to 100% (8/8) while losing no
  recall. Recommendation for Phase 2b: `confidence < 0.9 ⇒ unknown`.
- Ambiguity skews toward flagging (3 of 4 ambiguous → contradiction).
  Under M3's philosophy ("false contradictions erode trust fastest") the
  threshold rule above is the right lever; prompt-side calibration is a
  Phase 2b experiment.

## Implications

- **M3 baseline = 88.9%** enters spec §11; the ≥ 70% Phase 2b entry gate
  is met with margin, and the τ = 0.9 gating result suggests the shipped
  checker can exceed the baseline.
- Strict-JSON output was 100% parseable — R25's malformed-output branch
  exists for provider failures, not routine model behavior.
- Per-check cost (~$0.48 with a frontier model) confirms the pull-based,
  on-demand design (I4/R14): a background checker would be both
  trust-eroding and expensive.
