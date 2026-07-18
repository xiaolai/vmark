# Coherence Layer On-Disk Format — v0

- **Status:** Draft v0 — the public contract for Phase 1 implementation
  (R21: written and versioned before implementation).
- **Date:** 2026-07-18
- **Contract:** `dev-docs/coherence-layer-paper.md` v1.1. This spec covers
  WI-0.1 (schemas) and WI-0.2 (kernel decisions) of
  `dev-docs/plans/20260718-coherence-layer.md`. Traces: R5, R6, R10, R17,
  R19, R20, R24, R25, R28, R30, R31, R32, I5, O6, O7, M1–M5.
- **Versioning policy:** every serialized record carries `"format": 0`.
  Breaking changes bump the format number; readers must reject records with
  a format number greater than the highest they understand, and must
  preserve (never rewrite) records with older format numbers. Additive
  fields are allowed within a format version; readers ignore unknown fields.

## 1. Workspace layout

All coherence state lives under `.vmark/` at the workspace root:

| Path | Contents | Git status |
|---|---|---|
| `.vmark/ledger/<writer-id>.jsonl` | Append-only transformation/resolution segments, one file per writer | Tracked; `merge=union` |
| `.vmark/ledger/quarantine/` | Malformed-entry quarantine (see §5.6) | Tracked |
| `.vmark/contexts/*.json` | Context pin manifests | Tracked |
| `.vmark/snapshots/sha256/<aa>/<hash>` | Content-addressed snapshot store (CAS) | Per-workspace user choice; **default: tracked** (see §4.4) |
| `.vmark/index.db` | SQLite index — strictly derived (R16) | **Gitignored, always** |
| `.vmark/.gitignore` | Written by the kernel on first init; ignores `index.db*` | Tracked |
| `.vmark/.gitattributes` | Written by the kernel on first init; `ledger/*.jsonl merge=union` | Tracked |

The kernel initializes `.vmark/` lazily on the first captured transformation
in a workspace, never on mere open. A workspace without `.vmark/` has no
coherence state and the kernel treats every query against it as empty.

The kernel must not require git (R19). All layout above is plain filesystem;
the git-related files are inert outside a repository.

## 2. Identity

### 2.1 Object identity — frontmatter convention (R5)

A Semantic Object is identified by a stable ID carried in the document's
YAML frontmatter under the single reserved top-level key `vmark`:

```yaml
---
title: Elena          # author-owned, not reserved
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
  schema: character   # optional; userland object kind
---
```

Rules:

- `vmark.id` is a **UUIDv7** (time-ordered, collision-free across writers).
  It is assigned by the kernel on **first capture** of the file (never on
  mere open), by rewriting frontmatter in the same atomic write that
  captured the content.
- `vmark.id` and `vmark.schema` are the only reserved keys in v0. Everything
  else in frontmatter is author-owned and never written by the kernel.
- Frontmatter holds **only author-owned facts** (R5): stable ID, schema.
  Provenance never appears in frontmatter.
- **Duplicate IDs** (file copied, then both edited) are detected on scan and
  surfaced to the human — never auto-resolved (I3). Until resolved, the
  kernel treats the duplicate set as read-only for capture: it records
  observed-external transformations against a synthetic `duplicate-of:`
  object and raises a workspace diagnostic.
- A file with no frontmatter gets a frontmatter block prepended at first
  capture. A file with frontmatter but no `vmark` key gets the key added.
  Identity assignment does **not** create a new revision (§3.3).
- Binary files cannot carry frontmatter; a binary promoted to canon (R20)
  gets its identity in the ledger only (`object-registered` entry, §5.4.6).

### 2.2 Writer identity (O7)

A **writer** is one program instance appending to the ledger. Writer
identity must not be shared through git (two clones of one repo are two
writers), so it lives outside the workspace:

- VMark stores a per-installation UUIDv7 at
  `<app-data-dir>/coherence-writer-id` (created once, reused for every
  workspace on that installation).
