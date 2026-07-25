# Landing `refactor/vmark-core` to `main` — Phased Plan

> **⛔ SUPERSEDED (2026-07-23) — no release train.** Decision: the refactoring is
> developed **locally, with no releases**, and **parks on `refactor/vmark-core`**
> indefinitely; `main` is not touched until a separate, explicit decision. The
> versioned train (`v0.9.8`→`v0.10.0`), the reconstruct-into-releasable-slices
> apparatus, per-phase version bumps, and `v*` tags below are all **cancelled**.
>
> The strategy is now **local sequential-branch integration** (see
> [`landing/local-integration-strategy.md`](landing/local-integration-strategy.md)):
> each refactoring unit is a short-lived branch off `refactor/vmark-core`, made
> green under `pnpm check:all`, merged back `--no-ff`, then the next. The
> extension re-architecture is code-complete and parked; the next development unit
> is the **command-registry unification**
> (`20260723-command-registry-unification.md`).
>
> What remains **useful** below (history-of-record): Phase 0's differential
> harness (`scripts/landing-differential.sh`), the manifest, and the equivalence
> findings — a reusable regression net, not a release procedure. Ignore every
> version/tag/release-gate instruction.

**Status:** **Phase 0 COMPLETE** (2026-07-23) — findings in `landing/phase-0-findings.md`,
manifest in `landing/WI-0.1-manifest.md`, harness `scripts/landing-differential.sh`. Two
Codex passes folded before Phase 0 (RETHINK → NEEDS AMENDMENT). **Headline result: the
differential shows 19/22 corpus fixtures byte-identical v0.9.7↔branch for markdown
round-trip; the only 3 changes are exactly the D1–D4 fixes** (harness asserts target==HEAD +
dependency-equality; other domains gated separately) — strong evidence the plan's core
premise holds. **Correction from the Phase-0
spike: "format-services" is NOT one independent slice** — its contract body is core-coupled
(WI-0.5); only jscpd/harness/service-tier/perf/fence/svg/closeSave-dup are pre-nucleus
independent. **Codex re-review of the concretized Phases 1–2 done (NEEDS AMENDMENT → all 8
folded:** versioned release train `v0.9.8`→`v0.9.9`→`v0.9.10`→`v0.10.0` with cumulative
validation; harness `EXPECT_IDENTICAL` gate mode; harness-first WI ordering; concrete D3 +
golden gate; manual-smoke checklist authored; `check-landing-phase.sh` as a real WI-1.5
deliverable; stale Phase-2 language purged). **Ready to execute Phase 1** (start at WI-1.2,
harness-first).
**Branch under landing:** `refactor/vmark-core`, rooted exactly at `v0.9.7` / `440ed317`.
**51 refactor commits** are the landing units — exactly `v0.9.7..cc89b450`: 51 commits,
361 files, +8302/−2363 (verified). The branch tip beyond `cc89b450` carries this session's
**landing apparatus** — Zed research, ADR amendments, the landing plan, Phase 0 — which are
meta, not units (so the raw `v0.9.7..HEAD` count is higher and grows as the plan is worked;
e.g. `v0.9.7..6b7f1459` = 54 commits / 363 files / +9055).
**Motivation:** `dev-docs/deep-researches/20260723-zed-architecture-lessons.md` §D. Zed's
discipline is *build-alongside-then-swap on a shippable `main`*; a large refactor that
diverges indefinitely, or a second refactor stacked on an unmerged first, is the failure
mode. `main` was reset to `v0.9.7` deliberately; this plan returns the completed extension
re-architecture in **releasable slices, each proving exactly what it changes for users.**

## Why the first draft was wrong (Codex review, verified)

The first draft built its slice manifest from `git log --format='%s'` **subject lines**.
On this branch the subjects **do not describe their diffs** — a history-rewrite artifact.
Verified counterexamples:

| Commit | Subject claims | Actual diff (`git show --stat`) |
|---|---|---|
| `10b62d64` | "validate cli_path at the command boundary" | `src/lib/extensions/resolve.test.ts`, `types.ts` — the **resolver**, no `src-tauri` |
| `faec8620` | "make plugin-isolation able to fail CI" | *also* introduces `src-tauri/.../cli_path_guard.rs` + tests |

