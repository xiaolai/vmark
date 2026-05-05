/**
 * Workflow Preview Renderer
 *
 * Renders a GitHub Actions workflow YAML code fence as an inline
 * snapshot of the same xyflow + JobNode pipeline that the side panel
 * uses. Pipeline:
 *   YAML → parse() → WorkflowIR → toGraph + applyLayout
 *        → hidden xyflow root → html-to-image.toSvg() → SVG string
 *
 * Visual parity with the side-panel canvas is structural: same nodes,
 * same badges, same layout. Replaces the previous Mermaid-based
 * inline render (lossy per ADR-9 of the GHA viewer plan); rationale
 * lives in dev-docs/plans/20260504-workflow-fence-snapshot.md.
 *
 * @coordinates-with src/lib/ghaWorkflow/render/renderXyflowSnapshot.ts
 *   — render queue + cache
 * @coordinates-with src/components/Editor/WorkflowPanel/JobNode.tsx
 *   — shared node visuals
 * @module plugins/codePreview/renderers/renderWorkflowPreview
 */

import type { EditorView } from "@tiptap/pm/view";
import { Decoration } from "@tiptap/pm/view";
import { sanitizeSvg } from "@/utils/sanitize";
import { diagramWarn } from "@/utils/debug";
import { installDoubleClickHandler, type PreviewCache } from "../previewHelpers";

// Lazy-load the snapshot renderer only when a workflow code fence
// actually requires rendering. This keeps xyflow + react-dom + the
// parser out of the eager App bundle for users who never view a
// workflow fence.
type SnapshotModule = typeof import("@/lib/ghaWorkflow/render/renderXyflowSnapshot");

let snapshotModulePromise: Promise<SnapshotModule> | null = null;

function loadSnapshotModule(): Promise<SnapshotModule> {
  if (snapshotModulePromise) return snapshotModulePromise;
  snapshotModulePromise = import(
    "@/lib/ghaWorkflow/render/renderXyflowSnapshot"
  );
  return snapshotModulePromise;
}

/**
 * Render a workflow YAML to a sanitized SVG string. Returns null on
 * failure so callers can fall back to a textual error placeholder.
 */
async function renderWorkflowToSvg(yaml: string): Promise<string | null> {
  try {
    const mod = await loadSnapshotModule();
    const svg = await mod.renderXyflowSnapshot(yaml);
    if (!svg) return null;
    return sanitizeSvg(svg);
  } catch (e) {
    diagramWarn(
      "Workflow preview: snapshot failed:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * Update live preview element with rendered SVG. Mirrors the
 * updateMermaidLivePreview signature exactly so the dispatcher in
 * tiptap.ts can hand off without special casing.
 */
export async function updateWorkflowLivePreview(
  element: HTMLElement,
  content: string,
  currentToken: number,
  getToken: () => number,
): Promise<void> {
  const svg = await renderWorkflowToSvg(content);
  if (currentToken !== getToken()) return;
  if (svg) {
    element.innerHTML = svg;
  } else {
    element.innerHTML =
      '<div class="code-block-live-preview-error">Invalid workflow</div>';
  }
}

/**
 * Decoration widget shown beside a workflow code fence. Mirrors
 * createMermaidPreviewWidget — async render with a placeholder while
 * Mermaid is loading.
 */
export function createWorkflowPreviewWidget(
  nodeEnd: number,
  content: string,
  cacheKey: string,
  previewCache: PreviewCache,
  handleEnterEdit: (view: EditorView | null | undefined) => void,
): Decoration {
  const placeholder = document.createElement("div");
  placeholder.className =
    "code-block-preview workflow-preview workflow-preview--loading";
  placeholder.textContent = "Rendering workflow…";

  return Decoration.widget(
    nodeEnd,
    /* v8 ignore start -- @preserve reason: Decoration.widget factory callback runs in live ProseMirror view; not exercised in jsdom unit tests */
    (view) => {
      installDoubleClickHandler(placeholder, () => handleEnterEdit(view));
      renderWorkflowToSvg(content)
        .then((svg) => {
          if (svg) {
            previewCache.set(cacheKey, { rendered: svg });
            placeholder.className = "code-block-preview workflow-preview";
            placeholder.innerHTML = svg;
          } else {
            placeholder.className =
              "code-block-preview workflow-preview workflow-preview--error";
            placeholder.textContent = "Failed to render workflow diagram";
          }
        })
        .catch((error: unknown) => {
          diagramWarn(
            "Workflow preview render failed:",
            error instanceof Error ? error.message : String(error),
          );
          placeholder.className =
            "code-block-preview workflow-preview workflow-preview--error";
          placeholder.textContent = "Failed to render workflow diagram";
        });
      return placeholder;
    },
    /* v8 ignore stop */
    { side: 1, key: cacheKey },
  );
}
