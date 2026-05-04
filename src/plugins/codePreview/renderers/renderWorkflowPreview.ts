/**
 * Workflow Preview Renderer
 *
 * Renders a GitHub Actions workflow YAML code fence as an inline
 * Mermaid flowchart. Pipeline:
 *   YAML → parse() → WorkflowIR → toMermaid() → renderMermaid() → SVG
 *
 * This is the inline-preview path (lossy per ADR-8 — no custom node
 * decorations, no status badges). The richer @xyflow/react view lives
 * in the side panel (Phase 2 components in
 * src/components/Editor/WorkflowPanel/).
 *
 * @coordinates-with src/lib/ghaWorkflow/parser/index.ts — IR producer
 * @coordinates-with src/lib/ghaWorkflow/export/toMermaid.ts — IR → text
 * @coordinates-with src/plugins/mermaid/index.ts — actual SVG renderer
 * @module plugins/codePreview/renderers/renderWorkflowPreview
 */

import type { EditorView } from "@tiptap/pm/view";
import { Decoration } from "@tiptap/pm/view";
import { renderMermaid } from "@/plugins/mermaid";
import { sanitizeSvg } from "@/utils/sanitize";
import { diagramWarn } from "@/utils/debug";
import { installDoubleClickHandler, type PreviewCache } from "../previewHelpers";

// Lazy-load the parser + Mermaid exporter only when a workflow code
// fence actually requires rendering. This keeps @actions/workflow-parser
// (~120 KB gz) out of the eager App bundle. Mirrors the mermaid plugin's
// own lazy-loading pattern.
type GhaWorkflowParser = typeof import("@/lib/ghaWorkflow/parser");
type GhaWorkflowExporter = typeof import("@/lib/ghaWorkflow/export/toMermaid");

let ghaModulesPromise: Promise<{
  parser: GhaWorkflowParser;
  exporter: GhaWorkflowExporter;
}> | null = null;

async function loadGhaModules() {
  if (ghaModulesPromise) return ghaModulesPromise;
  ghaModulesPromise = Promise.all([
    import("@/lib/ghaWorkflow/parser"),
    import("@/lib/ghaWorkflow/export/toMermaid"),
  ]).then(([parser, exporter]) => ({ parser, exporter }));
  return ghaModulesPromise;
}

/**
 * Convert a workflow YAML string to a Mermaid `flowchart TD` string.
 * Always returns valid Mermaid; for malformed input returns a
 * one-node "empty" placeholder so renderMermaid doesn't throw on the
 * downstream side.
 */
export async function workflowYamlToMermaid(yaml: string): Promise<string> {
  try {
    const { parser, exporter } = await loadGhaModules();
    const ir = parser.parse(yaml);
    return exporter.toMermaid(ir);
  } catch (e) {
    diagramWarn(
      "Workflow preview: parse failed:",
      e instanceof Error ? e.message : String(e),
    );
    return "flowchart TD\n    empty[no jobs]";
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
  const mermaid = await workflowYamlToMermaid(content);
  const svg = await renderMermaid(mermaid);
  if (currentToken !== getToken()) return;
  if (svg) {
    element.innerHTML = sanitizeSvg(svg);
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
      workflowYamlToMermaid(content)
        .then((mermaid) => renderMermaid(mermaid))
        .then((svg) => {
          if (svg) {
            previewCache.set(cacheKey, { rendered: svg });
            placeholder.className = "code-block-preview workflow-preview";
            placeholder.innerHTML = sanitizeSvg(svg);
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
