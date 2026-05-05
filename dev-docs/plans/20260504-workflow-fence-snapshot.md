# Workflow Fence Snapshot — xyflow inline render

**Status:** Draft (Phase 1 in progress)
**Owner:** Xiaolai
**Branch:** `feat/workflow-fence-xyflow-snapshot`
**Stacks on:** `refactor/mcp-prune-to-four-tools` (which stacks on `feature/gh-actions-workflow-viewer`)
**Created:** 2026-05-04

## Goal

Replace the Mermaid-based inline render of GitHub Actions workflow YAML in markdown code fences with the same xyflow-based render the side panel uses, captured as a frozen SVG via `html-to-image`. **Workflows are a first-class asset in VMark** (alongside markdown), and visual parity between inline preview and side-panel canvas is structural — not aesthetic.

The current Mermaid pipeline strips custom node decorations (matrix badges, runner labels, conditional dots, reusable badges) that the side panel renders via `JobNode`. That divergence reads as "the inline preview looks wrong" rather than "intentionally simplified." Killing the Mermaid path puts the IR through one renderer, two surfaces.

## Non-goals

- Re-implementing xyflow node rendering as native SVG (would defeat the parity goal — two render paths to maintain).
- Live interactivity inside the inline preview (drag, click-to-select). The inline render is read-only by design; users open the standalone YAML for interaction.
- Markmap, LaTeX, Mermaid (non-workflow) renderers — those stay on their existing paths.

## ADRs

### ADR-1: One IR, one renderer

**Decision:** Both surfaces — side panel and inline fence — feed the workflow IR into the same `toGraph` + `applyLayout` + `JobNode` pipeline. The inline path adds a final `html-to-image.toSvg()` capture step; the side-panel path keeps the live xyflow canvas.

**Mechanism:** Visual parity is structural rather than maintained by hand. Changes to `JobNode` (a new badge, a layout tweak) propagate to both surfaces automatically. Eliminates the "Mermaid emits boxes, side panel shows badges" divergence.

**Confidence:** High. Same approach the export pipeline takes (ADR-8 of the GHA viewer plan).

### ADR-2: Single shared off-screen xyflow root

**Decision:** Mount **one** persistent xyflow `ReactFlowProvider` + canvas at a fixed off-screen DOM position (e.g., `position: absolute; left: -9999px; visibility: hidden`). All snapshot renders re-use that same root by swapping nodes/edges via `setNodes`/`setEdges`. Don't mount one xyflow per code fence.

**Mechanism:** A markdown doc with 20 fences should not pay 20× the React mount cost. React's reconciler swaps node trees in-place much cheaper than mount/unmount. Bounded memory and main-thread cost regardless of doc size.

**Confidence:** High.

### ADR-3: Content-hash cache, in-memory + disk

**Decision:** Cache snapshots keyed on `hash(canonicalize(yaml))` where `canonicalize` strips comments and trailing whitespace. In-memory `Map` for the hot path; persisted to `appDataDir/workflow-snapshot-cache/<hash>.svg` (or a single JSONL with hash → SVG entries) so cold start has near-zero cost on unchanged docs.

**Mechanism:** Most repeated fences (tutorials, doc pages) are byte-identical or near-identical. Hash-cache turns N renders into 1 render + (N-1) lookups. Disk persistence turns repeat-session opens into (N-1) lookups.

**Confidence:** High on in-memory; **Phase 2** for disk cache (skip in v1 if MVP ships in budget).

### ADR-4: FIFO single-flight queue

**Decision:** Snapshot requests serialize through one queue. The shared xyflow root processes one workflow at a time: set nodes/edges, `await raf` for layout, `html-to-image.toSvg`, cache, advance. Concurrent calls wait their turn.

**Mechanism:** Concurrent renders contend for the layout pass and html-to-image's main-thread DOM walk; serializing eliminates contention without adding worker complexity.

**Confidence:** High.

### ADR-5: IntersectionObserver gating (Phase 2)

**Decision:** Only enqueue a snapshot job when the fence's placeholder is within ~1.5 viewport heights of the visible area. Off-screen fences stay as `code-block-preview workflow-preview--pending` placeholders until they near the viewport.

**Mechanism:** A long doc with 20 fences typically shows 1–3 at a time. Lazy-mounting fences when they near the viewport caps initial work to the visible window.

**Confidence:** Medium-high. Adds complexity; defer to Phase 2 if v1 already meets the perf budget.

### ADR-6: AI-side snapshot tool (deferred)

**Decision:** A future `vmark.workflow.snapshot({tabId})` MCP action could return the cached SVG, letting AI agents reason about the visual structure. **Not in v1 scope.** Recorded so the cache shape (workflow YAML → SVG) anticipates the use case.

**Confidence:** Low priority. Build only if real demand surfaces.

## Final architecture

```
                                     ┌──────────────────────────────────┐
   workflow YAML  ──parse──► IR ──┬─►│  toGraph + applyLayout (dagre)  │
                                  │  └──────────────────────────────────┘
                                  │           │
                                  │           ▼
                                  │  ┌──────────────────────────────────┐
                                  │  │  JobNode (React)                 │
                                  │  └──────────────────────────────────┘
                                  │           │
                                  │           ├───►  side panel: live canvas (interactive)
                                  │           │
                                  │           └───►  hidden root: html-to-image.toSvg
                                  │                              │
                                  │                              ▼
                                  │                  ┌──────────────────┐
                                  │                  │  cached SVG      │  ← memo + disk
                                  │                  └──────────────────┘
                                  │                              │
                                  └────cache hit─────────────────┘
                                                                 │
                                                                 ▼
                                                       inline fence widget
```

