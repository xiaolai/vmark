// WI-3.3 — HTML adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
} from "../registry";
import { htmlFormat, registerHtmlFormat, htmlValidator } from "./html";
import { registerMarkdownFormat } from "./markdown";

describe("html adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares id 'html'", () => {
    expect(htmlFormat.id).toBe("html");
  });

  it("registers .html and .htm extensions", () => {
    expect(htmlFormat.extensions).toEqual(["html", "htm"]);
  });

  it("declares loadLanguage + validator + genericPreview", () => {
    expect(typeof htmlFormat.loadLanguage).toBe("function");
    expect(typeof htmlFormat.validator).toBe("function");
    expect(htmlFormat.genericPreview).toBeDefined();
  });

  it("dispatchEditor routes .html and .htm", () => {
    registerMarkdownFormat();
    registerHtmlFormat();
    expect(dispatchEditor("/x/page.html").id).toBe("html");
    expect(dispatchEditor("/x/page.htm").id).toBe("html");
  });

  it("registerHtmlFormat installs into the registry", () => {
    registerHtmlFormat();
    expect(getFormatById("html")).toBe(htmlFormat);
  });

  describe("htmlValidator", () => {
    it("returns no diagnostics for empty document", () => {
      expect(htmlValidator("")).toEqual([]);
    });

    it("returns no diagnostics for valid HTML", () => {
      const html = `<!doctype html>
<html><head><title>x</title></head><body><p>hi</p></body></html>`;
      expect(htmlValidator(html)).toEqual([]);
    });

    it("flags <script> tag (XSS warning)", () => {
      const diags = htmlValidator(
        '<html><body><script>alert(1)</script></body></html>',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
      // Script tags surface a diagnostic so users know the iframe will
      // block them; not blocked at the validator level (the renderer
      // handles enforcement).
      expect(diags[0].severity).toBe("warning");
      expect(diags[0].ruleId).toBe("html/script-blocked");
    });

    it("flags javascript: URLs in href / src", () => {
      const diags = htmlValidator(
        '<a href="javascript:alert(1)">x</a>',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].ruleId).toBe("html/javascript-url");
    });

    it("flags inline event handlers", () => {
      const diags = htmlValidator(
        '<button onclick="evil()">click</button>',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].ruleId).toBe("html/inline-handler");
    });

    it("returns multiple diagnostics for combined risks", () => {
      const diags = htmlValidator(
        '<script>1</script><a href="javascript:1">x</a><b onclick="2">x</b>',
      );
      expect(diags.length).toBeGreaterThanOrEqual(3);
    });
  });
});
