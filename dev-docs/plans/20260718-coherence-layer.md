# Plan: Coherence Layer — Kernel + Breakdown View (Phases 0–1, later phases outlined)

- **Status:** Phase 0 in progress (spec + G1/G2 + S1 done; S2–S4 running).
  **Codex cross-model review completed and dispositioned — see "Cross-model
  review" section** (rule 60 §6). Phase 1 may start once Phase 0's DoD is
  green (`bash scripts/check-coherence-phase.sh 0`).
- **Date:** 2026-07-18 (amended same day after Codex review)
- **Contract:** `dev-docs/coherence-layer-paper.md` **v1.1** (Codex-reviewed,
  Appendix A). All WIs trace to the paper's R1–R33, I1–I5, O1–O9, M1–M5, and
  gates G1–G2. Where this plan and the paper disagree, the paper wins and the
  plan is amended. The on-disk contract is
  `dev-docs/specs/coherence-format-v0.md` (WI-0.1/0.2 output).
- **Evidence base:** `dev-docs/deep-researches/20260718-*` (three verified
  research passes + discussion record); Phase 0 gates and spikes under
  `dev-docs/grills/coherence/`.
- **Scope discipline:** Phases 0–1 are decomposed into WIs here. Phases
  2a/2b/3/4 are outlined only and MUST be decomposed by a plan amendment
  after the Phase 2a design session — decomposing them now would guess at
  decisions O1/O5/O8 deliberately not yet made.

## Verifiable success criteria (plan level)

1. Phase 0 exit: format spec exists and covers its R-IDs; gates G1/G2 have
   recorded PASS; spikes S1–S4 have written reports; M1–M5 baselines set.
   `bash scripts/check-coherence-phase.sh 0` exits 0.
2. Phase 1 exit: on the dogfood workspace, every AI generation through
   instrumented paths produces a complete transformation at the path's
   designed confidence (`exact` for in-app AI paths, `inferred` for
   external-agent MCP writes — spec §8; M1 at baseline); the breakdown view
   lists version-stale and diverged edges and its three actions append the
   correct records (I5 verified by test); deleting the SQLite index and
   rescanning reproduces identical query results (R16 test).
   `bash scripts/check-coherence-phase.sh 1` exits 0 (it *runs* the
   coherence test suites — fail closed, not reminder-only).
3. No WI is "complete" without linkage (commit message `(WI-N.M)` or test
   header) — `scripts/check-wi-linkage.sh` passes.

## ADRs (implementation-level; architectural decisions live in the paper)

