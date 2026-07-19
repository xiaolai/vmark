# Coherence Layer — Viability, Support, and Architecture/Tech-Stack

> Deep-research report (harness: 6 search angles → 24 sources fetched → 109
> claims → 25 adversarially verified, 3-vote panels → **21 confirmed, 4
> refuted**). Date: 2026-07-19. Subject: `coherence-layer-paper.md` v2.0 +
> `vision.md` + the banked `grills/coherence/design-runtime.md`. Builds on (does
> not redo) the four `20260718-*` prior-art reports.

## Verdicts

- **VIABILITY: SOUND, with one dominant, well-characterized risk.** The design's
  load-bearing assumption is confirmed: semantic edits genuinely propagate
  consequences ("ripple effect"), and *automated* propagation is unreliable — so
  two-axis staleness is warranted and "human as scheduler, no autonomous
  semantic propagation" is the correct stance. The single binding constraint is
  the **LLM semantic checker** (correctness + economics).
- **SUPPORT: NOVELTY HOLDS.** No 2026 system (MemStrata, ATOM, Graphiti) combines
  all four components (canon + versioned provenance edges + staleness propagation
  + LLM semantic checking of NL). The nearest do versioned temporal facts and
  lack three of four. Inductive over leading candidates, not a universal proof.
- **ARCHITECTURE: shipped stack vindicated; un-built layers map onto proven
  patterns.** The banked accept-protocol design is the textbook
  idempotency + event-sourcing approach.

## Confirmed findings (cited)

### Viability

1. **Core assumption confirmed (3-0).** Semantic edits propagate consequences AND
   automated methods do this unreliably — validating *both* halves of the design.
   *RippleEdits* (Cohen et al., **TACL 2024**, arXiv 2307.12976): injecting one
   fact "introduces a ripple effect … additional facts that the model needs to
   update," and "current methods fail to introduce consistent changes." Follow-ups
   (RippleCOT 33.8% on MQuAKE-cf; ChainEdit 18.6%→58.7%, still open) cap
   auto-propagation at ~33–59% — well below a coherence guarantee, even for the
   in-context/reasoning methods that mirror VMark's own mechanism.
   **⚠ Correction:** the "~20%" the design rests on is the *automated-method
   success rate* (methods get ~20% right → fail ~80%), **not** an edit base-rate
   ("~20% of edits ripple"). Read correctly it *supports* human-as-scheduler.
   `vision.md`'s phrasing "~20% ripple accuracy" is right; do **not** restate it
   as "20% of edits ripple."

2. **Top risk — checker CORRECTNESS (3-0).** The LLM check cannot be a coherence
   oracle. *One Token to Fool LLM-as-a-Judge* (2507.08794, NeurIPS 2025): single
   symbols (":", ".") and generic openers ("Let's solve this step by step") elicit
   false-positive rewards up to ~80% across GPT-4o/o1/Claude-4 — **even in
   reference-based settings**. *Reliability without Validity* (2606.19544):
   reliability ≠ validity (test-retest ≥0.95 with position bias >0.10);
   human-agreement only κ ≈ 0.38–0.51 on MT-Bench; exact-match overstates
   discrimination by 33–41 points. **Implication:** the checker needs
   *deterministic/structural guardrails* (version-axis key gating,
   adversarial/degenerate-input filtering, position-swap/ensemble, confidence
   routing to the human) — treat it as fallible advice, never a gate. This
   validates the paper's I3 "advisory, never blocking," and raises the bar on
   guardrails.

3. **Top risk — checker ECONOMICS (3-0).** The accept-time check is the binding
   cost/latency constraint and is neither free nor high-precision. A control-plane
   study (2606.15903) measures the LLM mutation hook at ~2.3 s/case and ~$0.17 per
   385-case run vs 64–191 ms deterministic (~10–35× latency). ATOM (2510.22590):
   LLM atomic decomposition **drops** factual precision ~9% by inventing
   "semantically plausible but not strictly present" facts (false positives), at
   $1.55–$2.70 per ~1,000 articles. **Budget the checker as expensive + imperfect,
   confined to the accept path** (batching, caching, cheap-model triage,
   embeddings pre-filter). *Caveat: $0.17/2.3 s are DeepSeek-V3-specific; frontier
   models cost 10–100×.*

