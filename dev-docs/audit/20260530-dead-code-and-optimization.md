# Audit: Dead Code & Optimization (multi-round)

**Date:** 2026-05-30
**Status:** Active
**Scope:** whole repo — `src/` (~977 non-test TS/TSX, 103 CSS), `src-tauri/src/` (81 Rust files), build/deps.
**Method:** `knip` (unused files/exports/deps), `cargo check` (zero dead-code warnings), `depcruise`, plus parallel deep-dive agents per perspective. Every claim grep-verified before listing. False positives are recorded explicitly so they are not re-chased.

This is a living document — each investigation round appends a section. Nothing here is applied yet; it is a backlog.

---

## Round 1 — Dead code & performance

### 1A. Dead CSS (largest cluster; CSS-in-JS tools can't parse decoration-applied classes)

| Finding | Location | Size | Confidence |
|---|---|---|---|
| Entire `source-popup-shared.css` unused (~28 selectors) — every source popup uses its own classes | `src/styles/source-popup-shared.css` (whole 230-line file) | Large | High |
| `.math-block*` — block-math never implemented (only inline math ships) | `src/plugins/latex/latex.css:112-188` | Large | High |
| `.mermaid-block*` — superseded by `mermaid-preview-*` | `src/plugins/mermaid/mermaid.css:69-149`, `mermaid-fallback.css:26-92` | Large | High |
| `.files-view` / `.sidebar-file*` cluster — superseded sidebar view | `src/components/Sidebar/Sidebar.css:132-219` | Medium | High |
| `.lint-gutter-*` / `.lint-line-*` — abandoned CM-style lint (only block decorations ship) | `src/plugins/lint/lint.css:12-41` | Medium | High |
| `.popup-container--vertical`, `.popup-btn-row`, `.popup-input-row` | `src/styles/popup-shared.css:24,146,163` | Small | High |
| dead `syntax-marker` math/image variants | `src/plugins/syntaxReveal/syntax-reveal.css:49-50,60-61,67-70` | Small | High |
| dead `syntax-marker` sub/superscript variants | `src/plugins/subSuperscript/sub-super.css:18-21` | Small | High |
| `.provider-switcher-badge*`, `.provider-switcher-item--unavailable` | `src/components/GeniePicker/genie-picker.css:408,427,435,506` | Small | High |
| `.pm-selection-persist` / `.pm-selection-pulse` (removed feature) | `src/components/Editor/editor.css:122,126,139-140,713-714` | Small | High |
| `.table-overflow`, `.code-overflow` (export uses `*-wrapper`) | `src/export/exportStyles.css:68-69` | Small | High |
| `.export-warning-banner` (+ svg/media variants) | `src/export/exportStyles.css:97,111,116` | Small | High |
| `.heading-picker-close` (closes via Escape/blur, no button) | `src/components/Editor/heading-picker.css:48` | Small | High |
| `.source-peek-inline-error` | `src/plugins/sourcePeekInline/source-peek-inline.css:185,206` | Small | High |
| `.wiki-embed` (plugin uses `wiki-link`) | `src/plugins/markdownArtifacts/markdown-artifacts.css:15` | Small | High |
| dead CSS vars: `--sidebar-width`, `--duration-slow`, `--line-height-tight` | `src/styles/index.css:32,231,210` | Trivial | High |

### 1B. Dead Rust / Tauri commands (registered → compiler can't warn; zero callers)

| Command | Registered | Verdict |
|---|---|---|
| `mcp_server_start` / `mcp_server_stop` | `src-tauri/src/lib.rs:645-646` | Dead — frontend uses `mcp_bridge_start/stop` (`useMcpServer.ts:91,108`) |
| `mcp_config_get_status` | `lib.rs:653` | Dead — frontend only calls `mcp_config_diagnose` |
| `open_folder_dialog` | `lib.rs:639` | Dead — frontend uses `@tauri-apps/plugin-dialog` `open()` directly |
| `cli_install*` `#[tauri::command]` | `lib.rs:695-699` | Called only internally from Rust → drop the command attr/registration, keep as `pub fn` |
| `restore_snapshot` / `list_snapshots` | `workflow/snapshots.rs:99,174` (`#[allow(dead_code)]`) | Parked half-feature — **decision needed**: finish workflow-undo or delete (snapshots are written but never restored/listed) |

