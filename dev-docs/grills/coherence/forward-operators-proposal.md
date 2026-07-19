# Forward Operators and the Semantic-Merge Auditor — Design Proposal

> **Status: APPROVED (owner, 2026-07-19).** ADR-C6 (forward operators) and
> ADR-C7 (semantic-merge auditor) are accepted, seeding the implementation
> plan `dev-docs/plans/20260719-coherence-runtime-layer.md` (satisfies that
> plan's gate G-A). Remaining gates before any Phase-1 commit: the plan's
> Codex cross-model review (gate G-B, rule 60 §6) and — for the
> forward-operator phases — the Phase 0 dry-run-projection spike SP1 (gate
> G-C, rule 60 §7). `design-2a.md` and `design-3.md` remain the other
> APPROVED normative records. Existing coherence ADRs: C1 rusqlite, C2
> workspace layout, C3 kernel TDD, C4 module boundaries + core types,
> C5 dependencies.
>
> **Inputs:** paper v1.1 (§5, §8, §14; R1, R2, R11, R18, R24, R25, R33; I3;
> Tier-1 extensibility), spec v0 rev 2, `design-2a.md`/`design-3.md`
> (approved model), and an external "extend coherence into a state runtime"
> discussion. A standing drift gauge exists at
> `epcho-ai/instruments/drift_metrics.py` (reads this workspace's ledger).

## Framing

The kernel today is **backward-looking**: a `transformation` is recorded
*after* a write (R1). The one capability a "state runtime" adds on top is a
**forward operator** — a named, reusable semantic action (Split-Character,
Generalize, Relax-Constraint) that *proposes* a change, shows its blast
radius, and commits only on explicit human accept. Crucially, this must be
added **without** violating I3 (only a human/delegated agent resolves) or
§14 (no autonomous semantic propagation). Both proposed ADRs are
compositions of existing atoms; neither adds a kernel atom (§5).

## D1 — Proposed ADR-C6: Forward operators (propose → preview → verify → commit)

**Context.** A forward operator turns coherence from an after-the-fact
auditor into a runtime a creator composes in. The risk is that it drifts
into autonomous exploration/auto-commit — the exact thing §14 rejects on
evidence (auto-propagation of belief revisions is only ~20% *accurate* — the
methods' success rate, not an edit base-rate; §3.3 law 5). The design keeps the
human as scheduler.

**Decision.** A forward operator is a **userland, schema-pack function**
(Tier-1 extensibility — data, not runtime code; Tier-5 code plugins stay
deferred) that emits a *candidate* changeset. Its lifecycle:

1. **Propose** — the operator produces one or more candidate object
   revisions in memory. Nothing is appended to the ledger.
2. **Preview** — the kernel computes the staleness/blast-radius projection
   of the candidate revisions against the viewing context, via a **pure
   dry-run** that overlays the candidates on the DAG without minting them.
   This is the one genuinely new kernel entry point; everything else reuses
   the breakdown machinery (§6.2/§9.2).
3. **Verify** — optional advisory semantic check (Phase 2b checker, R11/R25)
   over each candidate; surfaced, **never blocking** (I3, §14).
4. **Commit** — only on explicit human accept, the chosen candidate lands as
   an ordinary `transformation` (R1) with `intent.kind = "operator:<name>"`
   and confidence per its capture path (§8). Input roles follow R24.

**Invariants preserved.** The operator **never auto-selects** among
candidates and **never auto-commits** (I3). N candidates ⇒ the human picks;
the tool only makes each candidate's blast radius legible. AI-proposed
output is unverified until the human accepts — consistent with the finding
that model self-correction does not catch its own errors (verification must
be external).

**Traces.** R1, R2, R24, R33, I3; §5 (everything is schema + transformations
on atoms); §14 (non-goal boundary); Tier-1 extensibility; ADR-C4 (this lives
at the kernel/service boundary, kernel stays pure).

**Open / spike (rule 60 §7).** The dry-run projection over *uncommitted*
candidate revisions is an unverified kernel assumption: staleness projection
is pure over (origin edges, resolution records, context), but candidates are
not in the ledger DAG. A Phase-0-style spike must show the projection
composes cleanly over a transient candidate overlay before any WI commits.

**Non-goals.** No autonomous exploration or multi-candidate auto-evaluation
(§14). No runtime code-plugin surface (Tier-5 deferred). Operators do not
mutate history or bypass capture.

## D2 — Proposed ADR-C7: Semantic merge is an auditor, not an auto-merger

**Context.** Git produces textually-clean merges that can be semantically
contradictory; §8 already names the opportunity ("the semantic merge auditor
git never had"). The tempting over-reach is automatic semantic 3-way *object*
merge. An earlier external design discussion proposed exactly that ("build
automatic semantic merge — the load-bearing wall"). The evidence rejects it:
automatic semantic propagation/reconciliation is unsolved (§3.3 law 5;
belief-revision literature; §14).

**Decision.** Do **not** build automatic semantic merge. Build the
**auditor**: a git merge/mutation is already captured as an `agent:git`
transformation (R18); after it, run the Phase-2b checker (R11/R25) over the
affected edges and surface any contradictions in the breakdown for **human**
resolution — accept-newer / revise / waive (R15). This is a composition of
shipped/planned pieces (git-mutation capture + check-result + breakdown), not
a new algorithm.

**Traces.** R18 (git mutation ⇒ transformation), R11/R25 (semantic staleness +
check schema), R12/I3/R15 (human resolves), §8, §14.

**Why the correction matters.** The auditor is the evidence-consistent form
of the "semantic merge" moat; the auto-merger is a mirage that would import
the belief-revision failure mode the whole design sidesteps. Recording the
rejection here so it is not re-proposed.

## Sequencing note (not a commitment)

Both ADRs depend on the **Phase-2b checker producing check-results at
volume** — D1's verify step and D2's audit both call it, and today the
ledger holds only 3 check-results, so neither is measurable yet. Finish
Phase 2b first; then the drift gauge
(`epcho-ai/instruments/drift_metrics.py`) can report the contradiction-rate
and re-coherence-tax trends that would tell us whether the operate → verify →
commit loop compounds or drifts. D1 (forward operators) is the higher-value
add; D2 (auditor) is mostly composition. Neither should seed a plan before
owner review + cross-model review (rule 60 §6).
