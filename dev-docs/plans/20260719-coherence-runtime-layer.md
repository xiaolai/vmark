# Plan: Coherence Runtime Layer — Verify-at-Volume, Classifier, Forward Operators, Canon-Hub, Merge Auditor

- **Status: READY TO BUILD — G-B cleared after 6 rounds (2026-07-20).** The
  cross-model gate converged: round 2 MAJOR GAPS → round 3 MAJOR GAPS → round 4
  NEEDS REVISION → round 5 NEEDS REVISION (2 residual) → **round 6 READY TO
  BUILD, no Phase-0/Phase-1 blocker.** `design-runtime.md` v4 (V4.1–V4.9) is the
  verified accept-protocol contract. **Phase 0 complete:** gate green
  (`check-coherence-runtime-phase.sh 0`, 13/13); SP1 4/4, SP3 7/7; spec rev 3
  §13 merged. Governance sequence now: **Phase 1 (verify at volume) → Phase 2
  (classifier) in parallel → Phase 3.0 primitives → SP0 PASS** (rule 60 §7) →
  Phases 3–5 → Phase 6 design. Rounds 3–6 disposition table precedes the
  round-2 one.

- **History — G-B round 1 (`019f796a-7e30-7173-8222-24be7b11368d`, MAJOR GAPS,
  2026-07-19):** found this plan decomposed to WIs *before* the runtime layer's
  design decisions were made — colliding with the shipped kernel (the checker
  requires a *committed* `(txf,input)`; append-only history has no rollback;
  edge identity `(txf,input)` omits output) and the normative ontology
  (contradiction is a `check-result` **assessment**, not an edge kind; canon is
  **claim-based** in the paper, not an object flag; staleness is strictly
  **local**, not transitive). Disposition accepted in full (table below); the
  plan reverted to *input* for the design session. **That session produced
  `design-runtime.md`** — ontology settled (D-table), candidate/accept model
  resolved (D1–D8), SP0 gate defined. This re-decomposition discharges that
  resolution. **G-A ✓** (owner, 2026-07-19): ADR-C6 + ADR-C7 approved.

- **Date:** 2026-07-19 (re-decomposed 2026-07-20)
- **Contract:** `dev-docs/coherence-layer-paper.md` **v2.0** and
  `dev-docs/specs/coherence-format-v0.md` (rev 3 — §13 runtime addenda). All WIs trace to the paper's
  R/I/O/M IDs and §5/§8/§14. Where this plan and the paper/spec disagree, the
  paper/spec wins and this plan is amended.
- **Design inputs:** `grills/coherence/forward-operators-proposal.md`
  (ADR-C6/C7), `grills/coherence/state-and-staleness-notes.md` (state ontology,
  edge taxonomy, waiver semantics, canon-hub), `dev-docs/vision.md` (the arc
  this serves), `grills/coherence/design-2a.md` + `design-3.md` (approved
  semantic + delegation model), **`grills/coherence/design-runtime.md` v4
  (un-banked for the funded build — the runtime-layer ontology, candidate/accept
  model D1–D8, and the V4.1–V4.9 protocol specs this plan decomposes against)**.
- **Prior work this builds on (already shipped — Phases 1–3 of
  `20260718-coherence-layer.md`, ~12k LOC Rust):** the three-atom kernel, both
  staleness axes (version via `dag.rs`/`project.rs`; semantic via
  `checker.rs`/`claims.rs`), capture funnels, scan reconciliation, git
  classification (`gitops.rs`/`merge_surface.rs`), waivers-as-ledger-entries with
  endpoint-advance expiry, the breakdown view, and read-only + delegated MCP.
  **This plan builds the runtime layer on top; it adds no kernel atom.**

## Implementation progress (2026-07-20)

Committed on branch `coherence-runtime-design-research`, all tests green + clippy
clean (coherence lib **303 passed**, spikes 4+7, inventory 11):

| WI | State | Evidence |
|---|---|---|
| Phase 0 (all) | ✅ **complete** | 6 G-B rounds → READY TO BUILD; SP1 4/4, SP3 7/7; gate `check-coherence-runtime-phase.sh 0` = 13/13; design v4; spec rev 3 §13 |
| WI-1.4 checker robustness | ✅ **done** | `check_sweep.rs` — 16 tests (cost/budget/backoff/resume/manifest) |
| WI-1.1 volume harness | ✅ **done (code)** | `check_sweep_run.rs` + `coherence_check_sweep` command, 6 tests + resume cursor |
| WI-1.2 drift baseline, WI-1.3 M-metrics | ⏳ **needs a live dogfood run** | require the running app + AI provider — cannot be produced from code |
| WI-2.1 edge-kind registry | ✅ **done** | `edge_kind.rs` (7 tests) + `OriginEdge.kind` + `project_edge` gating + schema v4 col; characterization-tested, behaviour-preserving |
| WI-2.4 read-model (backend) | ✅ **done** | `EdgeRow.kind`; frontend grouping + i18n×10 remain |
| WI-3.0a bounded ReadView | ✅ **done** | `read_view.rs` — `edges_by_downstream` + `edges_incident_to` cap, 4 tests |
| WI-3.0b idem-receipt lookup | ✅ **done** | `applied.entry_id` (schema v5) + `entry_id_by_idem`; index fast-path, original-on-replay test |
| WI-3.0c accept idem | ✅ **done** | `operator_accept.rs` — injective length-prefixed preimage, 6 tests |
| WI-3.0d transient candidate check | ✅ **done** | `build_candidate_check_prompt` (checker.rs), proposal-vs-inputs/canon, 4 tests |
| WI-3.0e reproject precondition | ✅ **done** | `accept_precondition.rs` — check-independent, physical-keyed, 8 tests |
| SP0 integration gate | ⬜ **remaining** | all 5 primitives done; needs the operator runtime + accept command wiring them (ledger-authoritative lookup-before-append) + a real perf/fault harness (20 ms / 16 MiB) |
| Phase 3 operators + UI + MCP | ⬜ **remaining** | WI-3.1–3.7; UI + i18n×10 need frontend + visual QA |
| Phase 4 (canon) | ⬜ **gated** | needs the **SP-canon** design pass first |
| Phase 5 (merge auditor) | ⬜ **gated** | needs the **SP4** merge-mapping spike first |
| Phase 6 (projection framework) | ⬜ **gated** | needs its own design pass |

## Scope discipline

- Phases 0–5 are decomposed into WIs here. **Phase 6 (projection framework) is
  outlined only** — decomposed by a plan amendment after its own design pass.
