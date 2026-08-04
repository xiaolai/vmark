// WI-13 — the GHA workflow schemaRenderer as a lazily-imported module.
//
// Split out of `yaml.tsx` because the yaml adapter is ALWAYS registered (the
// GHA workflow viewer shipped on by default), so its static imports are cold
// start for every window: the workbench, the xyflow canvas behind it, and the
// workflow IR parser all rode `bootstrapFormats()`.
//
// What this pins is the module contract the split introduced: the adapter maps
// this module's NAMED export to `{ default }` at the import site, and a rename
// on either side yields `{ default: undefined }` — which renders as nothing
// inside the split-pane preview, with no test noticing. Rendering behavior is
// covered by yaml.test.ts (schemaDetector routing) and the workbench suite.

import { describe, expect, it } from "vitest";
import * as rendererModule from "./yamlWorkflowRenderer";
import { yamlFormat } from "./yaml";

describe("yamlWorkflowRenderer module contract", () => {
  it("exports the renderer under the name the adapter's lazy import maps", () => {
    expect(typeof rendererModule.GhaWorkflowSchemaRenderer).toBe("function");
  });

  it("takes PreviewRendererProps, not zero args", () => {
    expect(rendererModule.GhaWorkflowSchemaRenderer.length).toBe(1);
  });

  it("is still reachable as the yaml adapter's gha-workflow schemaRenderer", () => {
    // The adapter wraps it in a Suspense boundary, so the registered value is
    // a wrapper — but it must exist, or a workflow file falls through to the
    // plain YAML tree with no diagnostic.
    expect(yamlFormat.schemaRenderers?.["gha-workflow"]).toBeDefined();
  });
});