## Performance budget

| Metric | Target |
|---|---|
| First-paint of a single fence (cache miss) | ≤ 300 ms (xyflow layout 50–100 ms + html-to-image 50 ms + react mount 100 ms; budget allows for slow machines) |
| First-paint of a fence with cache hit | ≤ 16 ms (sync DOM swap from cached string) |
| Edit→re-render debounce | 500 ms (existing convention) |
| Doc with 20 distinct fences (worst case, fresh cache) | ≤ 5 s total to render all 20 (visible-first via IntersectionObserver if Phase 2 lands; otherwise serial 20 × 250 ms = 5 s) |
| Doc with 20 *identical* fences | ≤ 350 ms (1 render + 19 cache hits) |

## Work items

### Phase 1 — V1 MVP (this PR)

- **WI-1.1** — Plan doc (this file). DoD: file present, ADRs 1–4 filled.
- **WI-1.2** — `src/lib/ghaWorkflow/render/renderXyflowSnapshot.ts`: persistent hidden xyflow root, FIFO queue, in-memory cache. DoD: unit tests green for hash dedup + queue ordering.
- **WI-1.3** — Wire `createWorkflowPreviewWidget` (`src/plugins/codePreview/renderers/renderWorkflowPreview.ts`) to call `renderXyflowSnapshot` instead of `workflowYamlToMermaid + renderMermaid`. Keep the existing `previewCache` shape so `createPreviewElement` continues to work. DoD: existing 244-test codePreview suite stays green.
- **WI-1.4** — Drop the now-dead `workflowYamlToMermaid` codepath from the codePreview surface. Keep the function in `lib/ghaWorkflow/render/toMermaid.ts` (still used by Mermaid export per ADR-8 of the original plan). DoD: `git grep workflowYamlToMermaid` returns only the export site and the function definition.
- **WI-1.5** — Live smoke against `pnpm tauri dev`: F6 round-trip preserves snapshot; visual parity check against the side-panel `JobNode`. DoD: screenshot in conversation log; no regressions.
- **WI-1.6** — Final gate: `pnpm check:all` green; size-limit shows xyflow chunk shared between side-panel + inline (no eager App bundle bloat).

### Phase 2 — defer until evidence demands

- IntersectionObserver gating
- Disk-persisted cache (`appDataDir/workflow-snapshot-cache/`)
- Idle-time prefetch with `requestIdleCallback`
- `vmark.workflow.snapshot` MCP action
- **Edge rendering in the captured snapshot.** The off-screen xyflow
  root contains the edge paths in `.react-flow__edges svg` (verified
  via DOM probe), but the parent `.react-flow__edges` div has a 0×0
  client rect because xyflow uses `position: absolute; left: 0; top: 0`
  with no explicit dimensions. html-to-image's PNG raster respects
  the parent's clip rect and drops the inner SVG content even though
  CSS `overflow: visible` lets the browser render it on screen.
  Mitigations to try in v2: (a) explicitly size the edges-layer
  container before capture, (b) capture `.react-flow__viewport`
  instead of `.react-flow`, (c) post-process the PNG to draw edges
  programmatically from the IR + dagre output. The side-panel canvas
  (live xyflow, no html-to-image) renders edges correctly thanks to
  the JobNode Handle fix from this PR.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Hidden xyflow root affects accessibility tree (screen readers see hidden duplicate canvas) | Low | `aria-hidden="true"` on the off-screen container; `inert` attribute |
| html-to-image SVG is large (~860 KB for 20 nodes per ADR-8 of the original plan) | Medium | Inline `<style>` blocks shared once; first-paint cost surfaces via render-time logging |
| ReactFlowProvider context conflict between hidden root and side panel | Medium | Each ReactFlowProvider creates its own internal context; siblings don't bleed. Test verifies. |
| Unmounting hidden root on app exit leaks React 19 StrictMode double-effect | Low | `createRoot` once at module load; never unmount during session |
| html-to-image's foreignObject SVG can render inconsistently in Safari Webview | Low | Tauri ships WebKit; verify smoke on the Tauri webview specifically |

## Test strategy

| Test | Pattern | File |
|---|---|---|
| Hash-cache dedup | unit | `src/lib/ghaWorkflow/render/__tests__/renderXyflowSnapshot.test.ts` |
| FIFO ordering | unit | same |
| Canonicalize ignores comments + trailing whitespace | unit | same |
| End-to-end render returns valid SVG string | integration | same (jsdom-friendly via mock if html-to-image breaks in jsdom) |
| codePreview integration: workflow fence renders xyflow snapshot, not Mermaid | integration | `src/plugins/codePreview/__tests__/renderWorkflowPreview.test.ts` |
| Live smoke: side-panel JobNode and inline snapshot use same node visuals | manual via Tauri MCP | conversation log |

## What's not in scope

- Mermaid export pipeline (ADR-8 of the GHA viewer plan, used by export menu) — stays as-is.
- Markmap, LaTeX, plain Mermaid code-fence previews — out of scope.
- Image-format options (PNG instead of SVG) — SVG only for v1.

## References

- `dev-docs/plans/20260504-github-actions-workflow-viewer.md` ADR-8, ADR-9
- `src/components/Editor/WorkflowPanel/WorkflowCanvasInner.tsx` — the canvas pattern to reuse
- `src/lib/ghaWorkflow/render/toGraph.ts` — IR → nodes/edges
- `src/lib/ghaWorkflow/render/layout.ts` — dagre layout
