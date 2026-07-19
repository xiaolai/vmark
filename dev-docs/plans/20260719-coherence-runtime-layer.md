# Plan: Coherence Runtime Layer — Verify-at-Volume, Classifier, Forward Operators, Canon-Hub, Merge Auditor

- **Status: READY FOR G-B RE-REVIEW — re-decomposed against `design-runtime.md`
  (2026-07-20).** The design session the first G-B demanded is done and BANKED
  (`grills/coherence/design-runtime.md` v3, four Codex reviews); this plan is now
  re-decomposed on top of it. Governance sequence to resume implementation:
  G-B re-review of *this* re-decomposed plan clears (rule 60 §6) → Phase 0
  spikes incl. **SP0** PASS (rule 60 §7) → phases commit in dependency order.
  See **§Re-decomposition (2026-07-20)** for exactly how the design record and
  Themes A–E fold into the WIs.

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
  `dev-docs/specs/coherence-format-v0.md` (rev 2). All WIs trace to the paper's
  R/I/O/M IDs and §5/§8/§14. Where this plan and the paper/spec disagree, the
  paper/spec wins and this plan is amended.
- **Design inputs:** `grills/coherence/forward-operators-proposal.md`
  (ADR-C6/C7), `grills/coherence/state-and-staleness-notes.md` (state ontology,
  edge taxonomy, waiver semantics, canon-hub), `dev-docs/vision.md` (the arc
  this serves), `grills/coherence/design-2a.md` + `design-3.md` (approved
  semantic + delegation model), **`grills/coherence/design-runtime.md` v3
  (BANKED — the runtime-layer ontology + candidate/accept model D1–D8 + SP0 gate
  this plan re-decomposes against)**.
- **Prior work this builds on (already shipped — Phases 1–3 of
  `20260718-coherence-layer.md`, ~12k LOC Rust):** the three-atom kernel, both
  staleness axes (version via `dag.rs`/`project.rs`; semantic via
  `checker.rs`/`claims.rs`), capture funnels, scan reconciliation, git
  classification (`gitops.rs`/`merge_surface.rs`), waivers-as-ledger-entries with
  endpoint-advance expiry, the breakdown view, and read-only + delegated MCP.
  **This plan builds the runtime layer on top; it adds no kernel atom.**

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

1. **Phase 0 exit:** SP1/SP2/SP3 spike reports written with a recorded PASS/
   decision; entry-gate spec addendum (rev 3, format stays 0) merged;
   `bash scripts/check-coherence-runtime-phase.sh 0` exits 0.
2. **Phase 1 exit (the gate):** the semantic checker has run at volume on the
   dogfood corpus, appending ≥ the WI-1.1 threshold of check-results; the drift
   gauge reads a recorded baseline; M1–M5 re-measured at volume;
   `check-coherence-runtime-phase.sh 1` exits 0.
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
- **ADR-P2 — Relationship-classifier placement resolved by SP3.** The two
  hardcoded axes (dependency/version, contradiction/semantic) become entries in
  a typed **edge-kind registry** — each kind carries `(origin:
  captured|discovered, shape: directional|symmetric, propagation:
  version|semantic|none)`. SP3 decides kernel-level registry vs Tier-1
  schema-pack declaration; the decision is recorded before Phase 2 commits.
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
| G-C | SP1/SP2/SP3 PASS before their dependent phases (SP1→P3/P4, SP2→P4, SP3→P2). | 60 §7 |

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

The first G-B verdict is discharged not by patching WIs but by the BANKED
design record. The amendments below are **normative over the phase tables that
follow** where they conflict (contract-first, R21):

