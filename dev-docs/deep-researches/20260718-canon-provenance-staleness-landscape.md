# Deep Research — Canon / Provenance / Staleness Landscape for Creative Work

- **Date:** 2026-07-18 (all live-page verifications performed this day)
- **Method:** deep-research workflow — 5 search angles, 23 primary sources fetched,
  110 falsifiable claims extracted, top 25 adversarially verified by 3-vote panels
  (22 confirmed, 3 refuted, 0 unverified). 105 agents total.
- **Motivating pain:** creative works are developed recursively across multiple
  co-constraining "engines" (e.g., fabula/syuzhet); git versions whole-tree
  snapshots not semantic dataflow; lint checks syntax not semantics; Obsidian-class
  tools treat knowledge as a fixed base with reference-links, not versioned
  dataflow edges.

## Research question

Does any existing tool, product, or research system combine:

- **(a)** an explicit canon/constraint store for creative work,
- **(b)** versioned dependency edges with provenance between semantic artifacts
  (e.g., "this scene was generated against character@v3"),
- **(c)** staleness propagation/visibility when upstream artifacts change,
- **(d)** LLM-powered semantic consistency checking over natural-language
  creative artifacts?

Purpose: establish whether this is a genuinely open product slot before building
it into VMark.

## Verdict

**No surveyed tool combines all four capabilities; the slot appears open.**

- **(a)** is commoditized — every surveyed AI-writing and AI-video product ships a
  canon/asset store (Novarrium locked bible, Novelcrafter Codex, Sudowrite Story
  Bible, Google Flow ingredients, LTX Studio Elements).
- **(d)** is rare — only Novarrium markets it, and only in self-published content
  (advertised, not independently demonstrated).
- **(b)** exists nowhere at the semantic level — the nearest analogue is ComfyUI's
  mechanical provenance recipes.
- **(c)** is universally absent — no surveyed product re-flags downstream
  artifacts when upstream canon changes. **Least attempted: (c), then (b).**

**Qualification:** openness is firmly established only within the AI-writing and
AI-video product space. Survey areas 3–6 (Ink & Switch lineage, USD/ShotGrid,
academic incremental computation/TMS, agent-memory products) produced no claims
that survived verification — they are *unexamined, not cleared*. USD layered
composition is the likeliest heavyweight prior art still unchecked.

## Capability scoreboard

| Product | (a) Canon store | (b) Versioned edges | (c) Staleness | (d) LLM checking |
|---|---|---|---|---|
| Novarrium | ✅ locked, auto-extracted | ❌ | ❌ | ⚠️ advertised, vendor-unverified |
| Novelcrafter | ✅ Codex + per-item revision history | ❌ mention links unversioned | ❌ | ❌ |
| Sudowrite | ✅ Story Bible ("source of truth") | ❌ context wiring, not recorded provenance | ❌ | ❌ |
| ComfyUI | — | ⚠️ mechanical graph, auto-embedded in outputs | ❌ | ❌ |
| Google Flow | ✅ visual "ingredients" + managed prompts | ❌ | ❌ | ❌ |
| LTX Studio | ✅ visual "Elements" | ❌ | ❌ | ❌ |

## Verified findings

### 1. Novarrium — closest single product (high confidence, 9-0 across 3 merged claims)

Launched early 2026 (inside the post-cutoff gap). Ships an explicit canon store —
story-bible facts automatically extracted from the manuscript and "locked" as
enforced canon ("Story Bible with Logic-Locking", Creator tier) — plus
per-chapter consistency verification via nine enumerated checks (Character
Traits, Dead Stay Dead, POV Enforced, Plot Points Hit, World Rules, Voice
Matched, Author Rules, Quality Scored, Bible Updated), mixing deterministic
scanning with AI-based checks. But its own comparison table and technical blog
describe **forward enforcement only**: no canon versioning, no record of which
canon version a chapter was generated against, no re-flagging of earlier
chapters when canon changes. The claim that contradictions act as hard gates
forcing regeneration was **refuted 0-3** — treat (d) as advertised checking, not
confirmed blocking enforcement.

Sources: novarrium.com (home, /pricing,
/blog/how-ai-story-consistency-works-technical-breakdown,
/blog/ai-story-bible-structured-memory).

### 2. Novelcrafter — most complete canon versioning, but it is backup, not dataflow (high confidence, 18-0 across 6 merged claims)

