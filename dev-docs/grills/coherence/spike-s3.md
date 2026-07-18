# Spike S3 — LLM edge-inference feasibility (O2 scoping)

> Status: **PASS** — direct-edge precision 88.9%, recall 100%

- **Plan:** `dev-docs/plans/20260718-coherence-layer.md` WI-0.7.
- **Traces:** O2, R24 (input-set taxonomy, spec §7), R25.
- **Question:** given a piece of prose and candidate upstream documents,
  can an LLM classify which candidates are direct inputs (output
  semantically depends on them), contextual (present but not depended
  on), or unrelated? This scopes the Phase-3 human-edit inference design
  (lazy confirmation, R3/O2). It changes no Phase 1 behavior.
- **Probe:** `probes/s3-edge-inference.mjs` (raw per-scene model
  verdicts: `probes/s3-results.json`). Run 2026-07-18, model
  `claude-fable-5` via the local `claude` CLI, 10 sequential calls,
  $5.85 total.

## Method

A purpose-built fictional story world (`probes/s3-corpus/`) where ground
truth is known **by construction**: 6 upstream docs (2 character sheets,
2 world-rule docs, 1 timeline, 1 style guide) and 10 scenes of ~150-300
words, each written against a known subset of the docs. Difficulty was
varied deliberately:

- **Easy:** named character plus sheet facts (scene-01, scene-02).
- **Hard:** dependency without naming — a world rule exercised by an
  unnamed character (scene-03), charter law used without stating it as
  law (scene-09), timeline dependency via date arithmetic only
  (scene-06, scene-10).
- **Traps (mention ≠ dependency):** a doc is mentioned or echoed with no
  semantic dependency — scene-04 name-drops Marcus, scene-07 has Guild
  banners as scenery, scene-10 has "the glassblower's daughter" as crowd
  scenery.
- `style.md` is contextual for every scene (all prose follows it; no
  scene depends on a fact in it), giving contextual ground truth.

One CLI call per scene presented all 6 candidate docs (full text) plus
the scene and the §7 role definitions, and demanded one line of strict
JSON `{"direct": [...], "contextual": [...], "unrelated": [...]}`.
Malformed output would have been recorded as such per R25 — never
guessed. 60 (scene, doc) classification pairs total; 16 true direct
edges.

## Metrics

| Role | TP | FP | FN | Precision | Recall |
|---|---|---|---|---|---|
| **direct** | 16 | 2 | 0 | **88.9%** | **100%** |
| contextual | 10 | 9 | 0 | 52.6% | 100% |
| unrelated | 23 | 0 | 11 | 100% | 67.6% |

The two failure modes that matter (paper O2):

| Failure mode | Count | Cases |
|---|---|---|
| **False direct edges** (noise — breaks trust) | 2 | scene-05 × world-rules.md; scene-10 × elena.md |
| **Missed direct edges** (silent staleness) | **0** | — |

Parsing: 10/10 responses were valid one-line strict JSON on the first
try (0 malformed, no retries, no "unknown" fallback needed).

## Per-scene outcomes

| Scene | Difficulty | Direct (truth) | Direct (model) | Result |
|---|---|---|---|---|
| scene-01 | easy | elena, timeline | elena, timeline | exact |
| scene-02 | easy | marcus | marcus | exact (+ timeline as contextual) |
| scene-03 | hard | world-rules | world-rules | exact (+ guild-law as contextual) |
| scene-04 | trap (marcus) | elena | elena | trap resisted (marcus → contextual) |
| scene-05 | medium | elena, guild-law | elena, guild-law, **world-rules** | 1 false direct |
| scene-06 | hard | marcus, timeline | marcus, timeline | exact — date arithmetic solved |
| scene-07 | trap (guild-law) | elena, world-rules | elena, world-rules | trap resisted (guild-law → contextual) |
| scene-08 | medium | elena, marcus, world-rules | elena, marcus, world-rules | exact |
| scene-09 | hard | guild-law | guild-law | exact — unnamed, law never stated |
| scene-10 | trap (elena) | timeline | **elena**, timeline | **trap fooled** |

## Qualitative failure analysis

**Which traps fooled it.** The two mention-traps (scene-04 "old Marcus"
name-drop, scene-07 Guild banners as scenery) were both resisted — the
model demoted them to `contextual`, not `direct`. The trap that fooled
it was the **epithet echo** (scene-10): "the glassblower's daughter" in
a crowd is resolvable to Elena via her sheet, and the model promoted the
successful entity-linking to a dependency claim. Failure shape: *entity
resolution succeeds, the dependency test is skipped*. The other false
direct (scene-05 × world-rules) is partly ground-truth softness: the
inspector's line "if I smell salt on you again" does echo world-rule 4
(workings smell of salt), so at file granularity the model's call is
defensible — a caution for how thin "relies on one line of the doc" is
(relevant to R31/O9 granularity).

**The hard cases all passed.** Unnamed-character rule use (scene-03),
law-without-stating-it (scene-09), and pure date arithmetic ("two years
he had kept the light" → the 721 timeline entry, scene-06) were all
correctly classified as direct. Direct-edge inference does not depend on
surface naming.

**Contextual is a hedge bucket.** Contextual precision is 52.6% because
the model parks anything with a faint echo there (timeline in scene-02,
guild-law in scene-03, elena and world-rules in scene-09) instead of
committing to `unrelated` — hence unrelated recall of 67.6% with
perfect unrelated precision. This is structural, not a model weakness:
per spec §7, "contextual" is a fact about *what the capture site
assembled*, and prose does not encode the assembly. Post-hoc inference
cannot recover it, only guess at it.

## Implication for O2 / Phase 3

1. **Feasible with lazy human confirmation.** Direct-edge inference
   reached 88.9% precision / 100% recall on this corpus. Zero missed
   direct edges means the dangerous failure mode (silent staleness) did
   not occur; the observed failure mode is over-proposal at ~0.2 false
   edges per scene, which lazy confirmation absorbs at one human
   decision each — comfortably inside the M4 spirit (≤ 10 demanded
   resolutions per session).
2. **Infer only the direct/not-direct boundary.** Phase-3 inference
   should propose **direct edges only**; it should never emit
   `contextual` provenance post-hoc (unrecoverable from prose, 52.6%
   precision here). Contextual provenance stays exclusive to
   instrumented capture (`confidence: exact`). Suggested consequence for
   the Phase-3 design: `confidence: inferred` transformations carry
   direct inputs only.
3. **Confirmation UX must show evidence.** The one observed error class
   (epithet echo) is cheap for a human to reject *if the UI shows why
   the edge was proposed* (the linking phrase). Design the confirmation
   affordance around evidence spans, mirroring R25's evidence field.
4. **Caveats.** N = 10 scenes / 60 pairs, single model, single prompt,
   fixture prose written by one author (the corpus author also defined
   ground truth — mitigated by construction-time labeling but not
   independent). Numbers are a feasibility baseline, not a benchmark;
   Phase 3 should re-measure on real dogfood prose before committing to
   thresholds.

## Reproduce

```bash
node dev-docs/grills/coherence/probes/s3-edge-inference.mjs
# requires the `claude` CLI authenticated; ~10 sequential calls
```
