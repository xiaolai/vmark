# Deep Research — Versioned Edges + Staleness: Prior Art Outside Consumer Creative Tools

- **Date:** 2026-07-18 (all doc fetches current this day; USD 26.05/26.08, breakdown2 v0.4.x)
- **Method:** deep-research workflow — 5 search angles, 25 primary sources fetched,
  123 falsifiable claims extracted, top 25 adversarially verified by 3-vote panels
  (23 confirmed, 2 refuted, 0 unverified). 107 agents (2 verify votes lost to a
  spend-limit interruption; findings unaffected).
- **Follow-up to:** `20260718-canon-provenance-staleness-landscape.md`, which
  established the four-capability slot — (a) canon store, (b) versioned dependency
  edges with provenance, (c) staleness propagation, (d) LLM semantic consistency
  checking — is open within the AI-writing/AI-video product space but left four
  prior-art areas unexamined.

## Research question

Does (b)+(c) prior art exist OUTSIDE consumer creative tools — in film/VFX
pipelines, data/build-pipeline engineering, NL-focused academic research, or
temporal agent-memory systems — and what design lessons transfer to VMark?

## Revised verdict

**Strong (b)+(c) prior art exists — in the VFX production stack — but none of it
operates over natural language, checks semantics, or has waiver semantics. The
four-capability slot for NL creative work remains open.** The reframe: VMark
would be **porting a proven VFX-pipeline pattern to natural language**, not
inventing from scratch. The differentiation burden is (a)+(d) plus waiver
semantics, layered on copied (b)+(c) mechanics. (Confidence: medium overall —
component findings are high-confidence and unanimous, but two of the four
commissioned areas again produced no verified claims; see Coverage gaps.)

## Verified findings

### 1. OpenUSD core: resolver indirection with deliberately zero version semantics (high confidence, 6 claims merged, unanimous)

The Ar (Asset Resolution) library maps logical asset references to physical
storage via studio-implemented `ArResolver` plugins (C++-only). A targeted
keyword pass confirmed "version", "pin", "latest", "stale", and "provenance"
appear **nowhere** in the core Ar API docs — version-pinning is a studio-side
convention built on `ArResolverContext` (scoped, bindable resolution state), not
a core feature. Sources: openusd.org (wp_ar2, Ar API), NVIDIA asset-structure
principles.

### 2. Two pinning models in the USD ecosystem (high confidence, 2 claims, both 3-0)

1. **Version embedded in the identifier** (`@MyAsset_v2.usd@`) — simplest;
   NVIDIA recommends it only for small projects.
2. **Resolver-indirected resource identifiers** (`@uri:/project/dept/MyAsset.usd@`)
   resolved against an external version-management system — the recommended
   model at scale. Direct transfer: literal-version references are VMark's cheap
   v1; resolver indirection is the scalable design.

### 3. USD has no automatic staleness propagation (high confidence, 3 claims, all 3-0)

Upstream-change detection is **pull-based** (`SdfLayer::Reload`;
`HasBackingStoreChanged` is manual polling; the only Ar notification fires on
resolver-config changes, not asset updates; no USD 24.x–26.x release added file
watching). The `assetInfo` metadata field is advisory and override-able —
"cannot be accurate when external dependencies can update." Push-vs-pull is an
explicit pipeline-design choice: assets with simple public interfaces can accept
pushed updates; assets with topology-specific downstream edits should use
explicit human-initiated pulls.

### 4. AYON: shipped resolver-based indirection with automatic provenance capture (high confidence, 4 claims merged, 3× 3-0, 1× 2-1)

USD files reference abstract entity URIs
(`ayon://project/folder?product=...&version=latest|hero|N`) translated to file
paths at runtime by an ArResolver plugin. **Live Mode** queries the server
per-URI so downstream always resolves latest (no pinning, no staleness concept).
**Pinning Mode** freezes URIs to fixed paths via a pinning file so all
render-farm workers resolve identical versions — a snapshot/reproducibility
semantic. The pinning file is **generated automatically at publish time**
(Houdini writes `__render___pin.json` recording what "latest" resolved to at
submission) — automatic provenance capture, shipped in production. (Scoping
caveats: auto-pinning requires a setting, currently Houdini-USD-render scope;
explicit-version URIs resolve fixed even in Live Mode.)

### 5. Flow Production Tracking breakdown apps: the strongest direct (b)+(c) prior art over creative artifacts (high confidence, 6 claims merged, all 3-0)

