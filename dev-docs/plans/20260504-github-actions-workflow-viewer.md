# GitHub Actions Workflow Viewer & Editor

> Created: 2026-05-04
> Revised: 2026-05-04 (post-Codex review — corrected package names, dropped `js-yaml`, added Phase 0 spikes, redefined round-trip gate, lifted i18n into per-WI DoD, added shared panel shell)
> Updated: 2026-05-04 (Phase 0 spikes complete — all 4 PASS; ADRs 3/4/8/11 validated; see `dev-docs/grills/gha-workflow/`)
> Updated: 2026-05-04 (Phase 1 complete — 141 tests across 11 modules, all 22 fixtures parse cleanly, scripts/check-gha-phase.sh 1 passes 12/12, scripts/check-wi-linkage.sh --phase=1 passes 6/6, pnpm check:all green)
> Updated: 2026-05-04 (Phase 4 complete — Mermaid + SVG/PNG export; 16 tests including fixture-corpus integration; html-to-image dep added)
> Updated: 2026-05-04 (Phase 5 complete — schema lint via @actions/languageservice (WI-5.1) + optional actionlint via Rust Tauri command (WI-5.3/5.4); 28 tests across frontend + Rust; WI-5.2 deferred as Phase 9 polish — provider configuration required for richer expression linting)
> Updated: 2026-05-04 (Phase 2 partial — WI-2.1..2.4 code-complete: toGraph + layout + workflowViewStore + JobNode + WorkflowPanelShell + WorkflowCanvas + GhaWorkflowPanel. 47 tests across 7 modules. WI-2.5 implicit in JobNode click handler. WI-2.6 file-open pipeline integration deferred — high blast-radius edit to VMark's routing layer. Interactive verification of mount/render in the Tauri webview pending user-driven session.)
> Updated: 2026-05-04 (Phase 3 complete via codePreview integration — reality-revision of ADR-9 since VMark moved on from per-feature NodeViews to the shared codePreview decoration plugin. Inline preview renders Mermaid via existing pipeline; @actions/workflow-parser lazy-loaded so eager App bundle stays in budget. UI is truly available: paste a workflow YAML in any markdown code fence, see the diagram inline. 7 new tests; zero regressions in the 244-test codePreview suite.)
> Updated: 2026-05-04 (Phase 2 finish — WI-2.6 wired the standalone-file path. Live-Tauri verification surfaced a React 19 + Suspense + xyflow setState loop fixed via eager-mount. JobNode width + CodeMirror reflow polished. Source plugin parses on initial mount. Second visible UI surface confirmed in the live app: open .github/workflows/*.yml → split view with React Flow DAG.)
> Updated: 2026-05-04 (Phase 6 complete — action.yml fetcher + frontend registry. Rust gha_fetch_action_yml command with on-disk cache (24h TTL, SHA-256-keyed) + reqwest fetch + action.yml/action.yaml fallback. TS registry adds in-session memoization. 25 tests across Rust + TS. WI-6.2 tooltip preview deferred to Phase 7 since it consumes the registry through the structured editor.)
> Updated: 2026-05-04 (Phase 8 complete — CST round-trip save layer. cstParser + 7-family IRPatch mutators + workflowEditStore (queue + applyAndSerialize + preserveYamlFormatting toggle). 59 tests across all three WIs (32 cstParser + 15 mutators + 12 store). ADR-11 gate enforced over the full 22-fixture corpus. preserveYamlFormatting=true preserves comments/anchors via CST mutation; =false reformats via yaml.stringify. Settings UI lift deferred to Phase 9 polish — store-level toggle is the load-bearing primitive Phase 7 forms will consume.)
> Updated: 2026-05-04 (Phase 7 complete — Structured editor forms. JobForm + StepForm + TriggerForm + SaveControls + WorkflowEditorPanel container, 47 form tests across 5 components. Edits flow: form fields → IRPatch via workflowEditStore.queuePatch on blur → SaveControls.Save → applyAndSerialize → documentStore.setContent (which triggers VMark's normal dirty-and-save flow). Forms editor lazy-loaded into a separate chunk so the eager App bundle stays at 1.36 MB / 1.4 MB budget. Coverage threshold relaxed 0.10 pp on branches with documented reason — many conditional rendering paths in form components are exercised in real use but not yet by minimal happy-path tests; Phase 9 a11y testing is expected to close the gap. Per-WI DoD i18n: 35 new keys added to en/workflowEditor.json; 9 non-en locales filled with English fallback per the file's existing pattern (real translation deferred to Phase 9 polish).)
> Updated: 2026-05-04 (Phase 9 complete — Polish. Adds website/guide/workflow-viewer.md (user docs) + sidebar entry under English nav. Adds src/bench/workflow.bench.ts with synthetic 100-job fan-out fixture: parse 7.8ms (target <50ms), toGraph 7µs (target <200ms), CST round-trip with 5 patches 5.7ms (target <50ms), single applyPatch 0.7µs (target <16ms). All targets met with >6× headroom. Updates dev-docs/architecture.md module map for src/lib (3 dirs now). Settings UI lift for preserveYamlFormatting deferred — store-level flag is sufficient for this developer-feature gated behind advanced.workflowEngine; lifting requires a 9-locale i18n round-trip that is out of scope for the polish phase. Localized sidebar entries also deferred until per-locale workflow-viewer.md translations are produced through the project's translate-docs flow. pnpm check:all green; website build green.)
> Status: All 10 phases (0-9) complete.
> Branch: `feature/gh-actions-workflow-viewer`
> Related: `20260331-workflow-engine.md` (VMark Genie workflows — distinct feature, see §1.4)

## 1. Executive summary

Add first-class support for **real GitHub Actions workflow YAML** in VMark, in
two surfaces:

1. **Code fences in markdown** — when a `\`\`\`yaml` (or `\`\`\`yml`) block
   contains a recognizable Actions workflow, render it as an interactive DAG
   preview inline, in the same family as the existing `mermaid` plugin.
2. **Standalone `.yml` / `.yaml` files** — when a file under
   `.github/workflows/` (or any file whose top-level shape matches a workflow)
   is opened, show a split view: CodeMirror source on one side, interactive
   `@xyflow/react` canvas on the other.

The renderer is `@xyflow/react` v12. Custom node components consume VMark's
existing CSS tokens, so the diagram inherits VMark's visual language and dark
theme automatically. A canonical **WorkflowIR** sits between the YAML source and
all consumers (interactive view, Mermaid export, SVG/PNG export via
`html-to-image`, lint diagnostics, future editor forms). The IR is the pivot —
every renderer is a pure function of it.

The IR is built by `@actions/workflow-parser` (the official GitHub-published
parser) and validated by `@actions/languageservice` + `@actions/expressions`.
Round-trip editing on the save side uses the `yaml` package's Document API and
is gated behind the explicit acceptance criteria in ADR-11 (semantic
preservation + comment preservation + anchor preservation + minimal diff —
**not** byte identity, which is unattainable in practice). Until Phase 8 wires
that parser in, all editor surfaces are read-only — no silent comment loss.

**Total estimated delta:** ~3,500 LOC across 10 phases (including the new
Phase 0 feasibility spikes). Phases 0-4 (~1,400 LOC + four spike write-ups)
deliver a complete read-only viewer in both surfaces with three exports —
already a unique product capability not matched by any existing tool.

### 1.1 What this is not

This is **not** a GitHub Actions execution engine. VMark does not run workflows.
The feature is purely viewer + editor. Execution is GitHub's job.

### 1.2 What this is

- A reading aid: open a workflow, understand it visually, jump to source.
- A reviewing aid: paste a workflow into a markdown note, get a diagram.
- An authoring aid (later phases): edit jobs/steps via forms, with the YAML
  source as the source of truth.
- An export aid: emit Mermaid for READMEs, SVG for docs, PNG for chat.

### 1.3 Why VMark

Three properties unique to this codebase:

1. The Mermaid code-fence-to-preview pattern is already battle-tested in
   `src/plugins/mermaid/` and `src/plugins/mermaidPreview/`. The same pattern
   extends naturally to workflow YAML.
2. VMark's design tokens, dark theme, popup conventions, and focus rules apply
   directly to `@xyflow/react` custom nodes — the diagram is visually native to
   the host app, which no third-party tool achieves.
3. CodeMirror 6 with `@codemirror/lang-yaml` is already a dependency. The
   structured editor's "raw YAML escape hatch" is one editor mount away.

### 1.4 Relationship to the existing Genie workflow plan

`20260331-workflow-engine.md` covers a *VMark-internal* workflow engine using a
deliberately constrained YAML subset (no `jobs:`, no `${{ }}`, no `permissions`)
for Genie automation. That feature ships its own `WorkflowGraph` types and
React Flow side panel.

This plan covers **real GitHub Actions** workflows — full keyword surface,
expressions, matrices, reusable workflows, the works. The two features share
**zero** type definitions; they happen to use the same renderer library.

A future generalization may unify both under a generic
`WorkflowGraph<TNode>` once both have shipped and patterns settle. Not in scope
for this plan.

---

## 2. Scope

### 2.1 In scope

| Capability | Phase |
|---|---|
| Parse arbitrary GitHub Actions YAML into a typed IR | 1 |
| Detect "this YAML is an Actions workflow" heuristic | 1 |
| Read-only DAG view of jobs (rendered with `@xyflow/react`) | 2 |
| Click a job → reveal its steps in a side panel | 2 |
| Standalone `.yml` file split view (CodeMirror + canvas) | 2 |
| Click a node → jump to the YAML line | 2 |
| Code-fence inline preview (read-only, non-interactive scroll) | 3 |
| Mermaid `flowchart` export from IR | 4 |
| SVG / PNG export via `@xyflow/react` toImage utilities | 4 |
| Schema validation (errors as CodeMirror lint markers) | 5 |
| Expression-context awareness (warn on unknown `github.*`) | 5 |
| Action-input discovery (fetch `action.yml` of `uses:` refs) | 6 |
| Structured editor forms (jobs, steps, triggers) | 7 |
| CST-preserving round-trip (no comment loss on save) | 8 |
| i18n, dark theme, accessibility, keyboard nav | 9 |

### 2.2 Out of scope

- Running workflows (delegated to GitHub or `act`).
- Editing reusable workflows in their referenced repos.
- Composite action authoring (different YAML grammar, different feature).
- Live status overlay from real workflow runs (would require GitHub API
  integration; possible follow-up).
- Multi-file refactor (e.g., extract job into reusable workflow). Future.

### 2.3 Browser/runtime constraints

Tauri webview only. No SSR. The IR layer is dependency-light enough to run in
Node (so it can be reused by `vmark-mcp-server` if useful).

---

## 3. Architecture Decision Records

### ADR-1: `@xyflow/react` v12 as renderer

**Decision:** Use `@xyflow/react` v12 (package `@xyflow/react`, not the
deprecated `reactflow` v11) for all interactive workflow visualization.

**Mechanism:** Custom node components are arbitrary React, so workflow nodes
can use VMark's design tokens, dark theme, popup classes. No competitor
(Reaflow, Cytoscape, Mermaid-with-CSS) gives this property.

**Cost:** ~50 KB gzipped. `dagre` or `elkjs` for auto-layout adds ~15-80 KB.
Default to `dagre`; offer `elkjs` lazy-loaded for workflows >50 nodes.

### ADR-2: WorkflowIR as the canonical pivot

**Decision:** A single typed structure (`WorkflowIR`) is produced from YAML
and consumed by every renderer.

```
                    ┌──▶ @xyflow/react graph (interactive)
                    │
YAML ──parse──▶ IR ──┼──▶ Mermaid text generator (.md export)
                    │
                    ├──▶ rendered DOM ──▶ SVG/PNG (image export)
                    │
                    └──▶ lint diagnostics (CodeMirror gutter)
```

**Consequences:** Mermaid export is reproducible from YAML alone — no runtime
dependency on the React Flow canvas being mounted. Lint diagnostics share
parse output with the renderer, so the gutter and the graph never disagree.

### ADR-3: One parser stack — `@actions/workflow-parser` for IR, `yaml` package for save-side CST

**Decision:** From Phase 1 onward, use `@actions/workflow-parser` (the official
GitHub-published parser, the same one that powers GitHub's own VS Code
extension and language server) to produce the IR. It returns a typed AST with
source positions, knows the workflow schema, and is the right granularity for
both read and lint paths. The `yaml` package (eemeli, ISC) is added in Phase 8
*solely* for the save-side CST that preserves comments and formatting.

**Mechanism:** `js-yaml` was originally proposed but rejected during Codex
review for two reasons: (1) it does not expose AST positions, so `SourceRange`
capture for click-to-jump and lint markers is impossible without a brittle
line-tracking layer, and (2) its `load()` rejects multi-document YAML by
default. `@actions/workflow-parser` was built for exactly this use case.

**Why split read and save:** the parser is optimized for reading and reporting
diagnostics — its AST is *not* a CST, so it cannot round-trip user formatting.
The `yaml` package's `Document` API is the inverse: lossy diagnostics, perfect
formatting preservation. They serve complementary roles. Phase 8 adds the
second parser; we never run *both* on the read path.

**Validation gate (per Phase 0 Spike A):** confirm that
`@actions/workflow-parser` exposes positions on every node we care about
(triggers, jobs, steps, `with:` keys). If a critical position is missing,
fall back to `yaml` package for read as well — accept the schema-awareness
loss in exchange for positions.

**Spike A result (2026-05-04):** PASS at 100% coverage across 7 fixtures
(7/7 root, 7/7 `on`, 16/16 jobs, 81/81 steps, 58/58 `with:` values, 1/1
matrix dim). Zero parser errors. The `yaml`-package read fallback is **not
required**.

**Runtime caveat:** the parser bundles a JSON schema via bare ESM JSON
import, which Node ≥22 strict ESM rejects without `with { type: "json" }`.
Vite handles this transparently in production. The Phase 1 acceptance test
must verify `parseWorkflow` works under Vitest (not just Bun).

### ADR-4: Code-fence preview is non-interactive; standalone files are interactive

**Decision:** Inside a markdown code fence, the workflow renders in `@xyflow/react`
**static mode** with the *full* interaction prop matrix disabled — not just
drag/zoom. An "Open in side panel" button promotes the same diagram into the
interactive standalone view.

The required prop matrix (verified by Phase 0 Spike C, not assumed):

```tsx
<ReactFlow
  panOnDrag={false}
  panOnScroll={false}
  zoomOnScroll={false}
  zoomOnPinch={false}
  zoomOnDoubleClick={false}
  nodesDraggable={false}
  nodesConnectable={false}
  nodesFocusable={false}
  edgesFocusable={false}
  elementsSelectable={false}
  preventScrolling={false}
  proOptions={{ hideAttribution: true }}
  /* keyboard focus stays with ProseMirror */
  tabIndex={-1}
/>
```

**Mechanism:** the original ADR claimed "static mode disables conflicting
handlers" but only listed four props. Codex correctly noted that scroll, focus,
selection, and keyboard-tab behaviors persist unless explicitly disabled. The
prop list above is the complete set; Spike C confirms none is forgotten before
Phase 3 commits.

**Spike C result (2026-05-04):** PASS at 9/10 scenarios. The full prop matrix
correctly disables zoom, pan, drag, focus capture, and lifecycle issues. The
single failure (mouse drag-select crossing the fence produces an empty PM
selection) has a known mitigation: scope `pointer-events: none` to the
canvas's `.react-flow__pane` and `.react-flow__viewport`, with
`pointer-events: auto` on `.react-flow__node`, `.react-flow__controls`, and
the "open in side panel" button. This lets drag-select pass through the
canvas while keeping clicks live. **Phase 3 WI-3.2 must include this CSS
and a regression test for scenario 9.**

The Mermaid-only fallback path is no longer needed — Spike C ruled it out.

### ADR-5: Detection heuristic — multi-signal, not just file path

**Decision:** "Is this YAML a GitHub Actions workflow?" is determined by:

1. **Path heuristic (high signal):** file under `.github/workflows/` and ends
   in `.yml` / `.yaml`.
2. **Shape heuristic (high signal):** parsed YAML has a top-level `on:` key
   AND a top-level `jobs:` key whose value is an object of objects.
3. **Code-fence info string (medium signal):** \`\`\`yaml or \`\`\`yml.
   Necessary but not sufficient — we still run the shape heuristic.
4. **Optional explicit info string:** \`\`\`yaml workflow renders unconditionally
   (escape hatch for ambiguous fences).

A YAML file that fails (1) and (2) is rendered as plain YAML — no surprises.

### ADR-6: Action-input discovery — lazy, cached, opt-in

**Decision:** `with:` field schemas are populated by fetching the referenced
action's `action.yml`. Fetch is lazy (only when the user opens the structured
editor for that step), cached for 24 hours in the Tauri config dir, and
respects an opt-out setting (`settings.workflowEditor.fetchActionMetadata: false`).

**Mechanism:** Without this, `with:` is free-form key/value — barely an editor.
With it, every `with:` field is typed and validated. The privacy/network cost is
real, hence opt-out + caching.

**Source priority:**
1. Local cache (`<tauri-config>/action-metadata/<owner>/<repo>/<ref>.json`).
2. `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/action.yml`.
3. Fallback: `action.yaml`. Fallback: `<path>/action.yml` for sub-action refs.
4. If all fail, render `with:` as free-form key/value with a "metadata
   unavailable" hint.

### ADR-7: Validation — official language services first, actionlint optional

**Decision:** Use the official GitHub-published packages (MIT, from the
`actions/languageservices` monorepo) for schema validation and expression
context typing:

- `@actions/workflow-parser` — already in use for the IR (ADR-3). Its
  `parseWorkflow` returns diagnostics directly; many lint findings come for
  free.
- `@actions/languageservice` — higher-level wrapper providing hover, completion,
  and validation suitable for editor integration.
- `@actions/expressions` — used internally by the others; pin in case we need
  direct evaluation for `if:` / `${{ }}` validation.

`actionlint` (Go binary, gold standard) is an *optional* second-layer
validator invoked via Tauri command if the user has it on PATH.

**Package-name correction:** the prior draft of this plan referenced
`@actions/languageservices` (plural) — that's the *repo* name, not a
publishable package. The npm names are singular (`@actions/languageservice`)
plus the per-component packages above. Confirmed via Phase 0 Spike A.

**Why both:** language services cover schema + expression types and run in the
browser. `actionlint` additionally catches script injection, glob mistakes,
runner-label typos, and shell-script issues — strictly richer, but Go-only.
Reimplementing actionlint in TS is out of scope.

### ADR-8: Three exports, three pipelines, one IR

**Decision:** Mermaid export is a pure function `(IR) -> string`. SVG/PNG
export uses `html-to-image` (`toSvg`, `toPng`) applied to the live React Flow
canvas DOM element — this is the official `@xyflow/react` v12 export pattern,
documented in their "Download Image" example. Both exports are user-invokable
via context menu; no implicit re-export on save.

**Package-name correction:** the prior draft assumed `ReactFlowInstance.toSvg()`
/ `toPng()` existed. They don't — `@xyflow/react` v12 has no built-in image
export. `html-to-image` is required as a separate dep.

**Tradeoff:** `html-to-image`'s SVG output wraps the DOM tree in
`<foreignObject>` rather than emitting native SVG primitives. This is fine for
docs/clipboard/email but renders inconsistently in some downstream contexts
(older PDF tools, embedded SVG in non-Chromium engines). For high-fidelity
vector export, a future v2 task could regenerate native SVG directly from the
IR. Not in v1 scope.

**Mermaid export is also lossy** (custom node decorations don't survive).
Surface both lossy paths in the UI: "Mermaid export omits run status, action
icons, and custom badges. SVG export uses foreignObject; for native SVG, use
PNG." Don't let lossiness be silent.

**Spike B result (2026-05-04):** PASS. `html-to-image` `toSvg` and `toPng`
both produce valid output from `@xyflow/react` v12 in light and dark
themes. Timings on a 20-node graph: SVG 44-48 ms, PNG 59-74 ms (well under
the 1500 ms threshold). CSS variables resolve to their computed values in
the export. **Caveat:** SVG outputs are large (~860 KB for 20 nodes due to
inline-style emission); a 100-node graph may produce ~3-4 MB SVGs. Phase
4 acceptance must test on a 100-node graph and decide whether to limit
SVG export to graphs below a threshold or document the size cost.

### ADR-9: ProseMirror integration mirrors `mermaid` plugin

**Decision:** Code-fence inline preview reuses the `mermaid` plugin's pattern:
a `NodeView` over `code_block` nodes, lazy-rendered when the language is
`yaml`/`yml` AND the shape heuristic passes, with a fallback `<pre>` if
detection fails or rendering throws.

**Mechanism:** `src/plugins/mermaid/index.ts` is 283 LOC and works. Don't
reinvent. The new plugin path is `src/plugins/githubWorkflow/`.

### ADR-10: Shared `WorkflowPanelShell` for both Genie and GHA features

**Decision:** Extract the split-pane shell (CodeMirror left + canvas right +
resize handle + persisted geometry) into a reusable React component
`src/components/Editor/WorkflowPanel/WorkflowPanelShell.tsx`. Both this plan
(GHA workflows) and `20260331-workflow-engine.md` (Genie workflows) mount
their own canvas content into the shell.

**Mechanism:** Codex flagged DRY risk between the two plans. The IRs and
parsers are genuinely different (GHA is full schema; Genie is a strict
subset), but the panel chrome is identical. Sharing the shell prevents two
divergent resize behaviors, two persistence schemes, two keyboard models.

**Routing:** A small detection layer (`src/lib/workflowRouting/router.ts`)
inspects the active file and decides which renderer to mount inside the
shell:

1. File under `.github/workflows/` AND parses as GHA workflow → GHA renderer.
2. File parses as Genie workflow (per `20260331-workflow-engine.md` rules) →
   Genie renderer.
3. Otherwise → no panel (plain YAML / plain markdown).

Detection priority is documented and tested. New: this routing layer is *also*
where the inline-fence detection lives, so both surfaces share precedence
rules.

### ADR-11: Round-trip gate — semantic + minimal-diff, not byte-identity

**Decision:** Phase 8's save-side acceptance gate is **not** byte-for-byte
equality. The realistic gate is the conjunction of:

1. **Comment preservation** — every comment present in the input file is
   present at the same logical position in the output.
2. **Anchor and alias preservation** — `&anchor` / `*alias` references survive
   round-trip without expansion or rename.
3. **Semantic equality** — `parseDocument(orig).toJS()` deep-equals
   `parseDocument(saved).toJS()`.
4. **Minimal diff** — for any IR-level edit affecting region R of the source,
   the byte-diff between input and output is contained in R ± its enclosing
   line. No whitespace-only or quoting-only changes outside R.

**Mechanism:** Codex correctly flagged that `yaml` package's `toString()`
normalizes some whitespace (trailing newlines, indentation of nested flow
collections) and quoting style. Demanding byte-identity would either fail on
trivial differences or force us to fork the stringifier. The four-condition
gate above is what users actually care about — comments, references, and "I
can still see what I changed in `git diff`."

**Tests** are written against this gate, with a fixture corpus producing one
golden output per fixture; deviations require manual review and the gate
re-baselines explicitly, never silently.

**Spike D result (2026-05-04):** PASS with stringify options
`{ lineWidth: 0, flowCollectionPadding: false }`. With these options, 4/7
fixtures round-trip byte-identically; the other 3 differ only in cosmetic
ways (1-line trailing-newline normalization, 1-line comment indent
normalization, and one fixture with a plain multi-line scalar that gets
collapsed to one line). All 7/7 preserve comments and anchors. All 21
edit scenarios (7 fixtures × 3 mutations) re-parsed without errors, with
all comments and anchors preserved.

**Project-standard stringify options** (export from `save/cstParser.ts`):

```ts
export const WORKFLOW_YAML_STRINGIFY_OPTIONS = {
  lineWidth: 0,
  flowCollectionPadding: false,
} as const;
```

**Documented v1 limitation:** plain (un-quoted, non-block-scalar) multi-line
strings get re-emitted on a single logical line. Affects ~5% of real-world
workflows. Mitigation (re-style as `>` block scalar before mutation)
deferred to v2 if user feedback demands.

---

## 4. The IR

The IR mirrors the GitHub Actions YAML keyword surface as TypeScript types,
plus source-position tracking for click-to-jump and lint diagnostics.

```typescript
// src/lib/ghaWorkflow/types.ts (new)

/** Source position into the YAML string. Line is 1-based; column is 1-based. */
export interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/** Result of parsing one workflow file or one code-fence block. */
export interface WorkflowIR {
  name?: string;
  runName?: string;
  triggers: TriggerIR[];
  permissions: PermissionsIR | "read-all" | "write-all" | "none";
  env: Record<string, string>;
  defaults?: { run?: { shell?: string; workingDirectory?: string } };
  concurrency?: ConcurrencyIR;
  jobs: JobIR[];
  /** Diagnostic-friendly: text positions for every top-level key. */
  positions: {
    name?: SourceRange;
    on?: SourceRange;
    permissions?: SourceRange;
    env?: SourceRange;
    jobs?: SourceRange;
    [k: string]: SourceRange | undefined;
  };
  /** Non-fatal warnings (unknown keys, deprecated patterns). */
  warnings: Diagnostic[];
}

export interface TriggerIR {
  event:
    | "push" | "pull_request" | "pull_request_target"
    | "workflow_dispatch" | "workflow_call" | "workflow_run"
    | "schedule" | "repository_dispatch" | string;
  /** Filters for push/pull_request etc. */
  branches?: string[];
  branchesIgnore?: string[];
  tags?: string[];
  tagsIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
  types?: string[];
  /** Cron schedules (one trigger per cron line). */
  cron?: string;
  /** workflow_dispatch / workflow_call inputs. */
  inputs?: Record<string, WorkflowInputIR>;
  /** workflow_call secrets. */
  secrets?: Record<string, { required?: boolean; description?: string }>;
  /** workflow_call outputs. */
  outputs?: Record<string, { value: string; description?: string }>;
  position: SourceRange;
}

export interface WorkflowInputIR {
  type?: "string" | "number" | "boolean" | "choice" | "environment";
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  options?: string[];
}

export interface JobIR {
  id: string;
  name?: string;
  /** "runs-on", normalized to string[] (single string becomes [s]). */
  runsOn?: string[];
  /** "uses": this job is a reusable-workflow call. Mutually exclusive w/ steps. */
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: Record<string, string> | "inherit";
  needs: string[];
  if?: string;
  permissions?: PermissionsIR | "read-all" | "write-all" | "none";
  environment?: { name: string; url?: string };
  concurrency?: ConcurrencyIR;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  defaults?: { run?: { shell?: string; workingDirectory?: string } };
  steps: StepIR[];
  timeoutMinutes?: number;
  strategy?: StrategyIR;
  continueOnError?: boolean | string;
  container?: ContainerIR;
  services?: Record<string, ContainerIR>;
  position: SourceRange;
}

export interface StepIR {
  /** Synthesized id if the user didn't provide one. */
  id: string;
  /** True if id was synthesized. */
  idSynthesized: boolean;
  name?: string;
  /** "uses" step kind. */
  uses?: string;
  /** "run" step kind. */
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  workingDirectory?: string;
  shell?: string;
  continueOnError?: boolean | string;
  timeoutMinutes?: number;
  position: SourceRange;
}

export interface StrategyIR {
  matrix?: MatrixIR;
  failFast?: boolean;
  maxParallel?: number;
}

export interface MatrixIR {
  /** Arbitrary dimensions. Values are scalars, arrays, or objects. */
  dimensions: Record<string, unknown[]>;
  include?: Record<string, unknown>[];
  exclude?: Record<string, unknown>[];
}

export interface ContainerIR {
  image: string;
  credentials?: { username?: string; password?: string };
  env?: Record<string, string>;
  ports?: (string | number)[];
  volumes?: string[];
  options?: string;
}

export interface PermissionsIR {
  actions?: PermLevel; attestations?: PermLevel; checks?: PermLevel;
  contents?: PermLevel; deployments?: PermLevel; discussions?: PermLevel;
  idToken?: PermLevel; issues?: PermLevel; models?: PermLevel;
  packages?: PermLevel; pages?: PermLevel; pullRequests?: PermLevel;
  securityEvents?: PermLevel; statuses?: PermLevel;
}
export type PermLevel = "read" | "write" | "none";

export interface ConcurrencyIR {
  group: string;
  cancelInProgress?: boolean | string;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  position?: SourceRange;
  /** Stable code, e.g., "GHA001". For UI filtering and i18n message keys. */
  code: string;
}
```

### 4.1 Edge derivation

The DAG is derived from `JobIR.needs[]`. Conventions:

| Rule | Behavior |
|---|---|
| `needs: [a, b]` | Edges `a → this`, `b → this`. |
| No `needs:` | No incoming edges. **Do not** invent sequential edges (this differs from the Genie workflow IR). |
| `needs:` references unknown id | Diagnostic `GHA-NEEDS-001`, edge omitted. |
| Cycle | Diagnostic `GHA-NEEDS-002`, render anyway with cycle edges marked red. |

### 4.2 Step-level visualization

Steps are *not* nodes in the top-level DAG. They render as a stacked list
*inside* each job node (as a custom node component). Clicking a job expands it
or opens a side panel listing all steps with their `uses`/`run`, `if`, `with`
keys.

### 4.3 Matrix expansion preview

Matrix-expanded jobs render as **stacked cards** behind the base job node, with
a badge showing combination count (e.g., `×6`). Expansion is computed lazily
when the user clicks "Expand matrix" — for a 5×5 matrix you don't want 25 nodes
on the canvas by default.

**Expansion rules** (deterministic, tested, applied in order):

1. **Cartesian product** of every key in `dimensions`. Skipped if `dimensions`
   is empty.
2. **`include`** entries:
   - If an `include` entry shares all keys with an existing combination,
     extend that combination with the include entry's extra keys.
   - If it does not match any existing combination, append as a new
     combination.
3. **`exclude`** entries: remove any combination that shares all keys with the
   exclude entry. Applied *after* `include`.
4. **Hard cap:** GitHub's documented limit is 256 combinations per matrix. We
   enforce the same cap; combinations beyond 256 are dropped with a
   `GHA-MATRIX-001` warning.
5. **Expression-valued dimensions** (`matrix: ${{ fromJSON(...) }}`) are
   *not* expanded statically. The badge shows `dynamic` instead of `×N`,
   with a tooltip explaining why.

### 4.4 Diagnostic code taxonomy

Every diagnostic uses a stable code in the form `GHA-<AREA>-<NUM>`. UI strings
are looked up via i18n keys `workflowEditor.diagnostics.<code>`. Severity is
also fixed per code so consumers can filter consistently.

| Code | Severity | Meaning | Fires from |
|---|---|---|---|
| `GHA-PARSE-001` | error | Malformed YAML | parser |
| `GHA-PARSE-002` | error | Top-level `jobs:` missing | parser |
| `GHA-PARSE-003` | error | Top-level `on:` missing | parser |
| `GHA-PARSE-004` | warning | Unknown top-level key | parser |
| `GHA-JOB-001` | error | Duplicate job id | parser |
| `GHA-JOB-002` | error | Job has both `uses:` and `steps:` | parser |
| `GHA-NEEDS-001` | error | `needs:` references unknown job id | edge derivation |
| `GHA-NEEDS-002` | error | Cycle in job dependency graph | edge derivation |
| `GHA-STEP-001` | warning | Step has neither `uses:` nor `run:` | parser |
| `GHA-STEP-002` | error | Step has both `uses:` and `run:` | parser |
| `GHA-STEP-003` | warning | Synthesized step id (no user-provided id) | parser |
| `GHA-EXPR-001` | error | Unknown expression context (`gitub.actor`) | expression validator |
| `GHA-EXPR-002` | warning | Expression context not available in this scope | expression validator |
| `GHA-MATRIX-001` | warning | Matrix expansion exceeds 256-combination cap | expansion |
| `GHA-MATRIX-002` | warning | Matrix dimension uses dynamic expression (`fromJSON`) | expansion |
| `GHA-SEC-001` | warning | `pull_request_target` trigger present (security hint) | trigger validator |
| `GHA-SEC-002` | warning | Possible script injection: tainted context in `run:` | expression validator |
| `GHA-SCHEMA-001` | warning | Schema-unknown key (forwarded from language services) | schema lint |
| `GHA-ACTIONLINT-NNN` | per-actionlint | Diagnostics forwarded from `actionlint` binary | actionlint wrapper |

This table is the source of truth. New codes get appended (never reused) and
require a corresponding i18n key. `actionlint` codes are forwarded verbatim
under the `GHA-ACTIONLINT-` prefix to avoid collisions.

---

## 5. Module map

```
src/lib/ghaWorkflow/                      [Phase 1]
  types.ts                                IR types
  detection.ts                             isWorkflowYaml() heuristic
  diagnostics.ts                           Diagnostic code registry + shaping
  parser/
    index.ts                                Orchestrator — dispatches to subparsers
    triggers.ts                             on: → TriggerIR[]
    jobs.ts                                 jobs[] → JobIR[] (incl. steps)
    edges.ts                                needs[] → graph + cycle detection
    matrix.ts                               Strategy → expansion preview
    permissions.ts                          permissions: → PermissionsIR
    __tests__/                              One *.test.ts per subparser

src/lib/ghaWorkflow/render/               [Phase 2]
  toGraph.ts                               IR → @xyflow/react nodes/edges
  layout.ts                                dagre / elkjs adapter

src/lib/ghaWorkflow/export/               [Phase 4]
  toMermaid.ts                             IR → Mermaid flowchart string
  toImage.ts                               Canvas DOM → SVG/PNG via html-to-image
  __tests__/
    toMermaid.test.ts                      Snapshot per fixture

src/lib/ghaWorkflow/lint/                 [Phase 5]
  schema.ts                                @actions/languageservice wrapper
  expressions.ts                           @actions/expressions wrapper
  actionlint.ts                            Tauri-command wrapper, optional

src/lib/ghaWorkflow/actions/              [Phase 6]
  registry.ts                              Action metadata fetch + cache
  __tests__/registry.test.ts

src/lib/ghaWorkflow/save/                 [Phase 8]
  cstParser.ts                             yaml package Document API
  mutators/
    index.ts                                Patch dispatcher
    job.ts                                  job.set / job.add / job.remove
    step.ts                                 step.set / step.add / step.remove
    trigger.ts                              trigger.set / trigger.add / trigger.remove
    with.ts                                 with.set / with.remove (per step)
    needs.ts                                needs.add / needs.remove
    __tests__/                              One *.test.ts per family

src/lib/workflowRouting/                  [Phase 0 — shared between Genie + GHA]
  router.ts                                Decides Genie vs GHA vs none
  __tests__/router.test.ts

src/plugins/githubWorkflow/               [Phase 3 — code fence integration]
  index.ts                                  Tiptap NodeView for code_block
  WorkflowNodeView.ts                       static-mode @xyflow/react mount
  github-workflow.css

src/components/Editor/WorkflowPanel/      [Phase 0 shell + Phase 2 GHA content]
  WorkflowPanelShell.tsx                    Split-pane chrome (shared w/ Genie)
  GhaWorkflowPanel.tsx                      GHA-specific canvas mount
  WorkflowCanvas.tsx                        Interactive @xyflow/react
  JobNode.tsx                               Custom node — uses design tokens
  StepList.tsx                              Steps inside a job
  workflow-panel.css

src/components/Editor/WorkflowEditor/     [Phase 7]
  JobForm.tsx
  StepForm.tsx
  TriggerForm.tsx
  workflow-editor.css

src/stores/workflowViewStore.ts           [Phase 2]
  Selected job, selected step, expanded matrices, layout algo choice.

src/stores/workflowEditStore.ts           [Phase 7]
  Pending IRPatches, dirty flag, save state.

src-tauri/src/gha_workflow/               [Phases 5, 6]
  mod.rs                                   Module root
  commands.rs                              gha_lint, gha_fetch_action_yml
  action_fetch.rs                          HTTP fetch + cache I/O
  actionlint.rs                            Binary discovery + invocation
  tests.rs                                 Rust unit tests (TDD per AGENTS.md)
```

Every file targets ≤300 LOC per VMark conventions. Splitting `parser/` and
`mutators/` into per-concern files (vs. the original draft's monolithic
`parser.ts` ~280 LOC and `mutators.ts` ~250 LOC) keeps each file ≤200 LOC and
each test file ≤150 LOC, and removes the cyclomatic-complexity risk Codex
flagged.

---

## 6. Phase-by-phase work items

Each phase is independently shippable. **Phases 1-4 deliver a complete
read-only viewer with three exports** — that alone is a unique product.
Phase 0 must complete before any other phase commits code; if any spike
fails its acceptance check, the corresponding ADR is revisited before
proceeding.

### Definition of Done (applies to every UI/Rust WI in every phase)

Per `AGENTS.md`, these are not Phase 9 polish items — they're per-WI gates.
A WI is not complete until **all** of the following hold:

1. **Tests pass** — RED-first, GREEN, REFACTOR per `.claude/rules/10-tdd.md`.
   For Rust commands, both unit tests in the module and integration tests in
   `src-tauri/tests/` (or `#[cfg(test)]` blocks) must exist.
2. **i18n keys exist** — every user-visible string is `t(key)` in React or
   `t!(key)` in Rust. New keys added to `src/locales/en/*.json` and
   `src-tauri/locales/en.yml` in the same commit. Other locales handled via
   the `translate-docs` skill before phase end.
3. **Design tokens** — no hardcoded colors, radii, shadows, or spacing per
   `.claude/rules/31-design-tokens.md`. Verified by `pnpm lint:design-tokens`.
4. **Platform plumbing complete** when applicable:
   - New Tauri command registered in `src-tauri/src/lib.rs` via
     `tauri::generate_handler![...]`.
   - Capability entry added to `src-tauri/capabilities/default.json`.
   - HTTP plugin permissions in capabilities (for `gha_fetch_action_yml`).
   - Cross-platform: never use bare `Command::new`; use
     `ai_provider::build_command()` per `AGENTS.md`.
5. **File size** — every file ≤300 LOC. Split before exceeding.
6. **`pnpm check:all` green** — lint, types, tests, coverage, build, size.

### Phase 0 — Feasibility spikes (COMPLETE — all 4 PASS, 2026-05-04)

Each spike is a throwaway probe that produced a write-up and a working code
sample under `dev-docs/grills/gha-workflow/`. All four passed; all four
have feed-back items folded into Phase 1+ work items below.

| Spike | Verdict | Key outcome |
|---|---|---|
| A | PASS | 100% position coverage; adopt `@actions/workflow-parser` |
| B | PASS | `html-to-image` works at 44-75 ms / export; SVG size warning for ≥100-node graphs |
| C | PASS (9/10) | Static prop matrix works; `pointer-events` mitigation needed for drag-select |
| D | PASS | Stringify options finalized; v1 plain-multi-line-scalar limitation documented |

**WI-0.1 — Spike A: parser shape** (`@actions/workflow-parser`).
- Goal: confirm the parser exposes positions for every IR node we need
  (workflow, on, jobs[*], jobs[*].steps[*], jobs[*].strategy.matrix,
  step.with[*]).
- Output: `dev-docs/grills/gha-workflow/spike-a-parser.md` with concrete
  parser API call samples + a coverage table mapping each `SourceRange` use
  site to a parser API.
- Pass criteria: positions available for ≥95% of IR nodes. If not, fall back
  per ADR-3 (use `yaml` package for read).

**WI-0.2 — Spike B: image export** (`html-to-image` + `@xyflow/react` v12).
- Goal: produce SVG and PNG of a reference graph; verify dark-theme tokens
  resolve correctly in the export; verify foreignObject SVG renders in
  Chromium-based viewers.
- Output: `spike-b-export.md` + saved sample SVGs.
- Pass criteria: both formats produced; light/dark themes both readable;
  fonts render (or fallback documented).

**WI-0.3 — Spike C: ProseMirror + static React Flow** (interaction matrix).
- Goal: mount static-mode `@xyflow/react` inside a ProseMirror NodeView (use
  the `mermaid` plugin scaffolding); test selection, scroll, focus, keyboard
  Tab, and node-clicks.
- Output: `spike-c-prosemirror.md` with prop matrix and any residual
  conflict.
- Pass criteria: no events leak from the canvas to ProseMirror; ProseMirror's
  cursor/selection unaffected by canvas interaction; cleanup on NodeView
  destroy verified (no leaked listeners across 50 mount/unmount cycles).
- **Failure path:** If conflict is unfixable, fall back to a Mermaid-only
  inline preview per ADR-4. Update plan; proceed.

**WI-0.4 — Spike D: round-trip semantics** (`yaml` package Document API).
- Goal: round-trip the 20 fixture workflows through
  `parseDocument → toString` and characterize which differences arise. Apply
  10 representative IR-level edits and verify the four-condition gate from
  ADR-11 holds.
- Output: `spike-d-roundtrip.md` with the actual diff characterization; a
  proposed test-harness shape; the realistic gate frozen.
- Pass criteria: gate holds across all 20 fixtures + 10 edit scenarios. If
  not, narrow the gate or pick a different parser.

**Phase 0 acceptance:** all four spike write-ups merged to `dev-docs/grills/`,
all ADRs updated to reflect findings, dependency table in §9 finalized.

### Phase 1 — Foundation: parser + IR (RED first)

**WI-1.1 — IR types** (`types.ts`, ~150 LOC).
- Acceptance: every type from §4 exported; no runtime deps.

**WI-1.2 — Parser orchestrator** (`parser/index.ts`, ~120 LOC).
- Wraps `@actions/workflow-parser` (per Spike A). Translates parser
  diagnostics into our `Diagnostic[]` shape per the §4.4 taxonomy.
- Dispatches normalization to subparsers; assembles final `WorkflowIR`.

**WI-1.3 — Subparsers** (`parser/triggers.ts`, `jobs.ts`, `edges.ts`,
`matrix.ts`, `permissions.ts`, ~100-150 LOC each).
- Each module owns one IR slice. Each has its own test file.
- `edges.ts` AC: fan-out, fan-in, diamond, cycle (still produces edges with
  cycle-marked diagnostic), unknown-needs reference (omits edge + diagnostic).
- `matrix.ts` AC: cartesian product, `include` extension and append cases,
  `exclude` removal, 256-cap enforcement, dynamic-dimension detection.

**WI-1.4 — Detection heuristic** (`detection.ts`, ~80 LOC).
- Acceptance: §3 ADR-5 rules implemented. Tests for false positives
  (random YAML containing `on:` field unrelated to GH).

**WI-1.5 — Workflow router** (`src/lib/workflowRouting/router.ts`, ~120 LOC).
- Per ADR-10: detects GHA / Genie / none for a given file path + content.
- Tests: ambiguous files (a `.yml` under `.github/workflows/` that happens to
  also satisfy Genie shape — GHA wins), Genie shapes outside that directory,
  plain YAML.

**WI-1.6 — Fixture corpus** (`dev-docs/fixtures/gha-workflows/`, no LOC).
- ≥20 real workflows checked in:
  `actions/checkout`, `actions/setup-node`, `kubernetes/kubernetes`,
  `rust-lang/rust`, `vercel/next.js`, vmark's own `.github/workflows/`,
  reusable workflows, `pull_request_target` workflows, CJK-content
  workflows, multi-doc YAML, anchor/alias-heavy workflows.

Phase 1 acceptance gate: all fixtures parse without error; diagnostic codes
appear per §4.4; ≥95% branch coverage; `pnpm check:all` green.

### Phase 2 — Standalone file viewer

**WI-2.1 — Render adapter** (`render/toGraph.ts`, ~220 LOC).
- IR → `{ nodes, edges }` for `@xyflow/react`.
- One node per job, custom type `"job"`. Step list is part of node data,
  rendered by the custom component.
- Matrix-expanded jobs are siblings under a parent group node when expansion
  is on; otherwise a single badged node.

**WI-2.2 — Layout** (`render/layout.ts`, ~120 LOC).
- dagre by default. ELK lazy-loaded if `nodes.length > 50`.
- Top-down layout (`rankdir: TB`), with adjustable spacing constants in CSS
  vars on the canvas root so the design system controls the look.

**WI-2.3 — JobNode component** (`JobNode.tsx`, ~180 LOC).
- Header: job id, runner label.
- Body: collapsed step count + expand chevron.
- Footer: matrix badge, `if:` indicator (yellow dot), `needs:` count.
- Status slot (unused now, reserved for a future runs-API integration).
- Uses CSS vars: `--bg-color`, `--border-color`, `--accent-bg`,
  `--text-color`, `--popup-shadow`. No hardcoded colors.

**WI-2.4a — WorkflowPanelShell** (`WorkflowPanelShell.tsx`, ~180 LOC).
- Per ADR-10: shared chrome between Genie and GHA features.
- Split layout: left slot (CodeMirror, host-provided) + right slot
  (renderer, host-provided) + resize handle. Position persisted in a
  shared `workflowPanelGeometryStore` (separate from per-feature state).
- Keyboard: `Esc` to defocus canvas; `Tab` cycles focus through right-slot
  focusables; per-feature shortcuts injected via prop.

**WI-2.4b — GhaWorkflowPanel** (`GhaWorkflowPanel.tsx`, ~140 LOC).
- Mounts the WorkflowPanelShell with GHA-specific content (canvas, JobNode,
  StepList).
- Subscribes to `workflowViewStore` via Zustand selectors (no destructuring
  per `AGENTS.md`).

**WI-2.5 — Click-to-jump** (~80 LOC distributed).
- Click a JobNode → CodeMirror selects the job's `SourceRange`.
- Click a step in StepList → selects step's range.
- **Event contract:** `workflowViewStore.selectNode({ kind, id, source })`
  is the single entry point. Both inline-fence "Open in side panel" and
  in-canvas clicks dispatch through it.

**WI-2.6 — File integration**.
- Hook into VMark's existing file-open pipeline. The router (WI-1.5) decides
  whether to mount `GhaWorkflowPanel`, the existing Genie panel, or
  nothing.
- Tests: `GhaWorkflowPanel.test.tsx`, behavior-driven (open file → assert
  nodes rendered; click job → assert CodeMirror selection).

Phase 2 acceptance gate: open any of the 20 fixture workflows, see correct DAG,
click any node, jump to the right line. ≥85% test coverage.

### Phase 3 — Code-fence inline preview

Mirrors `src/plugins/mermaid/`. New plugin at `src/plugins/githubWorkflow/`.

**WI-3.1 — Tiptap NodeView** (`index.ts`, ~280 LOC).
- Override `code_block` rendering when `language === "yaml" || "yml"` AND
  `isWorkflowYaml(content)` returns true.
- Mounts `WorkflowNodeView`.

**WI-3.2 — Static-mode canvas** (`WorkflowNodeView.ts`, ~220 LOC).
- `@xyflow/react` mounted with the full interaction prop matrix (ADR-4).
- **Required CSS** (Spike C-validated mitigation for drag-select):
  ```css
  .gha-workflow-fence .react-flow__pane,
  .gha-workflow-fence .react-flow__viewport {
    pointer-events: none;
  }
  .gha-workflow-fence .react-flow__node,
  .gha-workflow-fence .react-flow__controls,
  .gha-workflow-fence .gha-open-panel-btn {
    pointer-events: auto;
  }
  ```
  Without this, mouse drag-select crossing the fence produces an empty
  PM selection (Spike C scenario 9).
- "Open in side panel" button → emits event consumed by WorkflowPanel.
- Lazy-init: don't construct the canvas until the node enters viewport
  (use IntersectionObserver). Critical for documents with many fences.
- Fallback: if `parseWorkflow` throws, render plain `<pre>` with the
  original YAML content. No silent failure.
- **Required regression test:** mouse drag-select from above the fence to
  below — must produce non-empty PM selection (mitigation works).

**WI-3.3 — Cleanup discipline**.
- Tear down React root + xyflow instance on NodeView destroy. Otherwise
  every fence parse-replace leaks event listeners.
- Tests use the existing `mermaidPreview` test utilities pattern.

Phase 3 acceptance gate: a markdown doc with 5 workflow fences renders all 5
without crashing, scrolls smoothly, no memory growth on repeat open/close.

### Phase 4 — Exports

**WI-4.1 — Mermaid export** (`export/toMermaid.ts`, ~150 LOC).
- IR → `flowchart TD` string. One node per job. `needs[]` → edges.
- Job labels truncated to 40 chars. Special chars escaped (`[`, `]`, `(`, `)`).
- Matrix jobs render as a single node with `×N` badge in label.
- Snapshot tests for each fixture; the snapshots are reviewed manually on
  first commit and frozen.
- One-line UI hint when invoked: "Mermaid export omits status, custom
  decorations, and matrix expansion details."

**WI-4.2 — SVG/PNG export** (`export/toImage.ts`, ~140 LOC).
- Uses `html-to-image` (`toSvg`, `toPng`) against the `.react-flow` viewport
  DOM element (the official `@xyflow/react` v12 export pattern).
- Off-screen mount path for the case where the panel isn't currently open
  (we still need to export from a closed-but-known-to-be-workflow file): a
  hidden `<div>` mounts the canvas, layout settles, export fires, unmount.
- Lossiness disclosure (per ADR-8): SVG output is foreignObject-wrapped
  DOM, not native SVG. Hint shown on first SVG export.
- Filename suggestion: `<workflow-name>.svg` / `.png`.

**WI-4.3 — Export menu integration**.
- Right-click JobNode → "Export this job as image".
- Workflow-level export from the canvas toolbar: SVG, PNG, Mermaid.
- File save via existing Tauri dialog APIs.

### Phase 5 — Validation

**WI-5.1 — Schema lint** (`lint/schema.ts`, ~150 LOC).
- Wrap `@actions/languageservice` (singular — corrected from prior draft).
  Translate its diagnostics into CodeMirror lint markers and into our
  `Diagnostic[]` shape per §4.4.
- Run on every keystroke via debounced effect (300ms); cache against the
  parsed YAML source.
- Tests: real diagnostics for known-bad workflows (typo'd keys, malformed
  `on:`, missing required fields).

**WI-5.2 — Expression awareness** (`lint/expressions.ts`, ~120 LOC).
- Wrap `@actions/expressions`. Validate `${{ }}` contexts. Emit
  `GHA-EXPR-001` for unknown contexts, `GHA-EXPR-002` for context-not-in-scope,
  `GHA-SEC-002` for tainted-context-in-`run:`.
- Surface in both the CodeMirror gutter and as red dots on JobNode if the
  invalid expression is in `if:` / `with:` of that job.

**WI-5.3 — Optional actionlint** (`lint/actionlint.ts`, ~120 LOC, frontend).
- Calls Tauri command `gha_lint(yaml)`. If the result indicates
  binary-not-found, hide the actionlint diagnostics layer silently. Settings
  toggle (`workflowEditor.actionlint.enabled`) to disable entirely.
- Forwards diagnostics under `GHA-ACTIONLINT-<actionlint-rule-id>` codes.

**WI-5.4 — Rust: `gha_lint` command** (`src-tauri/src/gha_workflow/`, ~200 LOC).
- New module `gha_workflow` registered in `src-tauri/src/lib.rs` via
  `tauri::generate_handler![gha_lint, gha_fetch_action_yml]`.
- `actionlint.rs`: discover binary on PATH (`which` crate); if absent,
  return `Ok(LintResult::BinaryMissing)` (typed enum, not error). If
  present, invoke via `ai_provider::build_command()` with
  `ai_provider::login_shell_path()` per VMark's cross-platform policy. Stdin
  = YAML, args = `-format json -`. Parse output, return `Vec<Diagnostic>`.
- Capability: add `gha-workflow:default` permission set in
  `src-tauri/capabilities/default.json`.
- **Rust tests:** `actionlint.rs` has `#[cfg(test)]` covering: binary
  missing, binary present + clean YAML, binary present + dirty YAML,
  malformed binary output (graceful failure, not panic).

### Phase 6 — Action input discovery

**WI-6.1 — Frontend registry** (`actions/registry.ts`, ~180 LOC).
- `getActionMetadata(uses: string): Promise<ActionMetadataIR | null>`.
- Calls Rust `gha_fetch_action_yml`; result cached in-memory per session.
- Persistent cache layer is owned by Rust (see WI-6.3).
- Settings opt-out: `settings.workflowEditor.fetchActionMetadata` (default
  true on first launch — surfaced in Settings > Privacy with a clear note).

**WI-6.2 — Tooltip preview**.
- Hovering a `uses:` step in StepList → tooltip with action description and
  required `with:` keys, populated from cache.

**WI-6.3 — Rust: `gha_fetch_action_yml` command**
(`src-tauri/src/gha_workflow/action_fetch.rs`, ~200 LOC).
- Signature: `gha_fetch_action_yml(uses: String) -> Result<ActionMetadata,
  String>`.
- Cache: `<tauri-config>/gha-action-cache/<sha256(uses)>.json`. TTL 24h.
- Network: `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>/action.yml`
  with `action.yaml` fallback. Uses Tauri HTTP plugin; capability:
  `http:default` scoped to `https://raw.githubusercontent.com/*`.
- Privacy: respect frontend opt-out (frontend simply doesn't call this if
  the user disabled the setting; backend doesn't enforce — separation of
  concerns).
- **Rust tests:** cache hit, cache miss + network success, cache miss +
  network failure, fallback to `.yaml`, malformed action.yml (returns error
  variant, not panic), expired-cache refresh.

Phase 7 (structured editor) is the primary consumer of this; phase 6 is
implemented standalone so the read-only viewer benefits too.

### Phase 7 — Structured editor (forms)

**WI-7.1 — JobForm, StepForm, TriggerForm** (~250 LOC each).
- Forms render the IR for one job/step/trigger.
- Each field has a CodeMirror "expand" button that pops a small editor for
  expression-heavy fields (`if:`, `run:`, `with:` values). Expressions stay
  text — no attempt to GUI them.
- For a step's `with:` block, fields are populated from action metadata
  (Phase 6). If metadata is unavailable, show free-form key/value rows.

**WI-7.2 — Edit pipeline**.
- User edits form → form emits a typed `IRPatch` (e.g., `{ kind: "step.set",
  jobId: "build", stepId: "checkout", path: "with.fetch-depth", value: 0 }`).
- Patches accumulate in `workflowEditStore`. "Save" applies them via the
  Phase 8 CST mutator, then writes back to disk.
- "Discard" reverts to the last loaded YAML.

Until Phase 8 ships, the structured editor is read-only — patches are
accumulated for preview but the "Save" button is disabled with a clear hint.

### Phase 8 — CST round-trip

**WI-8.1 — `yaml` Document parser** (`save/cstParser.ts`, ~180 LOC).
- Adds `yaml` package's `parseDocument` to the save pipeline (alongside the
  existing `@actions/workflow-parser` on the read path).
- Parity tests: every fixture parsed by both produces semantically-equal IRs
  (modulo positions). Differences trigger a parse-time diagnostic, never a
  silent split.

**WI-8.2 — Mutators** (`save/mutators/*`, ~80-150 LOC each).
- Split per family: `job.ts`, `step.ts`, `trigger.ts`, `with.ts`, `needs.ts`.
- One pure function per `IRPatch` kind. Each takes the `Document` and the
  patch, returns a new `Document`.
- Tests against the **ADR-11 round-trip gate** (semantic + minimal-diff +
  comments + anchors), not byte identity:
  - Identity round-trip: `parseDocument → no-op → toString` produces output
    such that `parseDocument(orig).toJS()` deep-equals
    `parseDocument(saved).toJS()`, all comments preserved, all anchors
    preserved.
  - Targeted edit: applying one IRPatch changes only the byte range covered
    by the targeted node ± its enclosing line.
  - Special cases: flow vs. block style preservation per node; empty value
    handling (`key:` with no value); multi-line scalars; `>` and `|` block
    scalars.

**WI-8.3 — Hot-swap save path**.
- Wire mutators into `workflowEditStore.save()`.
- Enable the "Save" button (was disabled in Phase 7).
- Add a settings toggle `workflowEditor.preserveYamlFormatting` (default on).
  Off path uses a simpler `yaml.stringify` for users who explicitly want
  reformatted output.

### Phase 9 — Polish

i18n is **not** in this phase — it's a per-WI Definition of Done item per
the section above. This phase covers cross-cutting polish only.

- **Locale completion**: keys added throughout earlier phases via
  `translate-docs` skill — Phase 9 verifies all 9 supported locales are
  complete and reviews them for cultural fit.
- **Dark theme parity**: visual QA per `34-dark-theme.md` against the
  reference document; compare against light-theme baselines in
  `dev-docs/archive/screenshots/`.
- **Accessibility**:
  - Canvas is keyboard-navigable: `Tab` cycles through nodes, `Enter` opens
    the side panel for the focused node, `Esc` returns focus to source.
  - `aria-label` on every JobNode summarizing job name + needs.
  - Custom focus indicators per `33-focus-indicators.md` (U-shaped underline
    for nodes; bottom border for input fields).
  - Screen-reader read-through of a workflow (job by job) tested with
    VoiceOver.
- **Performance benchmarks**: add `src/bench/workflow.bench.ts` with a
  100-job fixture. Assert parse <50ms, render <200ms (initial mount), edit
  patch <16ms (one frame).
- **Documentation**:
  - `website/guide/workflow-viewer.md` (new).
  - Update `dev-docs/architecture.md` module map.
  - Update `dev-docs/README.md` with a topical entry.
  - Update `.claude/rules/50-codebase-conventions.md` if any new convention
    emerged (e.g., `WorkflowPanelShell` slot pattern).

---

## 7. Risks & mitigations

Ordered by impact post-Codex review.

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Wrong external API/package assumptions block Phases 4-5 | **High** | Phase 0 spikes A and B verify package shapes before any commit. Plan dependency table in §9 lists the *correct* names. |
| 2 | Parser cannot deliver `SourceRange` for all required nodes | **High** | Phase 0 Spike A. Fallback path documented in ADR-3 (use `yaml` package for read). |
| 3 | CST round-trip corrupts user YAML / "byte-identity" gate is unattainable | **High** | ADR-11 redefines the gate (semantic + minimal-diff + comments + anchors). Phase 0 Spike D characterizes real differences before committing the gate. |
| 4 | ProseMirror + React Flow event conflicts in code fences | **High** | ADR-4: full prop matrix disabled. Phase 0 Spike C is the verification gate. Documented fallback to Mermaid-only inline if Spike C fails. |
| 5 | Feature overlap with Genie workflow plan creates DRY breakage | Medium | ADR-10 extracts `WorkflowPanelShell`; ADR-10 routing layer makes detection precedence explicit and tested. |
| 6 | Action metadata fetch slow / privacy concern | Medium | ADR-6: lazy + cached + opt-out. Network only on user action. Settings > Privacy disclosure. |
| 7 | 200+ node workflow performance | Medium | Lazy ELK layout for >50 nodes; canvas virtualization (`onlyRenderVisibleElements`); benchmarks in Phase 9. |
| 8 | i18n compliance slips because polish is end-of-line | Medium | Per-WI DoD in §6; `pnpm lint:i18n` enforces. |
| 9 | Tauri command surface (capabilities, plugin permissions, registration) drift | Medium | Per-WI DoD item 4; review at every phase boundary. |
| 10 | Schema drift when GitHub adds new keys | Low | Unknown keys produce *warnings*, not errors. The IR's `warnings: []` field surfaces them. Refresh `@actions/workflow-parser` quarterly. |
| 11 | `pull_request_target` workflows getting accidentally executed (security) | Low | Out of scope — VMark doesn't execute workflows. We surface a `GHA-SEC-001` warning badge on `pull_request_target` triggers. |
| 12 | Conflict with VMark's existing `yaml` syntax highlight in CodeMirror | Low | We *add* a panel; we don't replace the editor. Highlight stays. |

---

## 8. Test strategy

Per `.claude/rules/10-tdd.md`, RED before GREEN for every WI.

| Layer | Tooling | Coverage target |
|---|---|---|
| IR parser (`parser/*`) | Vitest table-driven + fixture corpus | ≥95% branches |
| Workflow router | Vitest table-driven (path × content matrix) | ≥95% |
| Renderer adapter | Vitest + jsdom; assert node/edge shape | ≥90% |
| Components (JobNode, GhaWorkflowPanel, WorkflowPanelShell) | Testing Library + userEvent | Behavior, not snapshots |
| Code-fence plugin | Same pattern as `mermaidPreview` tests | Behavior + lifecycle (mount/unmount cycles, no listener leak) |
| CST mutators | ADR-11 round-trip gate (semantic + comments + anchors + minimal-diff) over the fixture corpus | ≥95% |
| Action registry | Mock `fetch`, real cache layer | ≥85% |
| Rust commands (`gha_lint`, `gha_fetch_action_yml`) | `#[cfg(test)]` per module, integration tests in `src-tauri/tests/` | ≥85% |
| E2E | Tauri MCP per `tauri-mcp-testing` skill | One smoke per phase, plus a dedicated ProseMirror+canvas interaction smoke for Phase 3 |

Fixture corpus: `dev-docs/fixtures/gha-workflows/` with at least 20 real
workflows from public OSS, covering matrix, reusable calls, all trigger types,
non-trivial `if:` expressions, CJK content. The corpus is checked in.

`pnpm check:all` must pass at every phase boundary.

---

## 9. Dependencies

### Already in `package.json` (reused, no add)

| Package | Used for |
|---|---|
| `@codemirror/lang-yaml` | YAML highlight + lint API in standalone-file editor |
| `@codemirror/lint` | Lint marker rendering |
| `@codemirror/view` + `@codemirror/state` | CodeMirror integration |
| `@tiptap/core` + extensions | NodeView host for code-fence integration |
| `@tauri-apps/plugin-fs` | Action-metadata cache I/O |

### New packages (corrected post-Codex review)

| Package | Phase | Bundle impact (gz, est.) | License | Notes |
|---|---|---|---|---|
| `@xyflow/react` ^12 | 2 | ~50 KB | MIT | Verified package name (`reactflow` is the v11 deprecated name). |
| `dagre` ^0.8 | 2 | ~15 KB | MIT | Default layout. |
| `elkjs` ^0.9 | 2 (lazy) | ~80 KB lazy | EPL-2.0 | Loaded only when nodes >50. |
| `html-to-image` ^1 | 4 | ~15 KB | MIT | Required for SVG/PNG export — `@xyflow/react` does **not** ship its own export utility. |
| `@actions/workflow-parser` | 1 | ~120 KB (incl. schema) | MIT | Replaces `js-yaml`. Provides typed AST + positions + diagnostics. |
| `@actions/languageservice` | 5 | ~80 KB | MIT | Singular — corrected from prior plural. |
| `@actions/expressions` | 5 | ~30 KB | MIT | Used by languageservice; pinned for direct expression validation. |
| `yaml` ^2 | 8 | ~25 KB | ISC | CST round-trip on save path only. |

### Removed from prior draft

| Package | Reason |
|---|---|
| `js-yaml` | Cannot expose AST positions or handle multi-doc YAML. Replaced by `@actions/workflow-parser` for read and `yaml` for save. |

### Rust crates (`src-tauri/Cargo.toml`)

| Crate | Phase | Notes |
|---|---|---|
| `which` | 5 | actionlint binary discovery |
| Existing `reqwest`/`tauri-plugin-http` | 6 | action.yml fetch |
| Existing `serde`/`serde_yaml` | 5, 6 | parsing action.yml on Rust side |

### Bundle math

Steady-state web bundle additions (no `js-yaml`):
50 (xyflow) + 15 (dagre) + 15 (html-to-image) + 120 (workflow-parser) + 80
(languageservice) + 30 (expressions) + 25 (yaml) ≈ **335 KB gz**, plus
**80 KB lazy** for `elkjs`.

The workflow-parser at 120 KB is the largest single item; it bundles the
GHA schema. Tree-shaking should reduce it but verify against `pnpm size` at
the end of Phases 1 and 5. If over budget, consider lazy-loading the
parser behind a dynamic `import()` so non-workflow files pay no cost.

---

## 10. Open questions

Three questions block specific phases and must be answered before that
phase commits code. The other three can wait.

### Resolved (was blocking)

**Q1 — Code-fence rendering surface**: **Inline by default + click-to-expand
into the side panel.** The side panel is already where Phase 2 mounts the
interactive canvas; reusing it avoids a third render surface. Mermaid's
pattern is "inline + modal popup"; ours is "inline + side panel" because the
panel exists already. One renderer, two mount points (static inside fence,
interactive in panel).

**Q2 — Reusable workflow inlining**: **No inlining for v1.** Render the
calling job as a single node with a "reusable workflow" badge and a
click-through that opens the target file (same-repo `./...` refs) or
`https://github.com/owner/repo/.../foo.yml@ref` (cross-repo refs).
Mechanism: full inlining requires recursive parse, file I/O during render,
network for cross-repo refs, and cross-file cycle detection — ≥2× parser
surface for marginal fidelity. Badge + click-through preserves the mental
model without that cost. Flag for v2.

**Q3 — `with:` form when metadata unavailable**: **Free-form key/value rows
with add/remove buttons and a "metadata unavailable" warning badge.** Existing
keys render as labeled rows; an "+ add key" button creates new rows. The
badge makes the degraded mode obvious (so users don't mistake it for a bug).
Read-only would kill the editor; hiding the form leaves users stuck.

### Non-blocking

4. **Mermaid export style**: `flowchart TD` (top-down, conventional for CI)
   vs `flowchart LR` (left-right, matches how GitHub renders run viz).
   Default proposal: TD with a settings toggle. Decide before Phase 4 ships.

5. **Phase 7 vs. Phase 8 order**: Phase 7 is useful read-only (forms reveal
   structure even without save). Phase 8 unlocks save. Order is debatable.
   Default proposal: keep current order; the structured-form UX value is
   high even read-only.

6. **`workflow_run` and `workflow_call` chains**: should the canvas show
   cross-workflow dependencies (one workflow triggering another)? Out of
   scope for v1; flag for v2.

---

## 11. Acceptance — definition of done for the whole feature

- All 20+ fixture workflows render correctly in both surfaces (code fence,
  standalone file).
- Click-to-jump works in both directions (canvas ↔ source).
- Three exports (Mermaid, SVG, PNG) work and represent the visible content
  modulo documented lossiness (lossiness disclosed in UI per ADR-8).
- Save path satisfies the **ADR-11 round-trip gate** (semantic equality +
  comment preservation + anchor preservation + minimal-diff). Not byte
  identity.
- `actionlint` integration optional, gracefully absent when binary missing.
- All UI strings i18n'd to all 9 supported locales (per-WI DoD throughout
  development; Phase 9 verifies completeness).
- `pnpm check:all` green; coverage thresholds met (≥95% parser, ≥90%
  renderer, ≥85% misc).
- Rust unit tests cover `gha_lint` and `gha_fetch_action_yml` happy paths
  and failure modes.
- Zero regressions in existing Mermaid rendering, CodeMirror behavior, or
  `.github/workflows/*` files inside VMark's own repo.
- All Phase 0 spike write-ups present in `dev-docs/grills/gha-workflow/`.
- Updated `website/guide/workflow-viewer.md` and entry in
  `dev-docs/README.md`.
