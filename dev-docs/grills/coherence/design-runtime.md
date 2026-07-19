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
> **DECISION (owner): BANKED.** The forward-operator layer is deferred to a
> deliberate, **running-code** implementation effort (the "option A" build, when
> funded) — *not* another design pass. What this record banks as that build's
> foundation: the settled ontology; decisions D1–D8; the three review-4 BLOCKERs
> (idem-lookup-return-receipt, full-payload idem, complete-read-set precondition)
> and their known fixes; the SP0 fault/concurrency/perf gate list; and the honest
> finding that accept is an idempotency + optimistic-concurrency protocol scoped
> to the single serialized per-workspace kernel. Reviews 1–4 (threads
> `019f7404`→`019f79cf`) are the audit trail. **Active track: verify-at-volume**
> (`verify-at-volume-baseline.md`).
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

### D4 — Accept = capture-equivalent single-entry commit with a deterministic idem (SP-A PROVEN)
Accept mints **one** transformation (one output) via **one** `append_and_apply`
(`state.rs:93`), `intent.kind = "operator:<name>"`. Crash semantics **equal
shipped capture's**: a crash before the ledger append heals as `observed-external`
on rescan (content present, operator provenance lost, re-runnable) — **not
atomic, capture-equivalent** (tested: `scan.test.rs:66`; torn append
`ledger.test.rs:62`). **Idempotent retry:** accept derives a **deterministic**
idem `= uuid(sha256(object ‖ base_rev ‖ content_hash))` (not the random
`Envelope::create` idem, `envelope.rs:171`), so a retry after a lost response
collapses via the existing dedup (`ledger.rs:199-202`, tested
`ledger.test.rs:89`). **SP-A confirms** this needs no new commit protocol.
**Grounding:** `spike-accept-primitive.md` (4 tests green); `state.rs:93`;
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
| #1 accept not atomic; scan can't recover intent | **SP-A PROVEN** — accept = capture-equivalent; deterministic idem; no new protocol (D4). "Atomic" corrected. |
| D2 `LogicalEdgeKey` not unique | **Multiset** over `(…, input_ordinal)` (D2). |
| D3 contract unspecified | **Specified** (D3). |
| N1/N4 accept binds only to base head | **Preview-fingerprint precondition + revalidate** (D6). |
| N2 base vs self-edge | Base is a **parent, not an input** (D1). |
| N3 candidate identity / idempotent retry | **Deterministic idem** (D4); result identity (D3). |
| N5 re-run contradicts pull-only | **No auto re-run**; pull-based after (D6/D8). |
| N6 no numeric perf gate | **Concrete gates** grounded to spec §10 (SP0). |
| Grounding (D1 object-id, D4 "atomic", `capture.rs:207`) | Corrected in D1/D4. |

## Governance

Decompose only after **Codex review 4** of this v3 clears (or NEEDS-REVISION with
a small residual) **and SP0 PASS** (rule 60 §6/§7). Verify-at-volume
(`verify-at-volume-baseline.md`) proceeds independently as the measurement track.
