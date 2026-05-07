// WI-2.3 — YAML adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

    it("returns one error for malformed YAML with line/column", () => {
      const diags = yamlValidator(`
name: test
version: : 1
      `.trim());
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].line).toBeGreaterThan(0);
    });

    it("flags duplicate mapping keys", () => {
      const diags = yamlValidator(`
foo: 1
foo: 2
      `.trim());
      // js-yaml flags duplicate keys with default schema
      expect(diags.length).toBeGreaterThanOrEqual(1);
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
});
