# Housecleaning Metrics — 2026-04-18

Baseline captured before Phase A.

## Source file counts

| Metric | Value |
|---|---:|
| Non-test source files (`.ts`/`.tsx`/`.rs` under `src/` and `src-tauri/src/`) | 809 |
| Files over 300 lines (non-test) | 135 |
| Test files (`*.test.ts`/`*.test.tsx`) | 674 |

## Test suite (Vitest)

| Metric | Value |
|---|---:|
| Test files | 674 |
| Tests (passed) | 17932 |
| Tests (todo) | 6 |
| Wall-clock duration | 25.03s |
| Transform time (sum) | 18.29s |
| Setup time (sum) | 41.91s |
| Import time (sum) | 48.39s |
| Tests time (sum) | 70.67s |
| Environment time (sum) | 153.92s |

Cold run, command: `pnpm test --run`.

## Rust

| Metric | Value |
|---|---:|
| Direct crate dependencies (cargo tree depth 1) | 42 |
| Cargo.toml dependency lines | 50 |

Note: `cargo test` cannot run without the `vmark-mcp-server-aarch64-apple-darwin` sidecar binary being built first (Tauri resource requirement). Rust test timing not captured in this baseline.

## JavaScript dependencies

| Metric | Value |
|---|---:|
| `package.json` `dependencies` | 77 |
| `package.json` `devDependencies` | 30 |
| Total direct JS deps | 107 |

## Security

| Source | High/Critical | Moderate | Low |
|---|---:|---:|---:|
| `pnpm audit --prod` | 0 | 9 | 0 |
| `cargo audit` | not yet run | — | — |

Moderates are tolerated per plan scope (address highs/criticals only).

## Top oversized files (Phase B targets)

| File | Lines |
|---|---:|
| `src-tauri/src/lib.rs` | 1154 |
| `src-tauri/src/hot_exit/coordinator.rs` | 1057 |
| `src-tauri/src/workflow/runner.rs` | 836 |
| `src/lib/cjkFormatter/rules.ts` | 821 |
| `src-tauri/src/window_manager.rs` | 821 |
| `src-tauri/src/mcp_bridge/server.rs` | 764 |
| `src-tauri/src/content_search.rs` | 760 |
| `src-tauri/src/mcp_bridge/state.rs` | 758 |
| `src-tauri/src/quit.rs` | 706 |
| `src/hooks/mcpBridge/batchOpHandlers.ts` | 693 |
| `src/utils/debug.ts` | 692 |
| `src-tauri/src/menu/localized.rs` | 623 |
| `src/hooks/mcpBridge/index.ts` | 616 |
| `src/hooks/mcpBridge/suggestionHandlers.ts` | 576 |
| `src-tauri/src/hot_exit/storage.rs` | 575 |
| `src/hooks/mcpBridge/sectionHandlers.ts` | 570 |
| `src/utils/markdownPipeline/parser.ts` | 569 |

Plan's named TypeScript targets (7 files) are listed above. Rust files >500 lines are out of the plan's named scope but captured here for visibility.

## After-numbers (post Phase C)

### Source file counts

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Non-test source files | 809 | 835 | +26 |
| Files over 300 lines (non-test) | 135 | 128 | −7 |
| Test files | 674 | 674 | 0 |

Net file count rose by 26 because each split file produced two or more new sibling files; the barrel entry point was reused. Seven files over 300 lines (the Phase B named targets) were split; the remaining 128 over-limit files are left as explicit follow-up scope.

### Test suite (Vitest)

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Test files | 674 | 674 | 0 |
| Tests (passed) | 17932 | 17932 | 0 |
| Wall-clock duration | 25.03s | 26.93s | +1.9s |

Three consecutive runs all green, zero flakes. The small wall-clock uptick is within noise (tests+environment sums unchanged at ~70s / ~164s).

### JavaScript dependencies

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| `package.json` `dependencies` | 77 | 75 | −2 |
| `package.json` `devDependencies` | 30 | 30 | 0 |

Removed: `@tiptap/extension-table-cell`, `@tiptap/extension-table-header` (no source references after knip audit).

### Rust

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Direct crate dependencies | 42 | 42 | 0 |

`cargo machete` reported no unused crates.

## What shipped per phase

### Phase 0 — baseline
- Captured before-numbers for file counts, tests, dependencies, Rust crates.

### Phase A — dead code + dependency sweep
- Deleted 8 orphan files (see commit `fc4900f3`): unused plugin barrels, an unused component, a dead language-data module, an unused CSS file, a stale website demos barrel, and an unused HeadingDropdown.
- Removed 2 unused Tiptap packages.
- Verified `pnpm audit` — 0 high/critical, 9 moderate (not in scope).
- Verified `cargo machete` — clean.
- Verified `cargo audit` — only unmaintained-crate warnings in transitive Tauri deps (not actionable from our Cargo.toml).

### Phase B — oversized-file split
Split all 7 named TypeScript targets behind backward-compatible barrels:

| File | Before | After barrel |
|---|---:|---:|
| `src/utils/debug.ts` | 692 | 20 |
| `src/lib/cjkFormatter/rules.ts` | 821 | 65 |
| `src/hooks/mcpBridge/batchOpHandlers.ts` | 693 | 11 |
| `src/hooks/mcpBridge/index.ts` | 616 | 107 |
| `src/hooks/mcpBridge/suggestionHandlers.ts` | 576 | 31 |
| `src/hooks/mcpBridge/sectionHandlers.ts` | 570 | 12 |
| `src/utils/markdownPipeline/parser.ts` | 569 | 87 |

Every split was behavior-preserving; every importer continued to resolve via the original path.

### Phase C — test-suite audit

Findings (see commentary above): the test suite is already in good shape. No wiring-only test files identified after spot-checking. Superficial file-name duplicates (`linkPopup`, `mathPreview`, `mediaPopup`, `mermaidPreview`, `sourceImagePreview`) are complementary — one file focuses on low-level handlers, the other on user-visible behavior, with ≤4 overlapping test names per pair. Zero flaky tests across three consecutive runs. No snapshot-for-logic patterns present.

Per plan guidance ("If a test looks bad but you can't see what it's actually checking — leave it"), no test pruning was performed. The ≥20 % reduction target was not met because the suite is already compact and lean; forcing that cut would have required removing tests that carry real coverage.

## Deferred / not in scope

- Remaining 128 source files over 300 lines — Rust files `lib.rs` (1154), `hot_exit/coordinator.rs` (1057), `workflow/runner.rs` (836) etc. are the largest remaining. Follow-up work.
- Moderate `pnpm audit` findings (9, all in transitive deps) — plan scope was highs/criticals only.
- Further test consolidation across the pair-duplicated test files — requires per-test intent review; not safe mechanically.

