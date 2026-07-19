# Design Record: Forward-Operator Core (Runtime Layer, increment 1) — v3

> **Status: DESIGN RECORD — v3 reviewed (Codex review 4, thread `019f79cf…`):
> MAJOR GAPS — BANKED (owner pivoted to verify-at-volume).** SP-A's "PASS" is **retracted** — it
> graded the recovery *ingredients*, not a composed accept
> (`spike-accept-primitive.md`). Review 4 confirms the accept step is a real
> **idempotency + optimistic-concurrency protocol**, not a capture wrapper, with
> three BLOCKERs: (1) storage dedup ≠ idempotent API — a lost-response retry must
> **look up the idem and return the original receipt** (D6's stale-base check
> would otherwise reject it); (2) the deterministic idem must be domain-separated
> over the **complete canonical commit payload** (inputs/roles/operator/intent),
> not just output bytes, or it false-collapses distinct events; (3) the accept
> precondition must bind the **complete projection read-set** (or reproject under
> the commit lock), not a partial fingerprint. **CLOSED by v3:** D2 multiset, N2
> base-as-parent, N5 no-auto-re-run. **Grounding errors corrected:**
> `content_hash_of` reads the *stored* hash (not the working copy); `resolve_live`
> is not a cross-process fence; the SP0 20 ms/16 MiB gates are *derived*, not in
> §10; `index.rs:37` key is four columns.
>
> **DECISION (owner, 2026-07-20): UN-BANKED for the funded build.** The
> "option-A" running-code effort is now funded (owner goal: finish all phases),
> so this record leaves BANKED status and becomes the live design contract the
> `20260719-coherence-runtime-layer.md` plan decomposes against. **v4 (below)**
> discharges the three review-4 BLOCKERs from *known fixes* to *specified
> protocols* and resolves the G-B-round-2 design findings (thread
> `019f7b48-9532-7732-b024-163e1a14f94d`): the full canonical idem preimage
> (superseding D4's short formula), the reproject-under-lock accept precondition
> (superseding the undefined "preview fingerprint"), the bounded `ReadView`, the
> `local_projection_delta` vs `preview_forward_closure` split, the content-addressed
> candidate lifecycle, and the additive `edge_kind` slot. What this record banks
> as the build's foundation is unchanged: the settled ontology; decisions D1–D8
> (as amended by v4); the SP0 gate list; and the honest finding that accept is an
> idempotency + optimistic-concurrency protocol scoped to the single serialized
> per-workspace kernel. Reviews 1–4 (`019f7404`→`019f79cf`) plus G-B round 2 are
> the audit trail. **Active track: the runtime plan (Phase 0 → 5).**
>
> **Anti-drift discipline:** each decision cites the contract or shipped code for
> exactly what it shows. Overstatements caught in reviews 2–3 (D4 "atomic", D7
> "reverse-index preview", `is_fed`/enforcement, object-id in `RevisionId`) are
> corrected here.

## Increment-1 scope (owner-confirmed)

- **Single-object, single-output operators only.** One output ⇒ one
  transformation ⇒ one ledger entry = the existing atomic commit unit
  (`state.rs:93`).
- **First operator = a simple, deterministic single-object revision operator**
  producing ≥2 candidates (disposable for SP0; a real single-object operator
  after SP0 passes).
- **Deferred, each to its own record:** multi-object changesets + a group-commit
  protocol; `Extract-Canon` + a typed candidate-effect model (object | claim |
  Context effects); delegated `operator.accept`; fingerprint-guarded rebind.

## Settled ontology (grounded)

| Element | Definition | Grounding |
|---|---|---|
| **Atom** | Semantic Object (+ co-atoms Transformation, Context) | paper §5.1; `types.rs:22,180`; Context in `contexts.rs` (`ContextManifest`/`ContextView`) |
| **Claim** | Derived "claim-object": stable id ≠ entry id, own lifecycle — not a kernel atom | `claims.rs:21-23`; spec §5.4.5 |
| **Canon** | Fed established claims **in a context whose enforcement = Enforcing** | fedness `is_fed` (`claims.rs:119-130`, does *not* check enforcement); enforcement separate (`contexts.rs:27,45`) |
| **Staleness** | Axis-1 (version) local per-edge by ancestry; full `EdgeState` folds in downstream liveness/context/resolutions/checks/`now` | `project.rs:164-186` + `:140,124` |
| **Contradiction** | An assessment (`EdgeCheck` verdict), not an edge | `project.rs:40-55`; `check_commands.rs:140` |

## Decisions

### D1 — Candidate = one fully-specified output over a single-head base
`Candidate = { object, canonical_bytes, content_hash, parents (complete,
sorted), inputs: [InputRef] }`. The candidate revision id is
`RevisionId::compute(content_hash, parents)` — **content + sorted parents only;
object identity is *not* hashed** (an accept-time invariant, not a rev-id input).
The **base revision is a parent** (in `parents`), **never a direct input** —
recording the base as an input would mint an immediately-stale self-edge (N2).
The candidate is bound to a **single-head** base; a diverged/multi-head base is
**rejected**, not guessed. In-memory only; nothing touches ledger/CAS.
**Grounding:** `types.rs:85-87` (`compute` = content + sorted parents);
`dag.rs` resolve → `Single`/`DivergedHeads`. *The candidate algebra is new.*

### D2 — Dry-run = existing `project_edge` over a full transient snapshot; proof = multiset equality
The overlay is the **complete read snapshot** `project_edge` consumes — `dag`,
origin edges, resolutions, checks, `ContextView`, `now` — plus the candidate's
revision + new edges. **Affected set** = candidate edges **∪** committed edges
whose `upstream` **or `downstream`** is the changed object (a new revision
changes liveness, so edges *into* the prior revision can retire `Some → None`,
`project.rs:140`). **Proof:** compare the two **multisets** of
`(SemanticEdgeKey, Option<EdgeState>)`, preview vs real commit, by *multiset*
equality (preserves multiplicity). `SemanticEdgeKey = (upstream, pinned,
downstream, downstream_rev, role, input_ordinal)` — a *bag*, not a map, because
physical edge identity is `(txf, input)` (`index.rs:37`) and duplicate
`InputRef`s / coinciding outputs / provenance-confirmation can share a semantic
tuple. The physical transformation envelope (id/time/idem) is excluded — it is
the only thing that differs preview→commit (candidate rev id is deterministic,
D1). Assert ledger/CAS/index byte-unchanged after preview.
**Grounding:** `project.rs:124` (pure), `:59-78` (`EdgeState` id-free), `:140`
(downstream liveness), `index.rs:37` (physical `(txf,input)` identity).

### D3 — Candidate-check contract (specified)
The candidate check is **proposal-vs-inputs/canon consistency**, not a stale-edge
drift check. Contract:
- **Inputs:** candidate content, its declared-input texts (at their current
  revisions), and the **fed claims** of the viewing context (base text supplied
  as context — base is a parent, not an input).
- **Context + fingerprint:** the viewing `ContextView`; the fed-claim identity is
  its `claims_fingerprint`. Enforcing vs greenhouse changes **labeling/severity**
  only — the check is advisory in both.
- **Prompt:** a **new** `build_candidate_check_prompt` (proposal + declared-input
  texts + fed claims), distinct from the stale-edge `build_check_prompt`. Reuse
  `parse_check_response`, the provider wrapper, fencing/limits.
- **Result:** transient, **holistic** (one verdict + evidence per candidate),
  in-memory only; result identity = `(candidate_id, claims_fingerprint,
  input_revisions)`.
- **Out-of-lock drift:** if the fingerprint or input revisions change during the
  provider call, the verdict is marked **stale and discarded** (never committed).
- **Failure:** timeout / provider error / cancel / malformed → `unknown`
  (re-implemented in the transient path — *not* inherited by bypassing
  `coherence_check`), never blocking.
**Grounding:** `checker.rs:65` (`build_check_prompt` is stale-edge shaped);
`parse_check_response` + provider wrapper reusable; `claims.rs:145`
(`claims_fingerprint`).

### D4 — Accept = capture-equivalent single-entry commit with a deterministic idem (SP-A INCOMPLETE)
Accept mints **one** transformation (one output) via **one** `append_and_apply`
(`state.rs:93`), `intent.kind = "operator:<name>"`. Crash semantics **equal
shipped capture's**: a crash before the ledger append heals as `observed-external`
on rescan (content present, operator provenance lost, re-runnable) — **not
atomic, capture-equivalent** (tested: `scan.test.rs:66`; torn append
`ledger.test.rs:62`). **Idempotent retry:** accept derives a **deterministic**
idem `= uuid(sha256(object ‖ base_rev ‖ content_hash))` (not the random
`Envelope::create` idem, `envelope.rs:171`), so a retry after a lost response
collapses via the existing dedup (`ledger.rs:199-202`, tested
`ledger.test.rs:89`). **SP-A did *not* establish** that this needs no new commit
protocol — it graded the recovery *ingredients* in isolation, and review 4 found
accept **is** an idempotency + optimistic-concurrency protocol (the three
BLOCKERs in the status header). Treat D4 as the *shape* of the commit, not as a
discharged proof.
**Grounding:** `spike-accept-primitive.md` (4 *ingredient* tests green; the
composed-accept verdict is retracted); `state.rs:93`;
`envelope.rs:161-171`; `ledger.rs:199-202`.

### D5 — v1 operators built-in Rust; first = a simple single-object revision op
`fn(selection, read-view) -> Vec<Candidate>` in Rust (not Tier-1 schema-pack
functions; executable = Tier 5, deferred). First operator is a simple
deterministic single-object revision op — not `Extract-Canon`.
**Grounding:** paper §10 (Tier 1 declarative / Tier 5 deferred).

### D6 — Human-only accept; commit is check-independent; NO auto re-run (resolves N5/D8)
Accept is `coherence_operator_accept(candidate)`, **human-only** in v1 (delegated
scope deferred). It commits **independently of any check** — a provider failure
never rolls back an accept. There is **no automatic post-accept re-run**: the
transient preview verdict is **discarded**; the committed edge is checkable via
the normal **pull-based** `coherence_check` on explicit human ask (D8 pull-only
preserved — this removes the v2 D6/D8 contradiction). **Accept precondition
(N1/N4):** immediately before writing, revalidate — base head == candidate
`base_rev` (`resolve_live`), working-copy hash == expected (`content_hash_of`),
object not held/absent, **and the preview fingerprint still holds** (viewing
context id + `claims_fingerprint` + input revisions unchanged). On any drift,
**reject → require re-preview**. Retry uses the D4 deterministic idem.
**Grounding:** SP-A; `check_commands.rs:52` (`content_hash_of`), `:71`
(`resolve_live`); `delegation.rs:15` (existing scopes are resolution-only).

### D7 — Bounded preview read-view is NEW; SP0 builds + measures it
Preview must project only the affected set, not the whole graph — which is **not
shipped** (`index_query.rs` `breakdown_checked` loads the full DAG + unfiltered
`SELECT … FROM edges`). `edges_by_upstream` exists (`index.rs:44`); SP0 **adds
`edges_by_downstream`** (needed for D2's downstream-incident set) and builds a
bounded read-view over `upstream ∪ downstream` incident to the changed object.
**Grounding:** `index_query.rs` `breakdown_checked`; `index.rs:44`.

### D8 — Guardrails as property tests (I3 / §14)
Never auto-select among N; never auto-commit; **semantic verdicts never block**
accept; schema / authorization / concurrency (stale-base) / persistence
validation **do** block; **pull-only** — no check runs without an explicit human
ask (now consistent with D6: no auto re-run).
**Grounding:** I3, §14.

## SP0 — end-to-end disposable single-object operator slice (with concrete gates)

A private deterministic single-object, single-output operator producing **two**
candidates.

**Functional:** preview (bounded read-view, D7) → transient candidate-check (D3)
→ reject one → **stale-base / stale-fingerprint accept rejected** (D6) → accept
the other (one `append_and_apply`, D4) → the accepted revision id equals the
previewed one.

**Fault + concurrency (must pass):**
1. Crash after file write / after CAS snapshot / after ledger entry → rescan →
   projection consistent; a crash before ledger heals as `observed-external`
   (capture-equivalent), no corruption.
2. Torn ledger append → quarantined, next append clean.
3. Crash after ledger append before index apply → `scan_workspace` replay
   (`scan.rs:63`) restores consistency.
4. **Idempotent retry:** re-sent accept with the D4 deterministic idem → **one**
   logical entry (not two).
5. Concurrent writer advances the base between preview and accept → accept
   rejects (stale base), no silent overwrite.
6. Downstream retirement: the accepted revision retires an old
   downstream-incident edge (`Some → None`) → the D2 multiset diff catches it.
7. Candidate tamper: accept recomputes `content_hash`/revision and rejects a
   mismatch.

**Performance gate (grounded to spec §10, 500k edges, release; debug ≤ 4×):**
| Metric | Gate |
|---|---|
| Preview p95 (bounded affected set) | **≤ 20 ms** (well under the ≤ 100 ms full-breakdown bar; single-edge projection is ≤ 1 ms) |
| Preview peak added memory | **≤ 16 MiB** (bounded by the affected set, not O(all edges)) |
| Accept commit | within capture's budgets — ledger append ≤ 5 ms + snapshot ≤ 10 ms (spec §10) |

**PASS gates decomposition.** Any red step/gate blocks the operator plan.

## Owner decisions — resolved

| # | Resolution |
|---|---|
| 1 | Canon claim-based / Context-hinged; `Extract-Canon` deferred. |
| 2 | Re-run vs rebind → **neither auto-runs** (D6 resolution supersedes: accept discards the transient verdict; post-accept check is pull-based). |
| 3 | Single output per transaction; v1 single-object-only (D4). |
| 4 | First operator = a simple single-object revision op (D5). |

## Codex review dispositions

**Review 2** (`019f79a2…`): ontology confirmed; scope narrowed. *(table retained
in v2 history; all items closed or folded below.)*

**Review 3** (`019f79ad…`, MAJOR GAPS) — dispositions:
| Finding | Disposition in v3 |
|---|---|
| #1 accept not atomic; scan can't recover intent | **SUPERSEDED by review 4** — this cell originally read "SP-A PROVEN"; that PASS is retracted (ingredient tests only). Accept is a real idempotency + optimistic-concurrency protocol; "atomic" corrected (D4). |
| D2 `LogicalEdgeKey` not unique | **Multiset** over `(…, input_ordinal)` (D2). |
| D3 contract unspecified | **Specified** (D3). |
| N1/N4 accept binds only to base head | **Preview-fingerprint precondition + revalidate** (D6). |
| N2 base vs self-edge | Base is a **parent, not an input** (D1). |
| N3 candidate identity / idempotent retry | **Deterministic idem** (D4); result identity (D3). |
| N5 re-run contradicts pull-only | **No auto re-run**; pull-based after (D6/D8). |
| N6 no numeric perf gate | **Concrete gates** grounded to spec §10 (SP0). |
| Grounding (D1 object-id, D4 "atomic", `capture.rs:207`) | Corrected in D1/D4. |

## v4 — G-B round-2 design dispositions (2026-07-20)

The runtime plan's G-B round 2 (`019f7b48…`, MAJOR GAPS, partially discharged)
found that D4/D6's three accept BLOCKERs were *named* but not *specified*, that
D7's bounded read-view was under-defined, and that "blast radius" and the
candidate lifecycle were ambiguous. This section specifies them. **Where v4 and
D1–D8 disagree, v4 wins** (it supersedes D4's idem formula and D6's "preview
fingerprint").

### V4.1 — Full canonical idem preimage (supersedes D4's `uuid(sha256(object ‖ base_rev ‖ content_hash))`)

D4's three-field preimage false-collapses distinct candidates (two operators
producing the same bytes over the same base would share an idem). The accept
idem is domain-separated over the **complete canonical commit payload**, with
**every field length-prefixed** so free-text values (`agent.id`,
`intent.summary`) cannot forge a field boundary (G-B round-3 High #C — a `\n` or
`:` in a summary must not alias a different structure):

```
fn field(s: bytes) = u32_be(len(s)) ‖ s              // length-prefixed, unambiguous
fn opt(x)          = byte(0) if None                 // presence byte disambiguates
                     byte(1) ‖ field(x) if Some(x)   // None ≠ Some("")
fn list(xs)        = u32_be(count(xs)) ‖ concat(field(x) for x in xs)

idem = uuidv8_from_sha256(
  field("vmark-operator-accept-v1")        // versioned domain tag
  ‖ field(format_version)
  ‖ field(operator_name)
  ‖ field(output.object) ‖ field(output.content_hash) ‖ field(output.revision)
  ‖ list(sorted(output.parents))
  ‖ list( for each input in declared order: field(input.object) ‖ field(input.revision) ‖ field(role) )
  ‖ field(agent.kind) ‖ opt(agent.id)               // opt: None distinct from Some("")
  ‖ field(intent.kind) ‖ field(intent.summary) ‖ opt(intent.prompt_hash)
  ‖ field(confidence)
)
```

Length-prefixing makes the encoding injective; the `opt` presence byte covers
**every** optional payload field — `agent.id` (`types.rs:136`) and
`intent.prompt_hash` (`types.rs:174`), which round-3's preimage omitted/aliased
(G-B round-4 PARTIAL #14). Parents are lexicographically sorted (matching
`RevisionId::compute`); no map iteration. The tag `…-v1` versions the schema; a
future field addition bumps it to `…-v2`. **Grounding:**
`RevisionId::compute` (`types.rs:87`) is the sorting/hashing precedent;
`Envelope.idem` is a plain `Uuid` field (`envelope.rs:21`) so a computed idem is
a field assignment, not a new constructor.

### V4.2 — Idem→receipt lookup returns the original receipt (BLOCKER 1)

Storage dedup (`applied` keyed by idem, `index.rs:55`) silently *drops* a replay;
an idempotent **API** must return the *original* receipt. New committable
primitive: `entry_id_by_idem(idem) -> Result<Option<Uuid>>` over a new
`applied.entry_id` column (today `applied` stores only the idem — the entry id is
lost). Accept flow, **holding the kernel lock**: compute V4.1 idem →
`entry_id_by_idem` → if `Some(id)`, load that entry and return its receipt
(entry id + resulting revision) **without appending**; if `None`, `append_and_apply`
then return.

**The torn-window correctness argument (G-B round-3 Critical #B, corrected in
round 4).** `append_and_apply` (`state.rs:93`) writes the *ledger first*, then the
index; the ledger's `append` never dedups (`ledger.rs:123` always writes), and
dedup happens only in `read_all` (`ledger.rs:199-202`). So a crash **between** the
ledger append and the index apply leaves an entry the `applied` table never
learns — and `WorkspaceKernel::open` only rebuilds when `needs_rebuild ||
!initialized` (`state.rs:44-53`), so a *valid* index does **not** heal that entry
on the next open. **An index-only idem lookup is therefore unsound.** Round-3's
"heals on open" claim was wrong.

**Correct rule: the idem lookup is ledger-authoritative, lookup-before-append,
under the lock.** Accept, holding the kernel mutex (`state.rs:179`):

1. computes the V4.1 idem;
2. **scans the ledger** for an existing entry with that idem — authoritative
   because the ledger is the source of truth and is always fully readable
   regardless of index state (the `applied` table is only a same-process fast
   path, consulted first, but a miss falls through to the ledger scan, it is
   never trusted as a *negative*);
3. if found, returns that entry's receipt **without appending**;
4. else appends, then applies.

Because the lookup reads the ledger *before* appending, a retry after a crash in
the torn window **finds the first entry** and never writes a second — so no
duplicate is ever created, and "which entry is the survivor / whether the clock
rolled back" never arises (there is at most one entry per idem). Two accepts
cannot interleave (the mutex serializes them), and a crash between lookup and
append is harmless because the retry re-runs the lookup and finds the committed
entry. Cost: an accept is a rare human action, so an O(ledger) scan (or an
in-memory idem→entry_id map kept alongside the index) is acceptable;
`applied.entry_id` (new column, schema bump → rebuild, R16) serves the
same-process fast path.

### V4.3 — Accept precondition = reproject-under-lock (supersedes D6 "preview fingerprint")

Rather than enumerate a read-set digest (fragile — any missed field is a
correctness hole, per G-B round-2 completeness #2), the precondition
**re-projects the affected set under the commit lock** and compares a
**check-independent structural class** of each edge's projection.

**Why not the raw `EdgeState` multiset (G-B round-3 Critical #A).** `EdgeState`
folds in the semantic verdict — `VersionStale`, `StaleValid`,
`StaleContradicted`, `StaleUnknown` differ *only* by which check result applies
(`project.rs:170-178`). Comparing raw states would let a semantic check landing
between preview and accept flip `VersionStale → StaleContradicted` and **reject
the accept** — i.e. a semantic verdict would block accept, violating I3/§14. So
the precondition compares `structural_class(Option<EdgeState>)`, which collapses
the four check-dependent states into one `Stale` token:

```
None                                 -> Retired
Fresh{ratified, ahead}               -> Fresh(ratified, ahead)   // kept: not check-derived
VersionStale | StaleValid
  | StaleContradicted | StaleUnknown -> Stale                    // ONLY the check verdict erased
Waived                               -> Waived
Diverged{multi_head}                 -> Diverged(multi_head)
Unpinnable                           -> Unpinnable
```

`structural_class` erases **only** the check verdict — it keeps every other
distinction (`Fresh{ratified, ahead}` stays split, so a ratification or an
"ahead" head move is still visible). It is **not** the coarser display helper in
the SP1 test.

**The comparison is a map keyed by *physical edge identity*, not by
`SemanticEdgeKey` (G-B round-4 Critical #A, round-5 refinement).**
`SemanticEdgeKey` is deliberately a **bag** key — coincident edges can share it
(D2), so `Map<SemanticEdgeKey → class>` would overwrite collisions and miss a
per-physical-edge change (one of two coincident edges getting waived/ratified).
The precondition instead keys by the **unique physical edge identity**: for a
committed edge, the edges-table PK `(txf, input_idx, downstream, downstream_rev)`
(`index.rs:42`); for one of the candidate's own new edges,
`(candidate_revision_id, input_ordinal)` (stable and unique, since the candidate
is content-addressed and fixed across preview→accept). So `S_preview` and `S_now`
are `Map<PhysicalEdgeId → structural_class>`.

An unkeyed bag would miss a *compensating swap* (edge A `Fresh→Stale` while edge B
`Stale→Fresh` leaves the bag `{Fresh:1, Stale:1}` unchanged); a physically-keyed
map catches it because A's and B's entries each change value. The precondition:
preview captured `S_preview`; accept, holding the single per-workspace kernel
mutex (`state.rs:179`), recomputes `S_now` over the same affected physical edges
against the *current* DAG / resolutions / context; if `S_now != S_preview` **for
any key**, **reject → re-preview**; else append. This catches every *structural*
concurrency hazard per physical edge — base-head moves
(`Fresh↔Stale↔Diverged↔Unpinnable`, incl. `ahead`), retirements (`Some↔None`),
ratifications (`Fresh↔Fresh{ratified}`), waivers, context repins — while a pure
semantic-check arrival is **invisible** to it, so accept is never blocked by a
verdict. Base-head revalidation (D6: `resolve_live` == candidate `base_rev`) runs
inside the same lock. Cross-process external `git`/scan advances are caught
because `S_now` is computed from the freshly loaded DAG.

### V4.4 — Bounded `ReadView` (completes D7)

D7 named `edges_by_downstream` but the projection also full-loads the DAG,
paths, absent set, all resolutions, and per-edge checks (`index_query.rs:146`).
The bounded `ReadView` for a single changed object `X`:

| Field | Source (targeted query) | Bound |
|---|---|---|
| affected edges | `edges_by_upstream(X)` ∪ `edges_by_downstream(X)` ∪ candidate edges | O(deg X) |
| sub-DAG | revisions+parents of **only** the objects incident to those edges | O(incident objects × their revs) |
| resolutions | `resolutions WHERE (txf,input) IN affected` | O(affected) |
| checks | `check_results WHERE (txf,input) IN affected` | O(affected) |
| paths / absent | registry+absent rows for incident objects only | O(incident objects) |
| context view | `ContextSet::effective_view(context_id)` (V4.6) | O(context pins) |

New committable primitives: `edges_by_downstream` (index on `edges(downstream)`),
`resolutions_for(&[(txf,input)])`, `checks_for(&[(txf,input)])`,
`revisions_of(&[object])`. **Worst-case degree:** a super-canon with N conformers
makes `edges_by_upstream(canon)` return N — inherent to a star. The preview
**caps** the affected set at a documented `PREVIEW_MAX_EDGES` (e.g. 2000) and
reports `+M more` rather than loading unbounded rows; the 16 MiB gate is measured
against the cap, and a hub above the cap is surfaced as "preview truncated," not
silently partial. Peak-memory measurement: RSS delta around the preview call in
the SP0 perf harness.

### V4.5 — Blast radius = `local_projection_delta` + `preview_forward_closure`

"Blast radius" splits into two contracts (G-B ambiguity #2):

- **`local_projection_delta`** (authoritative): the affected edges whose
  `Option<EdgeState>` **differs** between the base projection and the candidate
  projection — including `Some → None` retirements. This is exactly the D2
  multiset diff. Local, exact, mutation-free.
- **`preview_forward_closure`** (advisory display only): a bounded forward walk
  along dependency/conformance edges from `X`, depth-capped
  (`PREVIEW_CLOSURE_DEPTH`, e.g. 3), cycle-guarded (visited set), deduped by
  object. It **never** mutates `EdgeState` (staleness stays local — the ontology
  invariant) and is shown as "may also be affected," never as a stale verdict.

The preview UI shows the local delta as the verdict and the forward closure as
context. Retired (`Some → None`) edges appear in the delta, labeled "retired."

### V4.6 — Content-addressed candidate lifecycle across IPC

Candidate **revision id** = `RevisionId::compute(content_hash, parents)` (D1) —
content-addressed over content+parents **only** (`types.rs:87`; the object id and
inputs are deliberately *not* in the revision id). So the revision id alone is
**not** full tamper-evidence (G-B round-3 PARTIAL #14): tamper on the *inputs*,
*operator*, or *intent* is caught not by the revision id but by the **V4.1 idem**,
which the server recomputes from the resubmitted payload — a tampered input
changes the idem and, more directly, changes the transformation body that gets
appended. The two together bind the whole payload: revision id pins
content+parents, V4.1 idem pins everything else.

Accept **resubmits the full candidate** (object, content bytes → re-hashed,
parents, inputs, operator name, intent) **plus the preview's structural-class
multiset `S_preview`** (V4.3), *not* a server-memory handle. The server:
recomputes the revision id (rejects a content/parent mismatch — SP0 gate 7),
recomputes the V4.1 idem for the receipt lookup, and runs the V4.3
reproject-under-lock against `S_preview`. **Trust model:** a client that echoes a
stale `S_preview` cannot corrupt anything — the appended entry is exactly the
content-addressed candidate, and an actually-moved base is caught independently
by base-head revalidation (`resolve_live == base_rev`); `S_preview` only ever
*adds* a rejection, never forces an unsafe accept. Consequences: no server-side
candidate session to survive a restart; no expiry needed. Schemas: preview
`{ context_id, operator, selection }` → `{ candidates: [{ revision_id,
local_projection_delta, forward_closure, advisory_check, structural_classes }] }`;
accept `{ context_id, candidate_payload, structural_classes }` →
`{ entry_id, revision_id }`.

### V4.7 — Additive `edge_kind` slot (Phase 2 wire format)

`OriginEdge` gains `kind: OriginEdgeKind` (`project.rs:13`); the `edges` table
gains `edge_kind TEXT NOT NULL DEFAULT 'dependency'` (`index.rs:37`); legacy rows
default to `dependency`. **`edge_kind` is orthogonal to `InputRole`** — role
(Direct/Contextual) is provenance liveness; `edge_kind`
(dependency/conformance/supersession/part-of/mention) is the propagation class.
Contradiction is **not** a kind (it stays an `EdgeCheck` assessment). Inferred at
capture; schema bump → rebuild (R16). This is WI-2.1's concrete wire change.

### V4.8 — Estimated cost, not measured (Phase 1)

`run_ai_prompt_collect` returns `String` only — no token usage (G-B feasibility
#3). Phase-1 cost accounting is therefore **estimated, and labeled as such**:
`tokens ≈ (prompt_chars + response_chars) / 4`; `cost ≈ tokens × model_rate`
from a small per-model table; a running total trips the ceiling with a graceful
stop. CLI providers (no usage API) use the same estimate. A measured
provider-usage envelope is deferred to its own increment. The Phase-1 report
states "estimated cost" everywhere — no false precision.

### V4.9 — SP0 is not a Phase-0 probe; it is the Phase-3 integration gate

G-B feasibility #1 is correct: SP0 needs production seams (V4.2 idem-receipt,
V4.4 ReadView, D3 transient checker, V4.3 OCC accept) that Phase 0's
"no-production-source" rule forbids. **Resolution:** SP0 moves out of Phase 0.
Those seams become **Phase 3.0**, a committable primitives sub-phase (TDD, real
source); **SP0 becomes the Phase-3 entry acceptance test** that exercises the
nine functional/fault/perf gates over them. Phase 0 keeps only the pure-kernel
probes: **SP1** (done — `spike_sp1_dry_run_projection.rs`, 3/3 green: the D2
projection proof SP0 depends on), **SP3** (classifier placement), and **SP-canon**
absorbs the old SP2 (claim-based canon can't be probed as an object flag).
Sequencing: **SP1 → Phase 3.0 → SP0 → Phase 3**; **Phase 1 → Phase 3**.

## Governance

**Commit order (resolves the SP0 circularity — G-B round-3 PARTIAL #7).** The
runtime plan's **G-B review** must clear (rule 60 §6) before Phase-1 commits. The
**Phase-3.0 primitives** (V4.2/V4.3/V4.4 + D3) are ordinary committable WIs under
TDD — they commit **before** SP0, which is the *integration acceptance test built
on top of them*. So the order is: G-B clears → Phase 0 (SP1 green + SP3) → **Phase
3.0 primitives commit** → **SP0 PASS** (rule 60 §7) → Phase-3 surface/UI commits.
SP0 gates Phase-3 *surface* work, not its own prerequisites — it is not circular.
SP1 is green (`spike_sp1_dry_run_projection.rs`). Verify-at-volume
(`verify-at-volume-baseline.md`) proceeds independently as the measurement track.