| Source | Amendment to this plan |
|---|---|
| **Theme A / design D1–D2** | SP1's "byte-identical to `commit → project → rollback`" is **ill-formed** (append-only ⇒ no rollback). **Reformulated (WI-0.1):** *observational equality over a disposable clone* — run the operator's preview on a throwaway copy of the ledger/CAS/index, commit-then-read on a second copy, and assert the two **multisets** of `(SemanticEdgeKey, Option<EdgeState>)` are equal (envelope id/time/idem excluded), **and** the original store is byte-unchanged after preview. `SemanticEdgeKey` is a *bag* key incl. `input_ordinal` (physical identity `(txf,input)`, `index.rs:37`). |
| **Theme A / design D7** | Preview must project only the **affected set** (upstream ∪ downstream incident to the changed object), which is **not shipped** — `breakdown_checked` loads the full DAG. Adds a hard sub-item: build `edges_by_downstream` + a bounded read-view. This is **SP0's** build, gated by its perf envelope (≤20 ms p95 / ≤16 MiB added, grounded to spec §10). |
| **Theme A / design D4+D6, review-4 BLOCKERs** | Accept is **not** a capture wrapper — it is an idempotency + optimistic-concurrency protocol. Three BLOCKER sub-items become explicit WI-3.4 acceptance criteria: (1) lost-response retry **looks up the idem and returns the original receipt** (not just storage dedup); (2) the deterministic idem is domain-separated over the **complete canonical commit payload** (inputs/roles/operator/intent), not output bytes; (3) the accept precondition binds the **complete projection read-set** (or reprojects under the commit lock), not a partial fingerprint. |
| **Theme B / design D-table** | **Contradiction stays a `check-result` assessment, never an edge kind** — the Phase-2 registry types only `OriginEdgeKind` (dependency, conformance, supersession, part-of/mention); the semantic axis is *not* a registry entry. WI-2.1 corrected: refactor the **version** axis into the registry; the semantic axis remains a projection input (`EdgeCheck`), not a kind. Canon is **claim-hinged** (Phase 4 ADR-P3 re-cast). "Transitive canon-of-canon staleness" (old WI-4.5) is replaced by **local** current-staleness + a separate forward blast-radius closure used *only* for preview. |
| **Theme C** | v1 operators are **built-in Rust** (`fn(selection, read-view) -> Vec<Candidate>`, design D5) — **not** Tier-1 schema-pack functions (Tier 1 is declarative; executable = Tier 5, deferred). WI-3.2 corrected. Operator accept does **not** reuse the `resolve` delegation path; delegated `operator.accept` is **deferred** (v1 accept is human-only, D6). The merge auditor is **not** "mostly wiring": Phase 5 gets a **merge-diff→object mapping spike** (SP4) before it commits (`merge_surface` stores only a SHA; git txns have empty inputs). |
| **Theme D** | Phase 1 gates on distinct **live-edge** coverage + error-rate + p95 latency + total cost + resume correctness + owner-judged M3 — not a raw check-result count. M2/M4/M5 stay owner-judged. The drift-gauge formulas + required ledger/session fields are defined contractually (WI-1.2); the external gauge (`../epcho-ai/instruments/drift_metrics.py`, **present**) is version-pinned by commit hash in the baseline report. |
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

## Phase 0 — Spikes + entry gate (de-risk before commit)

**DoD:** `bash scripts/check-coherence-runtime-phase.sh 0` exits 0 — asserts the
three spike reports exist under `grills/coherence/` with a recorded verdict, the
entry-gate spec addendum is merged, and the checker script itself exists. No
production-source WIs except spike-class probes (grills, not shipped).

| WI | Work item | Traces to |
|---|---|---|
| WI-0.1 | **Spike SP1 — dry-run projection over a disposable clone (reformulated per Theme A / design D2).** Runnable probe: run the candidate preview on a throwaway copy of ledger/CAS/index (mints nothing on the original), commit-then-read on a *second* copy, and assert the two **multisets** of `(SemanticEdgeKey, Option<EdgeState>)` are equal — `SemanticEdgeKey` a bag key incl. `input_ordinal`, envelope id/time/idem excluded — across linear/branched/multi-head fixtures, **and** the original store is byte-unchanged after preview. The old "byte-identical to `commit → project → rollback`" formulation is retired (append-only ⇒ no rollback). Prerequisite for ADR-P1. | ADR-C6 step 2, paper §6.2/§9 (operators); design D2 |
| WI-0.2 | **Spike SP2 — conformance-edge composition.** Probe: model a canon node (flagged object) with K conformance edges; verify staleness propagates canon→conformers through the *existing* `dag`/`project` with **zero kernel change**, and that the edge count is linear (N, not N(N−1)/2) versus a modeled pairwise mesh baseline. PASS = conformance edges are ordinary directional edges the current projection already handles. | Deep-dive B, R10, R31 |
| WI-0.3 | **Spike SP3 — relationship-classifier placement.** Prototype both (a) a kernel-level typed edge-kind registry and (b) a Tier-1 schema-pack declaration, each reproducing the two existing axes as registry entries. Decide kernel vs schema-pack (resolves ADR-P2) with a recorded rationale + the minimal working prototype of the chosen side. | §3 classifier, Tier-1 |
| WI-0.4 | **Entry-gate spec addendum — rev 3 (format stays 0):** candidate-changeset schema (in-memory only, never ledger), operator-intent taxonomy (`intent.kind = "operator:<name>"`), conformance-edge role in the input-set taxonomy, and the edge-kind registry schema (if kernel per SP3). No implementation WI in any later phase starts before this lands (contract-first, R21). | R21, R24, spec §5/§7/§8 |
| WI-0.5 | Create `scripts/check-coherence-runtime-phase.sh` (template: `check-coherence-phase.sh`) with Phase 0–5 assertions; set the Phase 1 live-edge-coverage threshold and drift-gauge baseline fields. | M1–M5 |
| WI-0.6 | **Spike SP0 — end-to-end disposable single-object operator slice (the real Phase-3 gate, design §SP0).** A private deterministic single-object/single-output operator producing **two** candidates: preview over a bounded read-view (builds `edges_by_downstream` + affected-set projection, D7) → transient candidate-check (D3) → reject one → **stale-base / stale-fingerprint accept rejected** (D6) → accept the other via one `append_and_apply` (D4). Must pass the 7 fault/concurrency gates (crash recovery, torn append, replay, idempotent retry returns original receipt, concurrent-base-advance rejection, downstream retirement caught by the D2 multiset, candidate-tamper rejection) **and** the perf gates (preview p95 ≤ 20 ms, added mem ≤ 16 MiB, accept within capture budgets). Any red gate blocks Phase 3. | design §SP0, D1–D8, review-4 BLOCKERs |