Per-item revision history covers Codex descriptions, Codex notes, scene content,
scene summaries, snippets, and custom prompt instructions; the Codex
automatically maintains mention-level reference links between prose and canon
entries (names/aliases recognized as you type). However: each item's history is
an independent loss-prevention timeline (documented purpose: backup and
undo/redo); restore is manual whole-item replacement; mention links are
unversioned (no "scene written against character@v3"); no staleness detection,
no change notifications, no LLM consistency checking against the Codex — its AI
analysis ("Smart Highlighting") targets prose quality, not canon consistency.
Changelog through July 2026 shows only mention-matching improvements. A claim
that "Progressions" overwrite lore in place was **refuted 0-3** and excluded.

Sources: novelcrafter.com (help/docs/organization/revision-history,
/features/codex, help/docs/codex/codex-tracking, feedback changelog).

### 3. Sudowrite — a real influence graph, but edges are consumed, never recorded (high confidence, 19-2 across 7 merged claims)

Docs specify a fixed generation-time influence graph (Braindump → Synopsis →
Characters/Worldbuilding → Outline → Scenes → Draft) and Chapter Continuity
(May 2025) creates explicit chapter-to-chapter links auto-created from Story
Bible Outlines. Every edge is **prompt-context wiring consumed at generation
time**, not recorded provenance: generation reads the *current* state of
upstream entries with no mechanism to pin or later inspect which version a scene
was generated against. Consistency is an emergent property of a larger context
window (up to 25 chapters / 20,000 words), not a verification mechanism. The
Story Bible docs (updated 2026-01-13) contain zero occurrences of "version",
"stale", "outdated", "consistency", "contradiction", or "sync". Nearest
provenance mechanism: history-card "chiclets" recording context *categories* and
word counts (plus, since June 2026, model) — coarse, not entry-version-level.

Sources: docs.sudowrite.com (What is Story Bible), feedback.sudowrite.com
(Chapter Continuity changelog, changelog index).

### 4. ComfyUI — the working proof of text-as-IR + automatic provenance (high confidence, 6-0 across 2 merged claims)

The only surveyed system with a working implementation of text-as-IR plus
automatic provenance recipes on derived binaries: a human-readable JSON file is
the canonical workflow representation ("very small, allowing convenient
versioning, archiving, and sharing of graphs, independently of any generated
media"), and the complete generating workflow graph is **automatically embedded
in the metadata of every generated image** — so pervasively that a GitHub issue
reports `--disable-metadata` failing to suppress it and a third-party node
exists solely to strip it. This is capability-(b)-adjacent — provenance attached
to outputs at zero user effort — but over a mechanical generation graph (nodes,
models, parameters), **not semantic natural-language artifacts**. No staleness
propagation or semantic checking. Caveats: recipes reference models/nodes by
name (reproduction needs the same assets installed); exported JSON uses unstable
node IDs, so clean git-diffing needs normalization.

Sources: docs.comfy.org/development/core-concepts/workflow,
github.com/Comfy-Org/ComfyUI/issues/6758.

### 5. AI-video "creative IDE" segment — consistency is purely visual, generation-time only (high confidence, 11-1 across 4 merged claims)

Google Flow's "ingredients" let a created subject/scene be re-inserted into new
clips "with consistency", and prompts are managed as organized, re-runnable
assets attached to their clips — a partial text-as-recipe pattern. But nothing
checks generated artifacts against the canon, and the February 2026 Flow update
(asset grid, Collections, @-referencing, Gemini editing) added no versioning,
staleness, or semantic checking. The only verification in the ecosystem is
SynthID watermarking (unrelated). LTX Studio's "Elements" (AI Characters,
Objects, Locations) is likewise a shipped project-level **visual** canon store
scoped to capability (a) only.

Sources: blog.google (Flow launch, Flow updates Feb 2026), ltx.io/studio,
help.ltx.io (Introduction to Elements).

### 6. Metadata-upkeep burden is the adoption killer; automatic capture is the proven alternative (medium confidence — inferential)

Sudowrite's docs place the consistency burden entirely on the user ("make sure
all your sections are consistent and delete anything out of date"), and its
feature board shows "Automatically update the Story Bible" as a 76-upvote
**Planned** item — direct evidence users feel the upkeep burden and the vendor
knows manual maintenance fails. Conversely, ComfyUI's provenance succeeded
precisely because it is captured automatically at generation time with zero user
effort. No surveyed product asks users to manually declare dependency edges —
the industry has implicitly concluded such declarations won't be maintained.
(No confirmed claim documents a shipped-then-abandoned dependency-tracking
feature, so direct "failed attempt" evidence is absent from the verified
record.)

## Implications for VMark (medium confidence — derived)

1. **The differentiating build is (b)+(c)** — versioned semantic dependency
   edges plus staleness propagation. (a) is commoditized; (d) is buildable but
   already marketed by one competitor. Retroactive re-flagging of downstream
   artifacts when canon@v3 becomes canon@v4 is the feature no one has shipped.
