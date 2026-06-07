# Workflow Engine: YAML Workflows + React Flow Visualization

> Created: 2026-03-31
> Status: Superseded by `20260418-genie-in-workflow.md` + `20260504-github-actions-workflow-viewer.md` (webhook steps intentionally deferred).
> Branch: `feature/workflow-engine-plan`

## Executive Summary

Transform VMark from a markdown editor into a natural language IDE by adding
three capabilities: (1) typed Genie spec with structured I/O, (2) standalone
`.yml` workflow files with React Flow visualization in a side panel, (3) local
workflow execution with live status overlay. Total estimated delta: ~2,800 LOC
across 6 phases.

**Scope constraint:** Workflows are standalone `.yml` files only — not YAML code
fences inside markdown documents. This eliminates the highest-risk integration
(React Flow inside ProseMirror decorations) and avoids the `yaml workflow`
language tag round-trip problem. If code-fence previews are desired later, they
can be added as an incremental feature on top of this foundation.

## Architecture Decision Record

### ADR-1: React Flow for Workflow Visualization

**Decision:** Use `@xyflow/react` (React Flow v12) as the workflow canvas,
rendered in a side panel alongside the YAML source editor.

**Consequences:**
- Interactive from day one (click node to jump to YAML, hover for details)
- Partial re-renders (only changed nodes update during execution)
- Custom node components (progress bars, token counts, status icons)
- New dependency: `@xyflow/react` (~50KB gz), `dagre` (~15KB gz)
- Standard React component in a panel — no ProseMirror integration complexity

**Alternatives considered:**
- Mermaid-only: No click interaction, full re-render on change, no custom nodes
- React Flow in ProseMirror decoration: High risk (event isolation, lifecycle),
  eliminated by scoping to standalone `.yml` files only
- Vue Flow: VMark is React; wrong framework

### ADR-2: WorkflowGraph as Shared Model

**Decision:** All consumers (React Flow panel, static image export, execution
engine) consume a single `WorkflowGraph` data structure parsed from YAML.

**Consequences:**
- Single parser, single renderer, multiple surfaces
- Type-safe data flow between parser and renderer
- Source positions tracked per step for bidirectional editor linking

### ADR-3: Standalone .yml Files Only (No Code Fence Embedding)

**Decision:** Workflows are standalone `.yml` files, not YAML code fences inside
markdown documents. The visualization is a React Flow side panel, not an inline
code fence preview.

**Context:** Embedding React Flow inside ProseMirror widget decorations is the
highest-risk integration point — React Flow's drag/zoom/wheel events compete
with ProseMirror's event handling, the `Decoration.widget()` API expects passive
HTML, and the lifecycle management (React root mount/unmount during decoration
rebuild) is error-prone. Additionally, the `yaml workflow` language tag does not
round-trip through VMark's code block schema, which only preserves a single
`language` string.

**Consequences:**
- No ProseMirror integration risk — React Flow lives in a standard React panel
- No code block schema changes needed
- No `yaml workflow` language tag problem
- Simpler architecture: `.yml` file opens → CodeMirror + React Flow side panel
- Future: code fence preview can be added later as an incremental feature if
  there is demand, building on the proven side panel components

### ADR-4: GitHub Actions YAML Subset

**Decision:** Use a strict subset of GitHub Actions keywords for the workflow
spec. Familiar vocabulary, flatter structure, auto-exportable to real GHA.

**Kept:** `name`, `on`, `env`, `steps`, `id`, `uses`, `with`, `needs`, `if`,
`matrix`.

**Dropped:** `jobs`, `runs-on`, `container`, `services`, `permissions`,
`${{ }}` expressions.

**Added:** `limits` (timeout/cost/tokens), `approval` (show diff before
applying), `model` (override LLM model).

### ADR-5: Genie Spec v1 Extends Existing Frontmatter

**Decision:** Extend the current Genie frontmatter (which uses simple key:value
parsing) with typed input/output fields. Bump to `genie: v1` version marker.

**Context:** Current Genie metadata has `scope`, `action`, `model`, `context`.
The v1 spec adds `input.type`, `output.type`, `input.accept`, enabling
type-checking in workflows.

**Consequences:**
- Backward compatible: existing Genies without `genie: v1` continue working
- New fields parsed only when `genie: v1` is present
- Rust parser extended (not replaced) to handle nested YAML for input/output
- Adds `serde_yaml` dependency to Rust backend

---

## Phase 1: WorkflowGraph Model + YAML Parser

> Foundation layer. No UI. Pure data structures and parsing logic with full test
> coverage.

### WI-1.1: WorkflowGraph Data Model

**File:** `src/lib/workflow/types.ts` (new)

**Spec:**

```typescript
/** Parsed workflow representation — shared model for all renderers. */
export interface WorkflowGraph {
  name: string;
  description?: string;
  triggers: WorkflowTrigger[];
  env: Record<string, string>;
  defaults: WorkflowDefaults;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
}

export interface WorkflowStep {
  id: string;
  uses: string;                    // "genie/summarize" or "action/read-folder"
  type: "genie" | "action" | "webhook";
  label: string;                   // Display name derived from uses
  icon: string;                    // Emoji: "genie" -> robot, "action/read" -> folder
  with: Record<string, string>;
  needs: string[];
  condition?: string;              // if: expression
  matrix?: Record<string, string[]>;
  model?: string;
  approval?: "auto" | "ask";
  limits?: WorkflowLimits;
  // Source position (for click-to-jump and diagnostics)
  sourceRange?: { startLine: number; endLine: number };
  // Runtime state (populated during execution)
  status?: "pending" | "running" | "success" | "error" | "skipped";
  duration?: number;               // milliseconds
  error?: string;
}

export interface WorkflowEdge {
  source: string;                  // step id
  target: string;                  // step id
}

export interface WorkflowTrigger {
  type: "manual" | "schedule" | "github";
  cron?: string;
  event?: string;
  action?: string;
  branches?: string[];
  paths?: string[];
}

export interface WorkflowDefaults {
  model?: string;
  approval?: "auto" | "ask";
  limits?: WorkflowLimits;
}

export interface WorkflowLimits {
  timeout?: string;                // "5m", "30s"
  maxTokens?: number;
  maxCost?: string;                // "$2.00"
}
```

