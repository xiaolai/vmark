// WI-3.2 — Standalone SVG adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRegistry, dispatchEditor } from "../registry";
import { svgFormat, registerSvgFormat, svgValidator } from "./svg";
import { registerMarkdownFormat } from "./markdown";

describe("svg adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares id 'svg'", () => {
    expect(svgFormat.id).toBe("svg");
  });

  it("registers .svg extension only", () => {
    expect(svgFormat.extensions).toEqual(["svg"]);
  });

  it("declares loadLanguage + validator + genericPreview", () => {
    expect(typeof svgFormat.loadLanguage).toBe("function");
    expect(typeof svgFormat.validator).toBe("function");
    expect(svgFormat.genericPreview).toBeDefined();
  });

  it("dispatchEditor routes .svg", () => {
    registerMarkdownFormat();
    registerSvgFormat();
    expect(dispatchEditor("/x/icon.svg").id).toBe("svg");
  });

  describe("svgValidator", () => {
    it("returns no diagnostics for empty document (SVG is permissive)", () => {
      expect(svgValidator("")).toEqual([]);
    });

    it("returns no diagnostics for valid SVG", () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red" /></svg>`;
      expect(svgValidator(svg)).toEqual([]);
    });

    it("flags content not starting with <svg or <?xml", () => {
      const diags = svgValidator("not svg");
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].ruleId).toMatch(/^svg\//);
    });

    it("flags malformed XML", () => {
      const diags = svgValidator("<svg><unclosed");
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].severity).toBe("error");
    });

    it("flags root element != svg even when xml prolog present", () => {
      const diags = svgValidator(
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" />',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].severity).toBe("error");
    });
  });
});
