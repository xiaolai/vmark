# Architecture decision records

The decisions that rules, comments and docs in this repository cite by id. They live here, tracked, so a
clone can read what `ADR-013` means instead of taking the id on trust.

`pnpm lint:adr-refs` (`scripts/check-adr-refs.mjs`) reads every tracked file and fails when one cites an id
that has no record here. It also fails when a record is not linked from this page.

## Two id spaces

| Shape | Scope | Where the record is |
|---|---|---|
| `ADR-NNN` — exactly three digits | the whole repository; each number is used once | `ADR-NNN-<slug>.md` in this directory |
| anything else — `ADR-2`, `ADR-1a`, `ADR-C4`, `ADR-PDF1` | one plan; several plans have their own `ADR-2` | one file per plan under [`plans/`](plans/), or the tracked plan itself under `.claude/tdd-guardian/` |

A plan-scoped id only means something next to the feature its plan built: `ADR-2` in
`src/stores/paneStore.ts` is the split-documents plan's, and `ADR-2` in `src-tauri/src/content_server/` is
the content-server plan's. The tables below say which plan built what. The gate proves a plan-scoped id is
defined by some plan; it cannot tell which plan a bare citation means, so name the feature or the plan
when you cite one.

## Repository-wide records

Each record is the text that was written when the decision was made, restored unedited, under a short
note saying where it came from and what enforces it today. Several were found not to describe the code by
a review on 2026-07-22, and their Status lines say so: read the Status line and the "Enforced by" note
before relying on one.

| Record | Decision | Status line in the record |
|---|---|---|
| [ADR-001](ADR-001-markdown-as-source-of-truth.md) | Markdown as source of truth | Accepted |
| [ADR-002](ADR-002-mcp-sidecar-architecture.md) | MCP sidecar architecture | Accepted |
| [ADR-003](ADR-003-tiptap-over-milkdown.md) | Tiptap over Milkdown | Accepted |
| [ADR-004](ADR-004-human-oriented-mcp-tools.md) | Human-oriented MCP tool design | Superseded |
| [ADR-005](ADR-005-cli-based-ai-provider-routing.md) | CLI-based AI provider routing | Reversed in practice |
| [ADR-006](ADR-006-terminal-program-identity.md) | Terminal `TERM_PROGRAM` identity | Accepted |
| [ADR-007](ADR-007-shell-as-composition-root.md) | Shell as composition root | Accepted (drifted) |
| [ADR-008](ADR-008-workspace-as-single-facade.md) | Workspace as single facade | False in practice |
| [ADR-009](ADR-009-document-as-unit-of-state.md) | Document as the unit of state | Drifted |
| [ADR-010](ADR-010-editor-host-as-mode-agnostic-interface.md) | Editor host as mode-agnostic interface | False in practice |
| [ADR-011](ADR-011-plugin-manifest-contract.md) | Plugin manifest contract | Superseded by ADR-015 |
| [ADR-012](ADR-012-command-bus-as-single-intent-path.md) | Command bus as the single intent path | Accepted |
| [ADR-013](ADR-013-service-tier-as-cross-cutting-seam.md) | Service tier as the cross-cutting seam (the three-tier layout) | Accepted |
| [ADR-014](ADR-014-theme-tokens-as-typed-data.md) | Theme tokens as typed data | Accepted |
| [ADR-015](ADR-015-extension-model.md) | Extension model | Proposed |
| [ADR-016](ADR-016-capability-broker-requires-isolation.md) | A capability broker requires an isolation boundary first | Accepted |
| [ADR-017](ADR-017-command-bus-absorbs-the-action-registry.md) | The command bus absorbs the action registry | Proposed |
| [ADR-018](ADR-018-keybinding-registry.md) | One binding registry, many capture adapters | Proposed |
| [ADR-019](ADR-019-extension-host-api.md) | Extension host API | Proposed |

Two of these are cited by rules every change follows: ADR-013 (`AGENTS.md`, the three-tier source layout)
and ADR-014 (`.claude/rules/31-design-tokens.md`, where theme colours are defined).

## Plan-scoped records

Each file holds one plan's decisions, cut out of the plan unedited. The plans themselves are
maintainer-local (`dev-docs/plans/`), except the three that are tracked under `.claude/tdd-guardian/`,
which are linked in place.