`#[allow(dead_code)]` that are legitimately kept (do NOT remove): `workflow/types.rs:18,49,69,133` (serde targets), `ai_provider/mod.rs:28-36` (macro re-export resolution), `lib.rs:144,180` (platform-gated).

### 1C. Dead TypeScript exports (knip + grep-verified samples)

- **mcpBridge v1 `utils.ts` cluster** — ~10 exported helpers (`getDocumentContent`, `resolveNodeId`, `getTextRange`, …) **superseded by `mcpBridge/v2/`**, zero callers. Whole v1 `utils.ts` likely removable (verify `handleRequest.ts` fully delegates to v2 first). High value.
- `useSourceEditorShowInvisiblesSync` (`useSourceEditorSync.ts:249`) — zero callers anywhere.
- `runUpdateCheck` / `runUpdateDownload` (`useUpdateOperations.ts:72,130`) — only tests call them.
- `orphanCleanupWarn` (`utils/debug/warn.ts:162`) — only a test references it (sibling `orphanCleanupError` is used).
- Redundant `export default` on ~15 components imported by name (`SourcePane`, `SplitPaneEditor`, `Editor`, `Tab`, `StatusBar`, …) — safe micro-sweep.
- Unused dependency **`@actions/expressions`** — referenced only in a code comment (`lib/ghaWorkflow/eval/staticIf.ts:15`).

### 1D. Optimization — ranked

| # | Sev | Finding | Location | Fix |
|---|---|---|---|---|
| O1 | **High** | `codePreview` runs a full-document `descendants()` scan on **every keystroke** in prose-only docs (both fast-path guards require a non-empty decoration set) | `src/plugins/codePreview/tiptap.ts:419` (guards `:362,:380`) | Early-return when `codeBlockRanges.length === 0` after a cheap top-level check |
| O2 | **High** | `detect_ai_providers` is a sync command spawning 3 subprocesses (`which`×3) on the IPC thread → UI stall | `src-tauri/src/ai_provider/detection.rs:19` | `async` + `spawn_blocking` + memoize (session-stable) |
| O3 | High | `turndown` + gfm plugin eagerly bundled into the editor chunk for an HTML-paste-only feature | `src/utils/htmlToMarkdown.ts:8-9` → `htmlPaste/tiptap.ts:24` | Lazy `import()` inside the paste handler |
| O4 | Medium | `list_directory_entries`: up to 10,000 sync `stat` calls on the IPC thread per folder expand | `src-tauri/src/file_tree.rs:58,83` (`MAX_DIR_ENTRIES=10000`) | `async` + `spawn_blocking`; skip `metadata()` for dotfiles |
| O5 | Medium | `OutlineView` reconciles the whole heading tree on every cursor move (item not memoized, callbacks unstable) | `src/components/Sidebar/OutlineView.tsx:24,172,188` | `React.memo` + `useCallback` |
| O6 | Medium | Every lint rule independently `source.split("\n")` (~13×/pass); `noUndefinedRefs` O(L²) | `src/lib/lintEngine/rules/*`, `linter.ts:27` | Split once in orchestrator; precompute line offsets; hoist regex |
| O7 | Low | `flushToStore` full `serializeMarkdown` per idle flush — structural ceiling on huge docs (already debounced) | `TiptapEditor.tsx:202` | Known limitation; incremental serialization is a larger change |
| O8 | Low | `stripMarkdown` 13 regex passes for word count; `multiCursor` full-doc walk with `bounds`; `lint` regex-per-node | various | Optional micro-fixes |