- Segment files are named `<writer-id>.jsonl`. A writer only ever appends
  to its own segment (§5.1). Reading always merges all segments.
- Non-VMark writers (future CLI, CI) follow the same rule: own stable ID,
  own segment. The format does not distinguish writer *kinds*; the `agent`
  field of each entry does (§5.4.1).

### 2.3 Revision identity (R6, R30)

Revision identity is **content hash + parent links** — a DAG, exactly like
git commits, never a counter:

```
revision_id = "rev1:" + hex( SHA-256( "vmark-rev\n"
                                      + content_hash + "\n"
                                      + parent_1 + "\n"     # sorted
                                      + parent_2 + "\n"
                                      + ... ) )
```

- `content_hash` is the canonicalized content hash (§3).
- Parents are the revision IDs this revision supersedes, **sorted
  lexicographically** before hashing (R30: parent ordering is fixed).
- Zero parents = root revision. Two+ parents = merge revision.
- The `rev1:` prefix names the identity scheme; a future hash migration
  introduces `rev2:` without ambiguity.
- Sequential labels ("v4") are derived display names computed by the UI
  from DAG depth; they are never stored and never identity.

Re-creating identical content later (A → B → A) yields a distinct revision:
same `content_hash`, different parents, therefore different `revision_id`.

## 3. Canonicalization and hashing (R30)

### 3.1 Text canonical form

Applied to markdown/text content **for hashing and snapshot storage**:

1. Decode as UTF-8 (invalid UTF-8 ⇒ the file is treated as binary, §3.4).
2. Normalize Unicode to **NFC**.
3. Normalize line endings to **LF**.
4. No other transformation — trailing whitespace, final-newline presence,
   and indentation are content, not noise.

### 3.2 Content hash

```
content_hash = "sha256:" + hex( SHA-256( identity_masked( canonical_bytes ) ) )
```

`identity_masked` removes the **reserved identity keys** from the hashed
bytes (R30): the `vmark.id` and `vmark.schema` lines within the
frontmatter block are deleted (and an empty resulting `vmark:` mapping is
deleted with them, along with a frontmatter block emptied entirely by
the masking) before hashing. Everything else, including all author-owned
frontmatter, is hashed as-is.

### 3.3 The identity-exclusion property

Because identity keys are masked out, **assigning an ID to a file does not
change its content hash** and therefore does not create a new revision.
This is what lets the kernel adopt an existing workspace without minting a
spurious "edit" for every file it touches. WI-1.3 carries the test.

### 3.4 Binary content

Files that are not valid UTF-8, plus extensions declared binary by the
format adapter registry (images, audio, video, PDFs), are hashed as raw
bytes with no canonicalization and no identity masking:
`content_hash = "sha256:" + hex(SHA-256(raw_bytes))`.

## 4. Snapshot store (CAS) — R19, R20

### 4.1 Layout

```
.vmark/snapshots/sha256/<first-2-hex>/<remaining-62-hex>
```

Keyed by `content_hash` (without the `sha256:` prefix in the path; the
directory level names the algorithm).

### 4.2 Contents

- **Text:** the canonical bytes (§3.1) of the full file **including** its
  frontmatter identity block. Masking (§3.2) applies to hashing only, never
  to stored bytes. Two byte-sequences that differ only in identity keys
  share one hash; first write wins — the ledger, not the snapshot, is
  authoritative for which object a revision belongs to.
- **Binary:** the raw bytes.

### 4.3 Write protocol

Write to `.vmark/snapshots/tmp/<uuid>`, fsync, rename into place, then
(best-effort) fsync the parent directory. A snapshot that already exists
is never rewritten (identical hash = identical content). Snapshots are
**never deleted** in v0 — retention/GC is O3, out of scope.

### 4.4 Git tracking default

