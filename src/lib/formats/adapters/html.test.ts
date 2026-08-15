// @vitest-environment node
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

    // The validator used to split into lines and match each one, which threw
    // away two things: any construct spanning a newline, and the column of
    // every match (all were reported as 1).

    it("reports the real column, not 1", () => {
      const [diag] = htmlValidator('<p>hi</p><script>x</script>');
      expect(diag.ruleId).toBe("html/script-blocked");
      expect(diag.column).toBe(10);
    });

    it("reports the real line", () => {
      const [diag] = htmlValidator("<p>a</p>\n<p>b</p>\n<script>x</script>");
      expect(diag.line).toBe(3);
      expect(diag.column).toBe(1);
    });

    it("finds a javascript: URL whose attribute spans a newline", () => {
      const diags = htmlValidator('<a href =\n  "javascript:alert(1)">x</a>');
      expect(diags.map((d) => d.ruleId)).toContain("html/javascript-url");
    });

    it("finds an inline handler whose attribute spans a newline", () => {
      const diags = htmlValidator('<button\n  onclick = "evil()">x</button>');
      expect(diags.map((d) => d.ruleId)).toContain("html/inline-handler");
    });

    it("reports every occurrence, not just the first per line", () => {
      const diags = htmlValidator("<script>a</script><script>b</script>");
      expect(diags.filter((d) => d.ruleId === "html/script-blocked")).toHaveLength(2);
    });

    it("orders diagnostics by position in the document", () => {
      const diags = htmlValidator('<b onclick="x">y</b>\n<script>z</script>');
      expect(diags[0].ruleId).toBe("html/inline-handler");
      expect(diags[0].line).toBe(1);
      expect(diags[1].ruleId).toBe("html/script-blocked");
      expect(diags[1].line).toBe(2);
    });

    it("handles CRLF line endings", () => {
      const [diag] = htmlValidator("<p>a</p>\r\n<script>x</script>");
      expect(diag.line).toBe(2);
      expect(diag.column).toBe(1);
    });

    // Columns are UTF-16 code units, matching CodeMirror's own positions —
    // a BMP CJK character is one unit, so `<p>` + 6 chars + `</p>` puts the
    // script tag at column 14.
    it("counts a CJK character as one column", () => {
      const [diag] = htmlValidator('<p>用普通温度计</p><script>x</script>');
      expect(diag.column).toBe(14);
    });
  });
});
