# Deep Research — Agent Memory, Academic NL Prior Art, Waiver Semantics (Pass 3, Final)

- **Date:** 2026-07-18 (all fetches live this day; Graphiti code citations verified against `main`)
- **Method:** deep-research workflow — 6 search angles, 24 sources fetched,
  119 falsifiable claims extracted, top 25 adversarially verified by 3-vote
  panels (18 confirmed, 7 refuted, 0 unverified). 107 agents.
- **Follow-up to:** `20260718-canon-provenance-staleness-landscape.md` (pass 1:
  AI-writing/AI-video products) and
  `20260718-versioned-edges-staleness-prior-art.md` (pass 2: VFX/build-system
  prior art). This pass covers the areas fetched but never verified in both:
  temporal-KG agent memory, academic NL prior art, and waiver semantics.

## Research question

(A) How exactly does Zep/Graphiti's bi-temporal fact invalidation work, and does
human ratification of supersession exist anywhere in agent memory? (B) Does
academic prior art combine dependency edges or staleness with NL semantic
checking — especially any TMS+LLM system? (C) Does a dated, reasoned waiver
object ("stale but accepted") exist anywhere in build/data pipelines? Plus the
final three-pass verdict.

## Final verdict (three-pass synthesis, medium confidence)

**The single closest system in the world to the four-capability combination is
Zep/Graphiti.** It uniquely combines fact-level provenance, LLM semantic
contradiction detection, and non-destructive temporal invalidation with
preserved history. What it lacks:

1. **Any human ratification/waiver/override of supersession** — invalidation is
   hardcoded-automatic (no source mentions a human step; the only manual path in
   Zep docs is destructive edge deletion).
2. **Dependency edges between documents** — its graph is episodes-to-facts, not
   doc-to-doc; no staleness propagation along edges.
3. **Any notion of version-pinning** — the VFX stack (pass 2) has pins but no
   semantics; Graphiti has semantics but no pins.

**No system found in any pass distinguishes "stale-by-version but semantically
still valid" from "stale-and-contradicted."** The VFX/DVC lineage is purely
version-number-based; the agent-memory lineage is purely semantic with no
version axis. That distinction — plus a dated, reasoned, human-ratified waiver
object over NL content — appears **genuinely unclaimed**. (Confidence medium
because parts of the negative rest on coverage gaps; see Caveats.)

## Verified findings

### 1. Graphiti implements genuine fact-level bi-temporality (high confidence, 4 claims merged, 11/12 votes)

Every entity-to-entity fact edge carries four timestamp slots —
`created_at`/`expired_at` on the transaction timeline (when the system
learned/invalidated the fact) and `valid_at`/`invalid_at` on the event timeline
(when the fact held true in the world). Contradicted facts are invalidated
(soft-expired), never deleted; the graph is queryable at any historical point
via composable date filters. Code-verified: `graphiti_core/edges.py`
(`EntityEdge` defines exactly those four fields),
`search/search_filters.py` (DateFilters, 8 comparison operators). Caveats: only
fact edges carry all four fields; `valid_at`/`invalid_at` are nullable
(LLM-extracted when temporal info exists); historical query is via date
filters, not a dedicated as-of(T) API. A vivid blog-derived claim that
superseded fact text is rewritten into past-tense form was **refuted 0-3** — do
not repeat it.

### 2. Invalidation is LLM-detected, rule-resolved, fully automatic — never human (high confidence, 5 claims merged, 13/15 votes)

An LLM compares each new edge against semantically related existing edges to
detect contradictions; resolution is then a **deterministic** `valid_at`
comparison — the edge with the later event-time wins ("newer" in event-time,
not ingestion order; current code can even expire the *newly ingested* edge if
an existing fact is more recent). Full-text searches of the arXiv paper
(2501.13956), README, docs overview, and engineering blog found **zero**
mentions of human review, ratification, override, or restoration of
supersession. Nuance from the one 2-1 vote: contradiction *detection* is
LLM-based, but *resolution* is rule-based — "LLM-decided" alone is imprecise.

### 3. Provenance is first-class in Graphiti (high confidence, 4 claims merged, 12-0)

Raw sources are ingested as discrete episodes (non-lossy ground truth); every
extracted entity and fact edge traces back to its source episode(s) via
bidirectional indices (`EntityEdge.episodes: list[str]` + episodic MENTIONS
edges). v0.29.0 (2026-04-27) extends this to multi-episode batched extraction.
Caveat: the manual `add_triplet()` injection path bypasses episode provenance.

### 4. Mem0 is likewise LLM-automatic with no human gate (high confidence, 3 claims merged, 8/9 votes)

An LLM extracts a facts array; an LLM decides ADD/UPDATE/DELETE/NONE per fact
(Mem0 paper, arXiv 2504.19413). The formerly user-customizable update-decision
prompt has been **removed** — the config parameter is now `custom_instructions`
(fact extraction only), verified in `mem0/configs/base.py` with no deprecated
alias. Mem0 does ship a fact-level history API (`client.history(memory_id)`:
old/new values with events) — observability, not a formation-time human gate.
`infer=False` bypasses extraction entirely; post-hoc manual update/delete APIs
exist.

### 5. Academic belief revision meets LLMs only inside model weights; propagation is a named open problem (high confidence, 2 claims, 6-0)

