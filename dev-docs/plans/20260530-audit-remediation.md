# Audit Remediation — Dead Code, Optimization, Correctness & Hardening

> Created: 2026-05-30
> Revised: 2026-05-30 (post-Codex review — corrected WI-1.3/1.4 stale dead-code claims, added Phase -1 stability gate, restored dropped findings O3/B2/C3-C5/snapshot, tightened race-closure ACs and codemod scope; see §7)
> Status: **Implemented (2026-05-30)** on branch `chore/audit-remediation`, one commit per WI.
> Phases -1, 0, 1, 3, 4, 5 fully done; Phase 2 done except WI-2.6 (aborted per its DoD —
> `size:why` unavailable in this vite/esbuild setup) and WI-2.8 (deferred — lazy-turndown
> needs an async-claim paste refactor that changes a core-UX contract, unverifiable here).
> WI-2.9 measured (no leak), WI-1.5/0.7 decisions recorded. Backend `cargo test` 594 green;
> frontend `pnpm check:all` green.
> Source: `dev-docs/audit/20260530-dead-code-and-optimization.md` (3-round, grep-verified audit). Finding IDs (P1, C1, D3, O1, …) below reference that doc.
> Branch: (per-phase feature branches; see §6)

## 1. Executive summary

A 3-round whole-repo audit produced a verified backlog spanning correctness
bugs, dead code, performance, duplication, type-safety, lifecycle, accessibility,
and test gaps. This plan sequences the remediation into **6 phases**, ordered by
risk-adjusted value: **bugs first** (small, high-value, regression-tested), then
**low-risk deletions** (dead code), then **performance**, **duplication
refactors**, **hardening**, and **test backfill**.

Guiding constraints:
- Every phase ends `pnpm check:all` green and is independently shippable.
- Bug WIs are **TDD**: a failing regression test (RED) precedes the fix (rule 10).
- Dead-code WIs re-verify with `knip`/grep + the gate after removal — deletion is
  proven, not assumed.
- Refactor WIs are behavior-preserving codemods; the existing suite is the net.
- No WI mixes a bug fix with a refactor in the same commit.

Estimated delta: net **negative** LOC (≈ −600 to −900 lines from dead-code +
duplication removal), plus ~18 small fixes and **~18–22 new/updated test
artifacts** (re-estimated per-WI after Codex review — Phase 0 TDD + Phase 4
validators + Phase 5 backfill each carry their own tests).

## 2. Architecture decisions (ADRs)

**ADR-1 — Phase ordering is risk-first, not value-first.** Correctness bugs ship
before cosmetic cleanups even though cleanups touch more lines, because a CJK
export panic (P1) or orphan-document leak (C1) is user-visible and a regression
test locks it. Dead-code deletion is deferred to Phase 1 (after bugs) so a
revert during bug-fixing never tangles with large deletions.

**ADR-2 — Boundary validation is scoped, not universal.** T1/T2 flagged ~65
`invoke`/`listen` sites trusting typed payloads. We will **not** migrate all of
them to runtime schemas (over-engineering; the Rust side is the sole producer and
is test-covered). We validate only the **externally-driven or
highest-blast-radius** payloads: the MCP request stream (`mcpBridge`), workspace
config, AI response chunks, and session/hot-exit restore data. Everything else
stays typed-trust with a one-line note. Validators are hand-written shape guards
(no new `zod` dependency unless a payload is large enough to justify it).