### Support

4. **Novelty HOLDS (3-0).** *MemStrata* (2606.26511, Jun 2026): bi-temporal ledger
   (valid_from/valid_to/superseded_by, as-of-time queryable) via **deterministic**
   (subject,relation,object) supersession — but no canon, no LLM check, **"per-fact
   only, no propagation."** *ATOM* (EACL-Findings 2026, 2510.22590): LLM-built
   temporal KG, but "update" is set-union of validity endpoints (temporal-validity
   bookkeeping, **not** consequence propagation), fully automated, no canon, no
   dependency staleness, no human ratification. ATOM's own survey notes temporal
   handling is "only Graphiti," whose edge-invalidation is same-edge, not
   dependent-propagation. **The four-way combination remains uncombined.**

### Architecture

5. **Transferable laws validated; shipped choices vindicated (3-0).**
   (a) *verification-external-not-blocking*: memory splits into a deterministic
   read/recall plane and an LLM-bearing mutation plane — "Recall path stays
   LLM-free" (2606.15903); the projection path can stay fast+deterministic while
   only mutation pays LLM cost. (b) *rebuilder-before-scheduler / human-as-
   scheduler*: *Build Systems à la Carte* (Mokhov/Mitchell/Peyton Jones, **JFP
   2020**) — any scheduler composes with any rebuilder; verifying traces work by
   "comparing hash digests of actual dependencies against previously recorded
   values" without timestamps = VMark's version axis exactly. (c) content-hash
   verifying-traces map onto the shipped content-addressed snapshot store. **The
   shipped append-only-ledger + CAS design and its ship-order are validated.**

6. **Un-built ACCEPT PROTOCOL = solved problem, proven primitives (3-0).**
   Idempotency key = **hash of the payload (or selected subset) composited with a
   stable operator id** (AWS Powertools: payload subset selectable to exclude
   volatile fields); a **two-phase INPROGRESS→COMPLETE** record locked by a
   **conditional write that rejects concurrent retries** (optimistic concurrency,
   no separate read); on a COMPLETE+unexpired retry **return the stored original
   receipt** without re-running; over the append-only ledger use **event-store OCC
   — reject the append if the stream changed since read, then reload/reevaluate/
   retry** (Microsoft Event Sourcing pattern; EventStoreDB). Pitfall: the
   INPROGRESS lock is bypassable only after a deliberately-set first-invocation +
   in-progress expiry. **This is a direct fit — and it is exactly the three
   BLOCKERs the banked `design-runtime.md` identified** (return-original-receipt;
   full-payload idem; OCC precondition).

7. **PROJECTION + INDEX options (3-0).** *DBSP* (Budiu et al., **VLDB 2023 Best
   Paper**, 2203.16684): a single general algorithm that mechanically
   incrementalizes *arbitrary* view queries — a credible incremental-view-
   maintenance foundation **if** projection volume grows (Feldera is the
   production embodiment). For the disposable index, **rusqlite/SQLite is
   validated — no surviving evidence favors switching**; **redb** (pure-Rust, ACID,
   MVCC single-writer) is the strongest pure-Rust alternative *if later preferred*.
   Recommendation is "SQLite validated, redb is the pure-Rust option," **not**
   "switch."

## Refuted claims (transparency — do NOT rely on these)

| Refuted claim | Vote | Why it matters |
|---|---|---|
| "~16.5% *bounded* ripple" corroborates a precise ripple estimate | 0-3 | Do **not** assert a precise ripple bound; ripple is real but its magnitude is not pinned. |
| Similarity/embedding staleness is *structurally impossible* (AUROC 0.59) | 0-3 | You **cannot** claim embeddings are provably useless for staleness/edge-inference; the version axis is preferred on *other* grounds, not because embeddings demonstrably fail. |
| LLM verification costs 8× and leaks stale facts 25–60% | 1-2 | Survived only partially; don't cite specific leak rates. |
| A mutation-time LLM hook **validates VMark's exact accept-time placement** | 1-2 | **The strong "literature endorses accept-time placement" transfer did NOT survive.** Only the weaker "read path stays LLM-free" (Finding 5) holds. Do **not** claim the literature endorses accept-time checker placement specifically. |

## Caveats

