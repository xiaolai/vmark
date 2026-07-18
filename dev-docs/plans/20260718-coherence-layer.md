# Plan: Coherence Layer — Kernel + Breakdown View (Phases 0–1, later phases outlined)

- **Status:** Phase 0 not started. **This plan requires Codex cross-model
  review before any Phase 1 commit** (rule 60 §6: >3 phases, new
  dependencies).
- **Date:** 2026-07-18
- **Contract:** `dev-docs/coherence-layer-paper.md` **v1.1** (Codex-reviewed,
  Appendix A). All WIs trace to the paper's R1–R33, I1–I5, O1–O9, M1–M5, and
  gates G1–G2. Where this plan and the paper disagree, the paper wins and the
  plan is amended.
- **Evidence base:** `dev-docs/deep-researches/20260718-*` (three verified
  research passes + discussion record).
- **Scope discipline:** Phases 0–1 are decomposed into WIs here. Phases
  2a/2b/3/4 are outlined only and MUST be decomposed by a plan amendment
  after the Phase 2a design session — decomposing them now would guess at
  decisions O1/O5/O8 deliberately not yet made.

## Verifiable success criteria (plan level)

1. Phase 0 exit: format spec exists and covers its R-IDs; gates G1/G2 have
   recorded PASS; spikes S1–S4 have written reports; M1–M5 baselines set.
2. Phase 1 exit: on the dogfood workspace, every AI generation through
   instrumented paths produces a complete transformation (M1 at baseline);
   the breakdown view lists version-stale and diverged edges and its three
   actions append the correct records (I5 verified by test); deleting the
   SQLite index and rescanning reproduces identical query results (R16 test).
3. No WI is "complete" without linkage (commit message `(WI-N.M)` or test
   header) — `scripts/check-wi-linkage.sh` passes.

## ADRs (implementation-level; architectural decisions live in the paper)

- **ADR-C1 — SQLite via `rusqlite` (bundled).** Decide bundled vs. system
  SQLite in S2; default expectation: bundled (`rusqlite` `bundled` feature)
  for deterministic cross-platform behavior. New crate ⇒ manual review per
  rule 60 §4 (crates lack the npm heuristic) + `cargo audit`.
- **ADR-C2 — Workspace layout.** `.vmark/` at workspace root:
  `ledger/<writer-id>.jsonl` segments, `contexts/*.json` pin manifests,
  `snapshots/` CAS, `index.db` (gitignored), `waivers/` folded into ledger
  (waivers are ledger entries, not separate files — single append-only
  source). Final layout fixed in the format spec (WI-0.1).
- **ADR-C3 — TDD mechanics for Rust kernel.** The `.claude/hooks/`
  TDD guard is TS-scoped; Rust kernel discipline is enforced by convention
  (tests-first in `#[cfg(test)]` modules / `tests/`) and by Phase DoD
  asserting per-WI test existence. Frontend WIs (breakdown view) fall under
  the standard coverage gate.

## Phase 0 — Format spec, kernel decisions, gates, spikes

**DoD:** `bash scripts/check-coherence-phase.sh 0` exits 0 (script created in
WI-0.9; asserts the artifacts below exist and gate records read PASS).

| WI | Work item | Traces to |
|---|---|---|
| WI-0.1 | Write `dev-docs/specs/coherence-format-v0.md`: ledger entry + segment schema (self-identified, order-independent entries; writer identity; idempotency keys), pin-manifest schema, frontmatter ID/schema conventions, CAS layout, input-set taxonomy with worked examples, hashing canonicalization, provenance-confidence states, semantic-check result schema, claim schema (bi-temporal), waiver/ratification record schema | R17, R21, R24, R25, R28, R30, R32, I5 |
| WI-0.2 | Record kernel decisions as spec sections: Context-relative DAG staleness algorithm (ancestor check, diverged), file-level granularity, multi-writer protocol, performance targets (workspace scale + staleness-query latency budgets) | R10, R31, O6, O7 |
| WI-0.3 | **Gate G1 — capture coverage:** write-path inventory table (editor autosave, AI-suggestion apply, MCP document tools, Tauri fs commands, terminal/external) + end-to-end capture prototype logging a complete transformation for one representative path of each class; crash-recovery behavior noted per path | R26, R2, R9, G1 |
| WI-0.4 | **Gate G2 — git operation classification:** probe distinguishing navigation vs. mutation across checkout / reset / revert / merge / branch switch / worktree / detached HEAD / no-git; matrix of expected-vs-observed; PASS requires all rows correct on macOS | R18, G2 |
| WI-0.5 | Spike S1: ledger segment behavior under real git branch + merge (incl. `merge=union` gitattribute); report | R17 |
| WI-0.6 | Spike S2: `rusqlite` integration; index rebuild-from-scan performance at WI-0.2 target scale; bundled-vs-system decision (ADR-C1) | R16, O6 |
| WI-0.7 | Spike S3: LLM edge-inference feasibility on real prose (direct vs. contextual classification quality); Spike S4: semantic-check precision on a seeded-contradiction corpus → M3 baseline | O2, R24, R25, M3 |
| WI-0.8 | Close §3.4 evidence gaps: DVC freeze/commit waiver metadata; Graphiti v0.27–v0.29 release-window check; Jacquard/Patchwork cross-doc features. Update paper §3.4 with findings | §3.4 |
| WI-0.9 | Create `scripts/check-coherence-phase.sh` (template: `check-gha-phase.sh`) with Phase 0 and Phase 1 assertions; set M1–M5 baselines/exit thresholds in the spec | M1–M5 |