**Acceptance criteria:**
- [ ] All interfaces exported and documented
- [ ] No runtime dependencies (types only)

**Test targets:** Type-level only; tested via WI-1.2.

---

### WI-1.2: YAML-to-WorkflowGraph Parser

**File:** `src/lib/workflow/parser.ts` (new)

**Spec:**

```typescript
import type { WorkflowGraph } from "./types";

/**
 * Parse a YAML workflow string into a WorkflowGraph.
 * Uses js-yaml for parsing, then validates and normalizes.
 *
 * @throws WorkflowParseError with line/column for invalid YAML
 * @throws WorkflowValidationError for spec violations
 */
export function parseWorkflow(yaml: string): WorkflowGraph;

/**
 * Lightweight heuristic: does this YAML string look like a workflow?
 * Checks for `steps:` array with `uses:` entries.
 * Does NOT fully parse — fast enough for every keystroke.
 */
export function isWorkflowYaml(yaml: string): boolean;

export class WorkflowParseError extends Error {
  constructor(message: string, public line?: number, public column?: number);
}

export class WorkflowValidationError extends Error {
  constructor(message: string, public stepId?: string);
}
```

**Edge computation rules:**
1. If step has `needs: [a, b]` -> edges from `a` and `b` to this step
2. If step has no `needs` and is not the first step -> edge from previous step
3. Circular dependency detection (throw `WorkflowValidationError`)
4. Missing dependency reference detection (throw `WorkflowValidationError`)

**Step type derivation:**
- `uses: "genie/*"` -> type `"genie"`, icon `"robot"`
- `uses: "action/*"` -> type `"action"`, icon derived from action name
- `uses: "webhook/*"` -> type `"webhook"`, icon `"globe"`

**Label derivation:**
- `id` field if present, otherwise last segment of `uses` (e.g., `summarize`)

**Dependency:** `js-yaml` (MIT, ~50KB, already widely used)

**Acceptance criteria:**
- [ ] Parses minimal workflow (name + 1 step)
- [ ] Parses full workflow (needs, matrix, if, limits, approval)
- [ ] Computes edges from `needs:` declarations
- [ ] Computes sequential edges when `needs:` is absent
- [ ] Detects circular dependencies
- [ ] Detects missing step references in `needs:`
- [ ] Detects duplicate step IDs
- [ ] `isWorkflowYaml()` returns true for valid workflows, false for random YAML
- [ ] Throws `WorkflowParseError` with line number for malformed YAML
- [ ] Throws `WorkflowValidationError` with step ID for spec violations

**Test targets:** `src/lib/workflow/__tests__/parser.test.ts`
- Table-driven tests for each step type derivation
- Edge computation with: sequential, parallel, fan-out, fan-in
- Error cases: circular deps, missing refs, duplicate IDs, empty steps
- `isWorkflowYaml` heuristic: workflow YAML, random YAML, non-YAML strings, empty
- Unicode step IDs and CJK content in `with:` values
- Malformed YAML (missing colons, bad indentation)

**Estimated LOC:** ~250

---

### WI-1.3: Static Image Export from React Flow

**File:** `src/lib/workflow/exportImage.ts` (new)

**Spec:**

```typescript
import type { WorkflowGraph } from "./types";

/**
 * Render a WorkflowGraph to a static SVG or PNG using React Flow's
 * built-in export API. Used for: PDF export, clipboard copy, embedding
 * in GitHub READMEs as image files.
 *
 * Uses an off-screen React Flow instance: mount headlessly, call
 * toSVG()/toPNG(), unmount. No visible UI.
 *
 * @param graph - Parsed workflow graph
 * @param format - "svg" or "png"
 * @returns SVG string or PNG data URL
 */
export async function exportWorkflowImage(
  graph: WorkflowGraph,
  format: "svg" | "png",
): Promise<string>;
```

**Implementation approach:**

React Flow v12 provides `@xyflow/react` utilities for headless rendering:
1. Create an off-screen container (`display: none` or `position: absolute; left: -9999px`)
2. Mount `<ReactFlow>` with the same nodes/edges/layout as the in-editor preview
3. Call `reactFlowInstance.toSVG()` or `reactFlowInstance.toPNG()`
4. Unmount and remove container
5. Return the SVG string or PNG data URL

This ensures the exported image is pixel-identical to what the user sees in the
editor — same node components, same colors, same layout.

**Why not Mermaid export:**

Mermaid would produce a diagram that looks different from the in-editor React
Flow rendering (different node shapes, different layout algorithm, different
fonts). One renderer everywhere means what you see is what you export.

For GitHub READMEs where `yaml workflow` fences render as raw YAML, users can
export from within VMark (right-click workflow preview → "Export as SVG") and
embed the image:
```markdown
![Workflow](./workflow.svg)
```

**Acceptance criteria:**
- [ ] SVG export produces valid SVG with correct node positions
- [ ] PNG export produces image data URL at 2x resolution
- [ ] Exported image matches in-editor visual appearance
- [ ] Works with all step types (genie, action, webhook)
- [ ] Works with execution status colors (if status present)
- [ ] Off-screen container is cleaned up after export (no DOM leak)