Hase et al. (TMLR 2024, arXiv 2406.19354) frames model editing as AGM belief
revision — but at the level of *model parameters*, not an external document/KB
layer. Critically, it names **propagation of an edit's consequences to
logically related facts** — the NL analogue of staleness propagation along
dependency edges — as one of 12 open problems that are "extremely difficult to
address." 2024–2026 follow-ups (RippleEdits, RippleCOT, ChainEdit, RippleBench,
EditPropBench) confirm ripple-effect propagation remains unsolved (~20% logical
generalization accuracy reported). **No JTMS/ATMS-style TMS+LLM system over
documents was verified in any of the three passes.**

## Refuted claims (do not rely on these)

| Claim | Vote |
|---|---|
| Graphiti's Feb–Jun 2026 releases (v0.27.0–v0.29.2) contain no invalidation changes and add no human-in-the-loop surface | 0-3 ✗ (window unverified — check before building) |
| Invalidation is purely LLM-decided via a dedicated "invalidation prompt" | 1-2 ✗ (detection LLM, resolution deterministic) |
| Superseded fact text is rewritten into past-tense form | 0-3 ✗ |
| Letta memory blocks are mutable prose with no per-fact granularity | 1-2 ✗ |
| Letta human edits are in-place overwrites, no ratification mechanism | 0-3 ✗ |
| Letta's only human control is a block-level read_only flag | 0-3 ✗ |
| Letta docs describe no versioning/provenance/temporal validity | 0-3 ✗ |

All seven Letta claims failed verification (docs page likely changed or claims
misdescribed it) — **Letta's memory model is UNVERIFIED, not verified-absent.**
The "no human ratification in agent memory" statement is confirmed only for
Zep/Graphiti and Mem0.

## Caveats and coverage gaps

- **Focus areas that produced ZERO surviving claims this pass:** narrative-
  consistency benchmarks (including what arXiv 2605.17596 / 2503.23512 actually
  are), incremental computation over prose, lenses/bidirectional transforms,
  Ink & Switch Jacquard/Patchwork cross-document questions, and the entirety of
  the waiver-semantics area (DVC freeze/commit, Bazel/Nix/Snakemake). Verdicts
  touching those rest on absence of verified evidence, not verified absence.
- Vendor docs mutate: the Mem0 custom-prompt URL was repurposed between passes;
  all doc-scoped absence claims are pinned to 2026-07-18.
- The Graphiti Feb–Jun 2026 release window is unverified (blanket "no changes"
  claim refuted); code citations against `main` on 2026-07-18 partially
  mitigate.

## Open questions (remaining after three passes)

1. Does DVC record who/when/why for `freeze`/`commit` (a dated, reasoned waiver
   object), or is it an undated flag like every other build system? (Area C
   entirely unanswered — small, checkable directly in DVC docs/source.)
2. What do Jacquard and Patchwork actually ship for cross-document dependency
   edges, provenance, or staleness? No claim survived.
3. Do Letta, cognee, or LangMem implement fact-level provenance/invalidation or
   human ratification — and has anyone applied temporal-KG agent memory to
   creative canon/worldbuilding? No evidence either way survived.
4. Did any Graphiti v0.27.0–v0.29.2 release change invalidation semantics or
   add a human-in-the-loop surface?

## Implications for VMark (three-pass synthesis)

- **Copy from Graphiti:** the bi-temporal schema (transaction time + event time
  on every canon fact/edge), soft-expiry instead of deletion, and
  episode-provenance with bidirectional indices. This is the semantic half of
  the design, shipped and code-verified.
- **Copy from the VFX stack (pass 2):** resolver indirection, automatic pin
  capture at generation time, pull-based breakdown view, human-initiated
  updates. This is the version half.
- **Net-new (unclaimed anywhere):** joining the two axes — version-pinned edges
  *and* semantic validity — so staleness splits into "stale-by-version but
  semantically still valid" vs "stale-and-contradicted"; plus the dated,
  reasoned, human-ratified waiver object; plus human ratification of
  supersession itself (Graphiti/Mem0 are automatic-only, and academia says the
  propagation half is unsolved — which argues for VMark's human-in-the-loop
  design rather than against it: the human scheduler sidesteps the open
  problem).

## Sources (fetched, selection)

Primary: arXiv 2501.13956 (Zep paper), help.getzep.com, github.com/getzep/graphiti
(+ releases, issue #1193), blog.getzep.com; docs.mem0.ai (custom prompt, add
operation, history API), arXiv 2504.19413 (Mem0 paper); docs.letta.com (memory
blocks — claims refuted); arXiv 2406.19354 (Hase et al. TMLR 2024), 2410.03122,
2507.08427; inkandswitch.com (Jacquard notebook + /03/, universal version
control, Patchwork 2024-version-control/07/); github.com/salsa-rs/salsa; ACM
self-adjusting computation; dvc.org (freeze, commit, dvcyaml); trivy.dev
(filtering). Secondary: codepointer.substack.com (agent-memory overview).

## Run stats

| Metric | Value |
|---|---|
| Search angles | 6 |
| Sources fetched | 24 |
| Claims extracted | 119 |
| Claims verified (3-vote panels) | 25 |
| Confirmed / refuted / unverified | 18 / 7 / 0 |
| Findings after synthesis | 6 |
| Agents | 107 |
