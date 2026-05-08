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

**Mechanism:** When the AI changes one field of an existing YAML, naive raw rewrite risks losing comments and anchors that the AI didn't bother to preserve in its output. The CST mutator path makes that loss structurally impossible — the server only touches the bytes that correspond to the patched key. Treat the discriminated union as `apply_patch_v1`; future breaking shape changes bump to `_v2`.

**Trade-off acknowledged:** Internal type becomes external contract. Mitigation: flag `IRPatch` in `src/lib/ghaWorkflow/save/mutators.ts` with an `@public` JSDoc so future renames trigger review.

**Confidence:** Medium-high. The patch shape has been stable through Phase 7+8+9 of the GHA viewer plan.

**What `apply_patch` does NOT replace:** `document.read` and `document.write` work on workflow YAML tabs (and every other tab kind). The pruned spine is universal:

- `document.read` returns raw YAML text + revision.
- `document.write` does a verbatim string replace; whatever the AI sends, that's what gets stored. Comments survive iff the AI's output preserves them.
- `apply_patch` is for the case where the AI is making a *targeted* change and the server should guarantee zero collateral edits to surrounding content.

There is deliberately no `workflow.read` (would duplicate `document.read` returning IR — AI parses YAML trivially) and no `workflow.write` (would be strictly worse than `document.write`, because IR-level serialization can't reconstruct comments that aren't in the IR).

### ADR-6: One-shot `session.get_state` replaces five discovery tools

**Decision:** Replace `get_capabilities` + `get_document_revision` + `tabs.list` + `workspace.{get_focused, list_windows, get_document_info}` with a single `vmark.session.get_state` call returning `{windows, capabilities}` with all open tabs and their `{id, filePath, dirty, revision, kind}`.

**Mechanism:** AI orientation typically takes 2–5 round-trips today (capabilities → focused → tabs → revision per doc). Folding into one response saves both wall time and tool-selection ambiguity. The `kind` discriminator (`"markdown" | "yaml-workflow"`) tells the AI which mutation tool applies.

**Confidence:** High.

### ADR-7: Reintroduce `selection.{get, set}` for large-file economics

**Decision:** Add a `selection` tool with two actions, `get` and `set`. Restores the read/replace-selected-text capability removed by ADR-1; does **not** restore the rest of the old `selection.*` family (`extend`, `clear`, range-only `set`). Date: 2026-05-08. Partial reversal of ADR-1.

**Mechanism:** ADR-1 assumed every edit goes through `document.read → reason → document.write`. That is economical on small docs and quadratic-feeling on large ones — every edit pays the full doc in input tokens, the full doc in output tokens (~5× input price), proportionally longer write windows that widen the stale-revision retry loop, and a faithfulness risk where the model silently rewrites untouched bytes under length pressure. `selection.get` cuts input cost to the selected range; `selection.set` cuts output cost to the replacement string. Restricted to the user-driven selection (no AI-side offset arithmetic), which sidesteps the stateful-procedural failure mode that motivated ADR-004.

**Shape:**

- `selection.get({tabId?})` returns `{text, isEmpty, range: {from, to}, mode: "wysiwyg"|"source", kind, tabId, revision}`. `text` is the markdown serialization of the selected slice in WYSIWYG mode, raw text in source mode. `range` is in PM positions (WYSIWYG) or character offsets (source) — `mode` disambiguates.
- `selection.set({tabId?, content, expected_revision?})` replaces the editor's current selection with `content`. In WYSIWYG mode, plain inline text inserts as a literal text node so leading/trailing whitespace round-trips exactly; content carrying markdown markers is parsed as nodes. In source mode, `content` is always spliced as raw text. `expected_revision` mismatch returns `STALE` with `current_revision`. Operates on the selection at call time — pure cursor movement between get and set is not arbitrated by the server (the doc-level revision catches keystrokes).

**Trade-off acknowledged:** Tool surface goes from 4 / 14 to 5 / 15. Two actions, not five — the surface-bloat penalty stays small. New error code `NO_EDITOR` covers the case where the focused tab has no live editor instance.

