// WI-2.3 — YAML adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkflowStore } from "@/stores/workflowStore";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
} from "../registry";
import {
  yamlFormat,
  registerYamlFormat,
  yamlSchemaDetector,
  yamlValidator,
} from "./yaml";
import { registerMarkdownFormat } from "./markdown";

describe("yaml adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares id 'yaml'", () => {
    expect(yamlFormat.id).toBe("yaml");
  });

  it("registers .yaml and .yml extensions", () => {
    expect(yamlFormat.extensions).toEqual(["yaml", "yml"]);
  });

  it("declares loadLanguage + validator + genericPreview", () => {
    expect(typeof yamlFormat.loadLanguage).toBe("function");
    expect(typeof yamlFormat.validator).toBe("function");
    expect(yamlFormat.genericPreview).toBeDefined();
  });

  it("registerYamlFormat installs into the registry", () => {
    registerYamlFormat();
    expect(getFormatById("yaml")).toBe(yamlFormat);
  });

  it("dispatchEditor routes .yaml and .yml", () => {
    registerMarkdownFormat();
    registerYamlFormat();
    expect(dispatchEditor("/x/config.yaml").id).toBe("yaml");
    expect(dispatchEditor("/x/.github/workflows/ci.yml").id).toBe("yaml");
  });

  describe("yamlValidator", () => {
    it("returns no diagnostics for valid YAML", () => {
      expect(
        yamlValidator(`
name: test
version: 1
        `.trim()),
      ).toEqual([]);
    });

    it("returns no diagnostics for empty document", () => {
      expect(yamlValidator("")).toEqual([]);
    });

    it("returns one error for malformed YAML with 1-based line/column (WI-2.7)", () => {
      const diags = yamlValidator(`
name: test
version: : 1
      `.trim());
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      // `yaml` reports 1-based positions; the error is on the 2nd line.
      expect(diags[0].line).toBe(2);
      expect(diags[0].column).toBeGreaterThan(0);
    });

    it("flags duplicate mapping keys (WI-2.7 — yaml lib throws like js-yaml did)", () => {
      const diags = yamlValidator(`
foo: 1
foo: 2
      `.trim());
      // The `yaml` library errors on duplicate keys by default, matching the
      // previous js-yaml behavior the gutter relied on.
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].line).toBeGreaterThan(0);
    });

    it("returns ruleId yaml/syntax", () => {
      const diags = yamlValidator("foo: : bar");
      expect(diags[0]?.ruleId).toMatch(/^yaml\//);
    });
  });

  describe("yamlSchemaDetector (WI-2.4)", () => {
    it("returns 'gha-workflow' for paths under .github/workflows/", () => {
      // Path beats content per ADR-5 precedence rule 1.
      expect(
        yamlSchemaDetector("/repo/.github/workflows/ci.yml", "anything"),
      ).toBe("gha-workflow");
      expect(
        yamlSchemaDetector("/repo/.github/workflows/release.yaml", ""),
      ).toBe("gha-workflow");
    });

    it("returns 'gha-workflow' for workflow-shaped content even without path", () => {
      const yaml = `
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
      `.trim();
      expect(yamlSchemaDetector("/x/random.yaml", yaml)).toBe("gha-workflow");
    });

    it("returns null for non-workflow YAML at unrelated path", () => {
      const yaml = `
name: not a workflow
version: 1
deps:
  - foo
      `.trim();
      expect(yamlSchemaDetector("/x/config.yaml", yaml)).toBeNull();
    });

    it("returns null for syntactically invalid YAML even with workflow shape (ADR-5)", () => {
      // The regex shape check would match top-level on:/jobs:, but the
      // content fails to parse. Per ADR-5 rule 3 the detector must
      // return null — the path-first branch already covers files under
      // .github/workflows/, where we *do* keep the schema id even on
      // broken YAML.
      const broken = `
on:
  push:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo: : ::: invalid
      `.trim();
      expect(yamlSchemaDetector("/x/random.yaml", broken)).toBeNull();
    });

    it("path detection still wins on syntactically invalid YAML", () => {
      // Same broken content, but path is .github/workflows/ — the
      // user sees a degraded view with diagnostics instead of a tree.
      const broken = "::: invalid yaml :::";
      expect(
        yamlSchemaDetector("/repo/.github/workflows/ci.yml", broken),
      ).toBe("gha-workflow");
    });

    it("returns null for empty content + unrelated path", () => {
      expect(yamlSchemaDetector("/x/random.yaml", "")).toBeNull();
    });
  });

  describe("yamlFormat schema wiring", () => {
    it("declares schemaDetector + schemaRenderers['gha-workflow']", () => {
      expect(typeof yamlFormat.schemaDetector).toBe("function");
      expect(yamlFormat.schemaRenderers?.["gha-workflow"]).toBeDefined();
    });
  });

  describe("gha-workflow schemaRenderer", () => {
    beforeEach(() => {
      // jsdom shims required by @xyflow/react under WorkflowCanvas.
      // @ts-expect-error jsdom shim
      global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: () => ({
          matches: false,
          media: "",
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      });
    });

    it("mounts the workbench (canvas + forms editor), not a bare canvas", async () => {
      const Renderer = yamlFormat.schemaRenderers!["gha-workflow"];
      const { container } = render(
        createElement(Renderer, {
          content: "name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n",
          path: "/repo/.github/workflows/ci.yml",
          diagnostics: [],
          tabId: "tab-render",
        }),
      );
      // WI-13: the renderer (workbench + workflow IR parser) is behind a
      // React.lazy boundary now, so the canvas arrives a microtask later —
      // the assertion is unchanged, only the await is new. The generous
      // timeout is deliberate: the FIRST resolution of this lazy chunk pays
      // vitest's on-demand transform of the whole ghaWorkflow import graph,
      // which can exceed waitFor's 1s default on a cold or contended worker
      // (observed flaking 1-in-5 in isolation). The assertion still requires
      // the element; it just stops racing the transformer.
      await waitFor(
        () => {
          expect(
            container.querySelector(".gha-workflow-workbench__canvas"),
          ).not.toBeNull();
        },
        { timeout: 15_000 },
      );
    });
  });

  describe("loadExtraExtensions — gha slice wiring", () => {
    const WORKFLOW_YAML = [
      "name: ci",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: pnpm test",
      "",
    ].join("\n");

    it("mounts source extensions that feed the workflowStore gha slice", async () => {
      const filePath = "/repo/.github/workflows/ci.yml";
      useDocumentStore.setState({
        documents: { "tab-wf": { content: WORKFLOW_YAML, filePath } },
      } as never);
      useWorkflowStore.getState().resetGha();

      const extras = await yamlFormat.loadExtraExtensions!({
        tabId: "tab-wf",
        filePath,
        windowLabel: "main",
      });
      expect(extras.length).toBeGreaterThan(0);

      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const view = new EditorView({
        parent,
        state: EditorState.create({ doc: WORKFLOW_YAML, extensions: extras }),
      });
      expect(
        useWorkflowStore.getState().gha.byTab["tab-wf"]?.jobs.map((j) => j.id),
      ).toEqual(["build"]);

      // Closing the tab (view destroy) must clear this tab's entry.
      view.destroy();
      expect(useWorkflowStore.getState().gha.byTab["tab-wf"]).toBeUndefined();
    });

    it("a second pane holding plain YAML cannot clobber the workflow pane's IR (document split)", async () => {
      const wfPath = "/repo/.github/workflows/ci.yml";
      useDocumentStore.setState({
        documents: {
          "tab-wf": { content: WORKFLOW_YAML, filePath: wfPath },
          "tab-plain": { content: "title: hello\n", filePath: "/repo/config.yml" },
        },
      } as never);
      useWorkflowStore.getState().resetGha();

      const wfExtras = await yamlFormat.loadExtraExtensions!({
        tabId: "tab-wf",
        filePath: wfPath,
        windowLabel: "main",
      });
      const plainExtras = await yamlFormat.loadExtraExtensions!({
        tabId: "tab-plain",
        filePath: "/repo/config.yml",
        windowLabel: "main",
      });

      const host = (doc: string, extensions: unknown) => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        return new EditorView({
          parent,
          state: EditorState.create({ doc, extensions: extensions as never }),
        });
      };
      const wfView = host(WORKFLOW_YAML, wfExtras);
      const plainView = host("title: hello\n", plainExtras);

      // The plain pane mounted after the workflow pane and published
      // null — for ITS tab only. The workflow IR must survive.
      expect(
        useWorkflowStore.getState().gha.byTab["tab-wf"]?.jobs.map((j) => j.id),
      ).toEqual(["build"]);

      // Destroying the plain pane must not wipe the workflow pane.
      plainView.destroy();
      expect(useWorkflowStore.getState().gha.byTab["tab-wf"]).toBeDefined();

      wfView.destroy();
      expect(useWorkflowStore.getState().gha.byTab["tab-wf"]).toBeUndefined();
    });
  });
});
