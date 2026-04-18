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

## After-numbers

_To be appended after Phase C completes._
