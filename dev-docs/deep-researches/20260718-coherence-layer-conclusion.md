# Conclusion & Proposal — A Coherence Layer for Recursively Developed Creative Work

- **Date:** 2026-07-18
- **Status:** Direction document — synthesis of a strategy discussion plus three
  verified deep-research passes. **Not a plan and not a commitment.** If the
  direction is adopted, the next artifact is a phased plan in
  `dev-docs/plans/` per rule 60.
- **Inputs:**
  - Strategy discussion (VMark → "Creative IDE" / "Artifact Workspace" /
    Movie-vertical question, incl. a cross-model Codex conversation)
  - `20260718-canon-provenance-staleness-landscape.md` (pass 1 — AI-writing /
    AI-video products)
  - `20260718-versioned-edges-staleness-prior-art.md` (pass 2 — VFX pipelines,
    build-system theory)
  - `20260718-graphiti-agent-memory-academic-priorart.md` (pass 3 — agent
    memory, academic NL, waiver semantics)

## 1. The problem, formalized

The founding pain: **recursive explosion**. Creative works are developed
recursively across multiple co-constraining "engines" (e.g., fabula ↔ syuzhet in
story development — neither is upstream; each increment in one can invalidate
the other). With more than two engines, cross-constraints grow roughly
quadratically. Git versions whole-tree snapshots, not semantic dataflow; lint
checks syntax, not semantics; Obsidian-class tools treat knowledge as a fixed
base with reference-links, not versioned dataflow edges.

Formal shape: **incremental computation over a cyclic, nondeterministic
dependency graph, where the human is the scheduler.** Build systems solve the
acyclic/deterministic version; creative work violates both assumptions, and
"converged" is a human judgment, not a fixed point.

Two structural observations that tame the explosion:

1. **The explosion is really invisible staleness.** Recursion is the creative
   process; what's unmanageable is holding in your head which artifacts were
   written against which version of which other artifacts. Make staleness
   first-class and visible, and the recursion becomes a work queue.
2. **A canon hub linearizes the pairwise blowup.** Every engine checks against
   a shared canon (established facts with provenance), not against every other
   engine — N checks instead of N².

A supporting insight: **natural language is the intermediate representation of
LLM-era creative pipelines; images/video/audio are build artifacts** (cache
outputs of text + model + params). Sources and derivation recipes stay in
plain text/git; binaries live in a content-addressed store referenced by
manifest. When a binary is promoted to canon (e.g., a chosen character
reference image), it becomes a first-class node with an ID and provenance.

## 2. What three verified research passes established

The four target capabilities: **(a)** explicit canon/constraint store,
**(b)** versioned dependency edges with provenance, **(c)** staleness
propagation/visibility, **(d)** LLM semantic consistency checking over NL.

| Domain (pass) | Has | Lacks |
|---|---|---|
| AI-writing tools (1) — Novarrium, Novelcrafter, Sudowrite | (a) commoditized; Novarrium advertises (d) | (b), (c) everywhere; consistency burden pushed onto users |
| AI-video tools (1) — Flow, LTX Studio | (a) visual only | Everything semantic; generation-time consistency only |
| ComfyUI (1) | Auto-embedded provenance recipes in every output | Semantic level; staleness; checking |
| VFX stack (2) — USD/Ar, AYON, Flow Production Tracking | (b)+(c) over binaries: resolver indirection, auto pin capture, breakdown views, human-initiated updates | Any semantics; NL; waiver records |
| Agent memory (3) — Zep/Graphiti, Mem0 | Bi-temporal fact edges, LLM contradiction detection, episode provenance | Human ratification (fully automatic); doc-to-doc edges; version pinning |
| Academic (3) — belief revision × LLMs | AGM framing at model-weights level | Consequence propagation named an unsolved open problem (~20% accuracy in ripple-edit literature); no TMS+LLM over documents found |

**Verdict:** no system combines the four capabilities. The two lineages are
complementary halves — VFX/DVC is version-only with no semantics; agent memory
is semantic-only with no version axis. **Nobody joins the axes**, and nobody
distinguishes *"stale-by-version but semantically still valid"* from
*"stale-and-contradicted."* No dated, reasoned, human-ratified waiver object
exists anywhere surveyed. (Residual holes: DVC freeze/commit metadata,
Jacquard/Patchwork cross-doc features, Letta — all unverified, not cleared;
each is a minutes-scale manual check at plan time.)

