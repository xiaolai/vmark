---
vmark:
  id: 019f758c-5482-78e1-a042-d384f28175c9
---
# Coherence Layer On-Disk Format — v0

> **Spec revision 3 of format 0** (2026-07-20): adds the **runtime-layer
> addenda** (§13) for the forward-operator plan — the reserved
> `operator:<name>` intent taxonomy, the in-memory-only candidate payload
> schema, the **length-prefixed accept idem preimage** (unambiguous), the
> preview→accept binding, and the additive optional `kind` field on
> transformation inputs (`edge_kind`, default `dependency`). All additive or
> runtime-only; `format` stays `0`. Contract: `design-runtime.md` v4 (V4.1/V4.6/V4.7).
>
> **Spec revision 2 of format 0** (2026-07-19): adds the Phase 3
> contract — the `delegation` entry kind (§5.4.7), the conditional
> `delegation` reference on resolutions (§5.4.3), the
> `provenance-confirmation` re-emission rules (§5.4.1a), and the
> `git_branch` manifest field with the round-trip guarantee (§6). All
> additive; `format` stays `0`.
>
> **Spec revision 1 of format 0** (2026-07-18): fills the sections
> deferred to Phase 2a with the approved semantics
> (`dev-docs/grills/coherence/design-2a.md` D1–D5) and adds the two
> additive `check-result` fields (`context`, `claims_fingerprint`).
> The wire `format` stays `0`; v0 readers preserve unknown fields. Provenance for a hand-edited derived object is recovered, not auto-inferred, via the §5.4.1a provenance-confirmation event.

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
  object is **capture-held**: the kernel rejects captures against it with
  an explanatory error and raises a durable workspace diagnostic; the
  hold releases automatically once a scan finds the ID at exactly one
  path again.
- A file with no frontmatter gets a frontmatter block prepended at first
  capture. A file with frontmatter but no `vmark` key gets the key added.
  Identity assignment does **not** create a new revision (§3.3).
- **Parsing strategy (fixed here so implementations agree):** the reserved
  block is handled line-based on the raw frontmatter text — match a
  top-level `vmark:` mapping line and its indented `id:` / `schema:`
  children; everything else in the frontmatter is preserved byte-for-byte
  (no YAML round-trip, no reformatting of author content). A file whose
  frontmatter is malformed (unterminated `---` fence, invalid UTF-8) is
  treated as having no identity; the first capture attempt surfaces a
  `diagnostic` instead of guessing.
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