**Confidence:** High on the economics, medium on the surface-vs-capability balance. Revisit if AI clients start synthesising offset arithmetic on top of `selection.set`; that would be a signal to add `document.replace_range` rather than expand `selection.*`.

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
| `vmark.selection` | `get` | `{tabId?}` | `{text, isEmpty, range: {from, to}, mode: "wysiwyg"\|"source", kind, tabId, revision}` |
| | `set` | `{tabId?, content, expected_revision?}` | `{revision, replaced_chars} \| {error: "STALE" \| "NO_EDITOR" \| "INVALID_TAB", current_revision?}` |

`tabId` is optional everywhere; defaults to the focused tab. `windowLabel` is optional; defaults to the focused window. For `selection.*`, when `tabId` is supplied it must match the focused tab — selection is view-state and only the focused editor has a live selection; mismatch returns `INVALID_TAB`.

**Errors:** Every action returns either `{success: true, data: ...}` or `{success: false, error: <code>, message: <human-readable>}`. Codes: `STALE`, `INVALID_PATCH`, `INVALID_TAB`, `INVALID_PATH`, `READ_ONLY`, `NOT_WORKFLOW`, `NO_EDITOR`, `INTERNAL`.

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

### Phase 2 — Selection re-add (ADR-7)

- **WI-2.1** — `vmark.selection.{get, set}` bridge handlers and MCP tool registration. New files: `src/hooks/mcpBridge/v2/selection.ts`, `vmark-mcp-server/src/tools/selection.ts`. Wire into `v2/dispatch.ts`, `READ_ONLY_BLOCKED`, `index.ts`/`TOOL_CATEGORIES`/`EXPECTED_TOOL_COUNT`. Extend `V2ErrorCode` with `NO_EDITOR` and `CheckpointTool` with `selection.set`. DoD: handler-level tests cover get/set across WYSIWYG and source modes, STALE rejection, no-editor rejection (including destroyed editors), tabId mismatch, single-marker emphasis detection; `--health-check` reports `toolCount: 5`; `pnpm check:all` green.

This is now a two-phase plan; phase boundary is "everything green".

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

## Operational caveats

### Sidecar binary needs rebuilding

The MCP server runs as a packaged native binary at
`src-tauri/binaries/vmark-mcp-server-aarch64-apple-darwin`, built via
`pnpm build:sidecar` in `vmark-mcp-server/`. `pnpm tauri dev` spawns
whatever binary is present; it does **not** rebuild the sidecar
automatically.

Workflow after a sidecar source change:

```bash
cd vmark-mcp-server && pnpm build:sidecar
# then restart `pnpm tauri dev` so the parent picks up the new binary
```

Otherwise external MCP clients still see the previous tool surface
even though the frontend bridge is up-to-date via Vite HMR.

### Live-smoke verified

A live smoke against `pnpm tauri dev` (2026-05-04) confirmed:

- Bridge routes `vmark.session/workspace/document/workflow.*` correctly.
- Legacy types (`document.getContent` etc.) reject with `success:false`.
- `document.write` end-to-end: content updates, revision bumps,
  checkpoint pushes, JSONL persistence fires.
- STALE rejection works (write with bad `expected_revision` leaves
  content unchanged, returns false).
- `document.transform` `cjk-spacing` and `cjk-punctuation` produce the
  expected text rewrites.
- Per-tab checkpoint filtering works in the popover (badge count
  scopes to the focused tab's filePath).
- Restore via popover button rolls back to `contentBefore` and is
  non-destructive of history.
- `workflow.apply_patch` on a path-detected workflow file (.yml under
  `.github/workflows/`) lands the patch and preserves comments.

One bug uncovered and fixed during smoke (commit follows): kind
detection in `document.write` was reading the *current* (often empty)
tab content rather than the *new* content, causing YAML writes to a
fresh untitled tab to route through Tiptap's markdown parser and
garble the structure. Fix: re-evaluate `kind` against `args.content`
at write time. New unit test guards against regression.

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