## 3. The proposal

**Build a coherence layer over plain-text creative artifacts in VMark** — not a
"Movie Studio," not an "Artifact Workspace" rebrand. Almost every component has
shipped prior art to copy; the invention surface is deliberately small.

### Copy (with provenance)

| Mechanism | Copied from |
|---|---|
| References name logical artifacts (`character:aria`); resolver maps name → version; pins live in a separate context/pin file, never in the reference | USD Ar / AYON; NVIDIA warns embedded versions don't scale |
| Live/latest resolution while drafting + automatic snapshot pinning at generation time (record what "latest" resolved to) | AYON auto pin file; ComfyUI embedded recipes |
| Staleness = cheap version comparison, surfaced in a dedicated pull-based breakdown view with per-item update actions; never auto-propagate | Flow Production Tracking breakdown2 |
| Query a registry for "latest," not the filesystem | breakdown2's v1 → v2 migration |
| Push-vs-pull classification per artifact (hand-edited-after-generation ⇒ explicit pull) | NVIDIA USD principle |
| System records edges at generation time; never trust author-editable metadata | `assetInfo` failure; ComfyUI default-on capture |
| Ship staleness detection (rebuilder) before any regeneration machinery (scheduler) | Build Systems à la Carte separability result |
| Bi-temporal canon facts (event time + transaction time), soft-expiry not deletion, provenance to source episodes | Graphiti (code-verified schema) |

### Invent (unclaimed anywhere)

1. **Two-axis staleness:** version staleness (cheap, deterministic) × semantic
   validity (LLM judgment against canon) ⇒ "stale but still valid" vs. "stale
   and contradicted."
2. **The waiver object:** dated, reasoned, per-edge, human-ratified "accepted
   divergence" (intentional inconsistency is a creative tool — unreliable
   narrators exist).
3. **Human-ratified supersession:** Graphiti/Mem0 are automatic-only; academia
   says automatic propagation is unsolved. Automatic *capture*, human-ratified
   *convergence* — the human-as-scheduler sidesteps the open problem instead of
   depending on it.

### Design laws (adoption-critical)

- **Edge declaration cannot be homework.** Edges are inferred (LLM detects that
  a scene references a character) and merely confirmed; manual declaration
  dies — no surveyed product even attempts it.
- **Early drafts need a greenhouse.** Nodes have maturity states; only
  *established* nodes emit constraints; staleness display is pull, not push,
  during drafting.
- **Provenance capture is a zero-effort side effect of generation** (ComfyUI
  pattern), or it rots (Sudowrite's documented failure mode; its top-voted
  feature request begs for automation).

## 4. Recommended sequence

1. **Keep VMark's identity untouched; ship toward 1.0.** No rebrand, no
   "Artifact" generalization. (Generalize from N ≥ 2 proven verticals, never
   from N = 0 — the Obsidian lesson correctly read: platform emerged from a
   great editor + extensibility, not from an upfront "Knowledge OS" design.)
2. **Dogfood one real recursive creative project** in today's VMark (workspace
   folder, canon files, agents via MCP) to confirm where the pain bites first.
   Days, not months; produces ground truth before any build.
3. **First increment: the breakdown view** — pinned edges + version staleness
   only. No LLM checking, no regeneration. Provably shippable standalone.
4. **Second increment: the semantic layer** — canon store + LLM
   validity-checking of stale edges (reuse existing `ValidationDiagnostic`
   surface) + waiver objects.
5. **Movie/visual verticals as format adapters later**, if the dogfood pulls
   them; the adapter registry already exists. Artifact-abstraction extraction
   only when a second vertical shares real seams.

## 5. One-sentence conclusion

A version-control-grade coherence layer for recursively developed creative
work is a real, three-pass-verified gap; the winning design is mostly assembly
of proven parts (Graphiti's semantic half + the VFX stack's version half), and
the sole defensible invention — human-ratified, two-axis semantic staleness
with waivers — is exactly the piece both industry and academia have either
avoided or failed to automate.

## 6. Core value statement (addendum, same day)

Proposed formulation: *VMark's core value, as a writers'/creators' tool, is the
maintenance / validation / audit / version control of semantic edges.*