- **Text:** the **identity-masked canonical bytes** (§3.2) — exactly the
  bytes that were hashed, so every snapshot is self-verifying:
  `SHA-256(stored bytes) == key`. Storing identity-bearing bytes here was
  rejected (Codex review D1#3): two objects with identical author content
  but different `vmark.id` values share one key, and first-write-wins
  would then return the wrong identity block. Materializing a revision
  back to disk re-inserts the target object's `vmark:` identity block
  (id and schema come from the ledger, which is authoritative for
  identity), formatted per §2.1.
- **Binary:** the raw bytes (also self-verifying — §3.4 hashes raw bytes).

### 4.3 Write protocol

Write to `.vmark/snapshots/tmp/<uuid>`, fsync, rename into place, then
(best-effort) fsync the parent directory. A snapshot that already exists
is never rewritten (identical hash = identical content). Snapshots are
**never deleted** in v0 — retention/GC is O3, out of scope. Writers
`mkdir -p` the target directory **before every write**, never only at
init — git prunes empty directories on branch switch (Spike S1 finding),
so the directory's existence can never be assumed. A read that finds a
missing or hash-mismatched snapshot surfaces a `diagnostic` and returns
an explicit content-unavailable error — never silently empty content.

### 4.4 Git tracking default

Snapshot-store git tracking is a per-workspace user choice (paper §7).
**Default: tracked.** Rationale: the dogfood protocol needs historical
revision content to survive clones and machine moves; text snapshots are
small and pack well; a user with large binary CAS content can flip the
workspace setting, which writes `snapshots/` into `.vmark/.gitignore`.
Git blobs remain opportunistic, never load-bearing (R19).

## 5. Ledger (R17)

### 5.1 Segments and the multi-writer protocol (O7)

- One or more JSONL segment files per writer (the base is
  `.vmark/ledger/<writer-id>.jsonl`; rotation adds `<writer-id>-<NNN>.jsonl`).
  A writer appends **only** to its own segment; concurrent VMark windows on one
  installation share one writer ID and serialize appends through a single
  kernel instance per workspace (in-process mutex; cross-process safety
  comes from per-writer files plus O_APPEND single-line writes).
- Entries are **self-identified and order-independent** (R17): each carries
  its own UUIDv7 `id`, RFC 3339 UTC `time`, `writer`, and causal references
  by ID. File order and cross-segment interleaving are meaningless; readers
  merge all segments and may sort by (`time`, `id`) for display only.
- **Idempotency:** each entry carries an `idem` key — a UUIDv7 **minted
  once when the logical operation is created** and carried unchanged
  through any retry or replay of that same operation. Readers de-duplicate
  by `idem`, keeping the entry with the smallest (`time`, `id`). Distinct
  operations always get distinct `idem` values even when their outputs
  coincide — two generations converging on identical content are two
  provenance events, never collapsed (Codex review D1#2: a
  derived-from-outputs digest would silently merge them).
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
  "idem": "018f3c7a-a000-7c11-9e22-334455667788",
  "body": { }
}
```

`kind` ∈ { `transformation`, `navigation`, `ratification`, `waiver`,
`check-result`, `claim`, `object-registered`, `diagnostic`,
`delegation` }. Unknown kinds
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

#### 5.4.2 `navigation` (R18)

Records a git state-jump. **Never mints revisions.**

```json
{ "git": { "op": "checkout", "from": "<sha>", "to": "<sha>", "ref": "main" } }
```

`op` ∈ { `checkout`, `branch-switch`, `reset`, `detach`, `worktree-switch` }.
One `idem` per detected operation (§5.1); duplicate detections of the same
git operation produce duplicate navigation entries, which are harmless by
construction — navigation never mints revisions. Classification order
matters (Gate G2): check `MERGE_HEAD` first (a mid-conflict merge is
invisible to sha/reflog observables), then new-sha detection for
mutations, then HEAD comparison for navigation; never assume the known-sha
set only grows (`reset --hard` shrinks it).

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
  VersionStale and the waiver stays in history, inert. **Final per
  Phase 2a (design-2a.md D3):** this scope is not refined further — the
  §9.2 fail-closed projection *is* the re-prompt policy (linear advance
  reopens the edge; incomparable or multi-head selections stay Diverged
  and can never be ratified or waived — revising is the only way out).

- This v0 rule is the format-level expression of the paper's Phase-2a narrow-waiver preference.
- A waiver is **revoked** by appending a ratification or a newer waiver for
  the same edge; records are never edited or deleted (I5).
- `actor` requires an identity; agent-performed resolution additionally
  requires a recorded delegation (R29 — mutating surface is Phase 3; v0
  records only human actors). In v1 the human actor identity is taken from
  `git config user.name` when available, else the OS username; it is
  recorded verbatim and never blank. **v1 authority model:** the only
  mutating surface is the in-app breakdown UI — authorization *is* the
  human's explicit in-app action in their own OS session; the recorded
  identity is display identity, not a credential. R29's authenticated
  delegation model applies when agent-performed or MCP-exposed mutation
  arrives (Phase 3), not before.
- **Revision 2 (design-3.md D2):** a resolution whose `actor.type` is
  not `human` MUST carry a `delegation` field referencing the current
  grant entry id that authorized it; typed validation rejects a
  non-human resolution without it. The delegate identity is the
  authenticated bridge principal — never a caller-supplied argument.
  Human resolutions never carry the field.

#### 5.4.1a `provenance-confirmation` re-emission (revision 2, design-3.md D1)

The **only** transformation permitted to re-emit an existing revision:
intent kind `provenance-confirmation`, human actor, confidence
`inferred`. Rules — fresh envelope id, fresh transformation identity,
and a **fresh idem minted for the confirmation** (retries reuse that
new idem, never the original transformation's); the output's revision,
parents, and content hash must equal the object's current head
**exactly** (a changed head fails loud: `stale confirmation`); prior
resolutions never transfer — the new transformation's edges start
unresolved. Any other transformation re-emitting an existing revision
is malformed (quarantine, §5.6).

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
  "confidence": 0.83,
  "context": "<context-uuid>",
  "claims_fingerprint": "sha256:…"
}
```