Snapshot-store git tracking is a per-workspace user choice (paper §7).
**Default: tracked.** Rationale: the dogfood protocol needs historical
revision content to survive clones and machine moves; text snapshots are
small and pack well; a user with large binary CAS content can flip the
workspace setting, which writes `snapshots/` into `.vmark/.gitignore`.
Git blobs remain opportunistic, never load-bearing (R19).

## 5. Ledger (R17)

### 5.1 Segments and the multi-writer protocol (O7)

- One JSONL file per writer: `.vmark/ledger/<writer-id>.jsonl`. A writer
  appends **only** to its own segment; concurrent VMark windows on one
  installation share one writer ID and serialize appends through a single
  kernel instance per workspace (in-process mutex; cross-process safety
  comes from per-writer files plus O_APPEND single-line writes).
- Entries are **self-identified and order-independent** (R17): each carries
  its own UUIDv7 `id`, RFC 3339 UTC `time`, `writer`, and causal references
  by ID. File order and cross-segment interleaving are meaningless; readers
  merge all segments and may sort by (`time`, `id`) for display only.
- **Idempotency:** each entry carries an `idem` key — a deterministic
  digest of the logical operation (§5.4 defines the recipe per kind).
  Readers de-duplicate by `idem`, keeping the entry with the smallest
  (`time`, `id`). Replays after crash recovery are therefore harmless.
- **Rotation:** when a segment exceeds 8 MiB, the writer starts
  `<writer-id>-<NNN>.jsonl` (NNN = next integer, zero-padded to 3). All
  segments of a writer remain part of the ledger forever.

### 5.2 Atomicity, fsync, crash recovery

- An append is a single `write()` of one complete line (`\n`-terminated
  UTF-8 JSON, no internal newlines) to a file opened with `O_APPEND`,
  followed by `fsync`. The fsync policy is per-entry for `transformation`,
  `ratification`, `waiver`, and `object-registered` entries; `navigation`
  and `check-result` entries may be batched (flushed within 1 s or on
  shutdown).
- Snapshot writes (§4.3) happen **before** the ledger append that
  references them. Crash between the two leaves an orphan snapshot —
  harmless. Crash mid-append leaves a torn final line — handled by
  quarantine (§5.6). There is no state in which the ledger references
  content that does not exist.
- **Torn-tail termination (G1 finding):** before appending, if the
  writer's own segment does not end with `\n` (torn tail from a crash),
  the writer first appends a single `\n`, so the torn fragment becomes its
  own malformed line (quarantined on read) instead of corrupting the next
  entry. Writers never rewrite or truncate a segment — termination is the
  only permitted repair.

### 5.3 Entry envelope

Every line is one JSON object:

```json
{
  "format": 0,
  "id": "018f3c7a-a001-7def-8a3c-1b2c3d4e5f60",
  "kind": "transformation",
  "time": "2026-07-18T09:30:12.415Z",
  "writer": "018f3c7a-0000-7abc-9def-000000000001",
  "idem": "sha256:…",
  "body": { }
}
```

`kind` ∈ { `transformation`, `navigation`, `ratification`, `waiver`,
`check-result`, `claim`, `object-registered`, `diagnostic` }. Unknown kinds
are preserved and ignored by readers (forward compatibility).

### 5.4 Entry kinds

#### 5.4.1 `transformation` (R1–R4, R24, R28, I1, I2)

```json
{
  "inputs":  [ { "object": "<uuid>", "revision": "rev1:…", "role": "direct" },
               { "object": "<uuid>", "revision": "rev1:…", "role": "contextual" } ],
  "outputs": [ { "object": "<uuid>", "revision": "rev1:…",
                 "content_hash": "sha256:…", "parents": ["rev1:…"] } ],
  "agent": { "type": "model", "id": "claude-fable-5" },
  "intent": { "kind": "genie", "summary": "Rewrite scene 12 against Elena v3" },
  "confidence": "exact"
}
```

- `inputs[].role` is the input-set taxonomy tag (§7): only `direct` and
  `contextual` appear; `incidental` material is excluded at capture.