The Scene Breakdown apps (`tk-multi-breakdown`, successor `tk-multi-breakdown2`)
exist specifically to show artists which versioned file references in a scene
are out of date. Staleness is a **per-reference version comparison**
(referenced version < highest known version). v1 computed "highest" by
filesystem template scan; breakdown2 replaced this with **database queries over
PublishedFile records** ("We now use Flow Production Tracking instead of the
filesystem to determine the versions"). Dependency edges are captured
**automatically at scan time** — an engine hook scans the live DCC scene for
references and reconciles them to publish records by path; the artist never
hand-maintains a dependency list. Both apps actively maintained — living prior
art, not abandonware.

### 6. Propagation is human-initiated everywhere (high confidence, 2 claims, both 3-0)

Breakdown2 exposes explicit `update_to_latest_version` /
`update_to_specific_version` operations an artist must invoke; `auto_refresh`
refreshes only the staleness display, never the references. The publish
framework's lifecycle (collect/validate/publish/finalize) contains **no step
that notifies or flags downstream consumers** — "upstream updated, downstream
stale" surfacing is left to the separate pull-based breakdown tool plus human
coordination. Consistent with USD's pull-preferred principle.

### 7. Build Systems à la Carte: staleness detection is separable from regeneration (high confidence, 3-0)

Mokhov/Mitchell/Peyton Jones (ICFP 2018): any build system decomposes into a
**scheduler** (orders tasks along the dependency graph) and a **rebuilder**
(decides whether an artifact is out of date). VMark can therefore ship staleness
marking standalone — no regeneration/orchestration machinery required first.
Constraint surfaced in verification: rebuilders require dependency metadata
captured at task-run time — mapping directly onto VMark recording edges at
generation time.

## Design lessons for VMark (medium confidence — verified mechanisms, own transfer reasoning)

1. **Resolver indirection** — document references name logical artifacts
   (`character:aria`); a resolver maps name→version; pinning data lives in a
   separate context/pin file, never embedded in the reference (USD/AYON; NVIDIA
   explicitly warns embedded versions don't scale).
2. **Two-tier resolution** — default live/latest during drafting, plus
   **automatic snapshot pinning at generation time**: record what "latest"
   resolved to the moment an artifact is generated (AYON's auto pin file).
   Provenance capture must be automatic, not manual.
3. **Staleness as cheap version comparison in a dedicated pull-based
   "breakdown" view** — list stale references with per-item update-to-latest /
   update-to-specific actions; **never auto-propagate** (Breakdown2; the human
   decides convergence).
4. **Query a publish registry, not the filesystem, for "latest"**
   (Breakdown2's explicit v1→v2 lesson).
5. **Classify artifacts push-vs-pull** — simple-interface artifacts may
   auto-accept upstream updates; artifacts hand-edited after generation require
   explicit pulls (NVIDIA's principle — directly analogous to
   AI-generated-then-human-edited prose).
6. **Never trust author-editable metadata for provenance** — `assetInfo`'s
   documented failure; the system, not the document, records edges at
   generation/publish time.
7. **Build the rebuilder before the scheduler** — staleness detection first;
   regeneration orchestration later (Build Systems à la Carte).
8. **Waiver semantics must be invented, not copied** — no examined system
   distinguishes "stale but accepted" from "stale" beyond pinning (a pin is at
   best an implicit, undated waiver). An explicit, dated, per-edge waiver record
   is net-new design.

## Refuted claims (do not rely on these)

| Claim | Vote |
|---|---|
| tk-multi-publish2's `dependency_paths` is a first-class dependency-edge parameter populated by custom studio plugin code | 1-2 ✗ |
| tk-multi-publish2 provenance capture is "automatic per-publish after manual per-studio configuration" | 0-3 ✗ |

The publish framework's upstream-edge-capture story is **unresolved**; only the
breakdown apps' scan-time path-reconciliation model is verified.

## Coverage gaps and caveats

- **Areas 3 and 4 again produced zero verified claims** — academic NL prior art
  (Salsa/Adapton over NL, TMS/belief-revision revivals, narrative-consistency
  papers, lenses, Ink & Switch/Patchwork/Jacquard) and temporal-KG agent memory
  (Zep/Graphiti bi-temporal `t_valid`/`t_invalid` edges, Letta/MemGPT, Mem0,
  cognee). Sources were fetched (Jacquard notebook, Patchwork, Graphiti
  overview, several arXiv papers) but their claims didn't reach the verified
  top-25. **The "slot open" verdict stays provisional for those areas.**
- Area 2's concrete systems (DVC, Pachyderm, lakeFS, Snakemake/Nextflow, W3C
  PROV) were fetched but unverified — only Build Systems à la Carte survived.
- Several findings rest on rigorously verified **absence-of-evidence** keyword
  passes over docs — weaker than positive proof of absence in code.
- The ConStory-Bench arXiv identifier from the first report (2603.05890) was
  never verified and looks anomalous — re-check before citing.
- Two verify agents died on a spend-limit interruption (votes lost, not
  claims).

## Open questions

1. Do temporal-KG memory systems (Graphiti's bi-temporal edges with explicit
   fact invalidation) implement fact-level provenance + invalidation adaptable
   to creative canon — and is supersession LLM-made, rule-made, or human-made?
   (Biggest remaining hole.)
2. Does any 2023–2026 academic or Ink & Switch work apply dependency edges or
   staleness to natural-language documents — research prior art for (d)
   combined with (b)+(c)?
3. What are DVC's pinning/staleness/waiver semantics (`dvc status`, frozen
   stages, `dvc commit` as accept-divergence)? DVC's freeze/commit may be a
   better waiver template than inventing from scratch.
4. Does any prior art — in any domain — distinguish "stale by version number
   but semantically still valid" from "stale and contradicted", or is
   version-number staleness plus human judgment the universal ceiling that
   VMark's LLM semantic layer would genuinely be first to break?

## Sources (fetched, selection)

Primary: openusd.org (Ar 2.0 whitepaper, Ar API); NVIDIA Omniverse
asset-structure principles; help.ayon.app + docs.ayon.dev + github.com/ynput
(ayon-usd-resolver); github.com/shotgunsoftware/tk-multi-breakdown +
developers.shotgridsoftware.com (breakdown2, publish2 customization);
Microsoft Research (Build Systems à la Carte PDF); doc.dvc.org
(status/freeze/repro); docs.pachyderm.com (provenance, GlobalID);
inkandswitch.com (Jacquard notebook, Patchwork); arXiv (2603.05890,
2605.17596, 2503.23512, 2501.13956, 2606.26511, 2606.15903); plum-umd
Adapton. Secondary: USD Survival Guide (asset resolver chapter), ShotGrid
community forum thread on upstream published files.

## Run stats

| Metric | Value |
|---|---|
| Search angles | 5 |
| Sources fetched | 25 |
| Claims extracted | 123 |
| Claims verified (3-vote panels) | 25 |
| Confirmed / refuted / unverified | 23 / 2 / 0 |
| Findings after synthesis | 9 |
| Agents | 107 (2 lost to spend limit) |