## Phase 1 — Verify at volume + drift baseline (the gate; bucket A)

The load-bearing phase: the semantic checker is built but has run only at tiny
scale (~3 check-results). Everything downstream — forward-operator verify, the
auditor, the drift answer — needs verification producing signal at volume. This
phase is measurement + light hardening, not new surface. **May proceed before
G-A** (implements no proposed ADR).

**DoD:** `check-coherence-runtime-phase.sh 1` exits 0 — asserts the ledger holds
≥ the WI-0.5 threshold of check-results on the dogfood corpus, a drift-gauge
baseline report is committed, M1–M5 are re-recorded in the dogfood log, and the
checker's volume-failure-path tests are green.

| WI | Work item | Traces to |
|---|---|---|
| WI-1.1 | **Volume run harness.** Deterministic, replayable harness that exercises the checker over the dogfood corpus at volume (repo coherence corpus + the S3/S4 probe corpora), appending check-results to the ledger. Not ad-hoc — a committed, re-runnable script with a recorded seed/manifest. | M3, R25 |
| WI-1.2 | **Drift-gauge integration.** Wire `epcho-ai/instruments/drift_metrics.py` to read this workspace's ledger; produce and commit a **baseline** report (contradiction-rate, re-coherence-tax trend). This is the instrument the whole vision is validated by. | M2, M4, M5 |
| WI-1.3 | **M-metric re-measurement at volume** (dogfood session): M1 capture completeness, M2 staleness relevance, M3 semantic-check precision, M4 resolution burden, M5 time-to-confidence — all on the volume corpus, logged per the dogfood protocol. | M1–M5 |
| WI-1.4 | **Checker robustness at volume** (hardening the existing `checker.rs`): batching, provider rate-limit/backoff, `timeout→unknown` at scale, a **cost ceiling** with graceful stop, and resumability after interruption. Tests for the failure paths that only appear at volume (partial batch, mid-run abort, budget exhaustion). | R25 |

## Phase 2 — Relationship classifier (foundational refactor)

Generalizes the two hardcoded axes into the edge-kind registry (ADR-P2), so
conformance (Phase 4) and the long tail become registrations, not new hardcoded
branches. Behavior-preserving refactor first. **Gated by SP3.** May proceed
before G-A (implements no proposed ADR).

**DoD:** `check-coherence-runtime-phase.sh 2` exits 0 — the two existing axes are
registry entries with identical observable behavior (characterization tests
green), a third kind registers and propagates per its rule, and inert kinds are
captured/visible but never stale.