**Endorsed at the architecture level.** The four verbs map one-to-one onto the
four capabilities:

| Verb | Capability | Mechanism |
|---|---|---|
| Maintain | (b) capture | Automatic edge recording at generation time |
| Validate | (d) checking | LLM semantic check of artifacts against canon |
| Audit | (c) surfacing | Breakdown view + provenance inspection |
| Version control | (b) pinning | Version-pinned edges + bi-temporal canon history |

Three refinements are load-bearing — dropping any of them changes the product
into something that either already exists or predictably dies:

1. **Edges are the mechanism; the sellable value is coherence under
   recursion.** Creators don't want "semantic edge version control"; they want
   to rewrite aggressively and *know* what broke, what didn't, and what they
   already chose to leave divergent. Build the edge layer; sell "recurse
   without fear." (Sudowrite's top-voted request was phrased as relief from
   manual bible upkeep, not as edges.)
2. **Not edges alone — edges plus the human-ratified convergence loop.**
   Automatic edge semantics already exist (Graphiti maintains, validates, and
   versions semantic relationships fully automatically) — and that automation
   is precisely why it is unusable as creative canon. The unclaimed part is the
   governance model: machine captures and surfaces; human ratifies convergence;
   waivers record intentional divergence.
3. **The editor is not demoted — it is what makes the moat possible.** The
   clearest failure law from the research: manually maintained metadata dies,
   always. Zero-effort edge capture requires owning the surface where creation
   happens (editor + agent runtime + MCP bridge). A standalone edge tool over
   externally edited files degrades to manual upkeep. Stack reading: editor =
   commodity but mandatory as the *sensor*; canon = the hub; semantic-edge
   layer = the moat; agents = the hands.

Endorsed one-liner: **VMark's core value is doing for the relationships between
creative artifacts what git did for code files — with the human as the merge
authority and the LLM as the diff engine for meaning.**

## 7. The kernel (addendum, same day) — three atoms for a recursively evolving knowledge base

Proposed kernel (Xiaolai), adopted with two amendments. Everything else —
character, theorem, API, experiment, prompt, scene, task, claim, waiver — is
schema and transformations on top.

### 7.1 Atoms