### 1E. Verified false positives — do NOT chase
- knip "45 unused files": almost all false positives — `.claude/hooks/` (Claude Code), `scripts/*` (npm/CLI), `website/.vitepress/*` (vitepress entry), `src/bench/*` (vitest bench). Entry-point blind spots, not dead.
- knip "unused devDeps" (`@tauri-apps/cli`, `@hypothesi/tauri-mcp-server`, `esbuild`, `@yao-pkg/pkg`): used via wrapper/CLI/build, not imports.
- Dead barrel *re-exports* (e.g. `useCommandPaletteStore` via `index.ts`): symbol is used via direct import; only the re-export line is redundant. Cosmetic.
- No commented-out code blocks, no `*Legacy*`/`*.bak` files. Narrow Zustand selectors used consistently. Build already well-chunked (mermaid/katex/xyflow/codemirror-langs lazy). Editor update path already heavily optimized (adaptive debounce, `content-visibility`, `shouldRerenderOnTransaction:false`).

---

## Round 2 — Type safety, duplication, dependency weight, resource lifecycle

Headline: the codebase is unusually disciplined — 0 `@ts-ignore`, narrow selectors throughout, exemplary listener/timer/editor teardown. Findings are concentrated in (a) boundary-validation gaps, (b) a few high-payoff duplication clusters, and (c) two eager-bundle wins.

### 2A. Type safety & boundary trust

| # | Sev | Finding | Location |
|---|---|---|---|
| T1 | High | `invoke<T>()` IPC results trusted with compile-time-only types, no runtime validation (~40 sites) — zero-trust-at-boundary gap. Highest blast radius: workspace config, MCP install/health, session/hot-exit data | `useMcpHealthCheck.ts:61`, `openWorkspaceWithConfig.ts:25`, `WindowContext.tsx:130`, `McpConfigInstaller.tsx:199` … |
| T2 | High | `listen<T>()` event payloads trusted (~25 sites). Worst: `mcpBridge` flow is externally driven; `raw.type`/`raw.id` read unguarded before parse try/catch | `mcpBridge/index.ts:66-73`, `useGenieInvocation.ts:256`, `useWorkflowExecution.ts:61` |
| T3 | Medium | Cross-tab `StorageEvent` merged into settings store unvalidated (`JSON.parse` then `setState`) — only parse is guarded, not shape | `useSettingsSync.ts:50-69` |
| T4 | Medium | `as unknown as` double-casts over persisted/3rd-party JSON | `aiStore/provider.ts:230` (persist migrate), `settingsStore.ts:286-288`, `secureStorage.ts:49` |
| T5 | Medium | ~30 `querySelector/.closest(...) as HTMLElement` (non-nullable) — `.closest()` returns null on detached nodes; throws during editor teardown | `imagePreview/ImagePreviewView.ts:98`, `mathPreview/MathPreviewView.ts:74`, `footnotePopup/FootnotePopupView.ts:197`, `bookmarkLinkCommand.ts:50`, … |

Verified clean: all `!` non-null assertions safe; error-narrowing rule honored throughout; no TS suppressions; all `eslint-disable` reasoned.

### 2B. Duplication & missing abstractions (~450-500 lines recoverable)

