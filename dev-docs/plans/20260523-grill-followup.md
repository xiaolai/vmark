# Grill Report Follow-Up — Hardening From the 2026-05-23 Investigation

**Status:** Draft — Phase 1 not started
**Owner:** Xiaolai
**Branch:** `feat/grill-2026-05-23-followup` (proposed)
**Created:** 2026-05-23
**Sources:**
- `dev-docs/grills/grill-report-2026-05-23.md` (diagnostic)
- Codex cross-model design review of this plan’s shape (`gpt-5.5`, effort `high`, sandbox `read-only`, this session)

## Goal

Convert the diagnostic findings from the 2026-05-23 investigation into shippable hardening work, while correcting three claims the report got wrong (verified against live `main`):

1. The "adapter spike" the report proposed is **overtaken by prior work** — `src/lib/formats/types.ts` already defines the full `FormatConfig` / `FormatAdapters` / `TabFormatState` contract. The real multi-format blocker is **persistence migration** for the new tab-format state, not the contract.
2. `src-tauri/src/workflow/expressions.rs` already carries 16 test attributes — the actual untested surface is `runner.rs:322`'s `if:` evaluation TODO, not the expression evaluator itself.
3. The Terminal IME logic already lives in `setupImeComposition.ts` (260 lines, with sibling tests) — the work is **consolidation around the existing module**, not a from-scratch FSM extraction.

This plan therefore re-prioritizes: persistence + menu matrix + rev-6 of the multi-format plan come first (closes the gate); a11y polish runs in parallel after Phase 1 rebaselines the file landscape; Rust coverage and contract tests follow as a separate hardening tranche.

## Non-goals

- Re-litigating findings already auto-fixed (the audit-fix loop is functioning; ride it).
- Re-running every audit dimension from scratch — the grill report is the input, not a starting line.
- Phase-1A *implementation* of the multi-format plan. This plan only closes the gate; multi-format Phase 1A is a separate plan.
- Performance work on the WYSIWYG large-file freeze (deferred; needs its own ADR).

## ADRs

### ADR-1: The adapter spike is dropped

**Decision:** Remove the report's P0 "spike runnable adapter contract" item. The contract lives at `src/lib/formats/types.ts` and downstream registry/adapters are already in `src/lib/formats/{adapters,registry.ts,extSync.test.ts}`.

**Mechanism:** The grill report's recommendation predated checking that file. Codex review caught it. Wasted work avoided.

**Confidence:** High.

### ADR-2: Persistence migration is the real Phase 1A blocker

**Decision:** Treat `hot_exit` schema migration for `format_id` / `editing_enabled` / `active_schema_id` as the gating work item for the multi-format Phase 1A.

**Mechanism:** Without versioned migration, the first multi-format release will silently corrupt or drop existing hot-exit sessions on upgrade. The data-loss surface is large (sessions can contain unsaved user content). The Codex review of multi-format plan rev 5 surfaced this as one of three High-severity findings.

**Confidence:** High.

### ADR-3: Reframe IME work as consolidation, not extraction

**Decision:** Instead of extracting an IME finite-state-machine from event handlers, **harden the existing `setupImeComposition.ts` module** by making its idle/composing/grace states explicit and exhaustively tested.

**Mechanism:** The grill report's recommendation assumed the IME logic was inlined. Live code shows it's already a module. The bug pattern (6+ recent fixes) reflects implicit state transitions inside that module, not the absence of one.

**Confidence:** High.

### ADR-4: Defer CI noise fix until next run

**Decision:** The `Claude Code` workflow's label step already has `|| true` at `.github/workflows/claude.yml:200`. Do not preemptively rewrite; observe the next run.

**Mechanism:** The failure source is upstream of the label step (the script that *checks* whether the label exists, run before the gh-cli step). Without a reproduction, a fix risks moving the failure rather than removing it. If the next run still fails, file a single targeted WI then.

**Confidence:** Medium — depends on next run behavior.

### ADR-5: Rust coverage is a separate tranche, not a gate

