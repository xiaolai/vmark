/**
 * First-party fence renderers, registered as peers — Phase 5 WI-5.1.
 *
 * Purpose: register VMark's own diagram renderers into the fence extension point
 * markdown declares (`fenceRegistry.ts`), using the same API a third-party
 * renderer would.
 *
 * That symmetry is the point of ADR-015 D3. These are not privileged children of
 * markdown; they are peers that claim a language. Nothing in the markdown
 * dispatch path names mermaid, graphviz, markmap, svg or the workflow preview
 * any more — it asks the registry.
 *
 * Registration is idempotent so an editor remount cannot double-register.
 *
 * @coordinates-with fenceRegistry.ts — the extension point
 * @module plugins/codePreview/builtinFenceRenderers
 */
import { isGraphvizLanguage } from "@/plugins/graphviz";
import { isLatexLanguage } from "./previewHelpers";
import { createLatexPreviewWidget } from "./renderers/renderLatex";
import { createMermaidPreviewWidget } from "./renderers/renderMermaidPreview";
import { createGraphvizPreviewWidget } from "./renderers/renderGraphvizPreview";
import { createMarkmapPreviewWidget } from "./renderers/renderMarkmapPreview";
import { createSvgPreviewWidget } from "./renderers/renderSvgPreview";
import { createWorkflowPreviewWidget } from "./renderers/renderWorkflowPreview";
import { registerFenceRenderer, registeredFenceLanguages } from "./fenceRegistry";

let registered = false;

/** Register VMark's built-in fence renderers. Safe to call repeatedly. */
export function registerBuiltinFenceRenderers(): void {
  if (registered || registeredFenceLanguages().length > 0) return;
  registered = true;

  registerFenceRenderer({
    extensionId: "vmark.markmap",
    languages: ["markmap"],
    emptyLabelKey: "editor:preview.emptyMindmap",
    copyable: true,
    // Renders to live DOM — deliberately skips the shared preview cache.
    create: ({ nodeEnd, content, cacheKey, onEnterEdit }) =>
      createMarkmapPreviewWidget(nodeEnd, content, cacheKey, onEnterEdit),
  });

  registerFenceRenderer({
    extensionId: "vmark.latex",
    matches: isLatexLanguage,
    emptyLabelKey: "editor:preview.emptyMath",
    create: ({ nodeEnd, content, cacheKey, previewCache, onEnterEdit }) =>
      createLatexPreviewWidget(nodeEnd, content, cacheKey, previewCache, onEnterEdit),
  });

  registerFenceRenderer({
    extensionId: "vmark.svg",
    languages: ["svg"],
    emptyLabelKey: "editor:preview.emptySvg",
    copyable: true,
    create: ({ nodeEnd, content, cacheKey, previewCache, onEnterEdit }) =>
      createSvgPreviewWidget(nodeEnd, content, cacheKey, previewCache, onEnterEdit),
  });

  registerFenceRenderer({
    extensionId: "vmark.mermaid",
    languages: ["mermaid"],
    emptyLabelKey: "editor:preview.emptyDiagram",
    copyable: true,
    create: ({ nodeEnd, content, cacheKey, previewCache, onEnterEdit }) =>
      createMermaidPreviewWidget(nodeEnd, content, cacheKey, previewCache, onEnterEdit),
  });

  registerFenceRenderer({
    extensionId: "vmark.graphviz",
    matches: isGraphvizLanguage,
    emptyLabelKey: "editor:preview.emptyDiagram",
    copyable: true,
    create: ({ nodeEnd, content, cacheKey, previewCache, onEnterEdit }) =>
      createGraphvizPreviewWidget(nodeEnd, content, cacheKey, previewCache, onEnterEdit),
  });

  registerFenceRenderer({
    extensionId: "vmark.githubWorkflow",
    languages: ["yaml", "yml"],
    emptyLabelKey: "editor:preview.emptyWorkflow",
    create: ({ nodeEnd, content, cacheKey, previewCache, onEnterEdit }) =>
      createWorkflowPreviewWidget(nodeEnd, content, cacheKey, previewCache, onEnterEdit),
  });
}
