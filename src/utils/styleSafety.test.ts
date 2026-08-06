import { describe, it, expect } from "vitest";
import {
  isSafeStyleValue,
  isSafeStyleAttribute,
  sanitizeDeclarations,
  sanitizeStylesheetText,
  KATEX_STYLE_PROPS,
} from "./styleSafety";

describe("isSafeStyleValue", () => {
  it("rejects the execution and fetch vectors", () => {
    for (const bad of [
      "url(https://evil.test/p.png)",
      "expression(alert(1))",
      "javascript:alert(1)",
      "url(javascript:alert(1))",
      "-moz-binding: url(x)",
      "behavior: url(#default#userData)",
      "<script>",
    ]) {
      expect(isSafeStyleValue(bad)).toBe(false);
    }
  });

  it("rejects viewport-pinning positions used for overlay attacks", () => {
    // A KaTeX span with position:fixed covering the viewport is a
    // clickjacking surface, not math.
    expect(isSafeStyleValue("fixed", "position")).toBe(false);
    expect(isSafeStyleValue("sticky", "position")).toBe(false);
  });

  it("allows the positions KaTeX genuinely uses", () => {
    expect(isSafeStyleValue("relative", "position")).toBe(true);
    expect(isSafeStyleValue("absolute", "position")).toBe(true);
  });

  it("allows ordinary values", () => {
    expect(isSafeStyleValue("0.5em")).toBe(true);
    expect(isSafeStyleValue("#ff0000")).toBe(true);
    expect(isSafeStyleValue("middle")).toBe(true);
  });

  it("sees through CSS escapes and case", () => {
    expect(isSafeStyleValue("URL(https://evil.test/p.png)")).toBe(false);
    expect(isSafeStyleValue("u\\72l(https://evil.test/p.png)")).toBe(false);
  });
});

describe("sanitizeDeclarations", () => {
  it("keeps allowed properties and drops the rest", () => {
    const out = sanitizeDeclarations(
      "height: 1em; position: relative; pointer-events: none",
      KATEX_STYLE_PROPS,
    );
    expect(out).toContain("height");
    expect(out).toContain("position");
    expect(out).not.toContain("pointer-events");
  });

  it("drops an allowed property carrying a dangerous value", () => {
    expect(
      sanitizeDeclarations("width: url(https://evil.test/p.png)", KATEX_STYLE_PROPS),
    ).toBe("");
    expect(sanitizeDeclarations("position: fixed", KATEX_STYLE_PROPS)).toBe("");
  });

  it("returns empty for junk input", () => {
    expect(sanitizeDeclarations("", KATEX_STYLE_PROPS)).toBe("");
    expect(sanitizeDeclarations("novalue", KATEX_STYLE_PROPS)).toBe("");
  });

  it("covers every property KaTeX's source assigns", () => {
    // Derived from `style.<prop> =` across katex/src, not from a sample
    // render — sampling missed the last two and those constructs lost
    // their formatting.
    for (const p of [
      "background-color", "border-bottom-width", "border-color",
      "border-right-style", "border-right-width", "border-style",
      "border-top-width", "border-width", "bottom", "color", "height",
      "left", "margin", "margin-left", "margin-right", "margin-top",
      "min-width", "padding-left", "position", "top", "vertical-align",
      "width", "text-shadow",
    ]) {
      expect(KATEX_STYLE_PROPS.has(p)).toBe(true);
    }
  });

  it("still blocks a dangerous value on a newly allowed property", () => {
    // Widening the property list must not widen the VALUE rules.
    expect(
      sanitizeDeclarations("text-shadow: 0 0 4px url(https://evil.test/p)", KATEX_STYLE_PROPS),
    ).toBe("");
  });
});

describe("sanitizeStylesheetText", () => {
  it("strips a remote @import", () => {
    expect(sanitizeStylesheetText('@import url("https://evil.test/x.css");')).toBe("");
  });

  it("strips a rule that fetches an external resource", () => {
    expect(
      sanitizeStylesheetText("rect{fill:url(https://evil.test/p.svg)}"),
    ).not.toContain("evil.test");
  });

  it("keeps ordinary diagram styling (the Mermaid case)", () => {
    const css = ".node rect{fill:#eee;stroke:#333}.edgeLabel{color:#111}";
    expect(sanitizeStylesheetText(css)).toBe(css);
  });

  it("keeps a same-document paint reference", () => {
    const css = "path{marker-end:url(#arrowhead)}";
    expect(sanitizeStylesheetText(css)).toBe(css);
  });

  it("strips javascript: and expression() anywhere in the sheet", () => {
    expect(sanitizeStylesheetText("a{background:url(javascript:alert(1))}")).not.toContain(
      "javascript:",
    );
    expect(sanitizeStylesheetText("a{width:expression(alert(1))}")).not.toContain(
      "expression(",
    );
  });

  it("returns empty for an empty sheet", () => {
    expect(sanitizeStylesheetText("")).toBe("");
  });
});

describe("CSS comments cannot smuggle a blocked value", () => {
  it("blocks position:fixed written with a comment", () => {
    // Both parse as `position: fixed` in a browser; an exact-value check
    // sees neither.
    expect(isSafeStyleValue("fixed/**/", "position")).toBe(false);
    expect(isSafeStyleValue("/**/fixed", "position")).toBe(false);
  });

  it("blocks url() written with a comment", () => {
    expect(isSafeStyleValue("ur/**/l(https://evil.test/p)")).toBe(false);
  });

  it("still allows an ordinary value containing no comment", () => {
    expect(isSafeStyleValue("relative", "position")).toBe(true);
  });
});

describe("isSafeStyleAttribute — whole-attribute checking", () => {
  it("blocks position:fixed in a full style attribute", () => {
    // The SVG path passes the WHOLE attribute, with no property argument.
    // `isSafeStyleValue` only applies the position rule when told the
    // property, so this used to sail past the check written to stop it.
    expect(isSafeStyleAttribute("position:fixed")).toBe(false);
    expect(isSafeStyleAttribute("fill:#eee;position:fixed;stroke:#333")).toBe(false);
  });

  it("blocks it through comments and escapes", () => {
    expect(isSafeStyleAttribute("position:fixed/**/")).toBe(false);
    expect(isSafeStyleAttribute("position:f\\ixed")).toBe(false);
  });

  it("allows ordinary diagram styling", () => {
    expect(isSafeStyleAttribute("fill:#eee;stroke:#333;position:relative")).toBe(true);
  });

  it("blocks a url() beacon anywhere in the attribute", () => {
    expect(isSafeStyleAttribute("fill:#eee;background:url(https://evil.test/p)")).toBe(false);
  });
});