- `agent.type` ∈ { `human`, `model`, `external`, `git` }; `agent.id` is the
  model ID, the git operation, or absent for human.
- `intent` is a small structured record (kind + human-readable summary;
  optionally `prompt_hash` referencing a CAS snapshot of the full prompt —
  never the full prompt inline, to keep segments small and diffable).
- `confidence` ∈ { `exact`, `inferred`, `unknown` } (§8).
- `outputs[].parents` are the DAG parents of the new revision; the entry is
  self-contained enough to rebuild the DAG without any other source (R16).
- History is append-only: no entry kind updates or deletes a
  transformation (I2, I5).
- `idem` recipe: `SHA-256("txf\n" + sorted output (object, revision) pairs)`.

#### 5.4.2 `navigation` (R18)

Records a git state-jump. **Never mints revisions.**

```json
{ "git": { "op": "checkout", "from": "<sha>", "to": "<sha>", "ref": "main" } }
```

`op` ∈ { `checkout`, `branch-switch`, `reset`, `detach`, `worktree-switch` }.
`idem` recipe: `SHA-256("nav\n" + from + "\n" + to + "\n" + coarse-time)`
where coarse-time is `time` truncated to the second (dedupes double events
from the watcher).

#### 5.4.3 `ratification` and `waiver` (R13, R15, I5)

Resolution records about an **origin edge**, identified by the pair
(transformation entry `id`, input index) plus the revisions being judged:

```json
{
  "edge": { "txf": "<entry-uuid>", "input": 0 },
  "upstream_object": "<uuid>",
  "pinned": "rev1:…",
  "resolved_against": "rev1:…",
  "actor": { "type": "human", "id": "xiaolai" },
  "reason": "Divergence intentional — unreliable narrator in ch. 3"
}
```

- A **ratification** asserts the downstream artifact is compatible with
  `resolved_against` (the newer upstream revision). Projection treats the
  edge as Fresh while the context still selects `resolved_against`.
- A **waiver** accepts divergence: same shape, plus `reason` (required for
  waivers, optional for ratifications) and optional `expires` (RFC 3339).
  v0 waiver scope is strictly **per-edge, per-upstream-revision**: when the
  upstream advances past `resolved_against`, the edge re-enters
  VersionStale and the waiver stays in history, inert (O8 refines later).
- A waiver is **revoked** by appending a ratification or a newer waiver for
  the same edge; records are never edited or deleted (I5).
- `actor` requires an identity; agent-performed resolution additionally
  requires a recorded delegation (R29 — mutating surface is Phase 3; v0
  records only human actors).
- `idem` recipe: `SHA-256(kind + "\n" + txf + "\n" + input + "\n" +
  resolved_against + "\n" + actor.id)`.

#### 5.4.4 `check-result` (R25)

Append-only semantic-check assessments (Phase 2b writes these; the schema
is fixed now so Phase 1 readers already preserve them):

```json
{
  "edge": { "txf": "<entry-uuid>", "input": 0 },
  "pinned": "rev1:…",
  "checked_against": "rev1:…",
  "verdict": "no-contradiction",
  "model": "claude-fable-5",
  "prompt_version": "check-v1",
  "evidence": [ { "object": "<uuid>", "quote": "…", "loc": "L120-L134" } ],
  "confidence": 0.83
}
```

- `verdict` ∈ { `no-contradiction`, `contradiction`, `unknown` }.
  **`unknown` is first-class** (provider down, timeout, malformed output,
  confidence below threshold) and is never collapsed into either other
  state.
- A result **expires** when either endpoint advances: projection ignores
  results whose (`pinned`, `checked_against`) no longer match the pair
  under comparison. Expired results remain in history.

#### 5.4.5 `claim` (R32)

Bi-temporal canon facts (Phase 2b behavior; schema fixed now):