So the first draft's Phase 1 (cherry-pick `10b62d64` as the standalone security fix) was
**factually false**, and its "the core is one un-sliceable unit" was **disproved** —
`c41cb916` (service-tier, 137 files, precedes the core) and `870449b9`/`2a84e376` (fence
point, `codePreview`-only) are independently separable. This is the ADR-009 "trust the
label" failure mode. **Two principles follow.**

## Two load-bearing principles

1. **Landing units are built from verified diffs, never commit subjects.** Every candidate
   unit is audited with `git diff-tree`/`git show --stat`; the reconstructed landing series
   is validated against the branch with `git range-diff`. No hash is trusted by its message.
2. **A slice lands only when a differential proves precisely what it changes for users.**
   The `migrator` lesson — nothing changes silently. But the *markdown-serialization*
   differential is **necessary, not sufficient** (Codex): it does not cover Source/WYSIWYG
   composition, non-markdown formats, undo/autosave, Rust, or performance. Each needs its
   own gate.

## Phase 0 — Manifest audit + separability spike + differential harness (NO merge) — ✅ COMPLETE

The first draft assumed the manifest; this phase **produced** it, verified. Spike before
commit (rule 60 §7). **Deliverables:** `landing/WI-0.1-manifest.md` (54 commits by real
diff), `scripts/landing-differential.sh` (WI-0.2 harness), `landing/phase-0-findings.md`
(WI-0.2/0.3/0.4/0.5). Executed in a scratch `v0.9.7` worktree + `landing/recon-*` branch —
no `main` commit. All five WIs below are done; see findings for evidence.