| Plan | Decisions | What it built |
|---|---|---|
| [Workflow Engine: YAML Workflows + React Flow Visualization](plans/20260331-workflow-engine.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5 | workflow engine (first design) |
| [Genie Execution Inside YAML Workflows](plans/20260418-genie-in-workflow.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6 | genie steps inside YAML workflows (`src-tauri/src/workflow/`, `src-tauri/src/genies/`, `src-tauri/src/ai_provider/sink.rs`) |
| [GitHub Actions Workflow Viewer & Editor](plans/20260504-github-actions-workflow-viewer.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7, ADR-8, ADR-9, ADR-10, ADR-11 | GitHub Actions workflow viewer (`src/lib/ghaWorkflow/`) |
| [Workflow Fence Snapshot — xyflow inline render](plans/20260504-workflow-fence-snapshot.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6 | inline workflow-fence snapshot (`src/lib/ghaWorkflow/render/`, `src/plugins/codePreview/`) |
| [MCP Pruning — Four Tools, Hard Cut](plans/20260504-mcp-pruning.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7 | the pruned MCP tool surface (`server/mcp/`, `src/services/mcpBridge/v2/`) |
| [Multi-Format Workspace + Rebrand — Plain-Text Workspace for Humans and AI](plans/20260506-multi-format-rebrand.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7, ADR-8, ADR-9, ADR-10, ADR-11, ADR-12, ADR-13 | the multi-format workspace (`src/lib/formats/`) |
| [Grill Report Follow-Up — Hardening From the 2026-05-23 Investigation](plans/20260523-grill-followup.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5 | follow-up hardening from the 2026-05-23 review |
| [Audit Remediation — Dead Code, Optimization, Correctness & Hardening](plans/20260530-audit-remediation.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6 | the 2026-05-30 audit remediation (boundary shape guards, dead code) |
| [Terminal — Road to Industrial-Best (Implementation Plan)](plans/20260531-terminal-industrial-best.md) | ADR-T1, ADR-T2, ADR-T3, ADR-T4 | the terminal (`src-tauri/src/pty.rs`, `src/lib/pty.ts`, shell integration) |
| [Slidev Support + Knowledge-Base Content Server](plans/20260624-1500-slidev-kb-content-server.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-9, ADR-10, ADR-7, ADR-8 | the knowledge-base and Slidev content server (`server/content/`, `src-tauri/src/content_server/`) |
| [Window Status Panel (#1057)](plans/20260627-window-status-panel.md) | ADR-1, ADR-2, ADR-3 | the window status panel (`src-tauri/src/window_status/`) |
| [View Menu Mode Selector + Toggle Correctness (#1070)](plans/20260629-1000-view-mode-selector.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6 | the View-menu editor-mode selector |
| [Two Documents Side by Side (#1081)](plans/20260629-1010-side-by-side-documents.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5b, ADR-6b, ADR-8, ADR-5, ADR-6, ADR-7 | two documents side by side (first design; superseded by the split-documents plan) |
| [Two Documents Side-by-Side in One Window (#1081)](plans/20260701-split-documents.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7 | split documents (`src/stores/paneStore.ts`, `src/contexts/PaneContext.tsx`) |
| [Media Viewer — images / audio / video preview](plans/20260703-media-viewer.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-7 | the media viewer |
| [Split-Pane View Modes — Source / Split / Preview](plans/20260703-split-pane-view-modes.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7, ADR-8 | Source / Split / Preview view modes for split-pane formats |
| [Editor Right-Click Context Menu (Issue #1111)](plans/20260709-editor-context-menu.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6 | the editor context menu (`src/components/Editor/EditorContextMenu/`, `src-tauri/src/webview_edit.rs`) |
| [Embedded Browser, Site Plugin System & Web Workflows](plans/20260712-0610-embedded-browser-sites-workflows.md) | ADR-B1, ADR-B2, ADR-B3, ADR-B4, ADR-B6, ADR-B5, ADR-S1, ADR-S2, ADR-S3, ADR-S4, ADR-W1, ADR-W2, ADR-W3 | the embedded browser, site registry and browser workflows (`src-tauri/src/browser/`, `src/lib/sites/`, `src/lib/browser/workflow/`) |
| [Browser ↔ VMark Shell Integration](plans/20260714-browser-shell-integration.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7, ADR-8 | browser tabs in the shell (`src/components/Browser/`, `src/services/browser/`) |
| [Browser Automation — Richer Perception & Interaction](plans/20260715-browser-automation-perception.md) | ADR-A1, ADR-A2, ADR-A3, ADR-A4, ADR-A5, ADR-A6, ADR-A7 | AI browser automation (`src/lib/browser/agent/`, `src-tauri/src/browser/`) |
| [Plan: Coherence Layer — Kernel + Breakdown View (Phases 0–1, later phases outlined)](plans/20260718-coherence-layer.md) | ADR-C1, ADR-C2, ADR-C3, ADR-C4, ADR-C5 | the coherence kernel (`src-tauri/src/coherence/`) |
| [Plan: Coherence Runtime Layer — Verify-at-Volume, Classifier, Forward Operators, Canon-Hub, Merge Auditor](plans/20260719-coherence-runtime-layer.md) | ADR-P1, ADR-P2, ADR-P3, ADR-P4, ADR-P5 | the coherence runtime layer (`src-tauri/src/coherence/preview.rs`, `edge_kind.rs`, `merge_audit.rs`) |
| [Durable ledger store + git-revert auto-repair (Option 1)](plans/20260721-coherence-durable-ledger-store.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7 | the coherence durable ledger store |
| [Plan: Preserve blank-line runs through the WYSIWYG round trip](plans/20260721-blank-line-preservation.md) | ADR-1, ADR-1a, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6 | blank-line preservation (`src/utils/markdownPipeline/blankLineCapture.ts`) |
| [Plan: `open_workspace` MCP tool with approval gate](plans/20260721-mcp-open-workspace.md) | ADR-2, ADR-3, ADR-4, ADR-1 | MCP `workspace.open_folder` and its approval (`src/stores/workspaceApprovalStore.ts`) |
| [Tier Boundary Restoration (H4 burn-down)](plans/20260722-tier-boundary-restoration.md) | ADR-1, ADR-2 | tier-boundary restoration (the `use*` naming rule for hooks) |
| [Browser hardening + E2E verification](plans/20260726-browser-hardening-and-e2e.md) | ADR-BR1, ADR-BR2, ADR-BR3, ADR-BR4 | browser hardening and the AI-browser E2E journeys (`e2e/`) |
| [CRLF invariant and the source-mode block model](plans/20260731-crlf-and-source-block-model.md) | ADR-1, ADR-2 | CRLF handling and the Source-mode block model |
| [The verified core — specification over accumulation](plans/20260802-verified-core.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7 | the verified Markdown core |
| [Markdown testing adoption — harden the spec tier, close the editing-op gap](plans/20260805-markdown-testing-adoption.md) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6 | the Markdown spec, corpus and soak test tiers (`src/utils/markdownPipeline/__tests__/spec/`) |
| [Agent edit ledger (#1591)](plans/20261021-agent-edit-ledger.md) | ADR-AL1, ADR-AL2, ADR-AL3, ADR-AL4, ADR-AL5, ADR-AL6, ADR-AL7, ADR-AL8, ADR-AL9, ADR-AL10, ADR-AL11, ADR-AL12, ADR-AL13, ADR-AL14, ADR-AL15 | the agent edit journal and its history panel (`src-tauri/src/agent_journal/`, `src/services/agentJournal/`, `src/components/McpHistory/`) |
| [Forward Operators and the Semantic-Merge Auditor (design proposal)](plans/20260719-coherence-forward-operators-proposal.md) | ADR-C6, ADR-C7 | the coherence runtime layer's forward operators and merge auditor |
| [Debt paydown](../tdd-guardian/plan-20260809-debt-paydown.md) (tracked plan, in place) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5 | the ratcheting baselines and the gates over them (`scripts/`) |
| [Audit follow-ups](../tdd-guardian/plan-20260809-followups.md) (tracked plan, in place) | ADR-1, ADR-2, ADR-3, ADR-4, ADR-5, ADR-6, ADR-7 | baseline review schedule, work-item linkage, change-size gate (`scripts/`) |
| [Cross-platform PDF export](../tdd-guardian/20260816-cross-platform-pdf-export.md) (tracked plan, in place) | ADR-PDF1, ADR-PDF1a, ADR-PDF2, ADR-PDF3, ADR-PDF4, ADR-PDF5, ADR-PDF6, ADR-PDF7 | PDF export (`src-tauri/src/pdf_export/`) |

## Adding a record

A decision that binds the whole repository gets the next free three-digit number:

1. Write `ADR-NNN-short-title.md` here. The first line is `# ADR-NNN: Title`; then a Status line, Context,
   Considered options, Decision, Consequences, and "Enforced by" — the gate, test or config that holds the
   decision, or a plain statement that nothing does.
2. Add its row to the table above.

A decision that belongs to one plan stays in the plan. If the plan is tracked under
`.claude/tdd-guardian/`, define the id there as a heading or a bold paragraph that starts with the id. If
the plan is maintainer-local and code cites its decisions, copy them to `plans/<plan file name>` with a
`> Defines:` line listing the ids, and add the row above.

When a decision is reversed, change the record's Status line and say what replaced it. Do not delete the
record while anything still cites it; the gate will say what does.