**Decision:** Rust coverage WIs (`workflow/runner.rs`, `hot_exit/storage.rs`, `mcp_bridge/server.rs`) run as Phase 3, parallel to Phase 4 cleanup. They do **not** block the multi-format gate.

**Mechanism:** Multi-format Phase 1A needs the menu matrix and persistence migration; it does not need broader Rust coverage. Coupling them would extend the gate by ~14 h for no causal reason.

**Confidence:** High.

## Verified state of the codebase (2026-05-23)

| Area | Verified finding | Citation |
|---|---|---|
| Format registry | `FormatKind`, `FormatConfig`, `FormatAdapters`, `TabFormatState`, `ValidationDiagnostic`, `Validator`, `SchemaDetector`, `PreviewRenderer` all defined | `src/lib/formats/types.ts:1-30` |
| Format adapter directory | exists with `adapters/`, `registry.ts`, `extSync.test.ts`, `markdownLargeFile.ts`, `index.ts` | `src/lib/formats/` |
| IME module | exists, 260 lines, has sibling `setupImeComposition.test.ts` | `src/components/Terminal/setupImeComposition.ts` |
| Workflow expression tests | 16 `#[test]` / `#[cfg(test)]` attributes already present | `src-tauri/src/workflow/expressions.rs` |
| Hot-exit format fields | `format_id`, `editing_enabled`, `active_schema_id` absent from `TabState` on both sides | `src/utils/hotExit/*.ts`, `src-tauri/src/hot_exit/*.rs` (grep empty) |
| CI workflow label step | already wrapped in `|| true` | `.github/workflows/claude.yml:200` |

## Executive sequencing call

**Phase 1 closes the multi-format gate.** Phase 2 ships a11y polish in parallel. Phase 3 adds Rust test coverage as a hardening tranche. Phase 4 closes the recurring bug classes (MCP contract test, IME consolidation, dead code, multi-cursor todos).

Phase 1 is serial-critical: rebaseline → persistence → menu matrix → review re-run. Phases 2-4 parallelize internally and against each other once Phase 1 lands.

## Dependency graph

| WI | Depends on | Mode |
|----|-----------|------|
| WI-1.1 (rev-6 rebaseline) | — | serial-critical |
| WI-1.2 (persistence migration) | WI-1.1 | serial-critical |
| WI-1.3 (menu matrix) | WI-1.1 | serial-critical |
| WI-1.4 (CI verification) | — | parallelizable |
| WI-1.5 (review re-run) | WI-1.1, WI-1.2, WI-1.3 | serial gate |
| WI-2.1–WI-2.4 (a11y) | merge after WI-1.1 to avoid sidebar/content-search drift | parallelizable |
| WI-3.1 (runner `if:` tests) | — | parallelizable |
| WI-3.2 (hot-exit Rust tests) | WI-1.2 (so test fixtures use the migrated schema) | parallelizable |
| WI-3.3 (MCP bridge Rust tests) | — | parallelizable |
| WI-4.1 (MCP contract test) | WI-3.3 (shares fixture infrastructure) | serial-critical to Phase 4 |
| WI-4.2 (IME consolidation) | — | parallelizable |
| WI-4.3 (multi-cursor todos) | — | parallelizable |
| WI-4.4 (dead-code cleanup) | — | parallelizable |

## Phase 1 — Multi-Format Gate Closure

**Goal:** Convert multi-format plan rev 5 into a current rev 6 that no longer claims to do already-landed work, has explicit persistence migration, and has a tested menu matrix. Then re-run `/cc-suite:review-plan` to confirm READY.

**DoD (machine-checkable):**
- `bash scripts/check-wi-linkage.sh dev-docs/plans/20260506-multi-format-rebrand.md --phase=1A` passes for all rev-6 WIs.
- New `bash scripts/check-multi-format-phase.sh 1A` (created in WI-1.1) passes.
- `pnpm test src/utils/hotExit src/hooks/useUnifiedMenuCommands` is green.
- `pnpm check:all` is green.
- `/cc-suite:review-plan dev-docs/plans/20260506-multi-format-rebrand.md` returns READY TO BUILD or APPROVE-WITH-NOTES.