- **Verticals as schema packs** (vision stage 5) are explicitly *out of scope*:
  they belong to `20260718-coherence-layer.md` Phase 4. This plan is the
  runtime layer that a vertical later composes in.
- **No new external dependencies** (ADR-P5). Every phase composes existing
  atoms and crates. If any WI appears to need a new crate, stop and amend
  (rule 60 §4).

## Verifiable success criteria (plan level)

1. **Phase 0 exit:** SP1 (done, green) + SP3 spike reports written with a recorded
   PASS/decision; entry-gate spec addendum (rev 3, format stays 0) merged;
   `bash scripts/check-coherence-runtime-phase.sh 0` exits 0. (SP0 → Phase 3.0;
   SP2 → SP-canon — design v4.9.)
2. **Phase 1 exit (the gate):** from the committed run manifest — **distinct
   live-edge coverage ≥ 90%** of the current live stale-edge set (denominator =
   distinct live stale edges, not a raw check-result count; G-B round-3 PARTIAL
   #9), **checker error-rate ≤ 5%**, **p95 provider latency ≤ 30 s**, **estimated
   cost recorded and under the run's ceiling** (v4.8), and a **resume run that
   adds zero duplicate check-results** (idempotent by `(edge, checked_against,
   claims_fingerprint)`); the drift gauge reads a recorded content-hash-pinned
   baseline; owner-judged M1–M5 re-measured at volume;
   `check-coherence-runtime-phase.sh 1` exits 0. (Thresholds are the initial
   budget; WI-0.5 records them in the phase script so they are enforced, not
   prose.)
3. **Every phase:** `check-coherence-runtime-phase.sh <N>` exits 0 — it *runs*
   the coherence cargo suites + the relevant vitest suites (fail-closed, not
   reminder-only) and asserts the phase's guardrail property tests are green.
4. **Guardrail invariants** (property tests, every phase that can violate them):
   an operator **never auto-selects** among candidates and **never auto-commits**
   (I3); checks are **advisory, never blocking** (I3, §14); the auditor **never
   auto-merges objects** (§14). A red guardrail test fails the phase.
5. **No WI is "complete" without linkage** — commit `(WI-N.M)` or test-file
   header (rule 60 §2); `scripts/check-wi-linkage.sh <this-plan> --phase=N`.

## ADRs (implementation-level; architectural ADR-C6/C7 live in the proposal)

- **ADR-P1 — Dry-run projection is a pure candidate-overlay, mints nothing.**
  The one genuinely new kernel entry point. It overlays candidate revisions on
  the DAG and computes staleness/blast-radius *without appending to the ledger*.
  It reuses `dag::resolve`/`project_edge`; its correctness proof is **multiset
  observational equality over a disposable clone** (preview on a throwaway store
  vs commit-then-read on a second, envelope id/time/idem excluded; original
  byte-unchanged) — **not** the retired `commit → project → rollback` equality
  (append-only ⇒ no rollback). **Gated by SP1** (rule 60 §7). Traces: ADR-C6
  step 2, design D2.
- **ADR-P2 — Relationship-classifier placement resolved by SP3.** Only the
  **dependency/version** axis becomes an entry in a typed **`OriginEdgeKind`
  registry** — each kind carries `(origin: captured|discovered, shape:
  directional|symmetric, propagation: version|none)`. **Contradiction is NOT a
  registry entry** (G-B consistency #2): the semantic axis stays an `EdgeCheck`
  *assessment* that projection folds in (`project.rs:170-178`), never a kind. The
  registry is realized by the additive `edge_kind` slot (design v4.7). SP3
  decides kernel-level registry vs Tier-1 schema-pack declaration; recorded
  before Phase 2 commits.
- **ADR-P3 (re-cast) — Canon = claim-based, Context-hinged; surfaced through a
  conformance edge kind. No new atom, no object flag.** Per the owner decision,
  canon is **fed established claims in an enforcing Context** (paper §5;
  `claims.rs`/`contexts.rs`), *not* an "authoritative object" flag. Conformance
  is a registered `OriginEdgeKind` (directional, carries version-staleness)
  linking a conforming object to the canon it uses. Context-relative by
  construction (an alternate context may hold a `Diverged` canon). `Extract-Canon`
  and the typed candidate-effect model are deferred to SP-canon. Traces: paper
  §5, Deep-dive B, design owner-decision 1.
- **ADR-P4 — The auditor is composition, never a new algorithm, never an
  auto-merger.** ADR-C7 = run the existing checker over the edges a completed
  git merge touched (`merge_surface.rs` × `checker.rs`), surface contradictions
  for human resolution. No semantic object-merge is built (§14). Traces: R18,
  R11/R25, ADR-C7.
- **ADR-P5 — No new external dependencies.** Scope guard against rule 60 §4;
  any apparent need triggers a plan amendment + crate review, not a silent add.

## Pre-Phase-1 gates (must pass before any commit under this plan)

| Gate | Requirement | Rule |
|---|---|---|
| G-A | **✓ met (owner, 2026-07-19)** — ADR-C6 + ADR-C7 approved; proposal flipped to APPROVED. | 60 §1 |
| G-B | Codex cross-model review of this plan → disposition table appended before Phase 1 commits. | 60 §6 |
| G-C | Spikes PASS before dependent phases: **SP1→Phase 3.0→SP0→P3** (SP1 green); **SP3→P2**; **SP-canon→P4** (absorbs old SP2); **SP4→P5**. | 60 §7 |

---

## Cross-model review (G-B, rule 60 §6) — record and disposition

- **Thread:** `019f796a-7e30-7173-8222-24be7b11368d` (Codex, read-only sandbox,
  high reasoning effort; plan + paper + spec + proposal + notes + prior plan +
  rule 60 read; it also read the shipped kernel source).
- **Verdict: MAJOR GAPS.** 4 Critical + multiple High findings across all five
  dimensions. **Disposition: accepted in full** — no finding refuted. The
  findings cluster into five themes; Themes A–B are design-level (they resolve
  in the design session, not by patching WIs); Themes C–E fold into the
  re-decomposition.

| Theme | Codex findings | Disposition |
|---|---|---|
| **A — Candidate/uncommitted model is deeper than planned** | SP1 "byte-identical to commit→project→rollback" is ill-formed (append-only ⇒ no rollback; a commit mints UUID/time/idem); the shipped checker can only verify a *committed* edge; multi-object changesets need output-bearing edge identity (`(txf,input)` omits output); candidate lifecycle (base binding, concurrency, atomicity, recovery) undefined; no preview performance envelope vs 500k edges; "blast radius" undefined | **Accepted → design session.** SP1 reformulated to *observational equality over a disposable clone* (compare normalized projection rows, exclude envelope IDs/times, assert original ledger/CAS/index unchanged); add a transient checker-prep API over candidate bytes; decide output identity in the rev-3 contract; **Phase 0 becomes an end-to-end disposable operator slice** (two candidates → preview → transient check → reject one → atomic accept → restart/replay), not just a DAG overlay |
| **B — Ontology conflicts with the normative contract** | contradiction modeled as an edge kind (it is a `check-result` assessment); canon redefined as an object flag (paper derives canon from claim-objects in an enforcing Context); WI-4.5 transitive canon-of-canon staleness contradicts the local projection *and* the design notes | **Accepted → design session.** Separate `OriginEdgeKind` (dependency, conformance) from `AssessmentKind` (contradiction stays a check-result). **Canon ontology is an owner decision** (align to claim-based canon vs formally amend the paper). Replace "transitive staleness" with: local current-staleness (unchanged) **+** a separate forward blast-radius closure used *only* for preview |
| **C — "Mostly composition" claims too optimistic** | operators-as-"Tier-1 schema-pack functions" have no execution model (Tier 1 is declarative; executable = deferred Tier 5); operator accept can't reuse the `resolve` delegation path; the merge auditor isn't "mostly wiring" (`merge_surface` stores only a merge SHA; git-attributed txns have empty inputs) | **Accepted.** v1 operators are **built-in Rust** (no DSL/Tier-5); add an `operator.accept` delegation scope + dedicated atomic accept command; add a **merge-diff→object mapping spike** before the auditor phase |
| **D — Gate & measurement rigor** | Phase 1 entry-count gate is inflatable and doesn't establish precision/coverage/cost; M2/M4/M5 need human judgment (not auto); "re-coherence tax" is not a defined M-metric/wire field; drift gauge lives in the sibling `epcho-ai` repo (not vendored); no per-provider cost accounting | **Accepted.** Phase 1 gates on distinct *live-edge* coverage + error-rate + p95 latency + total cost + resume correctness + owner-judged M3; M2/M4/M5 stay owner-judged; define the drift-gauge formulas + required ledger/session fields contractually; locate/version the external gauge |
| **E — Plan hygiene** | gate wording self-conflicts (G-C "before any commit" vs dependent-phase; stale "before G-A"); trace refs unqualified/wrong (`§9.2`/`§3`/`§4` are not paper sections; WI-4.4 cites R31 though R31 *fixes* file-level granularity); thin per-WI acceptance; missing explicit per-phase prerequisites; projection framework deferred while bespoke panels accrue | **Accepted.** One phase dependency matrix; qualify every `§` by document; drop the backwards R31 citation; per-WI acceptance/edge-case columns; explicit prerequisites enforced by the phase script; a minimal shared read-model interface defined before the operator/canon UIs |

**Owner decision that unblocks the design session:** the canon ontology
(Theme B) — align to the paper's **claim-based** canon (recommended; no paper
amendment) vs redefine canon as **objects** (requires a formal paper amendment).
**Resolved (owner, `design-runtime.md`):** canon stays **claim-based /
Context-hinged**; no paper amendment; `Extract-Canon` deferred to its own
increment record. This is why Phase 4's ADR-P3 is re-cast below as
*claim-hinged canon surfaced through a conformance edge kind*, not an object
flag.

---

## Re-decomposition (2026-07-20) — how `design-runtime.md` + Themes A–E fold in

The first G-B verdict is discharged not by patching WIs but by the design record
(now `design-runtime.md` **v4**, un-banked). The amendments below are **normative
over the phase tables that follow** where they conflict (contract-first, R21):

| Source | Amendment to this plan |
|---|---|
| **Theme A / design D1–D2** | SP1's "byte-identical to `commit → project → rollback`" is **ill-formed** (append-only ⇒ no rollback). **Reformulated (WI-0.1):** *observational equality over a disposable clone* — run the operator's preview on a throwaway copy of the ledger/CAS/index, commit-then-read on a second copy, and assert the two **multisets** of `(SemanticEdgeKey, Option<EdgeState>)` are equal (envelope id/time/idem excluded), **and** the original store is byte-unchanged after preview. `SemanticEdgeKey` is a *bag* key incl. `input_ordinal` (physical identity `(txf,input)`, `index.rs:37`). |
| **Theme A / design D7 → v4.4** | Preview must project only the **affected set** (upstream ∪ downstream incident to the changed object), which is **not shipped** — `breakdown_checked` loads the full DAG, paths, absent set, all resolutions, and per-edge checks. The bounded `ReadView` (v4.4) adds `edges_by_downstream` + targeted `resolutions_for`/`checks_for`/`revisions_of` + a `PREVIEW_MAX_EDGES` cap. Built in **Phase 3.0** (WI-3.0a), gated by SP0's perf envelope (≤20 ms p95 / ≤16 MiB added). |
| **Theme A / design D4+D6 → v4.1/v4.2/v4.3** | Accept is **not** a capture wrapper — it is an idempotency + optimistic-concurrency protocol, now fully specified: (1) lost-response retry **looks up the idem and returns the original receipt**, ledger-authoritative so it survives the append-before-apply torn window (v4.2); (2) the deterministic idem is **length-prefixed** over the *complete* canonical payload — output object/hash/rev/parents, every input, agent, intent, confidence (v4.1); (3) the accept precondition **reprojects a check-independent structural class** under the commit lock (v4.3) — a concurrent semantic verdict is invisible to it, so it never blocks accept. |
| **Theme B / design D-table** | **Contradiction stays a `check-result` assessment, never an edge kind** — the Phase-2 registry types only `OriginEdgeKind` (dependency, conformance, supersession, part-of/mention); the semantic axis is *not* a registry entry. WI-2.1 corrected: refactor the **version** axis into the registry; the semantic axis remains a projection input (`EdgeCheck`), not a kind. Canon is **claim-hinged** (Phase 4 ADR-P3 re-cast). "Transitive canon-of-canon staleness" (old WI-4.5) is replaced by **local** current-staleness + a separate forward blast-radius closure used *only* for preview. |
| **Theme C** | v1 operators are **built-in Rust** (`fn(selection, read-view) -> Vec<Candidate>`, design D5) — **not** Tier-1 schema-pack functions (Tier 1 is declarative; executable = Tier 5, deferred). WI-3.2 corrected. Operator accept does **not** reuse the `resolve` delegation path; delegated `operator.accept` is **deferred** (v1 accept is human-only, D6). The merge auditor is **not** "mostly wiring": Phase 5 gets a **merge-diff→object mapping spike** (SP4) before it commits (`merge_surface` stores only a SHA; git txns have empty inputs). |
| **Theme D** | Phase 1 gates on distinct **live-edge** coverage + error-rate + p95 latency + total cost + resume correctness + owner-judged M3 — not a raw check-result count. M2/M4/M5 stay owner-judged. The drift-gauge formulas + required ledger/session fields are defined contractually (WI-1.2); the external gauge (`../epcho-ai/instruments/drift_metrics.py`, **present but not a git repo**) is version-pinned by **content hash** of the script in the baseline report (a commit hash is impossible — G-B round-3 PARTIAL #15). |
| **Theme E** | Gate wording de-conflicted (G-C is per-dependent-phase, not "before any commit"); the projection framework (Phase 6) defines a **minimal shared read-model interface** before the operator/canon UIs accrue bespoke panels. |

**Scope narrowing (design Increment-1, owner-confirmed):** Phase 3 ships
**single-object, single-output operators only**, first operator a *simple
deterministic single-object revision op* (not `Extract-Canon`). Multi-object
changesets + group-commit, `Extract-Canon` + typed candidate-effect model,
delegated `operator.accept`, and fingerprint-guarded rebind are each **deferred
to their own increment records**. Phase 4 (canon-hub) therefore needs its own
increment design pass (SP-canon) before it decomposes to committable WIs — it is
**outlined here, decomposed by amendment**, same status as Phase 6.

---

## Cross-model review rounds 3–5 (G-B) — record and disposition

- **Round 3** (`019f7b59…`, MAJOR GAPS partially discharged): 8/15 round-2 items
  fully addressed; found 5 new precise defects. **Round 4** (`019f7b68…`, **NEEDS
  REVISION** — up from MAJOR GAPS): confirmed C/High-C/High-D/#4/#5/#7/#9/#15/E
  fixed; found the residual defects below. All accepted and fixed:

| Round-3/4 finding | Sev | Disposition |
|---|---|---|
| v4.3 compared *raw* `EdgeState` → a concurrent semantic check could block accept | Critical | **v4.3:** compare a **check-independent structural class** (only the verdict erased). |
| v4.3 used an *unkeyed* class bag → a compensating edge-class swap escapes | Critical (r4) | **v4.3:** the comparison is a **map keyed by `SemanticEdgeKey`**, not a bag; property test added (WI-3.0e). |
| v4.2 index-only idem lookup missed the append-before-apply torn window; heal-on-open doesn't fire for a valid index; clock-rollback breaks "smallest time = first" | Critical | **v4.2 rewritten:** the idem lookup is **ledger-authoritative, lookup-before-append, under the lock** — at most one entry per idem ever exists, so no survivor/rollback question arises. |
| v4.1 delimiter ambiguity for free-text fields | High | **v4.1/spec §13.3:** length-prefixed **injective** encoding. |
| v4.1 omitted `intent.prompt_hash`; aliased `agent.id` None vs `Some("")` | High (r4) | **v4.1:** added `prompt_hash`; `opt()` presence-byte disambiguates None from `Some("")`. |
| SP1 proved only manual DAG overlay, not the real store path | High | **SP1:** `overlay_matches_real_committed_index` rebuilds a real `CoherenceIndex` and compares `breakdown()` (4/4). |
| WI-0.3 required prototyping *both* placements; SP3 prototyped only the kernel | Medium (r4) | **SP3:** added a Tier-1 schema-pack *declaration sketch* whose absent `propagation` field refutes side (b) by construction (6/6); WI-0.3 wording aligned. |
| Minor drift: spec "rev 2"; SP1 "3/3" | Low (r4) | Fixed (rev 3; 4/4). |

**Round 5** (`019f7b7e…`, confirmatory, NEEDS REVISION): confirmed v4.2 (torn
window) and v4.1 (preimage) **CORRECT**; found 2 residual defects, both fixed:

| Round-5 finding | Sev | Disposition |
|---|---|---|
| v4.3 keyed by the **non-unique** `SemanticEdgeKey` → coincident edges collide, a per-physical-edge waiver/ratification is missed | Blocker | **v4.3:** key by **physical edge identity** `(txf, input_idx, downstream, downstream_rev)` (candidate edges: `(candidate_rev, ordinal)`) — unique. WI-3.0e + spec §13.5 updated. |
| SP3's schema-pack "refutation" was rigged (deleted the propagation datum, then called the kernel), and the kernel registry itself models propagation as enum **data** — refuting the "behavior not data" rationale | Blocker (Phase-0) | **SP3 rewritten (7/7):** a real schema-pack data table + interpreter that reproduces the version axis; decision re-grounded on **type-safety/totality/single-source**, not the false claim. Both placements fairly prototyped. |
| `state.rs:160` citation | Minor | Corrected to `state.rs:179`. |

After round 5's fixes, **no residual Phase-0/Phase-1 blocker remains**; the
V4.1–V4.3 defects were Phase-3.0 correctness and are all fixed.

**Round 6** (`019f7b88…`, final confirmatory): both round-5 fixes **CORRECT** —
physical-edge key matches the edges-table PK and preserves per-edge changes while
collapsing semantic verdicts; SP3 fairly prototypes both placements with an
honest rationale. **Verdict: READY TO BUILD. Phase-0/Phase-1 blocker: none.**
G-B is cleared (rule 60 §6) after six rounds.

## Cross-model review round 2 (G-B) — record and disposition

- **Thread:** `019f7b48-9532-7732-b024-163e1a14f94d` (Codex, read-only, high
  effort; read this plan, `design-runtime.md`, the paper v2.0, and the shipped
  kernel). **Verdict: MAJOR GAPS — partially discharged.**
- **Disposition: accepted in full.** No finding refuted. Fixes below; the
  design-level ones land in `design-runtime.md` **v4**.

| G-B finding | Severity | Disposition |
|---|---|---|
| Output-less edge identity `(txf,input)` can attach a check to the wrong output | Critical | **Bounded away in Increment-1:** single-output only ⇒ `(txf,input)` unique; multi-output transformations **rejected** at the operator boundary; general output-ordinal fix deferred to the multi-object increment (Phase-3 header note). |
| Contradiction still called a registry entry (ADR-P2/SP3/Phase-2/DoD) | High | **Fixed in text:** ADR-P2, SP3 (WI-0.3), Phase-2 intro + DoD, WI-2.1 now say only the **version** axis is a kind; contradiction stays an `EdgeCheck` assessment. |
| Object-flag canon in SP2/WI-4.1 | High | **Fixed:** SP2 folded into **SP-canon**; WI-4.1 re-cast claim-hinged; the object flag is deleted. |
| `design-runtime.md` still "MAJOR GAPS — BANKED" | High | **Fixed:** v4 header UN-BANKS it for the funded build and supersedes the stale D4 idem formula. |
| Accept BLOCKERs under-specified (idem preimage; read-set digest) | Critical | **Specified in v4.1/v4.2/v4.3:** full canonical preimage; `applied.entry_id` + `entry_id_by_idem` receipt lookup; **reproject-under-lock** precondition (no fragile digest). Realized as committable **Phase 3.0** WIs. |
| D7 bounded read-view incomplete (only `edges_by_downstream`) | High | **v4.4 bounded `ReadView`** + `PREVIEW_MAX_EDGES` cap; Phase-3.0 WI-3.0a. |
| SP0 can't be a Phase-0 no-production-source probe; SP1→SP0; P1→P3 | Critical | **v4.9:** SP0 leaves Phase 0; seams become **Phase 3.0**; SP0 is the Phase-3 entry gate; sequencing SP1→Phase 3.0→SP0→P3, P1→P3 recorded. |
| D3 transient checker not decomposed | High | **WI-3.0d** decomposes every D3 bullet (prompt, transience, drift-discard, unknown, non-persistence) into RED/GREEN. |
| Phase-1 gate inflatable (raw count); no cost/resume | High | **DoD rewritten:** distinct live-edge coverage + error-rate + p95 + estimated cost (v4.8) + resume-without-duplicate + owner-judged M-metrics; WI-1.1 run manifest. |
| `edge_kind` has no wire slot | High | **v4.7 additive slot** in WI-2.1 (default `dependency`, orthogonal to `InputRole`). |
| Provider returns no usage/cost | High | **v4.8:** cost is **estimated** (char→token), labeled; measured envelope deferred. |
| Context handling inconsistent (`breakdown_checked` all-live) | High | **v4.6 / WI-3.1:** preview/check accept a `context_id` and materialize the effective `ContextView`. |
| "Blast radius" undefined | High | **v4.5:** `local_projection_delta` (authoritative) + `preview_forward_closure` (advisory, mutation-free). |
| Candidate IPC lifecycle undefined | High | **v4.6:** content-addressed candidate id (= revision id); accept resubmits the full payload; stateless; tamper-rejected. |
| `epcho-ai` not a git repo → can't pin by commit | Medium | **WI-1.2:** pin the gauge by **content hash** of `drift_metrics.py`, not a commit hash. |
| SP4 gate boundary unclear | Medium | Phase-5 header states SP4 (WI-5.0) is the pre-Phase-5 gate; the spike is exempt from the commit prohibition it gates. |
| Local staleness correctly separated from forward closure | Low (positive) | Preserved as a property test (WI-4.5). |

---

## Phase 0 — Spikes + entry gate (de-risk before commit)

Phase 0 holds **only pure-kernel probes** — no production seams. Per design v4.9
(G-B round-2 feasibility #1), **SP0 is not a Phase-0 probe**: it needs the
production primitives (V4.2 idem-receipt, V4.4 ReadView, D3 transient checker,
V4.3 OCC accept), so it moves to **Phase 3.0 → SP0** as the Phase-3 entry gate.
SP2's object-flag conformance probe is invalid (canon is claim-based, not an
object flag — G-B consistency #3), so it folds into **SP-canon** (Phase-4 design
pass). Phase 0 keeps SP1 (done), SP3, and the contract/tooling WIs.

**DoD:** `bash scripts/check-coherence-runtime-phase.sh 0` exits 0 — asserts the
SP1 and SP3 spike reports exist under `grills/coherence/` with a recorded
verdict, `spike_sp1_dry_run_projection` is green, the entry-gate spec addendum is
merged, and the checker script itself exists. No production-source WIs
(spike-class probes only; the operator primitives are Phase 3.0).

| WI | Work item | Traces to |
|---|---|---|
| WI-0.1 | **Spike SP1 — dry-run projection over a disposable clone (reformulated per Theme A / design D2).** ✅ **DONE — 4/4 green** (`src-tauri/tests/spike_sp1_dry_run_projection.rs`). Proves `(SemanticEdgeKey, Option<EdgeState>)` equality between a clone-overlay preview and an independent commit across linear/retirement/divergence fixtures + a comparison against a **real committed `CoherenceIndex.breakdown`**, with an on-disk byte-unchanged assertion. Retires the ill-formed `commit → project → rollback` formulation. Prerequisite for ADR-P1 and SP0. | ADR-C6 step 2, paper §6.2/§9; design D2 |
| WI-0.3 | **Spike SP3 — relationship-classifier placement.** ✅ **DONE** (`spike_sp3_edge_kind_registry.rs`, 6/6). Prototype the **kernel** side (typed `OriginEdgeKind` + `(origin, shape, propagation)`) reproducing the **version** axis as a registry entry (the semantic/contradiction axis is NOT a kind — v4.7, G-B consistency #2), **and** a minimal Tier-1 schema-pack *declaration sketch* that demonstrates by construction why it is **refuted**: a Tier-1 declaration can carry origin/shape metadata but has **no home for the propagation *behavior*** (executable = Tier 5, deferred — same reason design D5 keeps operators built-in Rust). Decision recorded: **kernel registry**. | §3 classifier, Tier-1 |
| WI-0.4 | **Entry-gate spec addendum — rev 3 (format stays 0):** candidate payload schema (content-addressed id, in-memory only, never ledger — v4.6), operator-intent taxonomy (`intent.kind = "operator:<name>"`), the additive `edge_kind` slot (v4.7), and the accept idem preimage (v4.1). No implementation WI in any later phase starts before this lands (contract-first, R21). | R21, R24, spec §5/§7/§8; design v4.1/v4.6/v4.7 |
| WI-0.5 | Create `scripts/check-coherence-runtime-phase.sh` (template: `check-coherence-phase.sh`) with Phase 0–5 assertions; set the Phase 1 **distinct live-edge coverage** threshold + error-rate/p95/cost/resume fields and drift-gauge baseline fields. | M1–M5 |

## Phase 1 — Verify at volume + drift baseline (the gate; bucket A)

The load-bearing phase: the semantic checker is built but has run only at tiny
scale (~3 check-results). Everything downstream — forward-operator verify, the
auditor, the drift answer — needs verification producing signal at volume. This
phase is measurement + light hardening, not new surface. **May proceed before
G-A** (implements no proposed ADR).

**DoD:** `check-coherence-runtime-phase.sh 1` exits 0 — asserts, from a committed
**run manifest** (WI-1.1): distinct **live-edge coverage** ≥ the WI-0.5 threshold
(the denominator is distinct live stale edges, not a raw check-result count —
G-B completeness #5), checker **error-rate** and **p95 latency** within budget,
**estimated total cost** recorded (v4.8), a **resume-without-duplicate** run
proven, a drift-gauge baseline report committed, and owner-judged M1–M5 recorded
in the dogfood log. M2/M4/M5 stay owner-judged (not auto).

| WI | Work item | Traces to |
|---|---|---|
| WI-1.1 | **Volume run harness + run manifest.** Deterministic, replayable harness that sweeps the checker over the dogfood corpus (repo coherence corpus + S3/S4 probe corpora), appending check-results to the ledger. Emits a committed **run manifest**: seed, the distinct live-edge **coverage denominator**, a resumable **cursor**, per-run error count, p95 latency, and estimated cost (v4.8). Resume from the cursor must not duplicate check-results (idempotent by edge+fingerprint). | M3, R25, G-B completeness #5 |
| WI-1.2 | **Drift-gauge integration.** Wire `../epcho-ai/instruments/drift_metrics.py` to read this workspace's ledger; commit a **baseline** report. `epcho-ai` is **not a git repo** (G-B ambiguity #4), so pin the gauge by **content hash** of `drift_metrics.py` recorded in the baseline (not a commit hash). The report states the **drift formulas** it computes (contradiction-rate = contradicted / checked; re-coherence-tax = resolutions per stale edge over a window) and the ledger/session fields each needs — contractually, in the report header. | M2, M4, M5 |
| WI-1.3 | **M-metric re-measurement at volume** (dogfood session): M1 capture completeness, M2 staleness relevance, M3 semantic-check precision, M4 resolution burden, M5 time-to-confidence — all on the volume corpus, logged per the dogfood protocol. M2/M4/M5 owner-judged. | M1–M5 |
| WI-1.4 | **Checker robustness at volume** — in the **service tier** (`check_commands.rs`, where the provider call lives; the pure `checker.rs` stays IO-free): a batch sweep with provider rate-limit/backoff, `timeout→unknown` at scale (the per-call timeout already exists, `check_commands.rs:191`), an **estimated cost ceiling** with graceful stop (v4.8 — the provider wrapper returns no usage, so cost is a char→token estimate, labeled), and resumability after interruption (the WI-1.1 cursor). Tests for the failure paths that only appear at volume (partial batch, mid-run abort, budget exhaustion). | R25, design v4.8 |

## Phase 2 — Relationship classifier (foundational refactor)

Generalizes the **version axis** into an `OriginEdgeKind` registry (ADR-P2), so
conformance (Phase 4) and the long tail become registrations, not new hardcoded
branches. The **contradiction/semantic axis is not part of the registry** — it
stays an `EdgeCheck` assessment (G-B consistency #2). Behavior-preserving
refactor first. **Gated by SP3.** May proceed before G-A (implements no proposed
ADR).

**DoD:** `check-coherence-runtime-phase.sh 2` exits 0 — the version axis is a
registry entry with identical observable behavior (characterization tests green),
the additive `edge_kind` column defaults legacy rows to `dependency` and rebuilds
cleanly (v4.7), a third origin-edge kind registers and propagates per its rule,
and inert kinds are captured/visible but never stale. Semantic-assessment
behavior is characterized **separately** and unchanged.

| WI | Work item | Traces to |
|---|---|---|
| WI-2.1 | **Edge-kind registry + wire slot** (placement per SP3): typed `OriginEdgeKind`s each with `(origin, shape, propagation)`; the additive `edge_kind` field on `OriginEdge` + `edge_kind TEXT NOT NULL DEFAULT 'dependency'` column, orthogonal to `InputRole`, schema-bump→rebuild (design v4.7). Refactor **only the dependency (version) axis** into a registry entry — **characterization tests written first** to freeze current behavior, then refactor under them. **The contradiction/semantic axis is NOT a kind** (G-B consistency #2): it stays a `check-result` assessment (`EdgeCheck`) that projection folds in, never a registry entry. | §3, R10, R11, R25, design v4.7 |
| WI-2.2 | **Propagation dispatch:** staleness projection consults the registry's per-kind propagation rule instead of hardcoded axis logic. Table-driven tests over each kind × linear/branched/multi-head fixtures. | R31, `project.rs` |
| WI-2.3 | **Long-tail readiness:** register `supersession` (carries version-staleness) and `part-of`/`mention` (inert — captured, visible, never stale) as proof the registry generalizes. Inert kinds must appear in read models but never in the stale set. | §3 long tail |
| WI-2.4 | **Read-model exposure:** `coherence_edges` reports the edge kind (read-only, R23 intact); breakdown view groups/labels by kind; i18n ×10. | R23 |

## Phase 3 — Forward operators (ADR-C6) — Increment-1: single-object, single-output

**Sequencing (G-B round-2 risk #2): SP1 → Phase 3.0 → SP0 → Phase 3.** Also
gated by G-A + **Phase 1** (checker-at-volume is the gate for forward verify).
Scope is `design-runtime.md` Increment-1: **one output ⇒ one transformation ⇒ one
ledger entry**; first operator a *simple deterministic single-object revision op*.
Because Increment-1 is single-output, edge identity `(txf,input)` is unique (one
downstream) — the output-less-identity hole (G-B consistency #1) is **bounded
away by rejecting any multi-output transformation** at the operator boundary; a
general fix (output ordinal in `EdgeRef`/checks/resolutions) is deferred to the
multi-object increment. Multi-object changesets, `Extract-Canon`, and delegated
`operator.accept` are deferred to their own increment records.

### Phase 3.0 — Accept primitives (committable prerequisites for SP0)

The production seams SP0 exercises. TDD, real source, each independently useful:

| WI | Work item | Traces to |
|---|---|---|
| WI-3.0a | **`edges_by_downstream` + bounded `ReadView`** over the affected set (upstream ∪ downstream incident to the changed object), with `resolutions_for`/`checks_for`/`revisions_of` targeted queries and a `PREVIEW_MAX_EDGES` cap that surfaces "truncated" rather than loading unbounded rows. | design v4.4, D7 |
| WI-3.0b | **Idem→receipt lookup:** `applied.entry_id` column + `entry_id_by_idem`; accept returns the *original* receipt on replay instead of dropping it. Migration = schema bump→rebuild backfill. | design v4.2 (BLOCKER 1) |
| WI-3.0c | **Full canonical accept idem** (v4.1 preimage: format, operator, output object/hash/rev/sorted-parents, each input, agent, intent, confidence) — replaces D4's three-field formula. | design v4.1 (BLOCKER 2) |
| WI-3.0d | **Transient candidate-check** (D3 contract, decomposed): a `build_candidate_check_prompt` distinct from the stale-edge prompt; result held in memory only; out-of-lock drift marks the verdict stale-and-discarded; timeout/error/cancel/malformed → `unknown`; never appended. RED/GREEN per D3 bullet. | design D3, G-B completeness #4 |
| WI-3.0e | **Reproject-under-lock accept precondition** (v4.3): recompute the affected-set structural-class map **keyed by physical edge identity** `(txf, input_idx, downstream, downstream_rev)` — *not* the non-unique `SemanticEdgeKey` — (check-independent: only the check verdict is erased, so a concurrent semantic verdict **never** blocks accept; physically keyed so coincident edges don't collide and a compensating swap is still caught) under the kernel lock; reject on any per-key difference vs the previewed `S_preview` (incl. base-head revalidation); else append. Property tests: (1) a concurrent check does **not** reject; (2) a compensating swap of two edges' classes **does** reject; (3) two coincident edges (shared `SemanticEdgeKey`) are tracked separately. | design v4.3 (BLOCKER 3) |

**Gated by G-A + SP1 PASS + WI-0.4 merged.** Scope is single-object/single-output.

**DoD:** `check-coherence-runtime-phase.sh 3` exits 0 — SP0 PASS over the Phase-3.0
primitives (all nine functional/fault/perf gates, design §SP0); an operator
produces candidates; preview shows `local_projection_delta` + `forward_closure`
(v4.5) with **zero ledger writes**; verify runs the checker advisory
(non-blocking); commit-on-accept mints **exactly one** transformation with
`intent.kind=operator:<name>`; guardrail property tests (never auto-select, never
auto-commit, checks non-blocking) green.

| WI | Work item | Traces to |
|---|---|---|
| WI-3.0 | **Entry gate:** confirm G-A + SP1 PASS + **Phase 3.0 primitives merged** + **SP0 PASS** + WI-0.4 spec addendum. No Phase-3 UI/surface work before this. | R21, 60 §7 |
| WI-3.1 | **Dry-run projection primitive** (ADR-P1): pure `project_candidates` over the WI-3.0a bounded read-view + a `coherence_preview` command (accepts a `context_id`, materializes the effective `ContextView` — v4.6/G-B ambiguity #3) that overlays candidate revisions and returns `local_projection_delta` + `forward_closure` (v4.5), minting nothing. Property test: **multiset observational equality over a disposable clone** across the SP1 fixtures (proven in SP1). | ADR-C6 step 2, design D2/v4.4/v4.5 |
| WI-3.2 | **Operator runtime** — **built-in Rust** `fn(selection, read-view) -> Vec<Candidate>` (design D5; *not* a Tier-1 schema-pack function — Tier 1 is declarative, executable = Tier 5, deferred). In-memory candidate production (D1: candidate = one fully-specified output over a single-head base; base is a **parent, never an input**; multi-head base **rejected**). N-candidate handling. No candidate touches the ledger. | ADR-C6 step 1, design D1/D5 |
| WI-3.3 | **Verify step:** the WI-3.0d transient candidate-check over each candidate, surfaced in preview, **never blocking** (I3, §14). A failing check annotates a candidate; it never removes or auto-ranks it; the verdict is transient (never appended). | ADR-C6 step 3, R11, R25, I3, design D3 |
| WI-3.4 | **Commit-on-accept** — composes the Phase-3.0 primitives (WI-3.0b idem-receipt, WI-3.0c full idem, WI-3.0e reproject-under-lock) into the operator accept command: human selects one candidate (resubmitting the full content-addressed payload, v4.6) → **one** transformation via **one** `append_and_apply`, `intent.kind=operator:<name>`. All three review-4 BLOCKERs are now *specified protocols* (v4.1/v4.2/v4.3), not labels. **Property tests: never auto-selects among N; never auto-commits; semantic verdict never blocks accept.** | ADR-C6 step 4, R1/R24/R33/I3, design v4.1/v4.2/v4.3 |
| WI-3.5 | **Preview UI:** operator picker; candidate list with per-candidate blast radius; advisory check badges; explicit human accept. Zero store destructuring (selectors only); loading/empty/error states; i18n ×10. | R15, §14 |
| WI-3.6 | **MCP surface:** propose + preview through read-only MCP; **accept is human-only in v1** (design D6 — delegated `operator.accept` is a *separate deferred scope*, **not** the existing `resolve` path, which is resolution-only per `delegation.rs:15`). R23 intact for read. | R23, design D6 |
| WI-3.7 | Docs (`website/guide/coherence.md` operators section + dev-docs note), i18n ×10, dogfood session (M2/M4 on operator-driven changes). | — |

## Phase 4 — Canon-hub + `Extract-Canon` (ADR-C6 instance; the re-coherence-tax lever)

**Outlined, decomposed by amendment after its own increment design pass
(SP-canon).** Per the owner decision (canon claim-based / Context-hinged;
`Extract-Canon` deferred), the WIs below are the *intended* shape but are **not
committable** until SP-canon resolves: the typed candidate-effect model (an
`Extract-Canon` candidate changes claims + Contexts, not just object bytes — out
of Increment-1's single-object scope), and claim-hinged canon surfaced through a
conformance edge kind (ADR-P3 re-cast — canon is **not** an object flag).
**Gated by G-A + SP-canon (absorbs old SP2) + Phase 2 (classifier) + Phase 3
(operators).**

**DoD:** `check-coherence-runtime-phase.sh 4` exits 0 — a claim-hinged canon + N
conformance edges reduce a modeled mesh to a star (edge count linear, verified
against the SP-canon baseline); `Extract-Canon` proposes extraction with preview;
changing a canon flags exactly its conformers (facet-scoped); guardrail tests
green.

| WI | Work item | Traces to |
|---|---|---|
| WI-4.1 | **Claim-hinged canon convention** (ADR-P3 re-cast; SP-canon resolves the mapping): canon = **fed established claims in an enforcing Context** (`claims.rs`/`contexts.rs`), **not** an object flag (G-B consistency #3). Context-relative by construction (`Diverged` canon per context). SP-canon must first define how a claim's lifecycle maps to versioned conformance-edge endpoints before any propagation is tested. | paper §5, Deep-dive B, design owner-decision 1 |
| WI-4.2 | **Conformance edge kind** (registered via Phase 2): directional, carries version-staleness, captured when an object references/uses a canon (edge inference, not homework). | §3, Deep-dive B |
| WI-4.3 | **`Extract-Canon` forward operator** (Phase 3 surface): detect a concept referenced by ≥k objects with pairwise-drift risk → propose a canon object + conformance edges as a candidate changeset → preview blast radius → human accepts. The first named, high-value operator. | ADR-C6, Deep-dive B |
| WI-4.4 | **Canon granularity:** facet-level canons (`canon(X.facet)`) + a split-canon operation so a facet change does not stale conformers that depend only on other facets. This is the false-positive-staleness knob (§4 granularity lever) applied at the hub. | §4 granularity, R31 |
| WI-4.5 | **Canon-of-canon layering:** canon→canon conformance as ordinary directional edges. Staleness stays **local per-edge** (Theme B — no transitive projection); a separate **forward blast-radius closure** walks the canon DAG *for preview only*, never mutating `EdgeState`. Table-driven tests over multi-layer fixtures assert local projection is unchanged and the closure is preview-scoped. | Deep-dive B, design D-table (staleness local) |
| WI-4.6 | Breakdown UI canon view + `coherence_edges` canon exposure (read-only) + i18n ×10 + dogfood measuring the **re-coherence-tax delta** the drift gauge reports before/after canon (does canon reduce the tax? — the whole justification). | M2, M4, drift gauge |

## Phase 5 — Semantic-merge auditor (ADR-C7)

**Gated by G-A (ADR-C7 approval) + SP4 PASS.** Depends on Phase 1 (checker at
volume) + existing `merge_surface.rs`; independent of Phases 2–4. **Not "mostly
wiring"** (Theme C): `merge_surface.rs` stores only a merge SHA and git-attributed
transformations have empty input sets, so the affected-edge set can't be read
off directly. **SP4 (WI-5.0) — merge-diff→object mapping spike** must PASS before
this phase commits: prove a completed merge's touched files map to
`(object, revision)` pairs and thence to the edges to re-check.

**DoD:** `check-coherence-runtime-phase.sh 5` exits 0 — after a completed git
merge, affected edges are re-checked and contradictions surface for human
resolution; **no auto-merge of objects**; guardrail test green.

| WI | Work item | Traces to |
|---|---|---|
| WI-5.0 | **Spike SP4 — merge-diff→object mapping** (grill probe, not shipped): given a completed merge SHA, resolve the touched files → `(object, revision)` pairs → the edges incident to them. PASS = the mapping is deterministic and total over the dogfood merge corpus; recorded verdict. Gate for the rest of Phase 5. | Theme C, R18 |
| WI-5.1 | **Merge-affected edge set:** from `merge_surface.rs` + the SP4 mapping, compute the edges a completed merge touched (per-merge-hash, deduped as in `design-3.md` D3). | R18, §8 |
| WI-5.2 | **Auditor wiring** (ADR-P4): run the Phase-2b checker over those edges; emit results as advisory check-results. No new algorithm. | R11, R25, ADR-C7 |
| WI-5.3 | **Breakdown surface:** merge-origin contradictions grouped; human resolves accept-newer / revise / waive (R15); **never auto-reconciles** (§14 property test). | R12, I3, R15, §14 |
| WI-5.4 | Docs + i18n ×10 + dogfood (M2 on merge-origin flags). | — |

## Phase 6 — Projection framework (outlined, not decomposed)

Vision stage 4: one abstraction for "many synchronized views of one state,"
unifying the format registry and the bespoke coherence panels (breakdown, canon,
operator preview) that Phases 1–5 accreted. **Decomposed by a plan amendment
after its own design pass** — decomposing now would guess at decisions not yet
made. Verticals-as-schema-packs (vision stage 5) remain in
`20260718-coherence-layer.md` Phase 4, not here.

## Risks

1. **SP1 fails** — dry-run projection does not compose over an uncommitted
   overlay → forward operators need a different mechanism; Phases 3–4 blocked.
   *Mitigation: Phase 0 gate; this is exactly why SP1 precedes any commit.*
2. **Checker cost/latency at volume** (Phase 1) — LLM calls at scale.
   *Mitigation: WI-1.4 batching + cost ceiling + sampling; the volume threshold
   is a budget, not "check everything."*
3. **`Extract-Canon` proposes poor canons** — the operator never auto-commits
   (I3); the human rejects; M2 tracks proposal noise, O9 escalates if it misses
   baseline.
4. **Scope creep toward auto-propagation / auto-merge** — §14 is binding; the
   guardrail property tests (criterion 4) are hard gates, not advisory.
5. **Registry over-generalization** — the classifier becomes a framework that
   does nothing. *Mitigation: only register kinds with a concrete propagation
   consequence; inert kinds must earn their place with a real read-model use.*

## Open questions (owner input)

1. ~~**G-A:** approve ADR-C6 + ADR-C7?~~ **Resolved ✓** (owner, 2026-07-19).
2. **Phase 1 dogfood corpus:** the repo coherence corpus (self-host) vs a real
   creative project — the still-open dogfood choice from
   `20260718-coherence-layer.md`. *Default taken for the re-decomposition:
   self-host on the repo coherence corpus (it is present and replayable);
   revisit if a real creative corpus becomes available.*
3. **Canon granularity default** (WI-4.4): facet-level vs concept-level — the
   false-positive-staleness knob. *Deferred to SP-canon.*
4. ~~**Classifier placement** (SP3/ADR-P2)~~ — resolved by SP3 (Phase 0), no
   owner prelation needed; recorded rationale in the spike report.

## Governance

- WI linkage enforced (`scripts/check-wi-linkage.sh <this-plan> --phase=N`).
- Phase status header ticks only when `check-coherence-runtime-phase.sh <N>`
  passes (rule 60 §3).
- **Codex review of this plan (G-B) is mandatory before Phase 1 commits**
  (rule 60 §6); round-1 disposition table above. **G-B round 2** (of this
  re-decomposition) disposition table appended below on completion.
- No new dependencies (ADR-P5); if that changes, crate review per rule 60 §4.
- ADR-C6/C7 owner approval (G-A) recorded in
  `grills/coherence/forward-operators-proposal.md` (status flips
  PROPOSED → APPROVED) before Phases 3–5.
