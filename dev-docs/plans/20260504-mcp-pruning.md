# MCP Pruning — Four Tools, Hard Cut

**Status:** Draft (Phase 1 in progress)
**Owner:** Xiaolai
**Branch:** `refactor/mcp-prune-to-four-tools`
**Stacks on:** `feature/gh-actions-workflow-viewer` (uses `IRPatch` types from `src/lib/ghaWorkflow/save/mutators`)
**Created:** 2026-05-04

## Goal

Reduce VMark's MCP surface from **12 tools / 76 actions** to **4 tools / 14 actions**, deleting in-document formatting tools that AI agents replicate trivially via Markdown round-trip. Keep workspace/file-level operations and the read/write spine. Preserve CJK formatting (deterministic rule-based rewriter) and the new GitHub Actions workflow CST-safe patch surface (preserves comments/anchors).

## Non-goals

- Backward compatibility — small user pool, hard cut, no deprecation flag.
- Reworking the Rust transport layer — `mcp_bridge::commands::{mcp_bridge_respond, mcp_bridge_heartbeat}` stay as-is.
- Touching the WebSocket protocol shape between server and bridge.

## ADRs

### ADR-1: Drop in-document formatting tools entirely

**Decision:** Remove `format.*` (10), `media.*` minus CJK (9), `table.*` (3), `structure.*` (8), `selection.*` (5), `editor.{undo,redo,focus}`, `tabs.{reopen_closed, list_recent_files}`, and `document.*` mutation actions other than `read`/`write`/`transform` (insert, replace, replace_anchored, batch_edit, apply_diff, smart_insert, read_paragraph, write_paragraph, search).

**Mechanism:** AI agents round-trip Markdown text trivially. Bold is `**bold**`. Tables are pipe syntax. Sections are heading levels. Selections are derivable from full-doc reads. Every retained tool description costs context tokens (Anthropic engineering: tool definitions can drop from 150K to 2K via fewer-richer surfaces; GitHub MCP server alone is ~42K–55K tokens; tool-selection accuracy drops ~95% → ~71% with crowded surfaces). The strongest non-vendor signal — Armin Ronacher's "Code Is All You Need" — collapses Playwright MCP from ~30 tools to one.

**Confidence:** High. Industry convergence is unambiguous.

### ADR-2: Keep CJK formatting via `document.transform`

**Decision:** One new action `vmark.document.transform({kind: "cjk-format" | "cjk-spacing" | "cjk-punctuation"})` calls the deterministic CJK rewriter at `src/lib/cjkFormatter`.

**Mechanism:** CJK rules are rule-based and nuanced (full-width punctuation conversion, em-dash spacing per `AGENTS.md`, half/full-width handling). Unlike Markdown formatting, AI re-implementing CJK in prose is lossy and slow; the server-side rewriter is the reference implementation. One action, three kinds — extensible later (Markmap normalization, etc.) without adding tools.

**Confidence:** High.

### ADR-3: Drop `suggestions.*` (tracked changes)

**Decision:** Remove all 5 suggestion actions and the `suggestionHandlers.ts` handler.

**Mechanism:** User-confirmed: small user base on this feature; the read/write spine subsumes the producer flow (AI writes the proposed content directly), and the consumer flow is a UI-only feature.

**Confidence:** High.

### ADR-4: Optimistic concurrency on every mutation

**Decision:** Every mutation accepts `expected_revision`; mismatch returns `{error: "STALE", current_revision}`.

**Mechanism:** Without revision tokens, AI overwrites user keystrokes during async tool calls. The existing `revisionTracker` infrastructure in `src/hooks/mcpBridge/revisionTracker.ts` already exposes a per-document version counter — reuse it.

**Confidence:** High. Skipping this ships a data-loss bug.

### ADR-5: Expose `IRPatch` as the workflow patch contract

**Decision:** `vmark.workflow.apply_patch({patches: IRPatch[], expected_revision?})` accepts the existing discriminated union from `src/lib/ghaWorkflow/save/mutators.ts` (8 patch kinds: `workflow.set`, `job.set`, `step.set`, `with.set`, `with.remove`, `needs.add`, `needs.remove`, `trigger.setFilters`).