1. **Semantic Object** — a persistent identity plus a revision history.
   Content is stored as content-addressed snapshots, never operational deltas
   (prose edits don't compose algebraically). Split/merge preserve identity
   lineage via ordinary transformations recording "derived-from" — the moments
   creative identity changes are exactly where provenance must not break.
   Object *kind* is schema (userland), not kernel. Rationale: persistent
   identity is precisely what git lacks (content tracking + rename heuristics),
   and its absence is why git cannot host staleness or provenance.

2. **Transformation** — an immutable event **with a recorded input set**
   (Amendment 1, non-negotiable):
   `{ inputs: [(object @ revision)…], outputs: [(object @ new-revision)…],
   agent, intent (prompt/params/instructions), timestamp }`.
   A provenance *record*, not a replayable function — LLM nondeterminism means
   chosen outputs are precious, not cache. **No write enters the system except
   through a transformation.** Dependency edges are never declared; they are
   *observed*: "T produced scene-12@v4 while reading elena@v3" *is* the edge.
   This is what makes edge capture a zero-effort side effect of generation
   (the ComfyUI/AYON law) and staleness kernel-computable. Without recorded
   inputs, relations demote to userland schema and the universal breakdown
   view — the moat — is unbuildable.

3. **Context** — a scope of truth, deliberately narrow (Amendment 2):
   `{ selections: object → pinned revision | live, visible-claims,
   canon-status: enforcing | greenhouse, parent? }`.
   The thing a document is opened *in*: which versions you see, which canon
   constrains you. Composition is single-inheritance overlay only (child
   overrides parent) until a real vertical forces more — resisting USD's
   LIVRPS-scale composition algebra, the hardest part of USD. Branch = forked
   context; variant = context with different selections; greenhouse mode =
   non-enforcing context (early drafts thrive on incoherence; only enforcing
   contexts emit constraints). Naming/namespacing is schema, not kernel.

### 7.2 Everything else is derived

| Derived | How it falls out of the atoms |
|---|---|
| Dependency edges | Transformation input sets — kernel-computable, auto-captured |
| Version staleness | Edge pins A@v; A has advanced past v → stale. Pure, deterministic, cheap |
| Semantic staleness | LLM layer judges stale edges against visible claims → *stale-but-valid* vs *stale-contradicted* |
| Canon | Claim-objects visible in an enforcing context |
| Waiver | Schema'd object referencing an edge/violation + reason + date + author |
| Audit / provenance | The transformation log read backwards |
| Declarative relations ("Elena is Marcus's daughter") | Claim-objects — schema level, as originally proposed; only *derivation* edges are kernel-observable |
| Fabula / syuzhet | Two contexts (or object families) over shared objects; cross-projection scenes carry observed derivation edges to the events/characters they read |

### 7.3 Invariants

1. Every write is a transformation (everything has provenance).
2. History is append-only (transformations never mutate the past).
3. The kernel *computes* staleness; only a human — or an explicitly delegated
   agent — *resolves* it: ratify, update, or waive.
4. Constraints flow only from enforcing contexts (greenhouse is sacred).

### 7.4 Mapping to VMark's substrate

- Objects: markdown files/sections with stable IDs in frontmatter.
- Transformation ledger: append-only JSONL sidecar per workspace (plain text,
  git-diffable).
- Contexts: small pin-file manifests (the AYON pattern).
- Binaries: content-addressed cache outside git, referenced by manifest;
  promoted binaries become first-class objects with provenance.
- Capture sensors: the editor, MCP bridge, and agent runtime. Input capture is
  **exact for AI generations** (the prompt context is known precisely) and
  **heuristic for human edits** (LLM-inferred references, lazily confirmed).
  The first increment — the breakdown view — is already valuable on
  AI-generation edges alone, so human-edit inference does not block v1.

### 7.5 Explicitly not in the kernel

Schemas; the LLM checking layer; all UI; any regeneration/orchestration
machinery (rebuilder before scheduler — staleness marking ships standalone).

### 7.6 Precedent check

The trio matches three independent lineages — Datomic (entity / immutable
transaction / database-as-value), event sourcing + DDD (aggregate / event /
bounded context), USD (prim identity / layer opinions / composition context) —
while fixing git's identity gap and adding what none of the precedents have:
recorded input sets that make semantic dependency edges observable rather than
declared, and a human-resolution invariant over staleness.

### 7.7 Storage architecture: three tiers, database never authoritative

Neither "database as truth" nor "frontmatter only." Each tier holds only what
it is structurally right for:

| Tier | Holds | Properties |
|---|---|---|
| Frontmatter (in the markdown file) | Author-owned object facts only: stable ID, schema/type, declared claims | Human-editable is *correct* here; minimal and low-churn |
| Plain-text sidecar ledger (`.vmark/` in workspace) | Canonical provenance: append-only JSONL transformation log, context pin manifests, waivers, content hashes into the snapshot store | System-written, git-tracked, diffable; append-only JSONL merges benignly. **Source of truth for edges** |
| SQLite (per workspace, gitignored) | Derived indices only: materialized edges, staleness cache, current-revision map, search | **Disposable by invariant** — delete it, lose nothing; rebuilt from tiers 1+2 by scan |

Why frontmatter-only fails: (1) provenance in author-editable metadata is the
verified `assetInfo` failure mode — the system, not the document, must record
edges; (2) transformations are workspace-level multi-object events that belong
to no single file, and writing them into output files churns content history
with metadata; (3) no query surface — the breakdown view needs "all stale
edges, now," not an O(workspace) frontmatter parse.

Why database-as-truth fails: it forfeits exactly the properties that made the
pattern win in the research (ComfyUI: small, text, shareable, versionable
independently of any tool) — SQLite is opaque to git, invisible to other
agents reading the workspace, tool-locked, and corruption there would mean
data loss instead of a rebuild.

Precedents for "plain/append-only truth + rebuildable index": Obsidian's
metadata cache, git's index over its object store, Datomic's log-vs-indices
split.

Consequences: external edits (other tools, other agents, the user in vim) are
reconciled by rescan, synthesizing an "observed external edit" transformation
with unknown inputs so history stays gap-free. Revision content is *not*
derivable once a file moves on, so the `.vmark/` snapshot store is canonical
for historical text — lean on git blobs when the workspace is a repo, but the
kernel must not require git.
