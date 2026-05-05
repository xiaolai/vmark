/**
 * Purpose: Public entry point for the GHA workflow canvas. Lazy-loads
 *   the inner xyflow surface so xyflow + dagre + the xyflow CSS bundle
 *   land in a separate chunk loaded only when a workflow viewer surface
 *   mounts.
 *
 *   Without this lazy boundary, every cold start absorbed ~90 kB of
 *   xyflow into the eager App bundle (judgment-agent audit finding).
 *   The Suspense boundary lives at the canvas level — not at the panel
 *   mount — to avoid the React 19 + xyflow disappearLayoutEffects loop
 *   documented in size-limit.cjs's EAGER: App comment.
 *
 * Key decisions:
 *   - Suspense fallback is `null`. The panel chrome already shows the
 *     side-panel surface; an extra spinner here would flash for the
 *     few hundred ms the chunk takes to load.
 *   - ReactFlowProvider lives inside the lazy chunk
 *     (`WorkflowCanvasInner.tsx`); keeping it in this outer file would
 *     pull all of xyflow back into the eager bundle.
 *
 * Interactive verification: this component mounts React Flow inside the
 * Tauri webview. Behavior is verified end-to-end at app runtime;
 * compile-time + DOM-shape correctness is covered by
 * WorkflowCanvas.test.tsx.
 *
 * @module components/Editor/WorkflowPanel/WorkflowCanvas
 */

import { Suspense, lazy, type ReactElement } from "react";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import "./workflow-canvas.css";

const WorkflowCanvasInner = lazy(() => import("./WorkflowCanvasInner"));

interface WorkflowCanvasProps {
  workflow: WorkflowIR;
}

export function WorkflowCanvas(props: WorkflowCanvasProps): ReactElement {
  return (
    <Suspense fallback={null}>
      <WorkflowCanvasInner {...props} />
    </Suspense>
  );
}