- **Revision-1 additive fields (design-2a.md D5.6):** `context` is the
  context id the check ran under (the implicit default context uses the
  fixed nil-namespace id `00000000-0000-0000-0000-000000000000`);
  `claims_fingerprint` is SHA-256 over the sorted
  `(claim-id, current-entry-id)` pairs fed to the checker (`sha256:`
  prefixed; an empty feed hashes the empty string). The default-context
  id here is the same implicit context defined in §6. A result is **live**
  for projection only when its (`pinned`, `checked_against`) pair
  matches §9.2's comparison AND `context` matches the projecting context
  AND `claims_fingerprint` equals the fingerprint of the claims that
  would be fed now. Results lacking these fields (pre-revision-1
  history) are historical only — never projected.
- The confidence threshold τ (0.9 per spike S4) is **tunable policy**,
  not a wire rule; the effective verdict already encodes its application
  (`unknown` when below τ).

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

Lifecycle semantics (revision 1, design-2a.md D2/D4):

- The body `claim` field is the **stable claim-object id**, distinct
  from the envelope entry id. Every lifecycle act (promote, correct,
  retire) appends a new entry with the **same claim id** whose
  `supersedes` names the prior entry's id. Context manifests scope by
  claim id, so no act can orphan a `visible_claims` reference.
- **Current-entry resolution:** the current entry for a claim id is the
  entry not named by any other entry's `supersedes`, in the reader's
  total order (§5.1). Concurrent supersessions of one entry both
  survive; the latest in reader order is current and the conflict is
  surfaced, never hidden.
- **Retirement is explicit supersession only** — an entry with
  `invalid_at` set (in-world end) or a corrected statement. Removing a
  claim from every context's `visible_claims` is a reversible
  visibility change, not retirement.
- **Feed rule (R33 matrix):** a claim is fed to semantic checks iff
  `maturity = established` AND it is in the projecting context's
  effective claims AND it is transaction-current AND its current
  entry's `invalid_at` is null. Enforcement decides presentation only:
  enforcing contexts label a contradiction a violation; greenhouse
  contexts present the same verdict as advisory. Story-time filtering
  by `valid_at`/`invalid_at` intervals is deferred past 2b.
- **Authority:** claim lifecycle entries record the human `actor`
  (§5.4.3 identity rule). Until Phase 3's delegation model, the only
  mutating surface is the in-app UI; AI suggestions persist nothing
  without an explicit human accept.

#### 5.4.6 `object-registered`

Appended at **every object's first capture** (text and binary alike), on
an observed schema change, and on split/merge to record identity lineage
(R8):

```json
{ "object": "<uuid>", "path": "art/elena-ref.png", "schema": "image",
  "derived_from": ["<uuid>"] }
```

This chain is the ledger-side identity registry: the authoritative source
for an object's `schema` (latest entry wins, where "latest" is the
largest (`time`, `id`) pair — the same deterministic order readers use
everywhere, robust to out-of-order segments) and the source §4.2
materialization reads when re-inserting the `vmark:` block. `schema` is masked from content hashing (§3.2), so schema edits
never mint revisions; the registry is how schema survives outside
revision history. For binaries it is additionally the *only* identity
carrier (no frontmatter).

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
malformed (§5.3). If the quarantine append itself fails (permissions,
disk full), the read still succeeds — the diagnostic is held in the index
only and re-attempted on the next scan; a reader never fails because
quarantine is unavailable.

#### 5.4.7 `delegation` (revision 2, R29, design-3.md D2)

```json
{
  "delegation": "<stable-grant-uuid>",
  "actor": { "type": "human", "id": "xiaolai" },
  "delegate": { "type": "external", "id": "<bridge principal>" },
  "scope": [ "resolve.accept-newer", "resolve.waive" ],
  "expires": "2026-07-26T00:00:00Z",
  "supersedes": null
}
```

- The body `delegation` field is the **stable grant id**; lifecycle
  entries share it and supersede one another exactly like claims
  (§5.4.5): current = the unsuperseded entry, latest in reader total
  order on concurrent supersession, conflicts surfaced.