| WI | Work item | Traces to |
|---|---|---|
| WI-2.1 | **Edge-kind registry** (placement per SP3): typed `OriginEdgeKind`s each with `(origin, shape, propagation)`. Refactor **only the dependency (version) axis** into a registry entry — **characterization tests written first** to freeze current behavior, then refactor under them. **The contradiction/semantic axis is NOT a kind** (Theme B): it stays a `check-result` assessment (`EdgeCheck`) that projection folds in, never a registry entry. | §3, R10, R11, R25, design D-table |
| WI-2.2 | **Propagation dispatch:** staleness projection consults the registry's per-kind propagation rule instead of hardcoded axis logic. Table-driven tests over each kind × linear/branched/multi-head fixtures. | R31, `project.rs` |
| WI-2.3 | **Long-tail readiness:** register `supersession` (carries version-staleness) and `part-of`/`mention` (inert — captured, visible, never stale) as proof the registry generalizes. Inert kinds must appear in read models but never in the stale set. | §3 long tail |
| WI-2.4 | **Read-model exposure:** `coherence_edges` reports the edge kind (read-only, R23 intact); breakdown view groups/labels by kind; i18n ×10. | R23 |

## Phase 3 — Forward operators (ADR-C6) — Increment-1: single-object, single-output

**Gated by G-A (ADR-C6 approval) + SP1 PASS + SP0 PASS.** Scope is the
`design-runtime.md` Increment-1: **one output ⇒ one transformation ⇒ one ledger
entry**; first operator a *simple deterministic single-object revision op*.
Multi-object changesets, `Extract-Canon`, and delegated `operator.accept` are
deferred to their own increment records (see §Re-decomposition). WIs below are
the committable form of design D1–D8.

**DoD:** `check-coherence-runtime-phase.sh 3` exits 0 — an operator produces
candidates; preview shows blast radius with **zero ledger writes**; verify runs
the checker advisory (non-blocking); commit-on-accept mints **exactly one**
transformation with `intent.kind=operator:<name>`; guardrail property tests
(never auto-select, never auto-commit, checks non-blocking) green.

| WI | Work item | Traces to |
|---|---|---|
| WI-3.0 | **Entry gate:** confirm G-A recorded + SP1 PASS + **SP0 PASS** + WI-0.4 spec addendum merged. No Phase-3 implementation before this. | R21, 60 §7 |
| WI-3.1 | **Dry-run projection primitive** (ADR-P1): pure `project_candidates` over a bounded read-view (D7) + a `coherence_preview` command that overlays candidate revisions and returns staleness/blast-radius, minting nothing. Property test: **multiset observational equality over a disposable clone** (preview vs commit-then-read on a clone; original byte-unchanged) across the SP1 fixtures. | ADR-C6 step 2, design D2/D7 |
| WI-3.2 | **Operator runtime** — **built-in Rust** `fn(selection, read-view) -> Vec<Candidate>` (design D5; *not* a Tier-1 schema-pack function — Tier 1 is declarative, executable = Tier 5, deferred). In-memory candidate production (D1: candidate = one fully-specified output over a single-head base; base is a **parent, never an input**; multi-head base **rejected**). N-candidate handling. No candidate touches the ledger. | ADR-C6 step 1, design D1/D5 |
| WI-3.3 | **Verify step:** advisory checker over each candidate, surfaced in preview, **never blocking** (I3, §14). A failing check annotates a candidate; it never removes or auto-ranks it. | ADR-C6 step 3, R11, R25, I3 |
| WI-3.4 | **Commit-on-accept** (design D4/D6 — an idempotency + optimistic-concurrency protocol, *not* a capture wrapper). Human selects one candidate → **one** transformation via **one** `append_and_apply`, `intent.kind=operator:<name>`, input roles per R24. **Three review-4 BLOCKER acceptance criteria:** (1) lost-response retry **looks up the idem and returns the original receipt**; (2) deterministic idem domain-separated over the **complete canonical payload** (inputs/roles/operator/intent), not output bytes; (3) accept precondition revalidates the **complete projection read-set** (base head == `base_rev`, working hash == expected, preview fingerprint holds) under the commit lock, else **reject → re-preview**. **Property tests: never auto-selects among N; never auto-commits; semantic verdict never blocks accept.** | ADR-C6 step 4, R1/R24/R33/I3, design D4/D6 |
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
**Gated by G-A + SP2 PASS + SP-canon + Phase 2 (classifier) + Phase 3
(operators).**

**DoD:** `check-coherence-runtime-phase.sh 4` exits 0 — a canon object + N
conformance edges reduce a modeled mesh to a star (edge count linear, verified
against the SP2 baseline); `Extract-Canon` proposes extraction with preview;
changing a canon flags exactly its conformers (facet-scoped); guardrail tests
green.

| WI | Work item | Traces to |
|---|---|---|
| WI-4.1 | **Canon object convention** (ADR-P3): schema/frontmatter flag marking an object authoritative-for-concept-in-context; no new atom; context-relative (`Diverged` canon allowed per context). | paper §5, Deep-dive B |
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