- **Domain transfer:** the strongest viability evidence is from *adjacent* domains
  — ripple data from parametric knowledge editing *inside LLM weights*, cost data
  from agent-memory forgetting benchmarks — transferred to VMark's NL-document
  domain by analogy. Mechanisms are domain-general; exact numbers do not transfer.
- **Cost figures** ($0.17/run, 2.3 s/case) are DeepSeek-V3-specific; frontier
  models 10–100×. Order-of-magnitude anchor, not a budget.
- **Novelty is inductive** over leading candidates (MemStrata, ATOM, Graphiti) —
  not a universal-absence proof.
- **Source quality:** several 2026 sources are non-peer-reviewed single-author
  preprints (MemStrata, control-plane, reliability-without-validity); anchors
  (RippleEdits TACL, à la Carte JFP, DBSP VLDB, ATOM EACL, AWS/Microsoft docs) are
  peer-reviewed/authoritative.
- **Multi-writer** CRDT/OT vs append-only-union: **unaddressed** by surviving
  evidence — the OCC findings cover single-stream conflicts only.

## Open questions (for follow-up)

1. **In-domain checker benchmark** — actual precision/recall and per-check cost of
   VMark's accept-time checker on real markdown docs. All cost/precision evidence
   is analogical; a VMark-native benchmark is needed before the checker budget is
   set. *(This is the verify-at-volume track — `verify-at-volume-baseline.md`.)*
2. **Checker guardrails** — which deterministic/structural guards wrap the checker
   so a fooled/degenerate check cannot silently pass (version-axis gating,
   reference-anchoring + relevance, adversarial-input filtering, position-swap/
   ensemble, confidence routing to the human)?
3. **IVM warranted?** — DBSP/differential-dataflow for projections, or is naive
   recompute-on-change sufficient at single-user-desktop scale? No evidence
   characterizes VMark's projection cardinality/update frequency.
4. **Multi-writer** — does append-only per-writer-segment + merge=union suffice as
   scope grows, or does real collaboration need CRDT/OT? Unaddressed.

## Actionable implications (synthesis)

1. **Correct the "~20%" phrasing** wherever it reads as a base-rate — it is the
   auto-propagation *success* rate (~20% right → ~80% wrong), which supports
   human-as-scheduler. `vision.md`'s "ripple accuracy" is fine; audit the proposal
   and any plan text.
2. **Do not claim the literature endorses accept-time checker placement**
   (refuted 1-2). The defensible claim is only "the read/projection path stays
   deterministic; the checker is confined to mutation."
3. **Add checker guardrails to the design** — I3 "advisory, never blocking" is
   validated but *insufficient alone*; the checker is foolable and reliable≠valid.
   Version-axis gating + adversarial-input filtering + ensemble/confidence-routing
   should be first-class, not afterthoughts.
4. **The banked accept-protocol design is on proven ground** — its three BLOCKERs
   are the textbook idempotency + event-sourcing patterns (Finding 6). When the
   operator build is funded, it implements a *solved* problem.
5. **No stack change warranted** — SQLite/rusqlite validated; redb noted as the
   pure-Rust option only. DBSP is a *future* projection option, not a now-need.

## Sources (24 fetched; anchors bold)

- **RippleEdits — arXiv 2307.12976 (TACL 2024)** · arXiv 2403.07825 (ripple bound, refuted)
- MemStrata — arXiv 2606.26511 · **ATOM — arXiv 2510.22590 (EACL-Findings 2026)** · control-plane — arXiv 2606.15903
- getzep.com (Zep/Graphiti) · callsphere.ai · graphlit.com (agent-memory survey)
- **One Token to Fool LLM-as-a-Judge — arXiv 2507.08794 (NeurIPS 2025)** · Reliability without Validity — arXiv 2606.19544 · llm-guard.com
- **Build Systems à la Carte — JFP 2020** (Cambridge) · Bazel caching (hashnode) · OpenUSD intro · DVC/lakeFS/Pachyderm guide (pistack)
- **AWS Powertools idempotency** · **Microsoft Event Sourcing pattern** · event-driven.io · dev.to (CQRS idempotency) · zuplo.com · tianpan.co
- **DBSP — arXiv 2203.16684 (VLDB 2023 Best Paper)** · **redb — github.com/cberner/redb** · tonsky.me (CRDT filesync)
