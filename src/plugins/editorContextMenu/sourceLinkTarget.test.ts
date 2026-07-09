// WI-4.2 — bounded source link-target parser: inline links (with titles,
// angle-bracket targets, CJK/nested-bracket text), reference links
// (full, collapsed, shortcut) resolved against the document's
// definitions, and clean nulls for everything unparseable.

import { describe, expect, it } from "vitest";
import { getSourceLinkTarget, parseLinkTarget, resolveReferenceTarget } from "./sourceLinkTarget";

describe("parseLinkTarget — inline links", () => {
  it.each([
    { syntax: "[text](https://example.com)", target: "https://example.com" },
    { syntax: "[text](./relative/path.md)", target: "./relative/path.md" },
    { syntax: '[text](https://example.com "a title")', target: "https://example.com" },
    { syntax: "[text](<https://example.com/with space>)", target: "https://example.com/with space" },
    { syntax: "[中文链接](https://例子.测试/路径)", target: "https://例子.测试/路径" },
    { syntax: "[a [nested] label](https://example.com)", target: "https://example.com" },
    { syntax: "[text]()", target: null },
  ])("$syntax → $target", ({ syntax, target }) => {
    const parsed = parseLinkTarget(syntax);
    if (target === null) {
      expect(parsed).toBeNull();
    } else {
      expect(parsed).toEqual({ kind: "inline", target });
    }
  });
});

describe("parseLinkTarget — reference links", () => {
  it("parses full reference form", () => {
    expect(parseLinkTarget("[text][label]")).toEqual({ kind: "ref", label: "label" });
  });

  it("parses collapsed form using the text as label", () => {
    expect(parseLinkTarget("[text][]")).toEqual({ kind: "ref", label: "text" });
  });

  it("parses shortcut form using the text as label", () => {
    expect(parseLinkTarget("[text]")).toEqual({ kind: "ref", label: "text" });
  });

  it("rejects garbage", () => {
    expect(parseLinkTarget("not a link")).toBeNull();
    expect(parseLinkTarget("")).toBeNull();
    expect(parseLinkTarget("[unclosed](https://x")).toBeNull();
  });
});

describe("resolveReferenceTarget", () => {
  const doc = [
    "Some text with [a link][ref1].",
    "",
    "[ref1]: https://one.example.com",
    "  [Ref2]: <https://two.example.com> \"title\"",
    "[空格标签]: https://cjk.example.com",
  ].join("\n");

  it("resolves a definition", () => {
    expect(resolveReferenceTarget(doc, "ref1")).toBe("https://one.example.com");
  });

  it("is case-insensitive and tolerates leading spaces and angle brackets", () => {
    expect(resolveReferenceTarget(doc, "ref2")).toBe("https://two.example.com");
  });

  it("resolves CJK labels", () => {
    expect(resolveReferenceTarget(doc, "空格标签")).toBe("https://cjk.example.com");
  });

  it("returns null for missing labels", () => {
    expect(resolveReferenceTarget(doc, "nope")).toBeNull();
  });
});

describe("getSourceLinkTarget", () => {
  it("returns inline targets without touching the document", () => {
    let docRead = false;
    const href = getSourceLinkTarget("[t](https://x.example)", () => {
      docRead = true;
      return "";
    });
    expect(href).toBe("https://x.example");
    expect(docRead).toBe(false);
  });

  it("resolves reference targets from the document", () => {
    const doc = "[t][r]\n\n[r]: https://r.example";
    expect(getSourceLinkTarget("[t][r]", () => doc)).toBe("https://r.example");
  });

  it("returns null when the reference is undefined", () => {
    expect(getSourceLinkTarget("[t][missing]", () => "no defs here")).toBeNull();
  });
});