**Parallelizable?** WI-1.1 is the bottleneck; WI-1.2/1.3 begin only after the rebaseline writes their target shape; WI-1.4 runs independently.

### WI-1.1 — Rev-6 rebaseline of the multi-format plan

- **Files:** `dev-docs/plans/20260506-multi-format-rebrand.md`, `scripts/check-multi-format-phase.sh` (new), `dev-docs/grills/multi-format/findings.md`, `dev-docs/grills/multi-format/security-review-html.md`
- **Scope:** Update the plan's "Background — verified state of the codebase" section against live `main`. Drop the adapter spike WI. Add the persistence migration WI. Add an explicit menu-routing regression matrix to the Phase 1A DoD. Tighten ADR-4 wording to separate iframe `sandbox` from CSP/sanitization. Centralize phase status in the plan header (resolves the `findings.md` / `security-review-html.md` drift).
- **Acceptance:** Codex Background table no longer claims missing implemented files. `scripts/check-multi-format-phase.sh 1A` exists and exit-codes against the rev-6 acceptance criteria. Plan header carries dated authoritative status for WI-0.4 sign-off.
- **Estimate:** 2 h
- **Mode:** serial-critical

### WI-1.2 — Hot-exit persistence migration

- **Files:** `src/utils/hotExit/types.ts`, `src/utils/hotExit/schemaMigration.ts` (new), `src/utils/hotExit/schemaMigration.test.ts` (new), `src/utils/hotExit/useHotExitCapture.ts`, `src/utils/hotExit/restoreHelpers.ts`, `src/utils/hotExit/useHotExitRestore.test.ts`, `src-tauri/src/hot_exit/session.rs`, `src-tauri/src/hot_exit/migration.rs` (new), `src-tauri/src/hot_exit/storage.rs`
- **Scope:** Add `formatId`, `editingEnabled`, `activeSchemaId` to `TabState` (TS) and `TabState` (Rust). Bump session-schema version. Write a migration that backfills `formatId="markdown"` and `editingEnabled=true` for pre-v2 sessions. Reject future schema versions with a clear error.
- **Acceptance:** v1 → v2 sessions migrate without data loss (covered by `schemaMigration.test.ts` table-driven cases including untitled, large-file, multi-window). Future-schema sessions return a typed error, not a panic. `pnpm test src/utils/hotExit` and `cargo test --manifest-path src-tauri/Cargo.toml hot_exit::migration` pass.
- **Estimate:** 4 h
- **Mode:** serial-critical

### WI-1.3 — Menu regression matrix across formats

- **Files:** `src/hooks/useUnifiedMenuCommands.ts`, `src/hooks/useUnifiedMenuCommands.test.tsx` (new), `src/lib/formats/adapters/*.tsx`
- **Scope:** Add a TDD-first test matrix covering: markdown WYSIWYG, markdown source, text/data split-pane (YAML/JSON/TOML/MMD/SVG/HTML), and read-only code viewer. Each format gets per-action assertions: which menu actions execute, which are disabled, which mutate state.
- **Acceptance:** Undo/redo work in all formats. Markdown-only formatting is disabled (not silently no-op) for non-markdown formats. Disabled actions raise no errors and do not mutate editor state. Test file uses `describe.each` over `FormatKind`.
- **Estimate:** 2 h
- **Mode:** serial-critical

### WI-1.4 — CI workflow verification (no change unless needed)

- **Files:** `.github/workflows/claude.yml` (read-only verification)
- **Scope:** Observe the next 2 `Claude Code` workflow runs. If they continue failing on the same label step, file a focused issue with the exact failure point.
- **Acceptance:** Either next 2 runs pass without changes (close as no-op), or a follow-up issue is filed with reproducible failure context.
- **Estimate:** 20 min
- **Mode:** parallelizable