```json
{
  "claim": "<uuid>",
  "statement": "Elena is Marcus's daughter",
  "valid_at": "2026-07-01T00:00:00Z",
  "invalid_at": null,
  "established_by": [ { "object": "<uuid>", "revision": "rev1:…" } ],
  "supersedes": null,
  "maturity": "draft"
}
```

Event time (`valid_at`/`invalid_at` — when the fact holds in the story
world) is distinct from transaction time (the envelope `time` plus a later
superseding entry's `time` — when the system learned/retired it). Claims
soft-expire by supersession (`supersedes` points at the older claim entry),
never by deletion. `maturity` ∈ { `draft`, `established` } (R33).

#### 5.4.6 `object-registered`

Introduces an object that cannot carry frontmatter (binaries, R20) or
records identity lineage on split/merge (R8):

```json
{ "object": "<uuid>", "path": "art/elena-ref.png", "schema": "image",
  "derived_from": ["<uuid>"] }
```

#### 5.4.7 `diagnostic`

Workspace-level findings that must survive restarts (duplicate IDs §2.1,
quarantined segments §5.6). Advisory; projections may recompute them.

### 5.5 Git merge behavior

`.vmark/.gitattributes` declares `ledger/*.jsonl merge=union`. Per-writer
segments make same-file concurrent appends rare (two branches of one clone
share a writer ID — the union driver resolves the EOF race); entries being
self-identified and idempotent makes any resulting duplication or
reordering harmless. Spike S1 (WI-0.5) verifies this end-to-end.

### 5.6 Malformed entries — quarantine

A reader encountering a line that is not valid JSON, lacks a valid
envelope, or fails schema validation for a **known** kind:

1. Copies the raw line to `.vmark/ledger/quarantine/<segment>.bad` with a
   `# line N, reason` comment line above it (append-only).
2. Skips it (the ledger read succeeds without it).
3. Emits a `diagnostic` entry (once per offending line, keyed by `idem` =
   digest of segment + line content) and surfaces it in the UI.

A torn final line (crash mid-append, §5.2) is the expected common case.
Quarantine files are never auto-deleted. Unknown `kind` values are **not**
malformed (§5.3).

## 6. Contexts — pin manifests

One JSON file per context in `.vmark/contexts/`:

```json
{
  "format": 0,
  "id": "018f3c7a-b002-7aaa-8bbb-ccc000000001",
  "name": "default",
  "parent": null,
  "selections": { "<object-uuid>": "live", "<object-uuid-2>": "rev1:…" },
  "enforcement": "greenhouse",
  "visible_claims": []
}
```

- `selections` maps object → pinned revision or `"live"`. Objects absent
  from the map are implicitly `"live"`. "Latest" is always defined by a
  Context's selection resolution, never globally (R10).
- `enforcement` ∈ { `enforcing`, `greenhouse` }. Only enforcing contexts
  emit constraints (I4); v0 ships greenhouse-only behavior.
- `parent` composes by single-inheritance overlay: the child's `selections`
  override the parent's per object; scalar fields are the child's own (O1
  defers richer algebra).
- Every workspace has an implicit **default context**: all-live,
  greenhouse, no claims. It exists without a manifest file; creating
  `contexts/default.json` materializes overrides.
- Manifests are written atomically (temp + rename). They are the only
  mutable-in-place files in `.vmark/` — a context's selections are current
  state, not history; history of selection changes is v1-out-of-scope.

## 7. Input-set taxonomy (R24)

| Role | Definition | Creates edge? | Recorded? |
|---|---|---|---|
| **direct** | Objects the output *semantically depends on* — the model was asked to conform to, derive from, or stay consistent with them | ✅ dependency edge | ✅ in `inputs` |
| **contextual** | Assembled context the output does not depend on — retrieved snippets for tone, style exemplars, the surrounding conversation | ❌ | ✅ in `inputs` (role `contextual`) |
| **incidental** | System scaffolding — system prompts, tool schemas, boilerplate instructions, UI chrome | ❌ | ❌ excluded at capture |

Worked examples:

1. **Genie rewrite.** User selects scene-12, runs a genie "revise this
   scene to match the character sheet", and the flow loads `elena.md` into
   the prompt. Capture: inputs = [scene-12@r (direct — it is being
   revised), elena@q (direct — output must conform to it)]; the genie's
   instruction template is incidental. Output = scene-12@r′.
2. **MCP document write.** An external agent reads `world-rules.md` and
   `timeline.md` through MCP document tools, then writes a new
   `chapter-3.md` through the MCP document surface. The MCP session's reads
   since the last write are captured as inputs of the write: role `direct`
   for documents read in full, `contextual` for search-result snippets.
   The agent's own system prompt is invisible to VMark and therefore
   trivially excluded.
3. **AI suggestion apply.** The suggestion was generated from the current
   document plus an instruction. Inputs = [document@r (direct)]; the
   instruction text goes in `intent`, not `inputs`. Output =
   document@r′.
4. **Chat with open document.** The conversation history is `contextual`
   (recorded as a single prompt-hash input if persisted, else summarized in
   `intent`); the open document being edited is `direct`.

Classification is decided **by the instrumented capture site** (it knows
why it assembled each piece), never by post-hoc inference in Phase 1.
Spike S3 (WI-0.7) measures how well an LLM could infer these roles, which
gates the Phase 3 human-edit inference design (O2) — it does not change
Phase 1 behavior.

## 8. Provenance confidence (R28)

Per-transformation `confidence` states:

| State | Meaning | Producers |
|---|---|---|
| `exact` | The input set is exactly what the generation consumed | In-app instrumented AI paths (genies, suggestion apply, workflow steps) and editor saves (prior-revision link) |
| `inferred` | Inputs are an honest under- or re-construction, not the agent's verified full context | **MCP bridge writes** (G1 finding: the session-observed read set under-approximates an external agent's true context); Phase 3 human-edit inference |
| `unknown` | Inputs not knowable — observed external edit | Scan reconciliation (R9) |

