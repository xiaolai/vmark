# Phase 0 — Findings (manifest audit + separability spike + differential harness)

Plan: `dev-docs/plans/20260723-landing-refactor-to-main.md`. No commit to `main`; all work
in a scratch worktree + a `landing/recon-*` branch off `v0.9.7`. Reproduce the differential
with `scripts/landing-differential.sh`.

## WI-0.1 — Verified manifest
See `WI-0.1-manifest.md`. 54 commits mapped by **actual diff**, not subjects. Cross-unit
commits (`faec8620`, `a6ebf4e1`, `87c0e2ee`, `732ba97c`) split at **file boundaries** — no
intra-file hunk surgery except `package.json` (three gate commits each append one `scripts`
entry). **Correction applied from WI-0.5 below: U9 "format-services" is not one independent
slice.**

## WI-0.2 — Differential (the headline result)
`scripts/landing-differential.sh v0.9.7 HEAD` ran each version's **own** pipeline + schema
on all 22 corpus fixtures and diffed. Result:

- **19 / 22 byte-identical**, 3 changed, 0 errored.
- The 3 changed are **exactly the four documented D1–D4 data-loss reversals**, nothing else:
  | Fixture | Defect | v0.9.7 (loses) | branch (preserves) |
  |---|---|---|---|
  | `14-media.md` | D1 | `![](clip.mp4)` | `![A short clip](clip.mp4)` |
  | `16-inline-marks.md` | D2 | `[link with title](url)` | `[link with title](url "Title")` |
  | `16-inline-marks.md` | D3 | `\==highlight **bold**==` | `==highlight **bold**==` |
  | `17-escaped-markers.md` | D4 | `x^2^` (escapes lost) | `x\^2\^` |

**This proves the plan's core premise:** the decomposition is behavior-preserving; the only
user-visible round-trip change is the four fixes. All four D-defects **are** exercised by the
corpus (D2 lives in `16-inline-marks.md:13`, not only `06-links-images.md`). → validates the
single-baseline design: after D1–D4 ship in `v0.9.8`, the nucleus must be byte-identical to
`v0.9.8`.

**Caveat (honest):** the differential only covers **markdown round-trip**. It says nothing
about Source-mode composition, non-markdown formats, interactive behavior, or Rust — those are
WI-0.3's separate gates.

## WI-0.3 — Behavioral inventory (footprint → gate)
Rule: every production path WI-0.1 found maps to a gate. Coverage sanity: branch has **1282
test files vs v0.9.7's 1272 (+10 net)** — the refactor added tests, dropped none.

| Domain (touched by) | Gate | Status |
|---|---|---|
| Markdown round-trip (pipeline) | `landing-differential.sh` + `roundtrip.characterization` | ✅ built + green |
| Schema completeness / adoption | `schemaCoverage.test` | ✅ exists |
| Extension resolver / claim | 5 `resolve/claim.test` files | ✅ exists |
| Service-tier moves — window/tab/workspace lifecycle, history/recovery, terminal gate, MCP bridge, media (`c41cb916`) | `tsc` (pure import/path move) + **81 test files carried with the move** | ✅ tsc-green on v0.9.7 (WI-0.5) + suites |
| Fence extension point (`870449b9`/`2a84e376`) | `fenceRegistry.test` | ✅ exists |
| SVG (`8edfe830`) | 5 svg test files | ✅ exists |
| Close/save (`da53f8c6`) | 2 closeSave test files | ✅ exists |
| Format-contract body (core-coupled) | format-adapter tests (land with nucleus) | ✅ exists, Phase 2 |
| cli_path security (Rust) | `cli_path_guard.test.rs` (15 tests) | ✅ exists |
| **Interactive / E2E** (undo-redo timing, paste/DnD, split-pane UX, popups) | **manual smoke** — not unit-covered | ⚠️ gap → manual checklist per release |

Net: every domain has a gate; the one genuine hole is interactive E2E, which is inherently
manual (VMark's E2E needs a running app) → each release DoD carries a manual smoke checklist.

## WI-0.4 — Per-gate coupling (verified, not assumed)
| Gate | Coupling | Evidence |
|---|---|---|
| deleted-name (`87c0e2ee`) | **POST-CORE** | `registry.ts`/`manifests.ts` exist at v0.9.7; `registry.ts:77` still defines `pluginsFor` → gate fails until `f64f99d5` deletes them |
| Node-safe seam (`cd5db8f4`) | **pre-core-capable** | `nodeSafe.ts` has zero ProseMirror imports at v0.9.7 → rule passes |
| plugin-isolation + extension-budget (`faec8620`) | **tree-specific** | baseline `maxKnownViolations: 7` snapshots the tree at `faec8620` (which already has service-tier); rides with the tree its baseline matches — land alongside service-tier, not before |
| scope inventory (`9fcb7dd0`) | pre-core-capable | pure inventory script |

## WI-0.5 — Separability (proven; corrects WI-0.1)
Cherry-picked candidate slices onto `v0.9.7`, skipping the nucleus, `tsc` at each step.

**Provably INDEPENDENT of the nucleus** (clean apply + `tsc --noEmit` exit 0):
`1ea49a30` jscpd · `1eaf1db1` corpus-harness · `c41cb916` service-tier (166 files) ·
`4b8a658b` perf-bench · `870449b9`→`2a84e376` fence · `8edfe830` svg · `da53f8c6` closeSave-dup.

**CORE-COUPLED** (conflict on resolver-shared files, or need nucleus-added API — reclassified
from WI-0.1's optimistic "independent"):
`43a60416`, `dd1c6f01`, `3c04a99d` conflict on `sourceEditorExtensions.ts` /
`formats/adapters/markdown.tsx` / `types.ts` (files the resolver commits `e5295559`/`54048c6f`
also change); `f8292c88` needs `FormatConfig.toPlainText` (added in the format-contract
cluster); `a870a535`/`ebc86ca0` are the contract head the above build on.

**Consequence for the plan:** "format-services" is **not** a pre-nucleus independent release.
Only `{jscpd, harness, service-tier, perf, fence, svg, closeSave-dup}` are pre-nucleus
independent. The format-contract body lands **in/after Phase 2** (with the nucleus).

## Phase 0 DoD — status
- ✅ Verified manifest exists (WI-0.1, corrected by WI-0.5).
- ✅ Changed-fixture set characterized ({14,16,17} = D1–D4 exactly).
- ✅ Every footprint domain has an assigned gate (WI-0.3); one honest manual-E2E gap noted.
- ✅ Each candidate slice independence proven or reclassified (WI-0.5).
- ✅ Per-gate coupling classified against real trees (WI-0.4).
- ✅ No commit to `main`.

## Derived release sequence (feeds the Phase 1/2 rewrite)
1. **`v0.9.8`** (patch): security (final cli_path guard) + D1–D4 + safety-net harness +
   pre-core gates (Node-safe seam, scope inventory) + target-vs-shipped docs.
2. **Independent slices** (each its own patch, any order, lowest-risk-first): service-tier,
   fence, svg, closeSave-dup, perf-bench, jscpd + plugin-isolation/budget gate (rides with
   service-tier per WI-0.4).
3. **`v0.10.0`** (minor): the nucleus + format-contract body + deleted-name gate; gate =
   byte-identical to the `v0.9.8` baseline (differential) + all WI-0.3 gates + manual smoke.
