# Codebase Audit Summary

**Date:** 2026-02-17
**Branch:** `audit/codebase-2026-02`
**Scope:** Full codebase (~186K lines across 8 chunks)

---

## Totals

| Severity | Count |
|----------|-------|
| **Critical** | **11** |
| **Warning** | **52** |
| **Info** | **24** |
| **Total** | **87** |

## By Chunk

| Chunk | LOC | Critical | Warning | Info | Report |
|-------|-----|----------|---------|------|--------|
| Rust backend | ~10K | 2 | 5 | 3 | [chunk-rust.md](chunk-rust.md) |
| Stores | ~9.5K | 1 | 7 | 5 | [chunk-stores.md](chunk-stores.md) |
| Hooks | ~26.6K | 3 | 5 | 4 | [chunk-hooks.md](chunk-hooks.md) |
| Plugins A-L | ~37K | 0 | 11 | 3 | [chunk-plugins-a-l.md](chunk-plugins-a-l.md) |
| Plugins M-Z | ~37K | 1 | 7 | 3 | [chunk-plugins-m-z.md](chunk-plugins-m-z.md) |
| Components + Styles | ~21K | 0 | 6 | 3 | [chunk-components.md](chunk-components.md) |
| Utils + Export | ~36K | 3 | 7 | 3 | [chunk-utils.md](chunk-utils.md) |
| MCP Server | ~8K | 2 | 6 | 3 | [chunk-mcp.md](chunk-mcp.md) |

---

## Critical Findings (11)

### Security (3)

| ID | File | Issue |
|----|------|-------|
| Plugins-MZ C1 | `mermaidPreview/MermaidPreviewView.ts:474` | **XSS: unsanitized mermaid SVG via innerHTML.** `sanitizeSvg()` is imported but not called on this path. One-line fix. |
| MCP C1 | `vmark-mcp-server/src/cli.ts:231` | **Command injection pattern:** `execSync` with template string interpolation. Use `execFileSync` with arg array. |
| MCP W4 | `vmark-mcp-server/src/tools/media.ts:99` | **URL scheme injection:** `insert_video`/`insert_audio` accept `javascript:` URLs. Add scheme allowlist. |

### Data Integrity (3)

| ID | File | Issue |
|----|------|-------|
| Utils C1+C2 | `src/export/fontEmbedder.ts:141,216` + `resourceResolver.ts:130` | **Stack overflow crash:** `btoa(String.fromCharCode(...data))` on large fonts/images. V8 arg limit is ~65K. Breaks HTML export for math-heavy or image-heavy docs. |
| Stores C1 | `src/stores/aiProviderStore.ts:257` | **Dead migration wipes API keys** (v0->v1 sets `apiKey: ""`). No longer fires (store at v2), but misleading dead code. |
| Plugins-AL W11 | `footnotePopup/FootnotePopupView.ts:278` | **Footnote save strips formatting.** Plain text node created, discarding bold/italic/links. |

### Correctness (5)

| ID | File | Issue |
|----|------|-------|
| Rust C1 | `menu/custom_menu.rs:319` vs `default_menu.rs` | **Menu item missing:** `cleanup-images` absent from default menu. Inaccessible on first launch. |
| Rust C2 | `menu/custom_menu.rs:49` | **Wrong shortcut key:** `"saveAllQuit"` (camelCase) instead of `"save-all-quit"` (kebab-case). Custom shortcuts silently ignored on macOS. |
| MCP C2 | `vmark-mcp-server/src/tools/document.ts:75` | **Dead type guard:** `as string` cast followed by `typeof !== 'string'` check. Found in 6+ tools. |
| Utils C3 | `src/utils/markdownPipeline/adapter.ts:69` | **Unsafe `as Error` cast.** Use ES2022 `new Error(msg, { cause })`. |
| Hooks C1-C3 | `useFileOperations.ts`, `useMcpAutoStart.ts`, `useUpdateChecker.ts` | **Bare `console.log` in production.** 12 calls total fire unconditionally. |

---

## Top Warning Themes

### 1. File Size Violations (~30 findings across all chunks)

The most pervasive issue. Files over 300 lines:

| Lines | File |
|-------|------|
| 1213 | `src/components/Editor/editor.css` |
| 1062 | `src/plugins/toolbarActions/sourceAdapter.ts` |
| 870 | `vmark-mcp-server/src/bridge/types.ts` |
| 784 | `src-tauri/src/mcp_bridge.rs` |
| 774 | `src/hooks/mcpBridge/mutationHandlers.ts` |
| 750 | `src/hooks/mcpBridge/structureHandlers.ts` |
| 744 | `src/plugins/actions/actionRegistry.ts` |
| 738 | `src/plugins/codePreview/tiptap.ts` |
| 701 | `src/hooks/useFileOperations.ts` |
| 660 | `src/hooks/mcpBridge/batchOpHandlers.ts` |
| 615 | `src-tauri/src/mcp_config.rs` |
| 594 | `src/hooks/mcpBridge/suggestionHandlers.ts` |
| 587 | `src-tauri/src/window_manager.rs` |
| 578 | `src-tauri/src/genies.rs` |
| 573 | `vmark-mcp-server/src/cli.ts` |
| 569 | `src/hooks/mcpBridge/index.ts` |
| 564 | `src/hooks/mcpBridge/sectionHandlers.ts` |
| 549 | `src-tauri/src/menu/custom_menu.rs` |
| 543 | `src-tauri/src/menu/default_menu.rs` |
| 538 | `src/plugins/codemirror/smartPaste.ts` |
| 527 | `src/plugins/mermaidPreview/MermaidPreviewView.ts` |
| 521 | `src/stores/settingsStore.ts` |
| 503 | `src/plugins/codemirror/sourceShortcuts.ts` |
| 497 | `src/services/persistence/hotExit/useHotExitRestore.ts` |
| ... | (+ ~15 more in the 300-470 range) |

### 2. Bare `console.*` in Production (~70+ calls)

Biggest offenders: `hotExit/` (41 calls), `codemirror/smartPaste.ts` (14), `useFileOperations.ts` (9), `footnotePopup/FootnotePopupView.ts` (5), `linkPopup/` (8).

### 3. Missing Focus Indicators (Accessibility)

Buttons in Sidebar, FindBar, and StatusBar lack `:focus-visible` styles. Affects all keyboard-only users.

### 4. CSS Token Violations

Handful of hardcoded `rgba()` values bypassing the token system: heading-picker hover, toolbar dropdown shadow, search match colors, StatusBar divergent borders.

### 5. Mutex Poison Handling (Rust)

Three `.lock().unwrap()` calls in production paths (`watcher.rs`, `tab_transfer.rs`, `lib.rs`) should use `.unwrap_or_else(|p| p.into_inner())`.

---

## Healthiest Areas

- **Plugin CSS** — tokens used correctly throughout, `.dark-theme` consistent, focus indicators on all popup buttons
- **MCP bridge error handling** — every handler has try/catch with `respond()` in both paths, proper error narrowing
- **Crash recovery** — proper debug logger, atomic writes, full validation
- **DOMPurify sanitization** — thorough allowlists, XSS-safe
- **Pure business logic** — `openPolicy.ts`, `closeDecision.ts` well-tested
- **Multi-cursor plugin** — well-tested, clean separation, proper cleanup refs

---

## Recommended Fix Priority

### P0 — Fix immediately (security + data integrity)
1. Mermaid XSS: add `sanitizeSvg()` call (1 line)
2. Export stack overflow: chunked base64 encoding (3 locations)
3. MCP URL scheme validation (add allowlist)

### P1 — Fix soon (correctness)
4. Menu item missing from `default_menu.rs`
5. Wrong shortcut key `saveAllQuit` -> `save-all-quit`
6. Footnote save strips formatting
7. Dead type guards in MCP tools (6+ locations)

### P2 — Fix in next sprint (quality)
8. Add missing focus indicators (accessibility)
9. Replace bare `console.*` with debug loggers (~70 calls)
10. Mutex poison recovery in Rust (3 locations)
11. CSS token violations (4-5 locations)

### P3 — Ongoing (maintainability)
12. Split oversized files (25+ files over 300 lines)
13. Remove dead code (4-5 unused exports)
14. Clean up stale comments and migration code