**Test targets:** `src/lib/workflow/__tests__/exportImage.test.ts`
- SVG export contains expected node count
- SVG export contains correct labels
- Off-screen container removed after export
- Empty graph produces valid (empty) SVG

**Estimated LOC:** ~100

---

## Phase 2: React Flow Side Panel + YAML File Support

> Ships the "wow" moment: open a `.yml` workflow file, see an interactive
> graph alongside the YAML source.

### WI-2.1: Install Dependencies

**Changes:**
- `package.json`: Add `@xyflow/react`, `dagre`, `js-yaml`, `@types/js-yaml`

```bash
pnpm add @xyflow/react dagre js-yaml
pnpm add -D @types/js-yaml @types/dagre
```

**Acceptance criteria:**
- [ ] `pnpm install` succeeds
- [ ] `pnpm check:all` passes (no type errors, no test regressions)
- [ ] Bundle size increase documented

---

### WI-2.2: YAML File Type in File Explorer

**Files:**
- `src/components/Sidebar/FileExplorer/fileTreeFilters.ts` (extend)
- `src/components/Sidebar/FileExplorer/useExplorerOperations.ts` (extend)

**Spec:**

1. Add `.yml` and `.yaml` to the default file filter (alongside `.md`, `.markdown`)
2. YAML files open in VMark's editor (source mode) instead of system default app
3. File explorer shows a distinct icon for YAML files (from Lucide)

**Note:** This was originally Phase 4, but the side panel (WI-2.5) requires
`.yml` files to be openable. Moved earlier per Codex review finding 5.3.

**Acceptance criteria:**
- [ ] YAML files appear in file explorer by default
- [ ] Clicking a YAML file opens it in source mode
- [ ] YAML files show appropriate icon
- [ ] Existing markdown behavior unchanged

**Estimated LOC:** ~40

---

### WI-2.3: Auto-Layout Engine

**File:** `src/lib/workflow/layout.ts` (new)

**Spec:**

```typescript
import type { WorkflowGraph } from "./types";
import type { Node, Edge } from "@xyflow/react";

/**
 * Convert WorkflowGraph into React Flow nodes + edges with dagre layout.
 * Returns positioned nodes (x, y computed) and typed edges.
 */
export function layoutWorkflow(graph: WorkflowGraph): {
  nodes: Node[];
  edges: Edge[];
};
```

**Layout rules:**
- Direction: left-to-right (rankdir: LR)
- Node size: 180px wide x 60px tall (estimated, adjusted by content)
- Node spacing: 60px horizontal, 40px vertical
- Edge type: `smoothstep` (rounded corners)
- Animated edges for "running" status

**Acceptance criteria:**
- [ ] Nodes have non-overlapping positions
- [ ] Linear workflows produce a single horizontal row
- [ ] Parallel steps produce vertically stacked nodes at the same rank
- [ ] Fan-in/fan-out edges connect correctly
- [ ] Empty graph returns empty arrays

**Test targets:** `src/lib/workflow/__tests__/layout.test.ts`
- Sequential layout: nodes in ascending x order
- Parallel layout: same x, different y for sibling steps
- Fan-in: multiple edges converge on one node
- Empty graph, single-step graph

**Estimated LOC:** ~100

---

### WI-2.4: Custom Workflow Node Component

**File:** `src/plugins/workflowPreview/WorkflowNode.tsx` (new)

**Spec:**

```tsx
import type { NodeProps, Node } from "@xyflow/react";

type WorkflowNodeData = {
  label: string;
  icon: string;           // Emoji or Lucide icon name
  type: "genie" | "action" | "webhook";
  status?: "pending" | "running" | "success" | "error" | "skipped";
  duration?: number;
  error?: string;
  stepId: string;
  yamlLine?: number;      // Source line for click-to-jump
};

export type WorkflowNodeType = Node<WorkflowNodeData, "workflow">;

/**
 * Custom React Flow node for workflow steps.
 *
 * Visual states:
 * - Default: neutral background, icon + label
 * - Running: yellow pulse animation, spinner icon
 * - Success: green background, checkmark
 * - Error: red background, error icon, tooltip with message
 * - Skipped: gray, dashed border
 */
export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeType>): JSX.Element;
```

**Styling:** Uses CSS vars from `31-design-tokens.md`:
- Default bg: `var(--bg-secondary)`
- Border: `1px solid var(--border-color)`
- Radius: `var(--radius-md)` (6px)
- Selected: `var(--accent-bg)` background
- Status colors: semantic tokens (`--success-color`, `--error-color`, `--warning-color`)

**File:** `src/plugins/workflowPreview/workflow-node.css` (new)

**Acceptance criteria:**
- [ ] Renders label, icon, and status indicator
- [ ] All five status states visually distinct
- [ ] Dark theme compatible (uses CSS vars, no hardcoded colors)
- [ ] Running state has subtle animation (pulse or spinner)
- [ ] Hover shows tooltip with step details
- [ ] Click fires callback with `stepId` and `yamlLine`

**Test targets:** `src/plugins/workflowPreview/__tests__/WorkflowNode.test.tsx`
- Renders with each status state
- Click fires callback with correct data
- Accessibility: role, aria-label

**Estimated LOC:** ~120 (TSX) + ~80 (CSS)

---

### WI-2.5: Workflow Side Panel

**Files:**
- `src/plugins/workflowPreview/WorkflowPreview.tsx` (new — React Flow canvas)
- `src/plugins/workflowPreview/WorkflowSidePanel.tsx` (new — panel wrapper)
- `src/plugins/workflowPreview/workflow-side-panel.css` (new)
- `src/stores/workflowPreviewStore.ts` (new)

**Context:** This is the primary visualization surface. When a `.yml` workflow
file is open, a persistent side panel shows the React Flow graph alongside the
CodeMirror YAML editor. Standard React component in a panel — no ProseMirror
integration complexity.