**ADR-3 — `mcpBridge/utils.ts` is partially live; resolve per-symbol, not
per-file (corrected per Codex #2).** The file exports a **live `respond`**
(imported by `handleRequest.ts:20` + `v2/document.ts:57`) alongside helpers that
1C flagged dead and TQ2 flagged buggy (the emoji-offset `findTextMatches`).
WI-0.7 determines whether the v1 text-match helpers are still on any code path.
If the buggy helper is **live** → fix the offset + test (Phase 0). If **dead** →
delete it (Phase 1, WI-1.4). Either way `respond` (and any other still-imported
export) **stays**. There is no "delete the whole file" option.

**ADR-4 — Duplication refactors extract, then codemod, then delete — in one PR per
cluster.** Each shared helper (`errorMessage`, `wrapHandler`, `mediaExtensions`)
lands with its call-site migration and the old inline copies removed in the same
change, so the gate proves equivalence. The `errorMessage` codemod (126 sites) is
mechanical and reviewed as a single diff.

**ADR-5 — Bundle work is measured, not speculative.** B1/B2 savings are estimated
from `dist/` artifacts; before acting, each is confirmed with `pnpm size:why`.
B1 (mermaid `_` helper extraction) follows the documented-safe path (extract the
helper, do **not** re-split mermaid internals — prior attempts broke prod).

**ADR-6 — Accessibility changes mirror existing correct siblings.** A1
(ImageContextMenu) is rebuilt from the `TabContextMenu`/FileExplorer `ContextMenu`
templates (same CSS, proven pattern), not invented.

## 3. Phases & work items

Severity tags map to the audit doc. Each WI lists **scope**, **change**,
**acceptance criteria (AC)**, and **test** requirement.

---

### Phase -1 — Pre-flight: stabilize the gate (Codex #4)

DoD: `pnpm check:all` is deterministic under full-suite load (no perf-test flake).
This lands first because every later phase's DoD depends on a green gate.

**WI-(-1).1 — Stabilize the flaky perf test (was WI-5.3; TQ4).**
- Scope: `src/utils/markdownPipeline/__tests__/performance.test.ts` (skips only on `process.env.CI`, so it runs — and flakes — in local `check:all` under CPU contention).
- Change: gate behind a `PERF=1` opt-in (default-skip locally and in `check:all`), or move it to a separate non-parallel Vitest project.
- AC: 5 consecutive `pnpm check:all` runs are green with no perf-test failure; the perf check is still runnable on demand.
- Test: the gate itself; document the 5× green run in the WI.

---

### Phase 0 — Correctness bugs (TDD; ship first)

DoD: all WIs have a RED-then-GREEN regression test; `pnpm check:all` green;
`cargo test --manifest-path src-tauri/Cargo.toml` green; no behavior change beyond
the fixed paths.

**WI-0.1 — Fix CJK char-boundary panic in PDF bookmark export (P1, High).**
- Scope: `src-tauri/src/pdf_export/bookmarks.rs:251` (`contains_with_boundary`).
- Change: advance `start = abs + needle.len()` (past the whole match) instead of `abs + 1`.
- AC: exporting a PDF with bookmarks from a doc containing a CJK heading (e.g. `## 第一章`) does not panic; ASCII behavior unchanged. **Invariant: UTF-8 char-boundary safety** is primary; heading occurrences are treated as non-overlapping (advancing past the whole match cannot skip a *distinct* heading because headings don't overlap) — document this in the test (Codex #6).
- Test: Rust unit test calling `contains_with_boundary` with a CJK needle that previously panicked, plus a case asserting the non-overlapping advance finds a second later occurrence.

**WI-0.2 — Fix orphan-document resurrection on close-during-open (C1, High).**
- Scope: `src/stores/documentStore/document.ts:156-166` (`initDocument`), caller `src/hooks/useFileOpen.ts:60-122`.
- Change: **minimal** guard (no new token machinery — Codex #5) — `initDocument` checks tab existence in `tabStore` at write time and no-ops if the tab is gone (or the caller re-checks immediately before the post-read write). Mirrors the `updateDoc` missing-key guard the sibling mutators already use.
- AC: closing a tab while its file read is in flight leaves **no** document entry for that tab; normal open still initializes.
- Test: (a) store unit test createTab → (tab removed) → initDocument → assert no orphan entry; **and (b) an integration test on the `useFileOpen` close-during-read path** (read in flight → tab closed → read resolves → assert no orphan), not just the store unit.

**WI-0.3 — Fix genie workflow execution-id race (C2, High).**
- Scope: `src/hooks/useGenieInvocation.ts:391-397`.
- Change: pre-generate `executionId`, `setExecution(id)` before `invoke("run_workflow", …)`, pass `executionId: id`; roll back on reject. Mirror `useWorkflowExecution.start:136-153`.
- AC: a fast-completing genie-launched workflow shows step progress and reaches a terminal state (no stuck "running").
- Test: **race-closure test (Codex #7)** — drive `workflow:step-update`/`workflow:complete` events that arrive *before* the `invoke` promise resolves, and assert the events are attributed to the execution (not dropped) and no stuck "running" state remains. (Call-order alone is necessary but insufficient.)

**WI-0.4 — Fix multibyte `timeout` panic in workflow step config (P2, Medium).**
- Scope: `src-tauri/src/workflow/step_config.rs:46` (`parse_timeout`).
- Change: peel the unit via `chars().next_back()` + `len_utf8()` instead of `split_at(len-1)`.
- AC: `timeout: "300秒"` / trailing emoji returns an error, does not panic.
- Test: Rust unit test with multibyte-suffix inputs.

**WI-0.5 — Make approval-registry locks poison-tolerant (P3, Medium).**
- Scope: `src-tauri/src/workflow/approval.rs:39,51,65`.
- Change: `.lock().unwrap_or_else(|p| p.into_inner())` (codebase standard) on all three.
- AC: a panic while holding the lock does not cascade-panic the approval feature.
- Test: Rust test that poisons the mutex then asserts subsequent `register`/`respond` still work.

**WI-0.6 — Unify divergent media-extension lists (D3, correctness).**
- Scope: `utils/imageUtils.ts:17`, `imagePathDetection.ts:11`, `mediaPathDetection.ts:33`, `mediaPopup/mediaPopupActions.ts:32`, plus inline arrays (`sourceImageActions.ts:147`, `wysiwygAdapterInsert.ts:133`, `useImageContextMenu.ts:81`, wiki-link popups); VIDEO/AUDIO lists too.
- Change: single source `src/utils/mediaExtensions.ts` exporting dotted + bare forms (and a normalizer); route all callers through it.
- AC: every code path agrees on which extensions are image/video/audio (avif/bmp/ico no longer disagree); the union is the intended set (decide the canonical list explicitly in the WI).
- Test: util test enumerating the canonical sets; a representative detection test for a previously-divergent extension (e.g. `.avif`).

**WI-0.7 — Resolve `mcpBridge` v1 utils: dead-or-buggy (ADR-3; P/TQ2).**
- Scope: `src/hooks/mcpBridge/utils.ts`, `handleRequest.ts`, `v2/`.
- Change: determine whether `handleRequest.ts` still calls v1 `utils.ts`. **If dead** → mark for Phase-1 deletion, no fix. **If live** → fix `findTextMatches` PM-offset bug (UTF-16 `.length` vs PM positions for astral/emoji chars) + add emoji/CJK boundary tests.
- AC: a documented determination + the chosen action; if live, an emoji insertion via MCP text-match lands at the correct PM position.
- Test (live branch): `findTextMatches`/`getTextRange` tests with emoji + multi-textblock matches.
- **Determination (2026-05-30):** `handleRequest.ts` fully delegates to `dispatchV2` (`v2/`); it imports only `respond` from `./utils`. `rg` across `src` (prod + tests) found **zero** callers of `findTextMatches`, `getTextRange`, `resolveNodeId`, `getDocumentContent` (and the `TextMatch`/`ResolvedNode` types, plus `getEditor`/`resolveWindowId`/`getActiveTabId`/`isAutoApproveEnabled`). The buggy `findTextMatches` is therefore **DEAD** → no fix. **Action: delete the dead helpers in Phase 1 (WI-1.4); keep the live `respond`.** No live branch, so no emoji boundary test is warranted.

**WI-0.8 — Finder hot-open TOCTOU (C3, Medium; Codex #3).**
- Scope: `src-tauri/src/lib.rs:92-97,916-977`.
- Change: flip `FRONTEND_READY` and `drain()` under one critical section; make the emit-side decision under the same lock — mirror `menu_events.rs` `check_ready_or_queue`.
- AC: a Finder open arriving during launch is neither dropped nor double-opened.
- Test: Rust test exercising the queue/drain interleaving (or a documented manual repro if the timing can't be unit-tested).

**WI-0.9 — Genie streaming applies to stale target after navigation (C4, Medium; Codex #3).**
- Scope: `src/hooks/useGenieInvocation.ts:235-327`.
- Change: capture the editor instance / tab+generation token at invocation; on `done`, verify the active editor still matches the captured tab before dispatching `replaceRange`; otherwise abort or convert to a suggestion.
- AC: switching tabs/editing during a genie stream never applies the edit to the wrong doc/range.
- Test: hook test — switch active editor mid-stream → assert no dispatch to the new doc.

**WI-0.10 — MCP `document.write` per-tab revision (C5, Medium; Codex #3).**
- Scope: `src/hooks/mcpBridge/v2/document.ts:282-303`, `revisionTracker.ts:21-31`.
- Change: key the revision store by `tabId`; validate `expected_revision` against the **resolved tab's** revision, not the global one.
- AC: a write to a non-active tab is accepted/rejected based on that tab's revision; no false STALE; no missed staleness.
- Test: revision-tracker test with two tabs at different revisions.

---

### Phase 1 — Dead code removal (low risk, large)

DoD: `knip` re-run shows the removed exports/deps gone; grep confirms zero
references for each removed CSS selector/command; `pnpm check:all` + `cargo test`
green; bundle size unchanged or smaller (`pnpm size`).

**WI-1.1 — Dead CSS sweep (1A).**
- Scope: delete `src/styles/source-popup-shared.css` (whole file + its `@import` in `source-link-popup.css:8`); `.math-block*` (`latex.css:112-188`); `.mermaid-block*` (`mermaid.css:69-149`, `mermaid-fallback.css:26-92`); `.files-view`/`.sidebar-file*` (`Sidebar.css:132-219`); `.lint-gutter-*`/`.lint-line-*` (`lint.css:12-41`); the ~10 small dead selectors and 3 dead vars enumerated in 1A.
- Change: delete; re-grep each class/var across `.ts/.tsx/.js/.html` (incl. `?raw` imports) to confirm zero hits before removal.
- AC: visual QA in light+dark via `dev-docs/css-reference.md` shows no regressions; `pnpm check:all` green (incl. `lint:design-tokens`).
- Test: CSS-only → visual QA (rule 10 exemption); document the QA in the WI.

**WI-1.2 — Dead Tauri commands (1B).**
- Scope: remove `mcp_server_start`, `mcp_server_stop`, `mcp_config_get_status`, `open_folder_dialog` from `generate_handler!` and delete their fns; drop `#[tauri::command]`/registration from `cli_install*` (keep as `pub fn` for the menu handler).
- Change: delete + re-grep frontend `invoke(` for each name to confirm zero callers.
- AC: `cargo check` clean; app launches; MCP lifecycle + folder picking still work (manual smoke).
- Test: existing Rust tests green; note manual smoke steps.

**WI-1.3 — Dead TS exports + unused dep (1C; corrected per Codex #1).**
- Scope: **re-baseline against HEAD with `rg` evidence per symbol before touching anything.** Genuinely dead → remove: `useSourceEditorShowInvisiblesSync`, `orphanCleanupWarn`, the redundant `export default` on the named-imported components (verify each is imported by name first), `@actions/expressions` from `package.json`. **NOT dead — do NOT delete:** `runUpdateCheck`/`runUpdateDownload` are called internally (`useUpdateOperations.ts:199/218/225/271/274`); knip flags only their unused *export* — the safe action is to drop the `export` keyword (or leave them, since they're internal helpers), never delete the functions.
- Change: remove only confirmed-dead symbols; `knip` re-run; `pnpm check:all`.
- AC: each removed symbol has zero-reference `rg` evidence recorded in the WI; updater UX still works (smoke); gate green; bundle unchanged.
- Test: gate is the check; updater happy-path test (existing) stays green.

**WI-1.4 — Trim `mcpBridge` v1 `utils.ts` (partial-dead; corrected per Codex #2, ADR-3).**
- Scope: `src/hooks/mcpBridge/utils.ts`. **`respond` is LIVE** — imported by `handleRequest.ts:20` and `v2/document.ts:57`; **keep it.** Delete only the verified-dead helpers superseded by `v2/` (`findTextMatches`, `getDocumentContent`, `resolveNodeId`, `getTextRange`, …) — and only if WI-0.7 determined the v1 text-match path is unused. **Verify each remaining export (`getEditor`, `resolveWindowId`, `getActiveTabId`, `isAutoApproveEnabled`) individually** for live callers before removing.
- Change: remove dead helpers; keep `respond` (consider relocating it to a minimal shared file if `utils.ts` shrinks to just it); confirm no broken imports.
- AC: per-symbol `rg` evidence; MCP tools (document/selection/session/workflow/workspace) still function (v2 tests + manual smoke).
- Test: v2 suite green; manual MCP smoke documented.

**WI-1.5 — Decide `restore_snapshot` / `list_snapshots` (1B; Codex #11).**
- Scope: `src-tauri/src/workflow/snapshots.rs:99,174` (behind `#[allow(dead_code)]`; snapshots are written but never restored/listed).
- Change: an explicit **finish-or-delete** decision. Default recommendation: **delete** both fns + the `create_snapshot` call that feeds them, unless workflow-undo is on the near-term roadmap — in which case file a tracking note and keep the `#[allow]`.
- AC: a recorded decision; if deleted, `cargo check` clean and no dangling snapshot writes.
- Test: `cargo test` green.
- **Decision (2026-05-30): KEEP** (finish, don't delete). `create_snapshot` is **live** — wired into workflow pre-execution in `workflow/commands.rs:188` (snapshots every modified file before a run). `restore_snapshot`/`list_snapshots` are the read-side of a roadmapped feature: `dev-docs/plans/20260331-workflow-engine.md` **WI-5.4 "File Snapshots for Undo"**. Deleting would orphan a deliberate safety mechanism that already runs on every workflow execution. Per the plan's exception clause, the `#[allow(dead_code)]` stays and a tracking note is filed (added to `snapshots.rs` module docs pointing at workflow-engine WI-5.4).

---

### Phase 2 — Performance & bundle

DoD: each WI has a before/after measurement (bench, `size:why`, or a reasoned
profile); `pnpm check:all` + `pnpm size` within budget; no behavior change.

**WI-2.1 — codePreview: skip full-doc scan in prose-only docs (O1, High).**
- Scope: `src/plugins/codePreview/tiptap.ts:419` (guards `:362,:380`).
- Change: early-return when `state.codeBlockRanges.length === 0` after a cheap top-level check that no previewable block was just inserted.
- AC: typing in a prose-only doc no longer triggers a `descendants()` walk per keystroke (verify via a counter/bench); previewable docs unchanged.
- Test: plugin test asserting the apply path short-circuits when no code blocks exist.

**WI-2.2 — `detect_ai_providers` async + memoized (O2, High).**
- Scope: `src-tauri/src/ai_provider/detection.rs:19`.
- Change: make the command `async`, wrap the 3 `which`/`where` lookups in `tokio::task::spawn_blocking`, memoize the result (session-stable) in a `OnceLock`/`Mutex`.
- AC: provider detection no longer blocks the IPC thread; result cached after first call.
- Test: Rust test for the env-key/pure portion (`read_env_api_keys`); detection extracted enough to assert caching.

**WI-2.3 — `list_directory_entries` async (O4, Medium).**
- Scope: `src-tauri/src/file_tree.rs:58,83`.
- Change: `async` + `spawn_blocking`; skip `metadata()` for dotfiles already excluded by name.
- AC: large-directory expand does not block the IPC thread.
- Test: existing file_tree tests green; add a large-dir case if cheap.

**WI-2.4 — `OutlineView` memoization (O5, Medium).**
- Scope: `src/components/Sidebar/OutlineView.tsx:24,172,188`.
- Change: `React.memo(OutlineItem)`, `useCallback` for `handleToggle`/`handleClick`.
- AC: cursor moves no longer reconcile the whole heading tree (verify via React profiler or a render counter in a test).
- Test: component test asserting untouched items don't re-render on active-heading change.

**WI-2.5 — Lint engine: split source once (O6, Medium).**
- Scope: `src/lib/lintEngine/linter.ts:27` + rule files; `noUndefinedRefs.ts` (O(L²)).
- Change: split `source` into lines once in the orchestrator, pass to rules; precompute line-start offsets; hoist per-line regex to module scope.
- AC: a large doc with many references lints in linear time; output identical.
- Test: lint output equivalence on existing fixtures; a large-input timing sanity check (non-asserting).

**WI-2.6 — Make mermaid + cytoscape truly lazy (B1, ~2.3 MB off eager).**
- Scope: `vite.config.ts`, `.size-limit.cjs`, the static `_` helper import (documented in `.size-limit.cjs:108`).
- Change: extract the `_` helper into a micro-chunk so `vendor-mermaid`/`vendor-graph` leave the eager preload graph. Do **not** re-split mermaid internals (ADR-5).
- AC (strengthened per Codex #8): `pnpm size:why` **proves the exact static import edge from the entry to `vendor-mermaid` is gone** (not just a smaller number); and a live render smoke of **Mermaid AND Markmap AND the workflow graph** all succeed; no `"this.clear is not a function"` regression. If the edge can't be cleanly severed, **abort the WI** rather than re-split internals.
- Test: build + size budgets green; the three live render smokes documented.
- **Status (2026-05-30): ABORTED (per the WI's own abort clause).** The strengthened DoD requires `pnpm size:why` to **prove the exact static import edge** from the entry to `vendor-mermaid` is gone. This project's `size-limit` runs on the `@size-limit/file` preset (vite/esbuild output), and `size-limit --why` only works with the `@size-limit/webpack-why` plugin — so the edge-level proof the DoD mandates is **not available** in this setup. Combined with the area being known-fragile (prior splits broke prod with `this.clear is not a function`), the WI's instruction is explicit: *"If the edge can't be cleanly severed, abort the WI rather than re-split internals."* Aborted; revisit if/when a webpack-why or `rollup-plugin-visualizer` edge analysis is wired into the size tooling.

**WI-2.7 — Drop `js-yaml` + `@types/katex` (B3/B4).**
- Scope: migrate the 2 `js-yaml.load()` sites (`formats/adapters/yaml.tsx`, `lib/workflow/parser.ts`) to `yaml`'s `parse()`; remove `js-yaml` + `@types/js-yaml`; remove redundant `@types/katex`.
- Pre-req (Codex #9): build an explicit **compatibility matrix** before removing the dep — `js-yaml.load()` vs `yaml.parse()` on (a) duplicate keys (`yaml.test.ts:71` depends on this), (b) anchors/aliases, (c) parse-error line/column extraction shape, (d) the workflow parser's error mapping. Reconcile each divergence (config `yaml.parse` options or adapt the consumer) before deleting `js-yaml`.
- AC: every YAML/workflow fixture parses identically AND the error/diagnostic shapes match the matrix; bundle drops `js-yaml`; gate green.
- Test: YAML adapter + workflow parser fixture suites green; add explicit duplicate-key + bad-syntax (line/col) cases.

**WI-2.8 — Lazy-load `turndown` on HTML paste (O3, High; Codex #3).**
- Scope: `src/utils/htmlToMarkdown.ts:8-9` (static `turndown` + gfm plugin) → `htmlPaste/tiptap.ts:24`.
- Change: keep the cheap `isSubstantialHtml` static; `await import("@/utils/htmlToMarkdown")` only when a substantial-HTML paste is detected.
- AC: `turndown` leaves the eager editor chunk (`pnpm size:why`); HTML paste still converts correctly.
- Test: paste-path test (substantial HTML → markdown); size budget green.
- **Status (2026-05-30): DEFERRED.** ProseMirror/CodeMirror paste handlers are **synchronous** and decide whether to claim the paste based on the *conversion result* (return false on trivial/empty conversion so default paste handles it). Lazy `import()`-ing `turndown` forces an **async-claim** refactor: the handler must `preventDefault()` + return `true` up front, then asynchronously convert and insert markdown-or-plain. That changes the handler's return contract for the "substantial-looking HTML whose conversion adds nothing" case (now claimed + plain-text-inserted instead of falling through to default rich paste) — a user-visible behavior change in a core editing path that cannot be live-verified in this session. A pre-warm-with-cold-fallback variant avoids the contract change but still alters first-paste timing. Per the plan's risk posture on bundle items, deferred pending live paste E2E verification; recommend revisiting with the Tauri MCP paste flow.

**WI-2.9 — Verify `@actions` parser isn't eager (B2, measure-only; Codex #3).**
- Scope: `src/lib/ghaWorkflow/detection.ts` (`isWorkflowYaml`, statically imported by `codePreview/tiptap.ts:68`).
- Change: confirm via `pnpm size:why` whether `detection.ts` transitively pulls `@actions/workflow-parser` (~1.6 MB) into the eager editor chunk. If it does, reduce `isWorkflowYaml` to a string/regex check so the parser stays lazy; if it doesn't, record "no action" with evidence.
- AC: a documented measurement; if a leak existed, ~1.6 MB removed from the eager path.
- Test: size budget green.
- **Measurement (2026-05-30): NO LEAK — no action needed.** `src/lib/ghaWorkflow/detection.ts` (`isWorkflowYaml`, the symbol `codePreview/tiptap.ts:68` statically imports) is **pure regex** — `rg "@actions/workflow-parser" detection.ts` returns nothing; it imports only local helpers and `RegExp`. So the eager editor chunk does **not** transitively pull `@actions/workflow-parser` via this path. The heavyweight parser is reached only from the lazy workflow-rendering chunks. `pnpm size:why` is unavailable here (see WI-2.6), but source inspection is conclusive for this binary "does X import Y" question.

---

### Phase 3 — Duplication / shared abstractions (behavior-preserving)

DoD: each cluster is one PR (extract + migrate + delete copies); `pnpm check:all`
green proves equivalence; net LOC negative.

**WI-3.1 — `errorMessage()` helper (D1, ~126 sites; scoped per Codex #10).**
- Scope: new `src/utils/errorMessage.ts`; codemod **only the exact ternary shape** `X instanceof Error ? X.message : String(X)`. **Exclude** sites with custom/localized fallbacks or non-`String()` else-branches (e.g. `saveToPath.ts:63`) — these are not equivalent.
- Change: produce a **manual skip list** of non-equivalent sites in the WI; codemod the rest; review as one diff.
- AC: single canonical implementation; the skip list is recorded with reasons; gate green; ~110+ lines removed.
- Test: util test; gate covers migrated call sites.

**WI-3.2 — MCP v2 `wrapHandler` (D2, ~15 sites).**
- Scope: `src/hooks/mcpBridge/v2/` — `wrapHandler(id, fn)` centralizing the try/catch→`respond({success:false})`.
- AC: handlers shrink to happy path; error contract identical; v2 suite green.
- Test: existing v2 handler tests green; add a wrapHandler error-path test.

**WI-3.3 — Shared `buildPopupIconButton` (D4, 6 reimplementations).**
- Scope: delete the 6 private `buildIconButton` methods; call `utils/popupComponents.ts:71` (add an `iconSvg` escape hatch for raw-SVG callers).
- AC: source popups render identically; ~60 lines removed.
- Test: existing popup tests green.

**WI-3.4 — Adopt `useDismissOnOutsideOrEscape` (D5, 5 components).**
- Scope: migrate QuickOpen/GeniePicker/HeadingPicker/ContentSearch/TerminalContextMenu; extend the hook with an optional `deferActivation` flag for the `setTimeout(0)` cases.
- AC: outside-click + Escape behavior unchanged (incl. IME-aware Escape); ~50 lines removed.
- Test: existing dismissal tests green; add hook test for `deferActivation`.

**WI-3.5 — Generic `debounce` util (D6).**
- Scope: new `src/utils/debounce.ts` (`.cancel()`/`.flush()`); rebuild `createQueryDebounce` + `createDebouncedSearchCounter` on it. Leave bespoke ProseMirror-plugin timers.
- AC: search debounce behavior unchanged; one tested implementation.
- Test: debounce util test (timers); existing search tests green.

**WI-3.6 — Rust `app_data_dir()` + `atomic_write()` (D7).**
- Scope: `src-tauri/src/app_paths.rs` — `app_data_dir(&AppHandle)` (replace 6 inline `map_err`); one `atomic_write(path, bytes)` (prefer `tempfile` crate path) replacing the two divergent implementations (`app_paths.rs:75-110`, `hot_exit/storage.rs:81-118`).
- AC: hot-exit + config writes still atomic; no temp-file leak on early error; `cargo test` green.
- Test: Rust test for `atomic_write` (incl. an injected mid-write error → no temp leak).

---

### Phase 4 — Hardening: boundary validation, lifecycle, a11y

DoD: targeted validators + lifecycle caps + a11y fixes; `pnpm check:all` green;
a11y items manually keyboard-verified in the live app.

**WI-4.1 — Validate high-blast-radius IPC/event payloads (T1/T2, ADR-2).**
- Scope: `mcpBridge/index.ts:66-73` (shape-check `raw.id`/`raw.type` before use), workspace config (`openWorkspaceWithConfig.ts:25`), AI response chunks (`useGenieInvocation.ts:256`), session/hot-exit restore.
- Change: hand-written shape guards at these boundaries; reject + log on mismatch (fail-loud per rule).
- AC: a malformed payload is rejected with a clear error, not propagated as `undefined`.
- Test: per-validator tests (valid/invalid/missing-field).

**WI-4.2 — Validate cross-tab settings `StorageEvent` (T3).**
- Scope: `src/hooks/useSettingsSync.ts:50-69`.
- Change: validate each group's shape before merging into the store (reuse the persist-migration validation path).
- AC: a malformed `localStorage` write under the settings key does not corrupt live settings.
- Test: hook test with malformed `newValue`.

**WI-4.3 — Null-safe DOM casts (T5).**
- Scope: the ~30 `.closest(...)/querySelector(...) as HTMLElement` non-nullable casts (`imagePreview`, `mathPreview`, `footnotePopup`, `bookmarkLinkCommand`, toolbar adapters …).
- Change: type as `… | null` and guard; matches existing `tableScroll`/`sourcePopup` pattern.
- AC: popup/view code does not throw if run during editor teardown.
- Test: where feasible, a teardown-race test; otherwise type-level + manual.

**WI-4.4 — Bound `previewCache` (R1).**
- Scope: `src/plugins/codePreview/tiptap.ts:97`.
- Change: LRU cap (~100 entries, evict oldest) or clear on last-view `destroy()`.
- AC: editing diagram blocks no longer grows the cache unbounded across a session.
- Test: cache test asserting eviction at the cap.

**WI-4.5 — Minor lifecycle fixes (R2/R3).**
- Scope: `ghaWorkflow/actions/registry.ts:89` (bound/clear `sessionCache`); `utils/pendingSaves.ts:41` + `saveToPath.ts:88` (clear in `finally`).
- AC: caches bounded; no stale pending-save entry on write error.
- Test: small unit tests for each.

**WI-4.6 — ImageContextMenu keyboard support (A1, High a11y).**
- Scope: `src/components/Editor/ImageContextMenu.tsx`.
- Change: rebuild from `TabContextMenu`/FileExplorer `ContextMenu` template — `role="menu"`/`menuitem`, `<button>` items, focus-in on open, arrow/Home/End/Enter/Escape, roving `tabIndex` (already imports `useDismissOnOutsideOrEscape`).
- AC: the image menu is fully keyboard-operable and exposed to AT.
- Test: component test (keyboard nav + activation); manual VoiceOver note.

**WI-4.7 — ARIA state on toggles & dialogs (A2/A3, Medium a11y).**
- Scope: `FindBar.tsx:176-200` (`aria-pressed` on regex/case/word — copy `ContentSearch.tsx:340`); `CommandPalette.tsx:37-145` (focus restore via `previousFocusRef`, `aria-modal`, `combobox`/`aria-activedescendant` — copy QuickOpen).
- AC: toggle state announced; palette restores focus on close.
- Test: component tests asserting the ARIA attributes + focus restore.

---

### Phase 5 — Test backfill (close coverage gaps)

DoD: new tests for the high-risk untested modules; `pnpm test:coverage` not
regressed; the known flaky perf test stabilized.

**WI-5.1 — Test `useWorkspaceBootstrap` (TQ1, High).**
- Scope: `src/hooks/useWorkspaceBootstrap.ts`.
- AC: tests cover null/valid/throwing `read_workspace_config`, dedup vs open tabs, `hasBootstrapped` guard, both silent-catch paths.

**WI-5.2 — Test `genies/parsing.rs` + `documentStore/unifiedHistory.ts` (TQ3, High).**
- AC (parsing): no-frontmatter, BOM, `----` rejection, missing closing fence, empty/scalar, v0 fallback. AC (history): `MAX_CHECKPOINTS=50` eviction, undo↔redo round-trips, per-tab isolation, `setRestoring` guard.

_(WI-5.3 — stabilize the flaky perf test — moved to **Phase -1** as WI-(-1).1 per Codex #4, since every phase's DoD depends on a green gate.)_

**WI-5.4 — Test pure logic in `genies/scanning.rs`, `ai_provider/detection.rs` (`read_env_api_keys`), `tab_transfer.rs` (TQ5, Medium).**
- Change: where untestable as written (`tab_transfer` takes `AppHandle`), extract the pure rect-hit-test helper first, then test.
- AC: each gets edge-case coverage (nested categories, control-char strip, symlink skip; env present/absent/malformed; point-on-edge, focused-preference, zero-size skip).

---

## 4. Cross-cutting non-goals (explicitly out of scope)
- No universal `zod` migration of all 65 `invoke`/`listen` sites (ADR-2).
- No merge of the source/WYSIWYG toolbar adapters (intentional strategy split).
- No touching the 131 idiomatic Rust `map_err(format!)` sites (only the repeated
  atomic-write sequence, WI-3.6).
- No incremental-serialization rework of `flushToStore` (O7 — structural, separate
  large effort).
- Rule-doc fix: `10-tdd.md` cites a non-existent `closeDecision.ts` — note for a
  docs pass, not part of this plan.

## 5. Risk register
- **WI-2.6 (mermaid lazy):** prior splits broke prod (`this.clear`). Mitigation:
  extract only the helper; live-smoke before/after; ADR-5.
- **WI-2.7 (yaml swap):** `yaml.parse()` ≠ `js-yaml.load()` on anchors/errors.
  Mitigation: run full fixture suites; keep the change isolated and revertable.
- **WI-1.4 (v1 utils delete):** gated behind WI-0.7 determination (ADR-3).
- **WI-3.1 (errorMessage codemod):** 126 sites — review as one diff; the gate is
  the equivalence proof.
- **WI-0.2 (orphan doc):** touches the open path; high-blast-radius store. Keep
  the guard minimal; regression test first.

## 6. Sequencing & branches
One feature branch per phase (`chore/audit-p0-bugs`, `chore/audit-p1-deadcode`,
…), each merged green before the next. Within a phase, WIs are separate commits
linked by message (`fix(pdf): … (WI-0.1)`) per `.claude/rules/60-ai-governance.md`
§2. Phases 0–1 are the highest value-to-risk and should land first.

## 7. Cross-model review (Codex)

> Per `.claude/rules/60-ai-governance.md` §6, this multi-phase plan requires a
> Codex review before Phase 1 commits. Reviewed by Codex (`gpt-5.3-codex`, high
> effort) on 2026-05-30 — threadId `019e774a-9c13-76a0-9239-4d463d133610`.
> **Verdict: REWORK.** The review caught two real factual errors and several
> scoping gaps; the plan was revised accordingly (Status header). Findings and
> responses below; ✅ = accepted & applied, ⚠️ = accepted with nuance, ✗ = declined.

| # | Sev | Codex finding | Response |
|---|---|---|---|
| 1 | High | `runUpdateCheck/Download` are **used internally** (`useUpdateOperations.ts:199/218/225/271/274`), not test-only — deleting breaks the updater | ✅ Verified true. WI-1.3 corrected: they are live; only the redundant `export` keyword is removable (knip flags unused *exports*, not dead functions). Removed from the deletion list. |
| 2 | High | `mcpBridge/utils.ts` is **not fully dead** — `respond` is imported by `handleRequest.ts:20` + `v2/document.ts:57` | ✅ Verified true. ADR-3 + WI-1.4 corrected: utils.ts is *partially* live. Delete only the verified-dead helpers (`findTextMatches`/`getDocumentContent`/`resolveNodeId`/…); keep `respond` (and re-verify each remaining export individually). |
| 3 | High | Audited findings O3, B2, C3/C4/C5 dropped with no defer rationale | ✅ Added: O3 (WI-2.8), B2 (WI-2.9), C3/C4/C5 (WI-0.8/0.9/0.10). |
| 4 | High | Flaky-gate fix (WI-5.3) too late — every phase needs `check:all` green | ✅ Moved to **Phase -1 (pre-flight)** before Phase 0. |
| 5 | Med | WI-0.2 "generation token" over-refactors; stores lack token semantics | ✅ Tightened to a minimal tab-existence guard at write time + an integration test on the `useFileOpen` close-during-read path. |
| 6 | Med | WI-0.1 may skip overlapping matches — make non-overlapping intent explicit | ✅ AC now states UTF-8 boundary safety is the invariant and heading matches are non-overlapping; test documents it. |
| 7 | Med | WI-0.3 AC proves call-order, not race closure | ✅ AC now requires a test where step/complete events arrive **before** `invoke` resolves → no stuck "running". |
| 8 | Med | WI-2.6 DoD too weak for a known-fragile area | ✅ DoD now requires proving the exact import edge is removed + smoke of Mermaid **and** Markmap **and** workflow-graph rendering. |
| 9 | Med | WI-2.7 YAML-swap semantics understated (`yaml.test.ts:71` relies on js-yaml duplicate-key + diagnostic shape) | ✅ Added a compatibility matrix (duplicate keys, anchors/aliases, parse-error line/col, workflow error mapping) as a WI-2.7 pre-req. |
| 10 | Med | WI-3.1 codemod over-broad — not all sites equivalent (`saveToPath.ts:63` custom fallback) | ✅ Codemod restricted to the **exact** ternary shape; custom-fallback sites excluded with a manual skip list in the WI. |
| 11 | Low | `restore_snapshot`/`list_snapshots` (1B) decision missing | ✅ Added WI-1.5 (explicit finish-or-delete decision). |
| 12 | Low | "~10 test files" optimistic | ⚠️ Accepted — re-estimated to ~18–22 test artifacts (per-WI targets); net LOC still negative. |

**Top-3 pre-Phase-0 changes (all applied):** (1) re-baseline WI-1.3/1.4 against HEAD — done; (2) flaky-gate fix to Phase -1 — done; (3) tighten WI-0.2/0.3 to prove real race closure — done.