"Gap-free history" (R9) means *no silent gaps*: every content change has a
transformation, but an `unknown`-confidence transformation honestly carries
an empty input set. UI and (later) the checker must render degraded
confidence distinctly and must never present `unknown` provenance as exact.

## 9. Staleness computation — kernel decisions (WI-0.2)

### 9.1 Granularity (R31)

v1 object granularity is **file-level**: one markdown file = one Semantic
Object. Section-level objects are gated on O9 (escalated only if dogfood
metric M2 misses its baseline). The format is granularity-agnostic:
objects are UUIDs, not paths; a future section-level scheme adds objects
without changing any schema in this spec.

### 9.2 Context-relative staleness algorithm (R10)

Inputs: origin edge E = (upstream object U pinned at revision `p` by
transformation T, producing downstream D@w), viewing context C, revision
DAG, resolution records for E.

```
resolve(C, U):
    s = C.selections[U]  (walking parent chain; absent ⇒ "live")
    if s == "live":
        heads = DAG heads of U          # revisions with no children
        if |heads| == 1: return heads[0]
        else:            return DIVERGED_HEADS   # multi-head object
    else: return s

project(E, C):
    sel = resolve(C, U)
    if sel == DIVERGED_HEADS:            return Diverged
    r   = latest resolution record for E with resolved_against == sel
    if r is ratification:                return Fresh (ratified)
    if r is waiver and not expired:      return Waived
    if p == sel:                         return Fresh
    if p is strict ancestor of sel:      # BFS over parent links
        v = latest non-expired check-result for (p, sel)
        if v == "no-contradiction":      return StaleValid
        if v == "contradiction":         return StaleContradicted
        if v == "unknown":               return StaleUnknown
        else:                            return VersionStale   # unchecked
    if sel is strict ancestor of p:      return Fresh (ahead)  # pin newer than selection
    else:                                return Diverged
```

Decisions fixed here:

- **Ancestor check direction:** an edge whose pin is *newer* than the
  context's selection (possible under pinned contexts) is Fresh-ahead, not
  stale — staleness means "the world moved past what this artifact was
  built from", which is false in that case. Displayed with an "ahead"
  badge.
- **Diverged** (incomparable pin and selection, or a multi-head live
  upstream) is first-class and surfaced; the kernel never picks a side.
- Resolution records bind to a specific `resolved_against` revision; any
  further upstream advance re-opens the edge (v0 waiver scope, §5.4.3).
- All states are **projections** over (origin edges, resolution records,
  C) — nothing is stored as mutable edge state (I5). The SQLite staleness
  cache is invalidated per-object on any new revision, resolution, or
  context-selection change touching that object.

### 9.3 Ancestor computation

`p ancestor-of sel` is decided by breadth-first walk from `sel` along
`parents` links (from ledger `outputs[].parents`), bounded by the object's
revision count. The SQLite index materializes the closure for objects with
> 64 revisions (§10 targets make the naive walk acceptable below that).

## 10. Performance targets (O6)

Target scale is the dogfood envelope with 10× headroom:

| Dimension | Target |
|---|---|
| Markdown files per workspace | 5 000 |
| Ledger entries per workspace | 200 000 |
| Revisions per object (p95) | 500 |
| Edges (input references) total | 500 000 |

Latency budgets at that scale (Apple Silicon, debug ≤ 4× these numbers,
budgets are for release):

| Operation | Budget |
|---|---|
| Ledger append (incl. fsync) | ≤ 5 ms |
| Snapshot write (typical 50 KiB file) | ≤ 10 ms |
| Breakdown query ("all non-fresh edges", warm index) | ≤ 100 ms |
| Full index rebuild from scan (R16 path) | ≤ 10 s |
| Single-edge projection (warm) | ≤ 1 ms |

Spike S2 (WI-0.6) validates the rebuild and query budgets before Phase 1
commits to the index design; if S2 misses a budget the spec numbers are
revisited **before** implementation, not silently ignored.

## 11. Metric baselines and exit thresholds (M1–M5)

Recorded per dogfood session against these Phase 1 exit thresholds
(WI-0.9; paper §12):

| ID | Metric | Baseline source | Phase 1 exit threshold | Failure signal |
|---|---|---|---|---|
| M1 | Capture coverage | 100% by construction on instrumented paths | 100% of AI generations through instrumented paths carry complete (`exact`) input sets; 0 manual metadata entries | Any manual entry (R4 violation) |
| M2 | Staleness precision | First dogfood session measurement | ≥ 60% of flagged edges judged relevant | < 60% ⇒ escalate O9 (section-level) |
| M3 | Semantic-check precision | Spike S4 seeded-corpus result (WI-0.7 report) | Phase 2b gate, not Phase 1; S4 baseline must be ≥ 70% before Phase 2b starts | False contradictions erode trust |
| M4 | Ratification burden | First dogfood session measurement | ≤ 10 demanded resolutions per session | Tool feels like homework |
| M5 | Time-to-confidence | First dogfood session measurement (baseline = pre-tool estimate, recorded once) | Post-change blast radius known in ≤ 5 min | The founding pain unfixed |

Session recording is manual in v1 (a per-session note in the dogfood log);
instrumented metric capture is deliberately out of scope for Phase 1.

## 12. Compatibility and evolution

- The format number gates everything (§ header). v0 makes **no stability
  promise**; v1 (frozen at Phase 1 exit) begins the compatibility
  contract.
- Additive evolution (new entry kinds, new optional fields) does not bump
  the format. Readers preserve unknown kinds/fields byte-for-byte on any
  rewrite-free path (the ledger has no rewrite path by construction).
- The SQLite schema is **not** part of the public contract (R16 — the
  index is disposable); its version lives in `PRAGMA user_version` and any
  mismatch triggers a silent rebuild from scan.