**Mechanism:** Raw text write of YAML loses comments, anchors, and key order — VMark's CST mutators preserve them. Treat the discriminated union as `apply_patch_v1`; future breaking shape changes bump to `_v2`.

**Trade-off acknowledged:** Internal type becomes external contract. Mitigation: flag `IRPatch` in `src/lib/ghaWorkflow/save/mutators.ts` with an `@public` JSDoc so future renames trigger review.

**Confidence:** Medium-high. The patch shape has been stable through Phase 7+8+9 of the GHA viewer plan.

### ADR-6: One-shot `session.get_state` replaces five discovery tools

**Decision:** Replace `get_capabilities` + `get_document_revision` + `tabs.list` + `workspace.{get_focused, list_windows, get_document_info}` with a single `vmark.session.get_state` call returning `{windows, capabilities}` with all open tabs and their `{id, filePath, dirty, revision, kind}`.

**Mechanism:** AI orientation typically takes 2–5 round-trips today (capabilities → focused → tabs → revision per doc). Folding into one response saves both wall time and tool-selection ambiguity. The `kind` discriminator (`"markdown" | "yaml-workflow"`) tells the AI which mutation tool applies.

**Confidence:** High.

## Final tool surface

| Tool | Action | Args | Returns |
|---|---|---|---|
| `vmark.session` | `get_state` | `{}` | `{windows: [{label, focused, tabs: [{id, filePath?, title, dirty, revision, kind}]}], capabilities: {version, supportedKinds, mcpProtocol}}` |
| `vmark.workspace` | `new` | `{kind?, windowLabel?}` | `{tabId}` |
| | `open` | `{filePath, windowLabel?}` | `{tabId}` |
| | `save` | `{tabId}` | `{filePath, revision}` |
| | `save_as` | `{tabId, filePath}` | `{revision}` |
| | `close` | `{tabId, force?: bool}` | `{closed: bool, reason?}` |
| | `switch_tab` | `{tabId}` | `{}` |
| | `focus_window` | `{windowLabel}` | `{}` |
| `vmark.document` | `read` | `{tabId?}` | `{content, revision, filePath?, kind, dirty}` |
| | `write` | `{tabId?, content, expected_revision?}` | `{revision} \| {error: "STALE", current_revision}` |
| | `transform` | `{tabId?, kind, expected_revision?}` where `kind ∈ {"cjk-format", "cjk-spacing", "cjk-punctuation"}` | `{revision} \| {error: "STALE", current_revision}` |
| `vmark.workflow` | `apply_patch` | `{tabId?, patches: IRPatch[], expected_revision?}` | `{revision} \| {error: "STALE" \| "INVALID_PATCH", details?}` |
| | `validate` | `{tabId?}` | `{ok: bool, diagnostics: [{line, col, message, severity}]}` |

`tabId` is optional everywhere; defaults to the focused tab. `windowLabel` is optional; defaults to the focused window.

**Errors:** Every action returns either `{success: true, data: ...}` or `{success: false, error: <code>, message: <human-readable>}`. Codes: `STALE`, `INVALID_PATCH`, `INVALID_TAB`, `INVALID_PATH`, `READ_ONLY`, `NOT_WORKFLOW`, `INTERNAL`.

## Work items

### Phase 1 — Foundation (this PR)