**Store:**

```typescript
// src/stores/workflowPreviewStore.ts
interface WorkflowPreviewState {
  /** Whether the side panel is visible */
  panelOpen: boolean;
  /** Parsed graph for the current .yml file (null if parse error) */
  graph: WorkflowGraph | null;
  /** Parse error message, if any */
  parseError: string | null;
  /** The step ID whose YAML is currently under the cursor */
  activeStepId: string | null;

  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;
  setGraph(graph: WorkflowGraph | null, error?: string): void;
  setActiveStepId(stepId: string | null): void;
}
```

**WorkflowPreview component (React Flow canvas):**

```tsx
interface WorkflowPreviewProps {
  graph: WorkflowGraph;
  activeStepId?: string | null;
  onNodeClick?: (stepId: string, yamlLine?: number) => void;
}

/**
 * Self-contained React Flow canvas.
 * - ReactFlowProvider wraps the component
 * - Auto-layout via dagre
 * - Fit-to-view on mount and graph change
 * - Mini controls (zoom in/out, fit view)
 * - Node types: { workflow: WorkflowNode }
 * - Background: dots pattern with var(--border-color)
 */
export function WorkflowPreview(props: WorkflowPreviewProps): JSX.Element;
```

**WorkflowSidePanel component (panel wrapper):**

```tsx
/**
 * Persistent side panel for standalone .yml workflow files.
 * Contains: WorkflowPreview + Run button + error display.
 * Layout: right side of editor area, resizable via drag handle.
 */
export function WorkflowSidePanel(): JSX.Element;
```

**Layout in the editor area:**

```
┌─ Editor Area ─────────────────────────────────────────────┐
│ ┌─ CodeMirror (.yml) ───────┬─┬── Workflow Panel ───────┐ │
│ │                            │▐│                         │ │
│ │ name: Weekly Summary       │▐│  [React Flow canvas]    │ │
│ │ steps:                     │▐│                         │ │
│ │   - id: read               │▐│  ┌────┐   ┌─────────┐  │ │
│ │     uses: action/read...   │▐│  │Read│──→│Summarize│  │ │
│ │   - id: summarize          │▐│  └────┘   └─────────┘  │ │
│ │     uses: genie/summarize  │▐│                         │ │
│ │                            │▐│  [▶ Run]  [Export SVG]  │ │
│ └────────────────────────────┴─┴─────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
                               ↑
                          resize handle (4px, var(--border-color) on hover)
```

**Bidirectional linking:**

1. **Node click -> YAML cursor jump:**
   - Each WorkflowNode stores the YAML source line range for its step
   - Click node -> CodeMirror `dispatch` to set selection at that line
   - Step line range computed during YAML parsing (WI-1.2 tracks positions)

2. **YAML cursor -> node highlight:**
   - CodeMirror `ViewPlugin` detects which step the cursor is in
   - Updates `workflowPreviewStore.activeStepId`
   - React Flow highlights the corresponding node (accent border)

**Run button behavior:**

The Run button in the side panel invokes `invoke("run_workflow", { yaml, env })`
— the same Tauri command that Phase 5 will implement. In Phase 2, this command
does not exist yet, so the button is present but disabled with a "Coming soon"
tooltip. This avoids the dual-execution-architecture problem (Codex finding 1.1).

**Trigger:**
- **Automatic:** When a `.yml` file detected as workflow opens, panel auto-shows
- **Manual:** F5 toggles the panel
- **Toggle button:** In the status bar

**CSS rules:**
- All colors via CSS vars (no hardcoded values)
- Dark theme via `.dark-theme` selector
- React Flow's default styles overridden to match VMark design system
- Panel uses `var(--bg-color)` background, `var(--border-color)` left border

**Acceptance criteria:**
- [ ] Opening a `.yml` workflow file shows the side panel with React Flow
- [ ] Non-workflow `.yml` files show no panel (graceful detection)
- [ ] Click node in React Flow -> cursor jumps to that step's line in CodeMirror
- [ ] Cursor movement in CodeMirror -> corresponding node highlighted in graph
- [ ] YAML edit -> graph re-renders (debounced 300ms)
- [ ] Panel is resizable via drag handle
- [ ] F5 toggles panel visibility
- [ ] Panel width persisted across sessions
- [ ] Run button present but disabled (enabled in Phase 5)
- [ ] Parse errors show inline error message instead of graph
- [ ] Handles empty graph gracefully (placeholder message)
- [ ] Light and dark theme both render correctly
- [ ] No hardcoded colors
- [ ] React Flow controls match VMark button style

**Test targets:**
- `src/stores/__tests__/workflowPreviewStore.test.ts`: store state transitions
- `src/plugins/workflowPreview/__tests__/WorkflowPreview.test.tsx`: renders graph, node click
- `src/plugins/workflowPreview/__tests__/WorkflowSidePanel.test.tsx`: panel open/close, error state

**Estimated LOC:** ~150 (preview) + ~150 (panel) + ~60 (store) + ~120 (CSS) = ~480

---

## Phase 3: Genie Spec v1 (Typed Input/Output)

> Extends the existing Genie system with structured I/O types, enabling
> workflows to type-check data flow between steps.

### WI-3.1: Genie Spec v1 Type Definitions

**Files:**
- `src/types/aiGenies.ts` (extend)
- `src-tauri/src/genies/types.rs` (extend)

**Spec (TypeScript):**

