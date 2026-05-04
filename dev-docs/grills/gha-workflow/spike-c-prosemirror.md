# Spike C — `@xyflow/react` static mode inside ProseMirror NodeView

> Status: **PASS WITH ONE MITIGATION** (9/10 scenarios; 2026-05-04)
> Plan ADR: ADR-4
> Probe: `probes/spike-c-runner.mjs` + `spike-c-app.tsx` + `spike-c.html`
> Run with: `node spike-c-runner.mjs`

## Goal

Verify that `@xyflow/react` rendered inside a ProseMirror `NodeView` with
the **full static-mode prop matrix** does not break ProseMirror's
selection, scroll, focus, keyboard navigation, or lifecycle.

## Method

Headless Playwright (Chromium) drives a minimal ProseMirror harness with
a custom `workflow_fence` block schema and a `NodeView` that mounts
`<ReactFlow>` with these props:

```tsx
panOnDrag={false}        panOnScroll={false}
zoomOnScroll={false}     zoomOnPinch={false}
zoomOnDoubleClick={false}
nodesDraggable={false}   nodesConnectable={false}
nodesFocusable={false}   edgesFocusable={false}
elementsSelectable={false}
preventScrolling={false}
proOptions={{ hideAttribution: true }}
tabIndex={-1}
```

The harness simulates 10 user-driven scenarios, each automated end-to-end.

## Findings

| # | Scenario | Result | Detail |
|---|---|---|---|
| 1 | Mouse wheel over canvas | ✓ | `docScrolled=true canvasEvents=0` — page scrolls; canvas doesn't zoom or pan |
| 2 | Click + drag on a node | ✓ | Node position unchanged after drag (`nodesDraggable=false` works) |
| 3 | Click on a node | ✓ | `cursorOffset 1→1 (Δ=0); nodeClick=true` — click handler fires (desired, for "open in side panel"), PM cursor doesn't unexpectedly jump |
| 4 | Tab from above the fence | ✓ | Tab traversal `TEXTAREA → BODY → ProseMirror → TEXTAREA → BODY` — never lands on a canvas node |
| 5 | Pinch / double-click | ✓ | No zoom triggered |
| 6 | Resize browser window | ✓ | Canvas resizes; no errors |
| 7 | NodeView rebuild (single) | ✓ | `created+1 destroyed+1 live=1` — clean teardown |
| 8 | 50 mount/unmount cycles | ✓ | `created+50 destroyed+50 live=1` — no NodeView leak |
| 9 | Drag-select crossing the fence (mouse) | **✗** | `selectedLen=0` — mouse drag from above the fence to below does NOT extend ProseMirror selection across the fence |
| 10 | Cross-fence selection via Cmd+A + selection inspect | ✓ | `selectionLen=70` includes both "Above the fence" and "Below the fence" text |

**Summary: 9/10 pass.**

## The one failure: mouse drag-select across the fence

When the user drags the mouse from above the fence to below the fence,
the mouse path crosses the canvas. The canvas's pane element captures
mouse events even with the full static prop matrix, so ProseMirror does
not see a continuous mouse-down → mouse-up gesture and the selection
ends up empty.

**Workaround verified to be feasible** (not implemented in spike, but
identified as the standard fix):

```css
/* On the canvas pane — let mouse events pass through to ProseMirror */
.workflow-fence-static .react-flow__pane,
.workflow-fence-static .react-flow__viewport {
  pointer-events: none;
}
/* Re-enable on the elements we want clickable */
.workflow-fence-static .react-flow__node,
.workflow-fence-static .react-flow__controls,
.workflow-fence-static .open-panel-button {
  pointer-events: auto;
}
```

This pattern lets drag-select pass through the canvas while keeping
node-click handlers and the "open in side panel" button live. **Phase 3
must implement this CSS as part of WI-3.2** and re-run scenario 9 as a
regression test.

## Lifecycle observations (scenarios 7 + 8)

The strongest result from the spike. 50 destroy+create cycles produced:
- 50 `destroy()` calls invoked
- 50 React roots unmounted
- 1 live NodeView at the end (correct — one fence in the doc)
- 0 detached DOM warnings in console

This validates the cleanup discipline plan in WI-3.3. The pattern:

```ts
class WorkflowFenceView implements NodeView {
  private root: Root | null = null;
  /* ... */
  destroy() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
```

works correctly through React 19 + `@xyflow/react` v12 + ProseMirror
1.41+ with no leaks.

## Decision

**Adopt static mode for Phase 3 inline preview** with the `pointer-events`
mitigation for drag-select. Do **not** fall back to Mermaid-only inline.

The "fallback path" defined in ADR-4 is no longer needed — even the one
failing scenario has a clear, well-understood fix.

## Open follow-ups for Phase 3

1. **WI-3.2 must include the `pointer-events: none` CSS** on the canvas
   pane/viewport, with `pointer-events: auto` on nodes and the "open in
   side panel" button.
2. **Regression test for scenario 9** (drag-select crossing the fence) in
   the Tauri MCP E2E suite per `tauri-mcp-testing` skill.
3. **Stress test with multiple fences** in one document — the spike used
   one fence; a doc with 5 fences should be re-tested for cumulative
   listener behavior.
4. **Test under VMark's actual Tiptap layer** (this spike used raw
   ProseMirror). Tiptap adds its own NodeView wrapping; verify that wrap
   doesn't reintroduce listener leaks.
5. **Test on a real touch device** (macOS Magic Trackpad / iPad
   simulator). Pinch-zoom may behave differently than headless Chromium
   reports.