- `expires` is **required** (RFC 3339). An empty `scope` on a
  superseding entry is a revocation. Grants are created and revoked
  only by in-app explicit human acts in Phase 3.
- Validation of an agent resolution: the referenced grant must be
  current, unexpired, unrevoked, scope-covering the resolution kind,
  and delegate-matching the authenticated principal — each checked
  fail-closed at append time.

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
  override the parent's per object (first explicit entry on the
  child→parent walk wins; absent everywhere → `live`). **Final per
  Phase 2a (design-2a.md D1):** the chain must terminate within 16
  hops; a cycle or overflow is a config error — the context degrades to
  the implicit default and the error is surfaced in the breakdown
  header. `visible_claims` inherit **additively only** (child ∪ parent,
  deduped by claim id; a child cannot hide a parent's claim). Siblings
  are independent. `enforcement` is never inherited: a missing field
  means `greenhouse`, and enabling `enforcing` requires an explicit
  in-app human confirmation.
- Every workspace has an implicit **default context**: all-live,
  greenhouse, no claims. It exists without a manifest file; creating
  `contexts/default.json` materializes overrides.
- Manifests are written atomically (temp + rename). They are the only
  mutable-in-place files in `.vmark/` — a context's selections are current
  state, not history; history of selection changes is v1-out-of-scope.
- **Revision 2 (design-3.md D3):** optional `git_branch: "<name>"` maps
  a context to a git branch by **exact string match** against
  `git rev-parse --abbrev-ref HEAD` (no globs). Mapping never selects a
  context automatically — it only surfaces a pull-only candidate in the
  UI. **Round-trip guarantee:** because manifests are mutable-in-place,
  every manifest writer MUST preserve fields it does not understand
  when rewriting, or refuse the rewrite with a surfaced error — an
  additive field must survive an older build's rewrite.

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
| `exact` | The input set is exactly what the generation consumed | In-app instrumented AI paths (genies, suggestion apply, workflow steps) and editor saves (prior-revision link). **Exception:** when the pre-apply buffer had diverged from the last captured revision, the recorded input revision under-describes what the model actually read — such applies are captured as `inferred` (honest under-claiming) |
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
        v = latest LIVE check-result for (p, sel) — live requires
            matching (pinned, checked_against) AND context = C AND
            claims_fingerprint = fingerprint(fed claims now) (D5.6)
        if v == "no-contradiction":      return StaleValid
        if v == "contradiction":         return StaleContradicted
        if v == "unknown":               return StaleUnknown
        else:                            return VersionStale   # unchecked
    if sel is strict ancestor of p:      return Fresh (ahead)  # pin newer than selection
    else:                                return Diverged
```

Decisions fixed here:

- **Edge liveness:** an edge is projected (and listed in the breakdown)
  **iff its downstream revision equals `resolve(C, D)`** for its
  downstream object D. Edges of superseded downstream revisions are
  historical and never listed. This is how the *revise* action resolves:
  the human's new revision of D supersedes D@w, retiring the old edge —
  no record ever mutates it (Codex review D1#4).
- **Ancestor check direction:** an edge whose pin is *newer* than the
  context's selection (possible under pinned contexts) is Fresh-ahead, not
  stale — staleness means "the world moved past what this artifact was
  built from", which is false in that case. Displayed with an "ahead"
  badge.
- **Diverged** (incomparable pin and selection, or a multi-head live
  upstream) is first-class and surfaced; the kernel never picks a side.
  Two diverged sub-cases differ in available actions (Codex review D4#2):
  with a *defined* selection that is merely incomparable to the pin,
  **accept newer** ratifies against that selection and **waive** records
  divergence normally; with an *undefined* selection (multi-head live
  upstream, `DIVERGED_HEADS`), there is no single `resolved_against`, so
  accept-newer and waive are disabled and only *revise* (or pinning a head
  in the context) is offered.
- Resolution records bind to a specific `resolved_against` revision; any
  further upstream advance re-opens the edge (v0 waiver scope, §5.4.3).
- All states are **projections** over (origin edges, resolution records,
  C) — nothing is stored as mutable edge state (I5). The SQLite staleness
  cache is invalidated per-object on any new revision, resolution, or
  context-selection change touching that object. The index stores
  **per-object head sets**, never a global "latest" — resolution is
  always context-relative (R10), and no index API may expose a
  context-free latest revision.

### 9.3 Ancestor computation

`p ancestor-of sel` is decided by breadth-first walk from `sel` along
`parents` links (from ledger `outputs[].parents`), bounded by the object's
revision count. The SQLite index materializes the closure for objects with
> 64 revisions (§10 targets make the naive walk acceptable below that).

### 9.4 Scan reconciliation state machine (R9)

Scan compares disk state against the index for **known objects** (files
carrying a `vmark.id` or registered via §5.4.6). Files never captured are
not objects — v1 adopts a file on first capture, never on scan.

| Condition on scan | Behavior |
|---|---|
| Known object, content hash unchanged | Nothing |
| Known object, content changed, git classifier says NAVIGATION | `navigation` entry only; **no revision minted** (R18) |
| Known object, content changed, git classifier says MUTATION (revert/merge) | Transformation with `agent.type = "git"`, parents = last known revision(s) |
| Known object, content changed, otherwise | Observed-external transformation: `agent.type = "external"`, empty inputs, `confidence = "unknown"`, parent = last known revision |
| Known object's file deleted | No ledger entry; object marked **absent** in the index (history intact; breakdown hides absent objects). Deletion-as-transformation is deferred to O3/retention design |
| Known object's file moved/renamed (same `vmark.id` found at new path) | Index path updated; no revision minted (content unchanged ⇒ same hash) |
| Two files carry the same `vmark.id` | `diagnostic` (duplicate-ID, §2.1); capture-hold on the duplicate set |
| File unreadable / invalid UTF-8 where text expected | `diagnostic`; skipped |
| Symlink | Skipped + `diagnostic` (never followed — escape hazard) |
| New file without identity | Ignored (not yet an object) |
| New file carrying a `vmark.id` unknown to this ledger (moved in from elsewhere) | Adopted: `object-registered` + observed-external root transformation (content from disk, no parents, `confidence = "unknown"`) — history stays gap-free for imported objects |

Mid-scan writes are serialized against capture through the per-workspace
kernel instance (§5.1); a scan never races its own writer's appends.

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
| M1 | Capture coverage | 100% by construction on instrumented paths | 100% of AI generations through instrumented paths carry complete input sets **at the path's designed confidence** (§8: `exact` for in-app AI paths, `inferred` for external-agent MCP writes); 0 manual metadata entries | Any manual entry (R4 violation) |
| M2 | Staleness precision | First dogfood session measurement | ≥ 60% of flagged edges judged relevant | < 60% ⇒ escalate O9 (section-level) |
| M3 | Semantic-check precision | Spike S4 result: **88.9%** contradiction precision, 100% recall (`dev-docs/grills/coherence/spike-s4.md`) | Phase 2b gate, not Phase 1; the ≥ 70% Phase 2b entry threshold is met with margin | False contradictions erode trust |
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

## 13. Runtime-layer addenda (rev 3, WI-0.4)

The forward-operator plan (`dev-docs/plans/20260719-coherence-runtime-layer.md`)
adds the following. All are additive or runtime-only; **`format` stays `0`**.
Normative source: `dev-docs/grills/coherence/design-runtime.md` v4.

### 13.1 Operator-intent taxonomy (no format change)

An operator-committed transformation uses the **existing** `Transformation.intent.kind`
field with a reserved value `"operator:<name>"` (e.g. `"operator:revise"`). No
new field; v0 readers already preserve `intent`. `<name>` is `[a-z][a-z0-9-]*`.
This is the only durable ledger trace an operator leaves — everything else about
an operator run (candidates, preview, checks) is transient (§13.2).

### 13.2 Candidate payload (in-memory only — never a ledger entry)

A **candidate** is a proposed output that has not been accepted. It is **never
serialized to the ledger or CAS** until accept (§13.3). Shape:

```
Candidate = {
  object:        ObjectId,
  content:       bytes,               // hashed on submit → content_hash
  parents:       [RevisionId],        // the base is a PARENT, never an input (D1)
  inputs:        [InputRef],          // declared inputs (may be empty)
  operator:      "<name>",
  intent:        { kind: "operator:<name>", summary },
}
```

The candidate's **identity for display and preview** is its revision id,
`RevisionId::compute(content_hash, sorted(parents))` (§2.3) — content-addressed
over content+parents **only**. The revision id is therefore *not* full
tamper-evidence: tamper on `inputs`/`operator`/`intent` is caught by the accept
idem (§13.3), which covers the whole payload.

### 13.3 Accept idem preimage — length-prefixed, unambiguous (V4.1)

Accepting a candidate mints **one** transformation via one append. Its envelope
`idem` (spec §5.3) is **deterministic** so a lost-response retry collapses to one
logical entry. The preimage is **length-prefixed** so free-text fields
(`agent.id`, `intent.summary`) cannot forge a field boundary:

```
field(s) = u32_be(bytelen(s)) ‖ s
opt(x)   = byte(0)  if None  |  byte(1) ‖ field(x)  if Some(x)   // None ≠ Some("")
list(xs) = u32_be(count(xs)) ‖ concat(field(x) for x in xs)

idem = uuid_from_sha256(
  field("vmark-operator-accept-v1")
  ‖ field(format) ‖ field(operator)
  ‖ field(output.object) ‖ field(output.content_hash) ‖ field(output.revision)
  ‖ list(sorted(output.parents))
  ‖ list(for each input in declared order: field(object) ‖ field(revision) ‖ field(role))
  ‖ field(agent.kind) ‖ opt(agent.id)
  ‖ field(intent.kind) ‖ field(intent.summary) ‖ opt(intent.prompt_hash)
  ‖ field(confidence)
)
```

The length-prefix makes the encoding **injective**: distinct payloads never share
a preimage. `opt` (a presence byte) covers every optional field — `agent.id` and
`intent.prompt_hash` — so `None` is never aliased with `Some("")`. The `…-v1`
domain tag versions the schema. Retry semantics: the
accept looks the idem up (ledger-authoritative, healing the append-before-index
torn window — V4.2) and returns the **original** receipt rather than appending
again.

### 13.4 Preview → accept binding

Preview and accept are **stateless** IPC calls (no server-side candidate
session). Accept resubmits the full candidate payload **plus** the structural-class
multiset the preview produced (`structural_classes`, V4.3/§13.5). The server:
recomputes the revision id (rejects a content/parent mismatch), recomputes the
§13.3 idem, and runs the reproject-under-lock precondition. A stale
`structural_classes` can only *add* a rejection — it can never force an unsafe
accept, because the appended entry is exactly the content-addressed candidate and
a moved base is caught independently by base-head revalidation.

### 13.5 Reproject-under-lock is check-independent

The accept precondition compares a **structural class** of each affected edge's
projection, not the raw `EdgeState`: only the check verdict is erased —
`VersionStale`, `StaleValid`, `StaleContradicted`, `StaleUnknown` all collapse to
one `Stale` token, while `Fresh{ratified, ahead}` and the rest are kept. A
semantic check landing between preview and accept therefore **cannot** cause a
rejection — accept is never blocked by a semantic verdict (I3/§14). The
comparison is a **map keyed by *physical* edge identity** (`(txf, input_idx,
downstream, downstream_rev)` for committed edges; `(candidate_rev, ordinal)` for
the candidate's own), **not** by the non-unique `SemanticEdgeKey`, so coincident
edges never collide and a compensating swap of two edges' classes is still
caught. Base-head moves, retirements, ratifications, waivers, and context repins
remain visible and do reject.

### 13.6 Additive `edge_kind` (optional input field)

To persist a non-dependency origin-edge kind (conformance, supersession,
part-of, mention — Phase 2), `InputRef` (§7) gains an **optional** `kind` field:

```
InputRef = { object, revision, role, kind?: "dependency" }   // default "dependency"
```

Absent `kind` reads as `dependency`, so every existing ledger entry is unchanged
and format stays `0`. `kind` is **orthogonal to `role`**: `role`
(direct/contextual) is provenance liveness; `kind` is the propagation class. The
derived `edges` index table carries `edge_kind TEXT NOT NULL DEFAULT 'dependency'`
(not public contract, R16). Contradiction is **never** a kind — it is a
`check-result` assessment (§5.4.4).