```typescript
// Add to existing GenieMetadata interface:
export interface GenieMetadataV1 extends GenieMetadata {
  version: "v1";
  input: GenieInput;
  output: GenieOutput;
  temperature?: number;
  maxTokens?: number;
  approval?: "auto" | "ask";
  tags?: string[];
}

export interface GenieInput {
  type: "text" | "files" | "folder" | "none" | "pipe";
  accept?: string;          // glob pattern for files/folder
  description?: string;
}

export interface GenieOutput {
  type: "text" | "file" | "files" | "json";
  filename?: string;        // template for file output
  schema?: Record<string, unknown>; // JSON schema for json output
  description?: string;
}

// Type guard
export function isGenieV1(meta: GenieMetadata): meta is GenieMetadataV1;
```

**Spec (Rust):** Corresponding struct additions with `serde_yaml` deserialization
for the nested `input`/`output` fields.

**Backward compatibility:** Genies without `genie: v1` header continue to parse
with the existing simple key:value parser. The v1 parser activates only when the
`genie` field is detected.

**Acceptance criteria:**
- [ ] Existing Genies continue to parse without changes
- [ ] v1 Genies parse all new fields correctly
- [ ] Type guard `isGenieV1()` correctly identifies v1 vs legacy
- [ ] Rust and TypeScript types are in sync

**Test targets:**
- `src/types/__tests__/aiGenies.test.ts` (type guard)
- `src-tauri/src/genies/parsing.rs` (Rust unit tests)
- Existing Genie tests continue passing

**Estimated LOC:** ~80 (TS) + ~120 (Rust)

---

### WI-3.2: Genie v1 Parser (Rust)

**File:** `src-tauri/src/genies/parsing.rs` (extend)

**Spec:**

```rust
/// Parse a Genie v1 file with full YAML frontmatter.
/// Activated when the frontmatter contains `genie: v1`.
fn parse_genie_v1(frontmatter: &str, body: &str, filename: &str) -> Result<GenieContent, String>;
```

**New dependency:** `serde_yaml` in `src-tauri/Cargo.toml`

**Parsing strategy:**
1. Existing `parse_genie()` detects if `genie:` key is present in frontmatter
2. If `genie: v1` -> delegate to `parse_genie_v1()` which uses `serde_yaml`
3. If no `genie:` key -> use existing simple parser (backward compatible)
4. V1 parser validates input/output types are known values
5. Unknown fields are ignored (forward compatible)

**Acceptance criteria:**
- [ ] Legacy Genies parse identically to before
- [ ] V1 Genies with all fields parse correctly
- [ ] V1 Genies with minimal fields (just input.type + output.type) parse
- [ ] Invalid input/output types produce clear error messages
- [ ] Unknown fields are silently ignored
- [ ] UTF-8 BOM handling preserved

**Test targets:** Unit tests in `src-tauri/src/genies/parsing.rs`
- Legacy format roundtrip
- V1 minimal format
- V1 full format (all optional fields)
- Mixed: v1 header with legacy-style simple fields
- Error: invalid input.type, missing required fields

**Estimated LOC:** ~120

---

### WI-3.3: Workflow Type Checking

**File:** `src/lib/workflow/typeCheck.ts` (new)

**Spec:**

```typescript
import type { WorkflowGraph, WorkflowStep } from "./types";
import type { GenieMetadataV1 } from "@/types/aiGenies";

export interface TypeCheckResult {
  valid: boolean;
  errors: TypeCheckError[];
  warnings: TypeCheckWarning[];
}

export interface TypeCheckError {
  stepId: string;
  message: string;
  line?: number;
}

export interface TypeCheckWarning {
  stepId: string;
  message: string;
}

/**
 * Type-check a workflow's data flow.
 * Verifies that each step's input type matches the output type of its
 * data source (the step referenced in `with.input`).
 *
 * @param graph - Parsed workflow
 * @param genies - Map of genie name -> metadata (loaded from workspace)
 */
export function typeCheckWorkflow(
  graph: WorkflowGraph,
  genies: Map<string, GenieMetadataV1>,
): TypeCheckResult;
```

**Type compatibility matrix:**

| Source output | Target input | Compatible? |
|---------------|-------------|-------------|
| text | text | Yes |
| text | pipe | Yes |
| files | files | Yes |
| files | pipe | Yes |
| file | text | No (warn: needs read) |
| json | text | Yes (auto-stringify) |
| json | pipe | Yes |
| * | none | Always (input ignored) |