| # | Payoff | Finding | Fix |
|---|---|---|---|
| D1 | High | `error instanceof Error ? error.message : String(error)` — **126 occurrences** | Extract `utils/errorMessage.ts`; codemod (~120 lines) |
| D2 | High | MCP v2 handler `try/catch → respond({success:false})` repeated ~15× verbatim | `wrapHandler(id, fn)` in `mcpBridge/v2/` (~90 lines) |
| D3 | High | **`IMAGE_EXTENSIONS` defined 4× with DIVERGENT contents** (avif/bmp/ico disagree) — latent correctness bug, not just DRY. VIDEO/AUDIO dup 3× too | Single `utils/mediaExtensions.ts` (dotted + bare) |
| D4 | Medium | `buildIconButton` reimplemented in 6 popup views despite shared `buildPopupIconButton` | Delete 6, call shared builder (~60 lines) |
| D5 | Medium | Click-outside guard hand-rolled in 5 components despite `useDismissOnOutsideOrEscape` hook | Migrate (add `deferActivation` flag) (~50 lines) |
| D6 | Medium | No generic `debounce` — 2 bespoke controllers + ~15 inline timers | `utils/debounce.ts`; rebuild controllers on it |
| D7 | Medium | Rust `app_data_dir().map_err(...)` repeated 6×; atomic-write implemented twice divergently (one leaks temp files on early error) | `app_data_dir()` + `atomic_write()` helpers in `app_paths.rs` |
| D8 | Low | `getFileName` ×2 (different semantics) + inline `.split("/").pop()`; footnote textarea dup; Rust `contains("..")` ×3 | Consolidate carefully (preserve Windows `\` + symlink ordering) |

Non-findings (do NOT over-DRY): source vs WYSIWYG toolbar adapters (intentional strategy split), 131 Rust `map_err(format!)` (idiomatic per rule 50), `safeStorage` vs `secureStorage` (different concerns).

### 2C. Dependency & bundle weight

| # | Est. saved | Finding | Action | Risk |
|---|---|---|---|---|
| B1 | **~2.3 MB off eager** | `vendor-mermaid` (1.67MB) + `vendor-graph`/cytoscape (644KB) eagerly preloaded because a tiny exported `_` helper is statically imported (team's own documented TODO in `.size-limit.cjs:108`) | Extract the `_` helper to a micro-chunk so both become truly lazy | Medium (don't re-split mermaid internals) |
| B2 | up to ~1.6 MB off eager | Verify `ghaWorkflow/detection.ts` (`isWorkflowYaml`, statically imported by `codePreview/tiptap.ts:68`) doesn't transitively pull `@actions/workflow-parser` (1.6MB) into the eager editor chunk | Confirm with `pnpm size:why`; if leaking, make detection a string/regex check | Low |
| B3 | ~460 KB dep | Dual YAML libs: `js-yaml` (parse-only) + `yaml` 2.x (CST/round-trip). Migrate 2 `js-yaml.load()` sites to `yaml.parse()`, drop `js-yaml` + `@types/js-yaml` | Migrate + test YAML/workflow fixtures | Low-Med |
| B4 | dev-only | `@types/katex` redundant — katex ships its own types | Remove from devDeps | Very low |

No action: `lucide-react` (named imports tree-shake fine), `highlight.js`/`lowlight` (shared, selective grammars — exemplary), no polyfills, `alfaaz` justified (CJK word count), zustand v4 via xyflow correctly quarantined to lazy chunks.

### 2D. Resource lifecycle (very clean — only 3 minor)

| # | Sev | Finding | Location | Fix |
|---|---|---|---|---|
| R1 | Low-Med | `previewCache` (`Map` keyed `${lang}:${content}`) has **no cap, no LRU**, never cleared on tab-close/unmount — grows per-keystroke while editing mermaid/svg/latex/markmap/workflow blocks; survives the session | `codePreview/tiptap.ts:97` | LRU cap (~100) or clear on last-view `destroy()` |
| R2 | Low | `ghaWorkflow` `sessionCache` unbounded outside test-only `clear()` | `actions/registry.ts:89` | Bound / clear on workflow-tab close |
| R3 | Low | `pendingSaves` clear not in `finally` — write throwing before clear leaves a stale entry (one per path) | `pendingSaves.ts:41`, `saveToPath.ts:88` | Wrap clear in `finally` |

Everything else verified clean: editor `.destroy()` on all paths, `safeUnlistenAsync` for unmount races, refs-based listener cleanup, `cleanupTabState()` on all close paths, bounded history stores.

---

## Round 3 — Rust panic-safety, concurrency/races, accessibility, test gaps

This round surfaced genuine **bugs** (not just debt): a CJK char-boundary panic, an orphan-document race, and a genie execution-id race. Backend is otherwise very disciplined (poison-tolerant locks, `Result<T,String>` discipline, documented `unsafe`); frontend has strong race-token/cancel-guard and a11y baselines — the items below are where that discipline is absent.

### 3A. Rust panic safety

| # | Sev | Finding | Location | Trigger / Fix |
|---|---|---|---|---|
| P1 | **High (bug)** | `contains_with_boundary` advances `start = abs + 1` after a match, slicing mid-character | `src-tauri/src/pdf_export/bookmarks.rs:251` (panics `:236`) | PDF export with bookmarks on any doc with a CJK heading → `haystack[start..]` panics. Fix: `start = abs + nlen` (advance past whole match) |
| P2 | Medium (bug) | `parse_timeout` does `split_at(len-1)` to peel unit; multibyte suffix (`"300秒"`, emoji) panics | `src-tauri/src/workflow/step_config.rs:46` | User-authored workflow `timeout:` value. Fix: peel via `chars().next_back()` + `len_utf8()` |
| P3 | Medium | Only production panicking lock: `.lock().expect("…poisoned")` (×3) — poisons → cascade-panic | `src-tauri/src/workflow/approval.rs:39,51,65` | Switch to `.lock().unwrap_or_else(\|p\| p.into_inner())` (codebase standard) |

Verified safe: `content_search.rs` slicing (regex/char-aligned), `genies/parsing.rs` ASCII slices, `runner.rs` `truncate_utf8_safe`, `login_shell_from_passwd` FFI, all 35 `unsafe` blocks (documented, invariants upheld). 298 `.unwrap()`/100 `.expect()` are overwhelmingly `#[cfg(test)]`.

### 3B. Concurrency & races

| # | Sev | Finding | Location | Fix |
|---|---|---|---|---|
| C1 | **High (bug)** | `initDocument` writes `[tabId]: doc` **unconditionally** (unlike every sibling mutator using the `updateDoc` missing-key guard). Closing a tab during the `await readTextFile` in open → read resolves → resurrects an orphan document entry | `documentStore/document.ts:156-166` + `useFileOpen.ts:60-122` | Guard on tab existence / generation token before the post-read write |
| C2 | **High (bug)** | Genie workflow `invoke("run_workflow")` **without** pre-generated `executionId`, then `setExecution` after — fast runner emits step/complete events filtered by a still-null id → lost progress / stuck "running". `useWorkflowExecution.start` already fixed this pattern; genie path missed it | `useGenieInvocation.ts:391-397` | Pre-generate id, `setExecution(id)` before invoke, pass `executionId` |
| C3 | Medium | Finder hot-open TOCTOU: `FRONTEND_READY.store(true)` then `drain()` as two steps → open landing between can drop/double-open. `menu_events.rs` `check_ready_or_queue` is the correct template | `lib.rs:92-97,916-977` | Flip ready + drain under one lock |
| C4 | Medium | Genie streaming applies AI result to captured `from/to` on `getState().tiptap.editor` (fresh) — tab switch/edit during stream lands edit in wrong doc/range | `useGenieInvocation.ts:235-327` | Verify captured tabId == active before dispatch; else abort/convert-to-suggestion |
| C5 | Medium | MCP `document.write` validates a **global** revision but writes a resolved (maybe non-active) tab → false STALE or missed staleness | `mcpBridge/v2/document.ts:282-303`, `revisionTracker.ts:21-31` | Per-tab revision keying |
| C6 | Low | `useExternalFileChanges` auto-reload (narrow window, mitigated by post-await `doc` re-read); `useAutoSave` edit-during-save mis-flag (M5); `useSourceEditorSync` interval stale pending; `cancel_workflow` ignores `execution_id` | various | Defensive re-reads / honor execution_id |

Already-guarded (verified correct): content-search race token, workflow event id-filtering, `check_ready_or_queue`, AI invocation CAS lock, runner `compare_exchange`+RAII, sidecar spawn atomic, watcher debounce, quit gate, tab-close reentry set, PTY double-start guard.

### 3C. Accessibility (strong baseline — roving tabindex, focus restore, aria-modal widespread)

| # | Sev | Finding | Location | Fix |
|---|---|---|---|---|
| A1 | **High** | `ImageContextMenu` items are `<div onClick>` — no `role`, `tabIndex`, key handler; container no `role="menu"`. Entirely mouse-only, invisible to AT | `ImageContextMenu.tsx:110-127` | Mirror `TabContextMenu`/FileExplorer `ContextMenu` (correct templates, same CSS) |
| A2 | Medium | FindBar regex/case/word toggles signal state by CSS class only — no `aria-pressed` (`ContentSearch.tsx:340` does it right) | `FindBar.tsx:176-200` | Add `aria-pressed` |
| A3 | Medium | CommandPalette: no focus restore on close; `role=dialog` missing `aria-modal`; no `combobox`/`aria-activedescendant` (QuickOpen is the template) | `CommandPalette.tsx:37-145` | Add `previousFocusRef` restore + aria |
| A4 | Low | Missing `role=option`/`aria-selected` on ContentSearch & PromptHistory rows; `frontmatterPanel` header no `aria-expanded` + textarea no label; ProviderSwitcher no `aria-haspopup`/focus-move; UniversalToolbar AI-Prompts button `tabIndex={-1}` may be keyboard-unreachable (verify live); FileNode rename input no `aria-label` | various | Incremental aria hardening |

### 3D. Test quality & coverage gaps

| # | Sev | Finding |
|---|---|---|
| TQ1 | High | `useWorkspaceBootstrap.ts` (startup crash-recovery / tab restore, 2 silent `catch{}`) — **zero tests**; regression silently fails workspace restore |
| TQ2 | High | `mcpBridge/utils.ts` (`findTextMatches`/`getTextRange`/`resolveNodeId`) untested + latent **emoji/surrogate boundary bug** (`pmTo = pmFrom + pattern.length` uses UTF-16 length → wrong PM positions for astral chars). Note overlap: this is the v1 utils flagged dead in 1C — confirm v2 supersedes before relying on it |
| TQ3 | High | `genies/parsing.rs` (frontmatter parser for user files) & `documentStore/unifiedHistory.ts` (cross-mode undo, `MAX_CHECKPOINTS=50` eviction) — both untested; undo-stack regression loses edits |
| TQ4 | Medium | `markdownPipeline/performance.test.ts` confirmed flaky — skips only on `process.env.CI`, runs in local `check:all` with wall-clock thresholds. Fix: gate on `PERF=1` opt-in or separate non-parallel project. (~25 other files use real `setTimeout` delays — secondary flake class) |
| TQ5 | Medium | Untested: `genies/scanning.rs`, `ai_provider/detection.rs` (`read_env_api_keys` is pure/testable), `tab_transfer.rs` (extract pure rect hit-test to make testable) |

Calibration: no systemic over-mocking or wiring-only-test problem. Note: rule `10-tdd.md` cites `src/utils/closeDecision.ts` which **does not exist** (logic is in `hooks/closeSave.ts`) — worth correcting the rule doc.

---

## Cross-round priorities (what to do first)

**Bugs to fix (correctness, not debt):**
1. **P1** — CJK heading → PDF-bookmark export panic (`bookmarks.rs:251`). One-line fix, real crash.
2. **C1** — orphan document on close-during-open (`initDocument` guard). Reproducible.
3. **C2** — genie workflow execution-id race (mirror the existing fix).
4. **P2/P3** — multibyte `timeout` panic; approval-lock poisoning.
5. **TQ2** — emoji/surrogate offset bug in MCP text matching (if v2 path is live).

**High-value, low-risk cleanups (good first cleanup branch):**
- **1A** dead CSS sweep (whole `source-popup-shared.css` + `.math-block*`/`.mermaid-block*` + ~12 selectors + 3 vars).
- **1B** dead Tauri commands (`mcp_server_start/stop`, `mcp_config_get_status`, `open_folder_dialog`).
- **D1** `errorMessage()` helper (126 sites) + **D3** unify divergent extension lists (closes a latent bug).
- **B4** drop `@types/katex`; **1C** `@actions/expressions` + verified-dead exports.

**Performance:**
- **O1** codePreview per-keystroke scan; **O2/O4** Rust IPC-thread blocking → async; **B1** mermaid `_` helper extraction (~2.3 MB off eager preload).

**a11y:** **A1** ImageContextMenu keyboard support (the one real gap).

Suggested sequencing: bugs first (small, high-value) → dead-code/CSS sweep (large, low-risk) → perf (O1, B1) → duplication refactors (D1/D3) → a11y + test-gap backfill.