### WI-1.5 — Cross-model review re-run

- **Files:** None — `/cc-suite:review-plan dev-docs/plans/20260506-multi-format-rebrand.md`
- **Scope:** Re-run the cross-model review against rev 6.
- **Acceptance:** Verdict is `READY TO BUILD` or `APPROVE-WITH-NOTES` with no remaining High-severity findings on completeness or ambiguity.
- **Estimate:** 30 min compute (mostly Codex inference)
- **Mode:** serial gate

## Phase 2 — A11y High-Severity Fixes

**Goal:** Close the verified keyboard and screen-reader blockers from the grill report.

**DoD (machine-checkable):**
- New tests pass: file-tree chevron keyboard interaction, sidebar resize arrow-key, sidebar `aria-expanded` binding, search input accessible names.
- `pnpm check:all` green.
- No hardcoded user-facing English (i18n keys for any new labels).

**Parallelizable?** Yes — all four WIs touch disjoint components.

### WI-2.1 — File-tree chevron as keyboard-operable button

- **Files:** `src/components/Sidebar/FileExplorer/FileNode.tsx`, `src/components/Sidebar/FileExplorer/FileNode.test.tsx` (new or extend), `src/components/Sidebar/FileExplorer/FileExplorer.css`
- **Scope:** Replace `<span onClick>` chevron with `<button>` (or `<span role="button" tabIndex={0}>` with key handler if click bubbling matters). Add `aria-label` via `t()`.
- **Acceptance:** Enter and Space toggle the folder. Mouse click continues to work. Focus indicator follows project standard (`33-focus-indicators.md` — U-shaped underline). Tree row selection is not broken.
- **Estimate:** 1.5 h
- **Mode:** parallelizable

### WI-2.2 — Keyboard-resizable sidebar

- **Files:** `src/App.tsx`, `src/hooks/useSidebarResize.ts`, `src/hooks/useSidebarResize.test.tsx`, locale JSON for new label
- **Scope:** Make the resize handle `role="separator"` with `aria-orientation="vertical"`, `aria-label`, `tabIndex={0}`. Arrow keys resize by 8 px; Shift+Arrow by 32 px; Home/End clamp to min/max.
- **Acceptance:** Keyboard resize is bounded by the same min/max as mouse drag. Mouse resize unchanged. State persists per the existing settings store.
- **Estimate:** 2.5 h
- **Mode:** parallelizable

### WI-2.3 — Sidebar toggle `aria-expanded` binding

- **Files:** `src/components/StatusBar/StatusBar.tsx`, `src/components/StatusBar/StatusBar.test.tsx`, `src/components/Sidebar/Sidebar.tsx`
- **Scope:** Replace hardcoded `aria-expanded={false}` / `={true}` with binding to the actual sidebar-visible state from the relevant store.
- **Acceptance:** `getByRole("button", { name: ..., expanded: false/true })` matches actual state in tests.
- **Estimate:** 1 h
- **Mode:** parallelizable

### WI-2.4 — Search input accessible labels

- **Files:** `src/components/FindBar/FindBar.tsx`, `src/components/FindBar/FindBar.test.tsx`, `src/components/ContentSearch/ContentSearch.tsx`, `src/components/ContentSearch/__tests__/ContentSearch.test.tsx`, `src/components/Terminal/TerminalSearchBar.tsx`, `src/components/Terminal/TerminalSearchBar.test.tsx`, `src/locales/en/*.json`
- **Scope:** Add `aria-label={t("findbar.searchInput")}`-style accessible names to each search-input field. Placeholders remain.
- **Acceptance:** `getByRole("textbox", { name: ... })` returns the search input for each bar.
- **Estimate:** 1.5 h
- **Mode:** parallelizable

## Phase 3 — Rust Coverage Tranche

**Goal:** Add tests around the highest-risk untested Rust behavior surfaces.