- **ADR-C1 — SQLite via `rusqlite` (bundled).** Decide bundled vs. system
  SQLite in S2; default expectation: bundled (`rusqlite` `bundled` feature)
  for deterministic cross-platform behavior. New crate ⇒ manual review per
  rule 60 §4 (crates lack the npm heuristic) + `cargo audit`. **S2 PASS +
  recorded crate review are hard prerequisites to touching
  `src-tauri/Cargo.toml`** (Codex D3#4).
- **ADR-C2 — Workspace layout.** `.vmark/` at workspace root:
  `ledger/<writer-id>.jsonl` segments, `contexts/*.json` pin manifests,
  `snapshots/` CAS, `index.db` (gitignored), `waivers/` folded into ledger
  (waivers are ledger entries, not separate files — single append-only
  source). Final layout fixed in the format spec §1.
- **ADR-C3 — TDD mechanics for Rust kernel.** The `.claude/hooks/`
  TDD guard is TS-scoped; Rust kernel discipline is enforced by convention
  (tests-first in sibling `*.test.rs` modules via `#[path]` include) and by
  Phase DoD *running* the per-WI tests. Frontend WIs (breakdown view) fall
  under the standard coverage gate.
- **ADR-C4 — Kernel/service module boundaries (R22, Codex D1#5).**
  Within `src-tauri/src/coherence/`: **pure kernel** — `types.rs`,
  `canonical.rs`, `dag.rs`, `project.rs` (no I/O, no Tauri, unit-testable
  in isolation); **storage** — `ledger.rs`, `cas.rs`, `index.rs`
  (filesystem + SQLite, no Tauri types beyond errors); **services** —
  `scan.rs`, `capture.rs`, `gitops.rs`, `state.rs` (per-workspace kernel
  instance + serialization), `commands.rs` (Tauri surface). TypeScript
  consumes read models over IPC only (R27) and implements no kernel
  semantics. Every file ≤ 300 lines (repo gate).
- **ADR-C5 — New dependencies (rule 60 §4).** Exactly three additions,
  each requiring recorded review before its first commit:
  (1) `rusqlite` (bundled) — per ADR-C1/S2;
  (2) `uuid` **feature** `v7` (no new crate — feature add on the existing
  pinned crate) for entry/object/writer IDs;
  (3) `unicode-normalization` — NFC canonicalization (spec §3.1); tiny,
  no-deps, maintained by the unicode-rs org. No other new dependencies in
  Phases 0–1.

## Cross-model review (rule 60 §6) — record and disposition

- **Thread:** `019f7404-223a-7512-93d8-56de0b340829` (Codex, read-only
  sandbox, high reasoning effort; plan + paper + spec + G1 + rule 60 read).
- **Verdict on the pre-amendment plan: MAJOR GAPS** — direction and Phase 0
  endorsed; Phase 1 not buildable as then written.
- **Disposition: all blockers accepted; amendments applied same day** (this
  file + spec edits). No finding rejected outright; two partially accepted
  with rationale.

| # | Finding (abridged) | Disposition |
|---|---|---|
| D1#1 | WI-1.6 claimed `exact` for MCP; G1 says `inferred` | Accepted — spec §8 + success criterion 2 + WI-1.6 aligned |
| D1#2 | Output-digest `idem` merges distinct generations with identical outputs | Accepted — spec §5.1: `idem` minted once per logical operation, not derived |
| D1#3 | CAS stored identity-bearing bytes under masked hash → wrong identity on shared key | Accepted — spec §4.2: CAS stores identity-masked canonical bytes (self-verifying); identity re-inserted at materialization from ledger |
| D1#4 | *Revise* had no mechanism to retire the stale edge | Accepted — spec §9.2 edge-liveness rule: edges of superseded downstream revisions are historical, never listed |
| D1#5 | Kernel/service boundary not concrete | Accepted — ADR-C4 |
| D2#1 | No lifecycle WI (startup/shutdown/rebuild/multi-window) | Accepted — new WI-1.12 |
| D2#2 | R1 vs. AI-only capture scope | Accepted — WI-1.6 expanded to all G1 inventory rows (human funnels + AI + observed-external) |
| D2#3 | No actor identity for ratify/waive | Accepted — spec §5.4.3: v1 actor = git `user.name` ∥ OS username; WI-1.9a carries the append API |
| D2#4 | Persistence error paths / format-evolution tests unenumerated | Accepted — per-WI acceptance tests listed in the WI table below |
| D2#5 | Phase checker fail-open (grep-only) | Accepted — checker now runs the coherence test suites for Phase 1 |
| D2#6 | Breakdown UI states / i18n unspecified | Accepted — WI-1.9b acceptance |
| D3#1 | No Rust capture API/IPC contract; vertical slice missing | Accepted — capture IPC contract defined below; build order re-sequenced |
| D3#2 | UUIDv7 + NFC undeclared dependencies | Accepted — ADR-C5 |
| D3#3 | MCP tools span three layers, unplanned | Accepted — WI-1.10 rewritten (Rust-terminal routing + sidecar + health-count) |
| D3#4 | S2 not a hard prerequisite | Accepted — ADR-C1 amended |
| D3#5 | Rust frontmatter strategy unspecified | Accepted — spec §2.1 parsing strategy fixed (line-based reserved block, byte-preserving) |
| D4#1 | "Exact input set" not operationalized per path | Accepted — typed `CaptureRequest` in the contract below; spec §7 worked examples |
| D4#2 | accept-newer undefined for diverged/multi-head | Accepted — spec §9.2: defined-selection diverged keeps both actions; multi-head disables accept-newer and waive |
| D4#3 | Scan reconciliation states undefined | Accepted — spec §9.4 state machine + table-driven tests (WI-1.6) |
| D4#4 | "Current-revision map" reads as global latest | Accepted — spec §9.2: per-object head sets; no context-free latest API |
| D4#5 | Quarantine self-append ambiguity | Accepted — spec §5.6 note |
| D4#6 | Snapshot-tracking open question already fixed by spec | Accepted — open question resolved to spec §4.4 default (tracked) |
| D5#1 | Phase 1 blocked until Phase 0 green; checker must fail closed | Accepted — Status header + checker amendment |
| D5#2 | Capture risk buried late; needs vertical slice | Accepted — build order below: editor-save slice lands before adapters |
| D5#3 | Foundational probes for UUIDv7/NFC/frontmatter/fsync | **Partial** — G1/S1 already probed the risky I/O semantics (append/fsync/torn-tail, masking, union-merge); UUIDv7/NFC are pure library calls covered by table-driven unit tests + ADR-C5 review. No further spikes. |
| D5#4 | Resolution write API before action buttons | Accepted — WI-1.9 split into 1.9a (API) / 1.9b (UI) |
| D5#5 | Dogfood workspace undefined for M1–M5 evidence | **Partial** — dogfood log schema defined below; Phase 1 exit measures M1 on a labeled synthetic dogfood workspace; the *real* creative project remains the one open user decision |

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

**DoD:** `bash scripts/check-coherence-phase.sh 1` exits 0. The checker
*runs* `cargo test` for the coherence module and the breakdown-view vitest
suites (fail closed — Codex D2#5), and asserts: R16 delete-and-rebuild test
green; I5 append-only property test green; breakdown view E2E via Tauri MCP
recorded (`dev-docs/grills/coherence/phase1-e2e.md`); M1 recorded in the
dogfood log. `pnpm check:all` green.

### Capture IPC contract (Codex D3#1, D4#1)

One Tauri command is the single write-side entry point:

```
coherence_capture(workspace_root, CaptureRequest) -> Result<CaptureReceipt, String>

CaptureRequest {
  path: String,                    // workspace-relative output file
  content: String,                 // the EXACT content the caller wrote — the kernel
                                   // hashes/snapshots THIS, never a disk re-read, so a
                                   // concurrent writer cannot be mis-attributed (D3#1)
  inputs: Vec<{ path | object_id, revision?: String, role: "direct"|"contextual" }>,
  agent: { type: "human"|"model"|"external", id?: String },
  intent: { kind: String, summary: String },
  confidence: "exact"|"inferred",  // per spec §8; "unknown" is scan-only
}
```

Ordering is fixed: content write succeeds → `coherence_capture` (snapshot
CAS write → ledger append → index update). A crash between content write
and capture is healed by scan reconciliation (spec §9.4) — same mechanism
as external edits, no special case. Callers: `saveToPath.ts` (human, after
`atomic_write_file`), genie `streamRunner.ts` (model, at apply), MCP
`document.ts`/`workspace.ts` handlers (model, `inferred`, session-read
input set), workflow `runner.rs` `action/save-file` (model, in-process
call, not IPC). **Input revision resolution order (D4#1):** (a) a
caller-provided `revision` wins (MCP read handlers attach the revision
that `document.read` returned at read time) — the kernel **validates**
that the revision exists and belongs to the referenced object, rejecting
the capture with an error on mismatch (no silent fallback); (b) otherwise
the kernel resolves path → current head at capture time. Capture runs
synchronously inside the same user action as the write and all in-app
writes serialize through the per-workspace kernel instance (spec §5.1),
so (b) is exact for in-app flows; races with external mid-action edits
fall to scan reconciliation like any external write. Callers never
compute revision IDs.

**Binary scope (v1):** every G1 write path emits text; `coherence_capture`
therefore carries `content: String` and captures text/markdown only.
Binary support in WI-1.3 is kernel-level (raw-byte hashing + CAS storage
+ §5.4.6 registration) so the format is ready; a binary *capture path*
arrives with the first media vertical (Phase 4), not in Phase 1.

### Build order (vertical slice first — Codex D5#2)

1. WI-1.1 → WI-1.2 → WI-1.3 → WI-1.4 (pure kernel + storage, all offline).
2. WI-1.5 (index; requires ADR-C1 prerequisites met).
3. WI-1.6a **vertical slice**: editor-save funnel through
   `coherence_capture` end-to-end (save → snapshot → ledger → index →
   restart → rescan → identical), with WI-1.12 lifecycle minimum (workspace
   open/close, rebuild trigger).
4. WI-1.6b adapters (genie, MCP, workflow, explorer/new-file, history
   revert) + observed-external synthesis; WI-1.7; WI-1.8.
5. WI-1.9a → WI-1.9b → WI-1.10 → WI-1.11 → WI-1.12 (rest) → E2E + dogfood.

| WI | Work item | Traces to |
|---|---|---|
| WI-1.1 | Kernel scaffold `src-tauri/src/coherence/` per ADR-C4: core types (ObjectId, RevisionId as hash+parents, Transformation with input set + confidence, Context with selections/enforcement), invariants I1/I2/I5 as enforced properties (no public mutating API on history) | R6, R7, R27, R28, I1, I2, I5 |
| WI-1.2 | Ledger: per-writer JSONL segment append (`mkdir -p` before every append — S1 finding; O_APPEND single-line + fsync policy; torn-tail termination — G1 finding), reader with malformed-entry quarantine, crash-recovery replay; property tests for order-independence + idem dedupe; acceptance: unknown-kind preservation, format-number rejection, quarantine-unavailable fallback | R17, spec §5 |
| WI-1.3 | Snapshot CAS (identity-masked canonical bytes, self-verifying) + canonicalized hashing per spec §3–4; identity-field exclusion test; binary vs. text handling; acceptance: missing/corrupt-snapshot surfaces diagnostic + explicit error | R19, R20, R30 |
| WI-1.4 | Revision DAG + Context-relative staleness incl. both diverged sub-cases and edge liveness; table-driven tests over linear/branched/incomparable/multi-head histories | R10, R31 |
| WI-1.5 | SQLite index (ADR-C1): materialized edges, per-object head sets, staleness cache; rebuild-from-scan; `PRAGMA user_version` mismatch → silent rebuild; **test: delete index → rescan → identical query results**; failed-rebuild surfaces diagnostic | R16 |
| WI-1.6 | Capture: (a) vertical slice — editor-save funnel through `coherence_capture` with lifecycle minimum; (b) adapters for all G1 inventory rows — genie (exact), MCP document/workspace (inferred, session reads), workflow save-file (exact, in-process), explorer new-file + history revert (human), observed-external synthesis on scan per spec §9.4 state machine (table-driven tests per row) | R1, R2, R9, R26, R28 |
| WI-1.7 | Git reconciliation from G2: MERGE_HEAD-first classification, navigation events (no revision minting), git-attributed mutation transformations for revert/merge; no-git and worktree handling | R18 |
| WI-1.8 | Frontmatter ID convention per spec §2.1 parsing strategy: assignment on first capture, scan reconciliation, duplicate-ID detection surfaced + capture-hold (never auto-resolved); malformed-frontmatter diagnostic | R5, R9, I3 |
| WI-1.9a | Resolution write API: `coherence_resolve` Tauri command appending ratification/waiver entries with actor identity (git `user.name` ∥ OS username); rejects multi-head accept-newer/waive per spec §9.2; I5 append-only property test | R13, R15, I5, R29 |
| WI-1.9b | Breakdown view (React): pull-based list of live stale/diverged edges grouped by artifact; actions accept-newer / revise / waive calling WI-1.9a (disabled states per spec §9.2); loading/empty/error states; result cap with count; i18n keys (all locales); zero store destructuring, selectors only | R15, R13, I5 |
| WI-1.10 | Read-only MCP tools on the existing server, Rust-terminal path: sidecar `tools/coherence.ts` (`coherence_status`, `coherence_edges`) + `EXPECTED_TOOL_COUNT` bump + Rust routing in `mcp_bridge/routing.rs::handle_rust_side` reading kernel state (no webview hop); tests at sidecar and Rust layers; errors for invalid workspace / stale index | R23 |
| WI-1.11 | Docs: `website/guide/coherence.md` + `dev-docs/` architecture note; README index updates (rule 21); MCP tools reference update | — |
| WI-1.12 | Lifecycle: per-workspace kernel instance in managed state (single instance across windows), init on workspace open (lazy `.vmark/` creation on first capture), index rebuild trigger, watcher wiring for scan reconciliation, batched-flush + shutdown fsync, failed-init surfaces diagnostic without blocking the editor | R16, R26, O7 |

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

One real recursive creative project (chosen by the user — **the one open
input**), run in a dedicated workspace from the first Phase 1 build. Until
that choice lands, Phase 1 exit measures M1 on a **synthetic dogfood
workspace** (a small story-world corpus exercised through the instrumented
paths), explicitly labeled synthetic in the log.

**Dogfood log** (`dev-docs/grills/coherence/dogfood-log.md`, one section
per session): date; workspace (synthetic|real:name); sessions actions
summary; M1 = captured-with-designed-confidence / total AI generations
(count both numbers); M2 = relevant-flagged / total-flagged (human
judgment); M4 = resolutions demanded; M5 = minutes from upstream change to
blast-radius known; M3 recorded from Phase 2b on. Qualitative gate per
paper §12 ("recurse without fear").

## Risks

1. **G1 or G2 fails** → Phase 1 does not start; redesign capture or git
   reconciliation first. *(Both gates PASSED 2026-07-18 — reports in
   `dev-docs/grills/coherence/`.)*
2. **Edge noise at file granularity** (R31) makes the breakdown view feel
   spammy → mitigation: M2 tracked from first dogfood session; O9
   (section-level) escalates if M2 misses baseline.
3. **New dependencies** (ADR-C5: rusqlite, uuid/v7 feature,
   unicode-normalization) — manual crate review + `cargo audit` before the
   first commit touching `Cargo.toml`.
4. **Scope creep toward regeneration** — §14 non-goals are binding; any
   "auto-update content" request is out of scope for this plan.

## Open questions (user input)

1. Which real creative project is the dogfood workspace? *(Only remaining
   open input; synthetic-workspace fallback defined above.)*
2. ~~Snapshot-store git-tracking default~~ — resolved: spec §4.4 fixes the
   default to **tracked**, per-workspace override writes
   `.vmark/.gitignore`.

## Governance

- WI linkage enforced (`scripts/check-wi-linkage.sh <this-plan> --phase=N`).
- Phase status header updated only when the phase's
  `check-coherence-phase.sh` assertion passes (rule 60 §3).
- Codex review of this plan: **done** — thread
  `019f7404-223a-7512-93d8-56de0b340829`, verdict MAJOR GAPS on the
  pre-amendment plan, all findings dispositioned in the table above and
  amendments applied before any Phase 1 commit (rule 60 §6). Two
  confirmation rounds followed (NEEDS REVISION → four residuals fixed:
  fail-closed gate incl. `pnpm check:all` run, v1 binary-capture scoping,
  caller-revision validation, deterministic registry ordering); **final
  verdict on the amended plan: READY TO BUILD.**
- New-dependency review per rule 60 §4 (ADR-C5).