**Phase 0 has no production-source WIs; TDD gate is N/A except the prototype
code, which is spike-class (grills), not shipped.**

## Phase 1 — Rust kernel + breakdown view + read-only MCP

**DoD:** `bash scripts/check-coherence-phase.sh 1` exits 0: all Phase-1 WI
tests exist and pass (`cargo test`, `pnpm check:all`); R16 delete-and-rebuild
test green; I5 append-only property test green; breakdown view E2E via Tauri
MCP recorded; M1 at baseline on the dogfood workspace.

| WI | Work item | Traces to |
|---|---|---|
| WI-1.1 | Kernel scaffold `src-tauri/src/coherence/`: core types (ObjectId, RevisionId as hash+parents, Transformation with input set + confidence, Context with selections/enforcement), invariants I1/I2/I5 as enforced properties (no public mutating API on history) | R6, R7, R27, R28, I1, I2, I5 |
| WI-1.2 | Ledger: per-writer JSONL segment append (atomic write + fsync policy), reader with malformed-entry quarantine, crash-recovery replay; property tests for order-independence | R17, spec |
| WI-1.3 | Snapshot CAS + canonicalized hashing per spec; identity-field exclusion test; binary vs. text handling | R19, R20, R30 |
| WI-1.4 | Revision DAG + Context-relative staleness incl. diverged; table-driven tests over linear/branched/incomparable histories | R10, R31 |
| WI-1.5 | SQLite index (ADR-C1): materialized edges, current-revision map, staleness cache; rebuild-from-scan; **test: delete index → rescan → identical query results** | R16 |
| WI-1.6 | Capture instrumentation for AI-generation paths from G1 (Genie flows, MCP document tools): transformations with exact input sets; observed-external-edit synthesis on scan with confidence=unknown | R1, R2, R9, R26, R28 |
| WI-1.7 | Git reconciliation from G2: operation classification, navigation events (no revision minting), git-attributed mutation transformations for revert/merge | R18 |
| WI-1.8 | Frontmatter ID convention: assignment on first capture, scan reconciliation, duplicate-ID detection surfaced (never auto-resolved) | R5, R9, I3 |
| WI-1.9 | Breakdown view (React): pull-based list of stale/diverged edges grouped by artifact; actions accept-newer / revise / waive appending ratification, transformation-via-editor, waiver records respectively; zero store destructuring, selectors only | R15, R13, I5 |
| WI-1.10 | Read-only MCP tools on the existing server: `coherence_status`, `coherence_edges` (query staleness, list edges + provenance); no mutating tools in this phase | R23 |
| WI-1.11 | Docs: `website/guide/` page for the breakdown view + `dev-docs/` architecture note; README index updates (rule 21) | — |

## Phases 2a / 2b / 3 / 4 — outlined, not decomposed

- **Phase 2a — semantic-model design session (no code):** O1 context
  composition, O5 canon lifecycle, O8 waiver scope, R33 maturity relation —
  one coherent model, written as a paper amendment + spec v1. **Plan
  amendment decomposes Phase 2b afterward.**
- **Phase 2b — semantic layer:** claims, enforcing/greenhouse contexts, LLM
  checking with first-class unknown (R11, R25), waivers (R13), resolution
  records in the breakdown view.
- **Phase 3:** human-edit inference with lazy confirmation (R3, O2);
  branch-mapped contexts; post-merge semantic audit; mutating MCP tools under
  the R29 authority model.
- **Phase 4:** first non-writing vertical as schema pack + format adapter;
  MCP hardening.

## Dogfood protocol (accompanies Phase 1+)

One real recursive creative project (chosen by the user — open input), run in
a dedicated workspace from the first Phase 1 build. Metrics M1–M5 recorded
per session against the WI-0.9 baselines. Qualitative gate per paper §12.

## Risks

1. **G1 or G2 fails** → Phase 1 does not start; redesign capture or git
   reconciliation first (both gates exist precisely because failure here is
   unfixable retroactively).
2. **Edge noise at file granularity** (R31) makes the breakdown view feel
   spammy → mitigation: M2 tracked from first dogfood session; O9
   (section-level) escalates if M2 misses baseline.
3. **rusqlite dependency** — manual crate review + `cargo audit` (rule 60
   §4); no other new dependencies expected in Phases 0–1.
4. **Scope creep toward regeneration** — §14 non-goals are binding; any
   "auto-update content" request is out of scope for this plan.

## Open questions (user input)

1. Which real creative project is the dogfood workspace?
2. Snapshot-store git-tracking default (per-workspace user choice — what
   should the *default* be: tracked or ignored?)

## Governance

- WI linkage enforced (`scripts/check-wi-linkage.sh <this-plan> --phase=N`).
- Phase status header updated only when the phase's
  `check-coherence-phase.sh` assertion passes (rule 60 §3).
- Codex review of this plan before Phase 1 commits (rule 60 §6) — record
  thread ID and disposition here when done.
- New-dependency review per rule 60 §4 (ADR-C1).