| WI | Change |
|---|---|
| WI-0.1 | **Manifest audit at HUNK granularity** (whole-commit clustering is insufficient — `a6ebf4e1` spans four domains at once: Rust guard, resolver/claim core, fence, markdown registries; `faec8620` mixes the Rust security guard with enforcement config — a `{hash, files}` row cannot assign them). Record actual changed paths (`git diff-tree --no-commit-id --name-only -r`) and, for cross-domain commits, individual **hunks**. Output: `{hash, path/hunk, target landing-unit, dependency}`. **Every final-branch hunk maps to exactly one landing unit or an explicit omission** — none falls through |
| WI-0.2 | **Differential harness.** Render round-trip output on `v0.9.7` vs the branch across the production corpus; diff per fixture. Extends `1eaf1db1`/`732ba97c` into a cross-ref diff. Output: the exact changed-fixture set |
| WI-0.3 | **Behavioral-diff inventory — driven by WI-0.1's footprint, not a fixed list.** Rule: **every production path WI-0.1 finds must map to a behavioral domain with a test** (harder to under-enumerate than a static list). Domains this refactor's footprint touches, each needing a gate: Source/WYSIWYG composition + ordering + interactive commands; undo/redo + autosave timing **and multi-tab close-persistence** (`da53f8c6`); clipboard/paste/DnD; window/workspace/tab/navigation lifecycle + startup file-open + Finder-open + window close/focus + recent-workspaces (`c41cb916`); filesystem + external-change handling; history/recovery rewiring (`c41cb916`); terminal key handling + `terminalGate` tier move; media/image resolution + popup actions; **MCP workspace bridge** (`workspaceOpenFolder`, `c41cb916`); large-file + split-pane (`a870a535`); source-language fast path (`43a60416`); SVG parse+render (`8edfe830`); code-preview lifecycle; linter/outline/word-count/status-bar; non-markdown formats (YAML/JSON/SVG/Mermaid/TOML/plain/code); file open/save + format dispatch; schema-completeness + adoption invariants (architectural gates distinct from byte serialization); Rust (`cli_path`); cross-platform compile; perf |
| WI-0.4 | **Per-gate coupling classification** (not one blanket assertion). Verify at the intended tree which gates pass pre-core vs require post-core: `plugin-isolation→error`+baseline, `extension-budget` baseline, scope inventory, Node-safe seam gate are **pre-core-capable** (baselines were authored to pass then); the **deleted-name** rules are **post-core-only** (they forbid files `f64f99d5` deletes). Verify every baseline value at its target tree |
| WI-0.5 | **Trial reconstruction + cumulative equivalence.** On a throwaway branch off `v0.9.7`, reconstruct each candidate unit from its verified hunks: security, service-tier, jscpd, **fence as the ordered pair** `870449b9`→`2a84e376`, **format-services as a DAG** (`dd1c6f01`/`3c04a99d` co-edit `formats/adapters/markdown.tsx`+`types.ts` and follow `a870a535`'s contract), docs, D1–D4. `range-diff` alone does **not** prove independence (it compares patch series, not runtime), so require **all** of: focused tree diffs, patch/hunk provenance, green `check:all`+Rust/cross gates on **each reconstructed intermediate tree**, a **final cumulative tree diff** of the whole reconstructed series against the branch tip, and explicit accounting for deliberately-omitted (doc) hunks. Independence is *proven*, not assumed |

**DoD (met):** ✅ verified manifest exists; ✅ changed-fixture set characterized ({14,16,17}
= D1–D4 exactly, 19/22 byte-identical); ✅ every footprint domain has an assigned gate (one
honest manual-E2E gap); ✅ each candidate slice reconstruction-proven independent or
reclassified core-coupled; ✅ per-gate coupling verified against real trees; ✅ no commit to
`main`.

### Derived release sequence (Phase 0 output — concrete versioned train)
Each release is reconstructed on the **preceding release tag** (not raw `v0.9.7`) and
validated **cumulatively** — "independent of the nucleus" is not "commutative in any order."

| Ver | Contents | WIs | Differential gate |
|---|---|---|---|
| **`v0.9.8`** | final cli_path guard + D1–D4 + safety-net harness + pre-core gates (Node-safe seam `cd5db8f4`, scope inventory `9fcb7dd0`) + target-vs-shipped docs | Phase 1 (WI-1.*) | characterization vs `v0.9.7`: **exactly** {14,16,17} change |
| **`v0.9.9`** | **service-tier `c41cb916` + jscpd `1ea49a30` + plugin-isolation/budget gate `faec8620`(config) — ONE unit** (the budget baseline was authored on the tree that already has service-tier + jscpd + harness, WI-0.4) | Phase 1b / WI-1b.1 | `EXPECT_IDENTICAL=1` vs `v0.9.8` (pure move; zero round-trip change) |
| **`v0.9.10`** | fence `870449b9`→`2a84e376` (+ `a6ebf4e1` `codePreview/**` corrections) + svg `8edfe830` + closeSave-dup `da53f8c6` + perf-bench `4b8a658b` | Phase 1b / WI-1b.2 | `EXPECT_IDENTICAL=1` vs `v0.9.9` |
| **`v0.10.0`** | nucleus + format-contract body (core-coupled) + deleted-name gate | Phase 2 (WI-2.*) | `EXPECT_IDENTICAL=1` vs `v0.9.10` (behavior-preserving core) |

Every release runs the full release gate + its slice's rows of the manual-smoke checklist
(`landing/manual-smoke-checklist.md`). The `v0.9.9`/`v0.9.10` groupings keep review small
without a release-per-commit explosion; split further only if a slice fails its gate. Each
Phase-1b WI = reconstruct on the prior tag → cumulative differential → full release gate →
version-bump → release note → tag.

## Phase 1 — Release 1: security + safety net + accurate docs (patch, `v0.9.8`)

Reconstructed as **fresh topic commits on `v0.9.7`**, not regrouped cherry-picks (the
worktree also has uncommitted Zed research/amendments/this plan, which cannot be
cherry-picked at all).

| WI | Change |
|---|---|
| WI-1.1 | **Security fix, reconstructed to its FINAL state** — the guard files at their `a6ebf4e1` version (137-line `cli_path_guard.rs` + `cli_path_guard.test.rs` + `mod.rs` wiring), which are **new files at `v0.9.7`** so they apply as a clean add; the only edit to an existing file is `run_ai_prompt`'s boundary call. Verified self-contained (Codex + git): `faec8620` introduces them, `a6ebf4e1` only refines them, the `ai_provider` tree at `faec8620^` == `v0.9.7`. This **is** a behavior change (rejects formerly-accepted `cli_path` inputs) — desirable security, **not** "zero behavior change". Verify with Rust tests + `check:cross` + fmt + clippy |
| WI-1.2 | **Safety-net harness FIRST** (moved before the fix it guards — RED before GREEN). Land corpus characterization (`1eaf1db1` + `732ba97c` src) + `roundtripDefects.test.ts` + the audited `scripts/landing-differential.sh` (final hardened state, from the branch tip). The D1–D4 fixtures fail on `v0.9.7`'s pipeline (RED) before any fix |
| WI-1.3 | **D1–D4 fixes, reconstructed against the `v0.9.7` functions** (verified portable; do NOT raw-cherry-pick — `pmBlockConverters.ts` diverged during inversion). Concrete change set: (a) `alt` attr on the audio/video Tiptap nodes; (b) mdast→PM media promotion passes `alt`; (c) PM→mdast media serialization emits `alt`; (d) Link extension adds `title` + both directions preserve it; (e) parse-side custom-marker transform extracted to `customInlineTransform.ts`, supporting marks spanning text/strong/etc. nodes (D3, ~288 lines); (f) serializer emits `\^` escaping outside superscript/title constructs (D4); (g) `roundtripDefects.test.ts` covers all four + control cases. **Golden gate:** re-render regenerates **exactly** `14-media.md`, `16-inline-marks.md`, `17-escaped-markers.md`; the other 19 stay byte-identical; a **4th** changed golden BLOCKS `v0.9.8` |
| WI-1.4 | **Deliberately-written pre-landing doc snapshot.** Do NOT cherry-pick post-refactor status docs (which say phases "COMPLETE" and files "deleted") onto a tree where they aren't. Publish ADR-015/016/017 + landing/Zed research as **"accepted target architecture,"** clearly distinguished from **"currently shipped."** Commit the uncommitted research/amendments here |
| WI-1.5 | **Machine gates + manual gate as blocking deliverables:** `landing/manual-smoke-checklist.md` (authored in Phase 0) becomes a recorded release gate; **author `scripts/check-landing-phase.sh`** (template `check-gha-phase.sh`) asserting the differential result, per-gate classification, release gate, and version consistency — a real blocking script, **not** a hollow stub |
| WI-1.6 | Version-bump per rule 40 (5 files + `Cargo.lock`); run the full release gate incl. the checklist; tag `v0.9.8` only after CI is green on the exact SHA |

**DoD:** full release gate (below) green; security tests + D1–D4 fixtures in CI; harness
present on `main`; docs labelled target-vs-shipped. Release note enumerates the cli_path
tightening and the four data-loss fixes with before→after examples.

## Phase 2 — Release 2: the serialization/composition core (minor, `v0.10.0`)

The **verified** interdependent nucleus — serialization inversion (both switch deletions +
registries), claim protocol, resolver-routed composition, dead-registry deletion, the
**post-core-only** deleted-name gate that enforces it — **plus the format-contract body**
WI-0.5 proved core-coupled (`a870a535`, `43a60416`, `dd1c6f01`, `3c04a99d`, `f8292c88`,
`ebc86ca0`: conflict on resolver-shared files or need `FormatConfig.toPlainText`). The
independent slices already shipped in `v0.9.9`/`v0.9.10` (§ Derived release sequence) are
**not** in this nucleus.

**Every final-branch hunk is now assigned** (WI-0.1 + WI-0.5): the multi-domain audit commits
`a6ebf4e1`/`77941c7a` split by file across security (`v0.9.8`), fence (`v0.9.10`,
`codePreview/**`), and nucleus (here, `extensions/**` + pipeline registries); `5483267c` rides
with D1–D4 (`v0.9.8`). None falls through.

**Differential gate — a machine gate, not characterization.** Because D1–D4 shipped in
`v0.9.8` and the `v0.9.9`/`v0.9.10` slices are round-trip-neutral, the nucleus must be
**byte-identical to its immediate predecessor `v0.9.10`**. Enforce with
`EXPECT_IDENTICAL=1 scripts/landing-differential.sh v0.9.10 HEAD` — **any** changed fixture
fails the gate.

**DoD:** the `EXPECT_IDENTICAL` differential vs `v0.9.10` passes (zero changes); every WI-0.3
behavioral gate green (composition snapshots, Source/WYSIWYG, non-md formats, undo/autosave,
perf); the **full** manual-smoke checklist recorded; deleted-name + all enforcement gates
green; version-bump; tag on green CI.

## Rollback & forward-compatibility (format-touching releases)

`git revert` restores *code*, not *documents already rewritten on disk*. A **symmetric**
"no information loss" test is **impossible** for the exact D1–D4 bugs: old VMark *loses*
alt text / link titles / nested-highlight semantics by definition, so new→old→save
necessarily reintroduces the loss. Use a **directional** compatibility contract:

- **old → new → save:** must preserve or repair D1–D4 (the fix works).
- **new → old → open (read-only):** characterize display + in-memory behavior.
- **new → old → edit → save:** *expected lossy* for D1–D4 — documented as unsupported, or
  protected via backup / revision history.
- **`v0.9.8` is the minimum safe serializer baseline.** Never roll production back to raw
  `v0.9.7` once users have adopted `v0.9.8`.
- **An emergency core rollback carries the format-preservation patch forward** — revert the
  architecture nucleus while keeping the D1–D4 fixes; never revert format semantics.
- Prefer a forward hotfix; treat format-output changes as **migrations with fixtures
  spanning released versions**; preserve backups/history.

## Release gate (every release DoD, explicit — not "cargo gates")

`pnpm check:cross` · `cargo fmt --all --check` · `cargo clippy --all-targets -- -D warnings`
· `pnpm check:all` (incl. coverage thresholds) · pre-push hook active (`.githooks/pre-push`)
· branch protection / required checks confirmed (the local hook is bypassable) · **CI green
on the exact tagged SHA** · rule-40 version-bump verified across all 5 files + `Cargo.lock`
+ About dialog + MCP `--version` + MCP health, with a clean-worktree check after lockfile
regen. (`10b62d64`'s own message notes rustfmt was unavailable at verification — do not
assume the host toolchain ran the Rust gates.) · **manual-smoke checklist recorded**
(`landing/manual-smoke-checklist.md` — the slice's rows; the **full** list for `v0.10.0`).

## Phase 3 — Post-landing: command-registry off the fresh `main`

Out of scope for landing. ADR-017 docs land in Phase 1; the *build*
(`20260723-command-registry-unification.md`) starts on a **new short-lived branch off the
post-`v0.10.0` `main`** — never stacked here. One refactor ships before the next begins.

## Machine-checkable DoD

`scripts/check-landing-phase.sh <0|1|1b|2>` (**authored in WI-1.5** from template
`scripts/check-gha-phase.sh`, rule 60 §3) asserts per release: the differential result
(characterization for `v0.9.8`; `EXPECT_IDENTICAL=1` for `v0.9.9`/`v0.9.10`/`v0.10.0`),
per-gate classification honored, full release gate green, manual-smoke recorded, version
consistent + worktree clean + tag-points-at-checked-commit — before each release tag. Phase 0
is already discharged (`landing/phase-0-findings.md`); it needs no script re-check.

## Review

Multi-phase + release-affecting ⇒ Codex cross-model review (rule 60 §6). **Two passes
done.** Pass 1 RETHINK (the subject≠diff manifest error). Pass 2 NEEDS AMENDMENT — 8/12
findings resolved; the 4 partials + 3 new precision findings folded above: hunk-level
manifest (WI-0.1), cumulative-equivalence validation (WI-0.5), final-state security
reconstruction incl. `a6ebf4e1` (WI-1.1), verified-portable D1–D4 (WI-1.2), footprint-driven
behavioral gates (WI-0.3), the completeness rule (Phase 2), and the **directional** rollback
contract (a symmetric "no loss" test is impossible for the D1–D4 bugs). Direction validated;
residual risk is manifest precision + test-contract accuracy, discharged *by* Phase 0 itself.
**Ready to execute Phase 0.**