**Acceptance criteria:**
- [ ] Compatible types produce no errors
- [ ] Incompatible types produce error with step ID and message
- [ ] Missing Genie definitions produce warnings (not errors)
- [ ] Built-in actions have known output types (hardcoded)
- [ ] Circular references handled (don't infinite loop)

**Test targets:** `src/lib/workflow/__tests__/typeCheck.test.ts`
- Table-driven: all combinations from the compatibility matrix
- Workflow with all compatible types -> valid
- Workflow with mismatch -> error with correct step ID
- Missing Genie -> warning
- Built-in actions (read-folder -> files, save-file -> accepts text)

**Estimated LOC:** ~150

---

## Phase 4: YAML Editor Enhancements

> Polish the YAML editing experience with syntax support and completions.
> File explorer support moved to Phase 2 (WI-2.2). Side panel moved to
> Phase 2 (WI-2.5).

### WI-4.1: YAML CodeMirror Language Support

**Files:**
- `package.json` (add `@codemirror/lang-yaml`)
- `src/utils/sourceEditorExtensions.ts` (extend)

**Spec:**

Currently the source editor is Markdown-based. When a `.yml` file is open,
load `@codemirror/lang-yaml` for proper syntax highlighting and indentation.

**Acceptance criteria:**
- [ ] YAML files get syntax highlighting in source mode
- [ ] YAML indentation rules work (auto-indent after `:`, `-`)
- [ ] Markdown files continue using markdown language mode
- [ ] `pnpm check:all` passes

**Estimated LOC:** ~30

---

### WI-4.2: Genie Auto-Complete in YAML

**File:** `src/lib/workflow/yamlCompletion.ts` (new)

**Spec:**

CodeMirror completion source for workflow YAML files:
- When typing `uses: genie/` -> suggest available Genies from workspace
- When typing `uses: action/` -> suggest built-in actions
- When typing `needs:` -> suggest existing step IDs in the workflow
- When typing `input:` in `with:` block -> suggest `stepId.output` references

**Acceptance criteria:**
- [ ] Genie completions show name + description
- [ ] Action completions show all built-in actions
- [ ] Step ID completions only show IDs defined above the current line
- [ ] Completions filter as user types

**Estimated LOC:** ~150

---

## Phase 5: Workflow Execution Engine

> Local execution of workflows from within VMark. This is the most complex
> phase and should only be started after Phases 1-3 are validated.

### WI-5.1: Workflow Execution Store

**File:** `src/stores/workflowExecutionStore.ts` (new)

**Spec:**

```typescript
interface WorkflowExecution {
  id: string;                           // UUID
  workflowName: string;
  startedAt: number;                    // timestamp
  status: "running" | "completed" | "failed" | "cancelled";
  steps: Record<string, StepExecution>;
  env: Record<string, string>;
}

interface StepExecution {
  stepId: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
  startedAt?: number;
  completedAt?: number;
  output?: string;
  error?: string;
  tokenCount?: number;
  cost?: number;
}

interface WorkflowExecutionState {
  executions: Record<string, WorkflowExecution>;
  activeExecutionId: string | null;

  startExecution(workflow: WorkflowGraph, env: Record<string, string>): string;
  updateStepStatus(executionId: string, stepId: string, update: Partial<StepExecution>): void;
  completeExecution(executionId: string, status: "completed" | "failed"): void;
  cancelExecution(executionId: string): void;
  getExecution(executionId: string): WorkflowExecution | undefined;
}
```

**Acceptance criteria:**
- [ ] Create execution, update steps, complete execution lifecycle
- [ ] Step status updates propagate to subscribers
- [ ] Cancel marks remaining pending steps as skipped
- [ ] Execution history preserved (last 50)
- [ ] Guards against updating non-existent executions

**Test targets:** `src/stores/__tests__/workflowExecutionStore.test.ts`
- Full lifecycle: create -> update steps -> complete
- Cancel mid-execution
- Concurrent executions (only one active at a time)
- History limit (51st execution evicts oldest)

**Estimated LOC:** ~200

---

### WI-5.2: Step Executor (Rust Backend)

**File:** `src-tauri/src/workflow/` (new module)

**Subfiles:**
- `mod.rs` — module entry
- `types.rs` — execution types
- `runner.rs` — step-by-step executor
- `commands.rs` — Tauri commands

**Spec:**

```rust
#[tauri::command]
pub async fn run_workflow(
    app: AppHandle,
    yaml: String,
    env: HashMap<String, String>,
) -> Result<String, String>;  // Returns execution ID

#[tauri::command]
pub async fn cancel_workflow(
    app: AppHandle,
    execution_id: String,
) -> Result<(), String>;
```

**Execution model:**
1. Parse YAML into steps
2. Topological sort by `needs:` dependencies
3. Execute steps in order, respecting parallelism:
   - Steps with no unmet `needs:` can run concurrently
   - Emit `workflow:step-update` event to frontend for each status change
4. For Genie steps: invoke AI provider (reuse existing `run_ai_prompt`)
5. For action steps: execute built-in action (read-file, save-file, etc.)
6. For webhook steps: HTTP POST with parameters (new)
7. Pass output from completed steps to dependent steps via `step_id.output`
8. Respect `limits:` (timeout per step, max tokens, max cost)
9. Respect `approval: ask` (emit event, wait for frontend response)
10. On error: mark step as error, skip all dependents, complete as failed

**Events emitted to frontend:**
- `workflow:step-update` — `{ executionId, stepId, status, output?, error?, duration? }`
- `workflow:approval-request` — `{ executionId, stepId, diff }`
- `workflow:complete` — `{ executionId, status }`

**Acceptance criteria:**
- [ ] Sequential workflow executes steps in order
- [ ] Parallel steps (via `needs:`) execute concurrently
- [ ] Step output passed to dependent steps via `with.input: stepId.output`
- [ ] Timeout enforcement cancels long-running steps
- [ ] Cancel command stops execution and marks remaining as skipped
- [ ] Events emitted for each step status change
- [ ] Genie steps invoke AI provider and stream response
- [ ] Action steps execute built-in operations (read/write files)
- [ ] Errors in one step don't crash the entire workflow

**Test targets:** Rust unit tests in `src-tauri/src/workflow/runner.rs`
- Sequential execution order
- Parallel execution (mock steps with delays)
- Dependency resolution (topological sort)
- Error propagation (step fails -> dependents skipped)
- Timeout enforcement
- Cancel mid-execution

**Estimated LOC:** ~500

---

### WI-5.3: Live Execution Overlay on React Flow

**Files:**
- `src/plugins/workflowPreview/WorkflowPreview.tsx` (extend)
- `src/hooks/useWorkflowExecution.ts` (new)

**Spec:**

```typescript
/**
 * Hook that listens to workflow:step-update events and updates
 * the WorkflowGraph step statuses in real-time.
 */
export function useWorkflowExecution(
  executionId: string | null,
  onStepUpdate: (stepId: string, status: StepExecution) => void,
): void;
```

**Behavior:**
1. Listen for `workflow:step-update` Tauri events
2. Match `executionId` to filter events
3. Update corresponding WorkflowGraph step status
4. React Flow nodes re-render with new status (green/yellow/red)
5. Running nodes show spinner animation
6. Completed nodes show duration badge

**Acceptance criteria:**
- [ ] Node colors update in real-time as steps execute
- [ ] Running step shows animated indicator
- [ ] Error step shows red with hover tooltip for error message
- [ ] Duration badge appears on completed steps
- [ ] Multiple rapid updates don't cause rendering thrash

**Estimated LOC:** ~120

---

### WI-5.4: File Snapshots for Undo

**File:** `src-tauri/src/workflow/snapshots.rs` (new)

**Spec:**

Before any workflow execution that modifies files, snapshot all affected files:

```rust
/// Create a snapshot of files that will be modified by a workflow run.
pub fn create_snapshot(
    execution_id: &str,
    file_paths: &[PathBuf],
) -> Result<SnapshotId, String>;

/// Restore all files from a snapshot.
pub fn restore_snapshot(snapshot_id: &str) -> Result<(), String>;

/// List recent snapshots (last 50).
pub fn list_snapshots() -> Result<Vec<SnapshotInfo>, String>;
```

**Storage:** `<app_data_dir>/workflow-snapshots/<execution_id>/`
- Each file copied with its relative path preserved
- Metadata JSON: `{ executionId, timestamp, files: [...] }`
- Auto-cleanup: delete snapshots older than 30 days or beyond 50 count

**Acceptance criteria:**
- [ ] Snapshot captures exact file content before modification
- [ ] Restore returns files to pre-execution state
- [ ] Multiple files in one snapshot
- [ ] Old snapshots cleaned up automatically
- [ ] Snapshot survives app restart (persisted to disk)

**Estimated LOC:** ~150

---

### WI-5.5: Approval Dialog

**Files:**
- `src/stores/workflowApprovalStore.ts` (new)
- `src/components/WorkflowApproval/ApprovalDialog.tsx` (new)
- `src/components/WorkflowApproval/approval-dialog.css` (new)

**Spec:**

When a workflow step has `approval: ask`, before applying changes:

1. Rust emits `workflow:approval-request` with `{ executionId, stepId, diff }`
2. Frontend shows approval dialog:
   - Lists files that will be modified
   - Shows friendly diff (additions in green, deletions in red)
   - Buttons: `Accept All`, `Review Each`, `Cancel`
3. On Accept: emit `workflow:approval-response` with `{ approved: true }`
4. On Cancel: emit `workflow:approval-response` with `{ approved: false }`,
   step marked as skipped, dependents also skipped

**Acceptance criteria:**
- [ ] Dialog appears when approval is requested
- [ ] Diff is readable (not raw git diff)
- [ ] Accept resumes execution
- [ ] Cancel stops the workflow gracefully
- [ ] Dialog uses VMark design system (tokens, radius, shadow)
- [ ] i18n: all strings use `t()` keys

**Estimated LOC:** ~200 (store + component + CSS)

---

## Phase 6: Webhook Connectors

> Extends the workflow system to call external APIs, unifying LLM calls
> and webhooks under the same step interface.

### WI-6.1: Webhook Connector Spec

**File:** `src/lib/workflow/webhookTypes.ts` (new)

**Spec:**

```typescript
/** Webhook connector definition — stored as .yml files in webhooks/ directory */
export interface WebhookConnector {
  name: string;
  description: string;
  endpoint: string;               // URL template with {{var}} placeholders
  method: "GET" | "POST" | "PUT" | "DELETE";
  auth: WebhookAuth;
  headers?: Record<string, string>;
  input: WebhookInput;
  output: WebhookOutput;
  rateLimit?: { requests: number; period: string };
}

export interface WebhookAuth {
  type: "bearer" | "api-key" | "basic" | "none";
  headerName?: string;            // For api-key auth
  credentialRef: string;          // Reference to OS keychain entry
}

export interface WebhookInput {
  type: "json" | "form" | "text";
  fields: WebhookField[];
}

export interface WebhookOutput {
  type: "json" | "text";
  extract?: string;               // JSONPath to extract from response
}

export interface WebhookField {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
}
```

**Acceptance criteria:**
- [ ] Types exported and documented
- [ ] Compatible with workflow step `with:` parameter passing
- [ ] Auth types cover common API patterns

**Estimated LOC:** ~60

---

### WI-6.2: Webhook Executor (Rust)

**File:** `src-tauri/src/workflow/webhook.rs` (new)

**Spec:**

```rust
/// Execute a webhook step: send HTTP request, return response.
pub async fn execute_webhook(
    connector: &WebhookConnector,
    params: HashMap<String, String>,
    credentials: &CredentialStore,
) -> Result<String, String>;
```

**Security:**
- Credentials resolved from OS keychain via Tauri secure storage
- Never log credentials or full request bodies
- Timeout: configurable per connector, default 30s
- HTTPS required for production connectors (HTTP allowed for localhost only)

**Acceptance criteria:**
- [ ] Sends HTTP request with correct method, headers, body
- [ ] Auth header injected from credential store
- [ ] Response extracted via JSONPath if `output.extract` specified
- [ ] Timeout enforced
- [ ] Network errors produce clear error messages

**Estimated LOC:** ~200

---

## Dependency Graph

```
Phase 1 (Foundation)
  WI-1.1 types
  WI-1.2 parser ← WI-1.1
  WI-1.3 static image export ← WI-1.1, WI-2.4 (needs node component)

Phase 2 (Side Panel) ← Phase 1
  WI-2.1 dependencies
  WI-2.2 file explorer YAML support
  WI-2.3 layout engine ← WI-1.1, WI-2.1
  WI-2.4 node component ← WI-2.1
  WI-2.5 side panel ← WI-2.2, WI-2.3, WI-2.4, WI-1.2

Phase 3 (Genie Spec) — independent of Phase 2
  WI-3.1 types
  WI-3.2 parser ← WI-3.1
  WI-3.3 type checking ← WI-3.1, WI-1.1

Phase 4 (YAML Editor) ← Phase 2
  WI-4.1 YAML language support
  WI-4.2 auto-complete ← WI-1.2

Phase 5 (Execution) ← Phase 1, Phase 3
  WI-5.1 execution store ← WI-1.1
  WI-5.2 step executor (Rust) ← WI-1.2, WI-3.2
  WI-5.3 live overlay ← WI-2.5, WI-5.1
  WI-5.4 file snapshots
  WI-5.5 approval dialog ← WI-5.1

Phase 6 (Webhooks) ← Phase 5
  WI-6.1 types
  WI-6.2 executor ← WI-6.1, WI-5.2
```

## LOC Summary

| Phase | WI | Component | New LOC |
|-------|----|-----------|---------|
| 1 | 1.1 | WorkflowGraph types | ~50 |
| 1 | 1.2 | YAML parser (with source positions) | ~250 |
| 1 | 1.3 | Static image export | ~100 |
| 2 | 2.1 | Dependencies (install) | 0 |
| 2 | 2.2 | File explorer YAML support | ~40 |
| 2 | 2.3 | Layout engine | ~100 |
| 2 | 2.4 | Node component (TSX + CSS) | ~200 |
| 2 | 2.5 | Side panel (preview + panel + store + CSS) | ~480 |
| 3 | 3.1 | Genie v1 types (TS + Rust) | ~80 |
| 3 | 3.2 | Genie v1 parser (Rust) | ~120 |
| 3 | 3.3 | Type checking | ~150 |
| 4 | 4.1 | YAML CodeMirror language support | ~30 |
| 4 | 4.2 | YAML auto-complete | ~150 |
| 5 | 5.1 | Execution store | ~200 |
| 5 | 5.2 | Step executor (Rust) | ~500 |
| 5 | 5.3 | Live overlay | ~120 |
| 5 | 5.4 | File snapshots | ~150 |
| 5 | 5.5 | Approval dialog | ~200 |
| 6 | 6.1 | Webhook types | ~60 |
| 6 | 6.2 | Webhook executor | ~200 |
| **Total** | | | **~3,180** |

Growth: ~0.5% on 683K LOC codebase.

## Visualization UX

Single context: standalone `.yml` files with a persistent side panel.

```
┌──────────────────────────┬─────────────┬───────────────────────────────────┐
│ Context                  │ Renderer    │ UX                                │
├──────────────────────────┼─────────────┼───────────────────────────────────┤
│ Standalone .yml file     │ React Flow  │ Persistent side panel. Click node │
│ (Source mode)            │             │ → jump to YAML line. Cursor in    │
│                          │             │ YAML → highlight node. Resizable. │
│                          │             │ F5 to toggle. Run button.         │
├──────────────────────────┼─────────────┼───────────────────────────────────┤
│ Export (SVG, PNG)        │ React Flow  │ html-to-image from side panel     │
│                          │ (snapshot)  │ canvas. "Export SVG" button.      │
└──────────────────────────┴─────────────┴───────────────────────────────────┘
```

**No code fence embedding.** Workflows are `.yml` files, not YAML inside markdown.
This eliminates:
- React Flow inside ProseMirror decorations (highest risk item)
- `yaml workflow` language tag round-trip problem
- Event isolation between React Flow and ProseMirror
- Code fence detection heuristics in WYSIWYG and source mode

If code fence preview is desired later, it can be added incrementally — the
`WorkflowPreview` React component from WI-2.5 is reusable in any context.

## New Dependencies

| Package | Version | Size (gz) | Phase | Purpose |
|---------|---------|-----------|-------|---------|
| `@xyflow/react` | ^12 | ~50KB | 2 | React Flow graph canvas |
| `dagre` | ^0.8 | ~15KB | 2 | Auto-layout (DAG positioning) |
| `js-yaml` | ^4 | ~50KB | 1 | YAML parsing |
| `@types/js-yaml` | ^4 | dev | 1 | TypeScript types |
| `@types/dagre` | ^0.7 | dev | 2 | TypeScript types |
| `serde_yaml` | ^0.9 | (Rust) | 3 | Genie v1 YAML parsing |

Total bundle impact: ~115KB gzipped (acceptable for a core feature).

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| ~~React Flow inside ProseMirror decoration~~ | ~~High~~ | **Eliminated** by scoping to standalone `.yml` files only (ADR-3) |
| ~~`yaml workflow` tag round-trip~~ | ~~High~~ | **Eliminated** by scoping to standalone `.yml` files only (ADR-3) |
| Workflow execution complexity exceeds estimate | High | Split WI-5.2 into sub-milestones: sequential → actions → AI → concurrency → approval |
| `run_ai_prompt` API incompatible with runner | High | Extract a backend AI adapter returning structured results (Codex finding 3.4) |
| Genie v1 parser breaks existing Genies | High | Gated behind `genie: v1` version marker; legacy parser untouched |
| Static image export API assumptions | Medium | Use `html-to-image` library (not nonexistent `toSVG()` built-in); requires visible container with dimensions |
| `js-yaml` parser size in bundle | Low | Already common dep; tree-shaking reduces actual impact |
| dagre layout produces ugly graphs for complex workflows | Low | Constrain to <15 steps per workflow; add elkjs fallback later if needed |

## Verification Gates

Each phase must pass `pnpm check:all` before proceeding.

- **Phase 1:** `pnpm check:all` passes, parser handles all edge cases in tests
- **Phase 2:** Visual demo — open a `.yml` workflow file, see React Flow side panel
- **Phase 3:** Existing Genies still work, v1 Genies parse correctly, `pnpm check:all`
- **Phase 4:** YAML files get syntax highlighting, completions work
- **Phase 5:** Execute a 3-step workflow, see live status on graph
- **Phase 6:** Call a real API (e.g., httpbin.org) from a workflow step