**DoD (machine-checkable):**
- `cargo test --manifest-path src-tauri/Cargo.toml workflow hot_exit mcp_bridge` is green and adds at minimum: 12 cases for runner conditions, 10 for hot-exit storage, 8 for MCP bridge protocol parsing.
- `pnpm check:all` green.

**Parallelizable?** Yes — three disjoint Rust modules.

### WI-3.1 — Workflow runner `if:` evaluation tests

- **Files:** `src-tauri/src/workflow/runner.rs`, `src-tauri/src/workflow/runner_conditions.test.rs` (new)
- **Scope:** Add table-driven tests for `if:` evaluation: literal true/false, whitespace, invalid syntax, unknown step refs, skipped-step status. Then unblock the `TODO` at `runner.rs:322` (length/comparison support) by extending the evaluator to pass the new tests.
- **Acceptance:** Tests defined first (RED), implementation second (GREEN). `runner.rs:322` TODO is removed.
- **Estimate:** 4 h
- **Mode:** parallelizable

### WI-3.2 — Hot-exit storage / coordinator tests

- **Files:** `src-tauri/src/hot_exit/storage.rs`, `src-tauri/src/hot_exit/coordinator.rs`, `src-tauri/src/hot_exit/session.rs`, `src-tauri/src/hot_exit/storage.test.rs` (new)
- **Scope:** Tests for: corrupt session file, stale lockfile, future schema version, dedup behavior, missing files, multi-window restore coordination, poisoned-lock recovery (already fixed by `bae018a3` — protect against regression).
- **Acceptance:** No data-loss path goes untested. Tests share fixtures with WI-1.2's migration tests where possible.
- **Estimate:** 5 h
- **Mode:** parallelizable (after WI-1.2 so fixtures use the migrated schema)

### WI-3.3 — MCP bridge Rust protocol tests

- **Files:** `src-tauri/src/mcp_bridge/types.rs`, `src-tauri/src/mcp_bridge/server.rs`, `src-tauri/src/mcp_bridge/state.rs`, `src-tauri/src/mcp_bridge/server.test.rs` (new)
- **Scope:** Cover malformed JSON, unknown request types, queue bounds (already addressed by `6e69a9fd` — protect against regression), abrupt disconnects, response correlation, concurrent reads through the allowlist.
- **Acceptance:** Untrusted client input cannot panic. Errors are deterministic. Existing fixes are regression-tested.
- **Estimate:** 5 h
- **Mode:** parallelizable

## Phase 4 — Contract Tests and Cleanup

**Goal:** Close the recurring bug classes (MCP contract drift, IME edge cases) and ship low-risk debt cleanup.

**DoD (machine-checkable):**
- New tests pass. `pnpm check:all` green. `cargo check` green.

**Parallelizable?** Mostly. WI-4.1 depends on WI-3.3's fixture infrastructure.

### WI-4.1 — MCP cross-side type-contract test

- **Files:** `src-tauri/src/mcp_bridge/types.rs`, `src/hooks/mcpBridge/types.ts`, `src/hooks/mcpBridge/v2/types.ts`, `src/hooks/mcpBridge/v2/__tests__/dispatch.test.ts` (new)
- **Scope:** One integration test per `BridgeRequest` variant: serde encode in Rust → JSON fixture → TypeScript zod parse → handler dispatch. Removing or renaming a required field on either side fails the test.
- **Acceptance:** Adding a field on one side without the other fails the build. Closes the pattern behind 5+ recent fixes (`fc13846d`, `b44c5f22`, etc.).
- **Estimate:** 3 h
- **Mode:** serial-critical to Phase 4

### WI-4.2 — Terminal IME state consolidation

- **Files:** `src/components/Terminal/setupImeComposition.ts`, `src/components/Terminal/setupImeComposition.test.ts`, possibly `src/components/Terminal/createTerminalInstance.ts`, `src/components/Terminal/terminalSessionInputWiring.ts`
- **Scope:** Make idle/composing/grace states *explicit* in `setupImeComposition.ts` (a discriminated union or string-literal state, not booleans scattered across handlers). Add transition tests for the 6 bug-driving scenarios from recent fixes: empty-data `compositionend`, IME punctuation lying, CSI-u Shift+Enter, grace-window leak in all key handlers, first CJK punctuation char loss, IME state during paste.
- **Acceptance:** All 6 historical bug scenarios are regression-tested. State transitions are explicit. CJK punctuation rules continue to pass existing tests.
- **Estimate:** 4 h
- **Mode:** parallelizable

