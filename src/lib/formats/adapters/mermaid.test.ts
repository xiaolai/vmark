// WI-3.1 — Mermaid adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
} from "../registry";
import { mermaidFormat, registerMermaidFormat, mermaidValidator } from "./mermaid";
import { registerMarkdownFormat } from "./markdown";

describe("mermaid adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares id 'mermaid'", () => {
    expect(mermaidFormat.id).toBe("mermaid");
  });

  it("registers .mmd extension only", () => {
    expect(mermaidFormat.extensions).toEqual(["mmd"]);
  });

  it("declares kind 'split-pane' with loadLanguage + validator + genericPreview", () => {
    expect(mermaidFormat.kind).toBe("split-pane");
    expect(typeof mermaidFormat.loadLanguage).toBe("function");
    expect(typeof mermaidFormat.validator).toBe("function");
    expect(mermaidFormat.genericPreview).toBeDefined();
  });

  it("registerMermaidFormat installs into the registry", () => {
    registerMermaidFormat();
    expect(getFormatById("mermaid")).toBe(mermaidFormat);
  });

  it("dispatchEditor routes .mmd", () => {
    registerMarkdownFormat();
    registerMermaidFormat();
    expect(dispatchEditor("/x/diagram.mmd").id).toBe("mermaid");
  });

  describe("mermaidValidator", () => {
    it("returns no diagnostics for empty document (Mermaid allows empty render attempt)", () => {
      expect(mermaidValidator("")).toEqual([]);
    });

    it("returns no diagnostics for valid flowchart", () => {
      const valid = `
flowchart LR
  A --> B
  B --> C
      `.trim();
      expect(mermaidValidator(valid)).toEqual([]);
    });

    it("flags missing diagram-type keyword", () => {
      const diags = mermaidValidator("not a valid diagram");
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].ruleId).toMatch(/^mermaid\//);
    });

    it("flags missing header at the actual non-comment line (not always line 1)", () => {
      const diags = mermaidValidator(`
%% leading comment
%% another comment

invalid header
      `.trim());
      // The header lives on the 4th line of the (leading-newline-stripped)
      // content because of the trim above. Verify the validator
      // reports the actual line, not 1.
      expect(diags).toHaveLength(1);
      expect(diags[0].line).toBeGreaterThan(1);
    });

    it("flags missing header with column pointing at the bad token", () => {
      const diags = mermaidValidator("    bogus");
      expect(diags).toHaveLength(1);
      // Column is 1-based; "bogus" starts at column 5 (after 4 spaces).
      expect(diags[0].column).toBe(5);
    });

    it("accepts every common diagram-type keyword", () => {
      for (const head of [
        "flowchart LR",
        "graph TD",
        "sequenceDiagram",
        "classDiagram",
        "stateDiagram-v2",
        "erDiagram",
        "gantt",
        "pie",
        "journey",
        "mindmap",
        "timeline",
      ]) {
        expect(mermaidValidator(head + "\nA --> B")).toEqual([]);
      }
    });
  });
});