2. **Provenance edges must be recorded automatically as a side effect of
   generation** (ComfyUI's pattern: the recipe travels with the artifact), never
   as user-maintained metadata (Sudowrite's documented failure mode).
3. **VMark's plain-text local-first substrate fits**: ComfyUI demonstrates that
   a small, shareable, text-canonical representation of the dependency recipe is
   what makes provenance durable and versionable.
4. **Forward-only checking is the current ceiling** — backward propagation is
   unclaimed territory.

## Refuted claims (do not rely on these)

| Claim | Vote |
|---|---|
| Novarrium's consistency checking is a blocking enforcement pipeline (contradictions are hard gates forcing automatic regeneration) | 0-3 ✗ |
| Novelcrafter "Progressions" overwrite prior lore in place (no versioned states) | 0-3 ✗ |
| ComfyUI docs frame versioning as purely external file management (negative claim) | 1-2 ✗ |

## Caveats and coverage gaps

- **Source quality:** the verified record is dominated by vendor-authored
  primary sources. Appropriate for *negative* claims (vendors overstate, so
  absence from their own feature lists is strong evidence) but weak for positive
  efficacy claims — Novarrium's nine-check system is documented only in
  self-published SEO/marketing content with no independent testing.
- **Unexamined areas (searched and fetched, but no claims survived to the
  verified top-25):**
  - Ink & Switch lineage — unverified fetch layer indicates Patchwork
    (2024–2026, active) is version control for writers scoped to
    branches/diff/revert *within* documents; Upwelling (2023) versions text
    edits in a single document via Automerge. Neither has dependency edges or
    staleness.
  - Pixar USD layered composition / Flow Production Tracking (ShotGrid) — the
    likeliest heavyweight analogue to (b)+(c); **not cleared**.
  - Academic — unverified fetch layer surfaced "Lost in Stories: Consistency
    Bugs in Long Story Generation by LLMs" (arXiv 2603.05890, Mar 2026):
    ConStory-Bench, 2,000 prompts, taxonomy of 5 error categories / 19 subtypes
    — reusable as an error taxonomy for a capability-(d) checker.
  - Agent-memory products claiming "living" knowledge bases — unexamined.
- **Unsurveyed area-1 products:** Raptor Write, Plottr, World Anvil, Campfire,
  Scrivener ecosystem — plausibly weaker than the surveyed leaders, but
  unverified.
- **Time sensitivity:** Novarrium launched inside the Jan–Jul 2026 knowledge
  gap, so further gap-period launches may exist. Sudowrite's "Automatically
  update the Story Bible" is status Planned and could ship a partial (c) at any
  time. Two constituent claims passed only 2-1 (both corroborated by adjacent
  unanimous claims).

## Open questions

1. Does USD's layered composition (or ShotGrid) already implement version-pinned
   dependency references with staleness semantics in production film pipelines —
   and what does its metadata-upkeep model teach?
2. Has any academic/research system (incremental computation beyond code, TMS
   revival for LLMs, 2023–2026 narrative-coherence papers, Ink & Switch lineage)
   prototyped staleness propagation or versioned dependency edges over
   natural-language artifacts?
3. Does Novarrium's checking work at its advertised scale (100+ chapters), and
   does "Import Existing Series" perform any retroactive re-validation edging
   toward (c)?
4. When Sudowrite ships auto-update for the Story Bible, will it include any
   backward propagation, or remain forward-only extraction — i.e., how fast is
   the (c) gap closing among incumbents?

## Sources (fetched)

Primary: novarrium.com (home, pricing, 2 technical blog posts);
novelcrafter.com (revision-history doc, Codex feature page, codex-tracking doc,
feedback changelog); docs.sudowrite.com (Story Bible);
feedback.sudowrite.com (Chapter Continuity, changelog);
docs.comfy.org (workflow core concepts); blog.google (Flow launch, Flow Feb 2026
update); ltx.io/studio; ltx.studio product-updates; help.ltx.io (Elements);
inkandswitch.com (universal-version-control, patchwork notebook, upwelling,
dispatch-014); arxiv.org (2603.05890, 2605.06527, 2606.04990, 2605.17596).

Secondary/blog: novarrium.com comparison post, numonic.ai (PNG metadata
persistence guide), memorable-studio.com (Flora review), rivereditor.com (series
bible busywork guide), techdictionary.io (Sudowrite vs Novelcrafter),
academy.worldanvil.com (worldbuilder's disease).

## Run stats

| Metric | Value |
|---|---|
| Search angles | 5 |
| Sources fetched | 23 |
| Claims extracted | 110 |
| Claims verified (3-vote panels) | 25 |
| Confirmed / refuted / unverified | 22 / 3 / 0 |
| Findings after synthesis | 8 |
| Agents | 105 |