- **WI-1.1** — Plan doc (this file). DoD: file present, all ADRs filled, work items linked.
- **WI-1.2** — New dispatchers under `src/hooks/mcpBridge/dispatchers/` for `session`, `workspace`, `document`, `workflow`. DoD: each dispatcher has unit tests covering happy path + STALE error path.
- **WI-1.3** — New server tool registrations replacing 11 files in `vmark-mcp-server/src/tools/` with 4 (`session.ts`, `workspace.ts`, `document.ts`, `workflow.ts`). DoD: `pnpm --filter vmark-mcp-server test` green.
- **WI-1.4** — Tests for the new surface (TDD per `.claude/rules/10-tdd.md`). DoD: every action has at least one happy-path test, every mutation has a STALE-revision test, every error code has a test.
- **WI-1.5** — Delete dropped handlers, dispatchers, server tool files, locale strings, and tests. Trim `src-tauri/capabilities/default.json` if any newly-unused commands remain. DoD: `git grep` finds no references to dropped tool names; `pnpm check:all` green.
- **WI-1.6** — Website docs rewrite (`website/guide/mcp-tools.md`); scrub references in `mcp-setup.md`. DoD: `cd website && pnpm build` succeeds; new doc reflects 4-tool surface.
- **WI-1.7** — Version bump per `.claude/rules/40-version-bump.md` (5 files, breaking change). DoD: all 5 files match.
- **WI-1.8** — Final gate: `pnpm check:all` + Tauri MCP smoke (read/write Markdown, transform CJK, apply_patch + validate on a workflow YAML). DoD: smoke passes; commit message lists every WI closed.

This is a single-phase plan; phase boundary is just "everything green".

## Definition of Done

A custom check script — same shape as `scripts/check-gha-phase.sh` — is **not** required for a single-phase plan. The DoD is:

```bash
pnpm check:all && \
  bash scripts/check-wi-linkage.sh dev-docs/plans/20260504-mcp-pruning.md && \
  bash scripts/check-new-deps.sh
```

Plus: manual Tauri MCP smoke per WI-1.8.

## Test strategy

Per `.claude/rules/10-tdd.md`:

| Test | Pattern | File |
|---|---|---|
| `session.get_state` shape | dispatcher unit test | `src/hooks/mcpBridge/dispatchers/__tests__/session.test.ts` |
| `document.read` returns revision | dispatcher unit test | `dispatchers/__tests__/document.test.ts` |
| `document.write` happy path | dispatcher unit test | same |
| `document.write` STALE on revision mismatch | dispatcher unit test | same |
| `document.transform` CJK kinds | per-kind table-driven | same |
| `workflow.apply_patch` dispatches each IRPatch kind | table-driven | `dispatchers/__tests__/workflow.test.ts` |
| `workflow.apply_patch` STALE | unit test | same |
| `workflow.validate` propagates actionlint diagnostics | unit test | same |
| `workspace` lifecycle (new → save → close) | integration | `dispatchers/__tests__/workspace.test.ts` |

Coverage target: no regression vs. the current `vitest.config.ts` thresholds (statements 94.80, branches 93.05, lines 94.80, functions 95.20). Net coverage should rise — the dropped tools have less coverage than the new surface will have.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| External MCP clients break silently | Medium | Documented in changelog; small user pool accepted. |
| `IRPatch` becomes external contract | Medium | `@public` JSDoc on `IRPatch` types; version bump on shape change. |
| CJK rewriter doesn't expose all variants AI needs | Low | One-action-many-kinds shape extends without API churn. |
| Coverage drops below threshold | Low | TDD-first per WI; expect net rise. |
| Rust capabilities accidentally over-permissive | Low | Audit `src-tauri/capabilities/default.json` in WI-1.5. |
| `.claude/hooks/gha-tdd-guard.mjs` blocks edits to GHA mutator code | Low | Test-first for any changes touching `src/lib/ghaWorkflow/`. |

## What's not in scope

- Selection-aware tools (`vmark.selection.get`) — defer until evidence of "fix this selection" flows.
- Search tool (`vmark.search`) — defer until evidence of large-doc pain.
- Markmap/Mermaid diagram surface — AI writes them as Markdown text.
- Tracked-changes (suggestions) — see ADR-3.

If real usage demands any of these, add them as a Phase 2 amendment.

## References

- `.claude/rules/60-ai-governance.md` — plan-doc contract, WI linkage, dependency review
- `.claude/rules/10-tdd.md` — RED → GREEN → REFACTOR
- `.claude/rules/40-version-bump.md` — 5-file version sync
- `.claude/rules/21-website-docs.md` — website doc sync
- Anthropic — [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- Armin Ronacher — [Your MCP Doesn't Need 30 Tools](https://lucumr.pocoo.org/2025/8/18/code-mcps/)