### WI-4.3 — Multi-cursor `it.todo` drainage

- **Files:** `src/plugins/multiCursor/__tests__/feature-complete.test.ts`, `src/plugins/multiCursor/**` (whatever the tests reveal as needing implementation)
- **Scope:** Replace six `it.todo` placeholders with real tests, then minimal implementation to make them pass. Test IDs: TC-MC-201 (Tab in table), TC-MC-400/401/402 (light/dark/switch theme rendering), column alignment during typing, deselect individual matches.
- **Acceptance:** All six tests pass. No previously-passing multi-cursor tests regress.
- **Estimate:** 2 h
- **Mode:** parallelizable

### WI-4.4 — Verified dead-code cleanup

- **Files:** `src/types/cursorSync.ts`, `src/plugins/tabIndent/tabEscape.ts`, `src-tauri/src/window_manager.rs` (deferred until verified)
- **Scope:** Delete `CursorInfo`, `TableAnchor`, `CodeBlockAnchor`, `BlockAnchor` from `src/types/cursorSync.ts`. Delete `isAtMarkEnd` from `tabEscape.ts` (already `@deprecated`). For `new_window`: grep deeper for menu-internal callers; only delete if confirmed unreferenced.
- **Acceptance:** `rg` finds no remaining importers/callers. Build still passes. No command-registration tests break.
- **Estimate:** 1.5 h
- **Mode:** parallelizable

## Risk gates

| Between phases | Gate type | What it checks |
|----------------|-----------|----------------|
| Before WI-1.2 starts | Manual sign-off | Xiaolai approves: is `activeSchemaId` persisted directly, or derived from `formatId` + user override? (Codex flagged this design ambiguity.) |
| Phase 1 → Phase 2 | `/cc-suite:review-plan` re-run on multi-format plan | rev 6 returns READY TO BUILD or APPROVE-WITH-NOTES |
| Phase 2 → Phase 3 | Manual keyboard pass | File tree, resize handle, sidebar toggle, search inputs operable via keyboard alone |
| Phase 3 → Phase 4 | Engineering review | Rust tests test behavior seams, not implementation snapshots (won't break on internal refactor) |
| Before next release | `/cc-suite:audit` over the diff | Catches anything the report missed |

## Total estimated agent-time

- **Total work:** ~39 h
- **Serial-critical sum:** ~12 h (WI-1.1 + WI-1.2 + WI-1.3 + WI-1.5 + WI-4.1)
- **Parallel-eligible:** ~27 h

Real wall-clock depends on how aggressively the parallel WIs are dispatched. With a single executor, expect ~5 working days. With 2-3 parallel executors on Phase 2-4, ~3 days.

## Cross-references

- Diagnostic input: `dev-docs/grills/grill-report-2026-05-23.md`
- Plan this advances: `dev-docs/plans/20260506-multi-format-rebrand.md`
- AI-governance rules: `.claude/rules/60-ai-governance.md`
- TDD rules: `.claude/rules/10-tdd.md`
- A11y rules: `.claude/rules/33-focus-indicators.md`, `.claude/rules/30-ui-consistency.md`

## Open questions for Xiaolai before Phase 1 starts

1. **Persistence model for `activeSchemaId`** — persist directly, or derive from `formatId` + an optional user override field? (WI-1.2 needs the answer.)
2. **Should the menu matrix in WI-1.3 enforce *disabling* or *hiding* markdown-only actions for non-markdown formats?** (User-facing UX decision.)
3. **Do you want WI-4.4 to delete `new_window` or just file an issue documenting its possible-deadness?** (Lowest cost path is the issue.)
