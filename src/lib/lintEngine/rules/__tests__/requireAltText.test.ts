// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { requireAltText } from "../requireAltText";
import type { Root, Image } from "mdast";

describe("W02 requireAltText", () => {
  it.each([
    {
      name: "clean: image with alt text",
      input: "![a photo of a cat](cat.png)",
      expected: 0,
    },
    {
      name: "flagged: image with empty alt",
      input: "![](image.png)",
      expected: 1,
    },
    {
      name: "clean: image with CJK alt text",
      input: "![一只猫的照片](cat.png)",
      expected: 0,
    },
    {
      name: "flagged: multiple images with empty alt",
      input: "![](a.png) and ![](b.png)",
      expected: 2,
    },
    {
      name: "clean: inline link with text is not flagged",
      input: "[text](https://example.com)",
      expected: 0,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
    {
      name: "clean: imageReference with alt is not flagged",
      input: "![alt text][img-ref]\n\n[img-ref]: image.png",
      expected: 0,
    },
    {
      name: "flagged: whitespace-only alt treated as empty",
      input: "![ ](image.png)",
      expected: 1,
    },
    {
      name: "clean: image with spaces in alt text",
      input: "![my alt text](image.png)",
      expected: 0,
    },
  ])("$name → $expected W02 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "W02");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity, uiHint, and messageKey", () => {
    const result = lintMarkdown("![](image.png)");
    const d = result.find((d) => d.ruleId === "W02");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("warning");
    expect(d!.uiHint).toBe("exact");
    expect(d!.messageKey).toBe("lint.W02");
    expect(d!.line).toBe(1);
  });

  it("skips image nodes without position", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "image",
              url: "image.png",
              alt: "",
              // No position — should be skipped
            } as Image,
          ],
        },
      ],
    };

    const diagnostics = requireAltText("", mdast);
    expect(diagnostics).toHaveLength(0);
  });

  it("flags image where alt is null (falls back to empty string)", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "image",
              url: "image.png",
              alt: null,
              position: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 15, offset: 14 },
              },
            } as unknown as Image,
          ],
        },
      ],
    };

    const diagnostics = requireAltText("", mdast);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].ruleId).toBe("W02");
  });

  it("uses offset fallback when position.start.offset is undefined", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "image",
              url: "image.png",
              alt: "",
              position: {
                start: { line: 1, column: 1 },
                end: { line: 1, column: 15 },
              },
            } as unknown as Image,
          ],
        },
      ],
    };

    const diagnostics = requireAltText("", mdast);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(0);
  });
});
