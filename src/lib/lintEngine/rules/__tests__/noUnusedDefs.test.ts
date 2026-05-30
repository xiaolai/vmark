import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { noUnusedDefs } from "../noUnusedDefs";
import type { Root, Definition } from "mdast";
import type { LintLineIndex } from "../../types";

// Empty-source line index for direct rule calls (orchestrator builds this in prod).
const EMPTY_INDEX: LintLineIndex = { lines: [""], lineOffsets: [0] };

describe("W03 noUnusedDefs", () => {
  it.each([
    {
      name: "flagged: definition not referenced",
      input: "[ref]: https://example.com",
      expected: 1,
    },
    {
      name: "clean: definition referenced by linkReference",
      input: "See [this][ref]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "clean: definition referenced by imageReference",
      input: "![alt][img]\n\n[img]: image.png",
      expected: 0,
    },
    {
      name: "flagged: one used, one unused",
      input: "[text][used]\n\n[used]: https://a.com\n[unused]: https://b.com",
      expected: 1,
    },
    {
      name: "flagged: case-insensitive match — REF reference uses [ref] def",
      input: "[text][REF]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
    {
      name: "flagged: two unused definitions",
      input: "[ref-a]: https://a.com\n[ref-b]: https://b.com",
      expected: 2,
    },
    {
      name: "clean: CJK definition referenced",
      input: "[文本][标签]\n\n[标签]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: CJK definition unused",
      input: "[标签]: https://example.com",
      expected: 1,
    },
    {
      name: "clean: no definitions in document",
      input: "# Just a heading\n\nSome text.",
      expected: 0,
    },
    // Issue 5: collapsed and shortcut reference forms
    {
      name: "clean: collapsed reference [label][] counts as usage",
      input: "[ref][]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "clean: shortcut reference [label] counts as usage",
      input: "[ref]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: definition not reached by collapsed ref with wrong label",
      input: "[wrong][]\n\n[ref]: https://example.com",
      expected: 1,
    },
  ])("$name → $expected W03 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "W03");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity, uiHint, messageKey, and messageParams", () => {
    const result = lintMarkdown("[ref]: https://example.com");
    const d = result.find((d) => d.ruleId === "W03");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("warning");
    expect(d!.uiHint).toBe("block");
    expect(d!.messageKey).toBe("lint.W03");
    expect(d!.messageParams.ref).toBe("ref");
  });

  it("skips definition nodes without position", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "orphan",
          label: "orphan",
          url: "https://example.com",
          // No position — should be skipped
        } as Definition,
      ],
    };

    const diagnostics = noUnusedDefs("", mdast, EMPTY_INDEX);
    expect(diagnostics).toHaveLength(0);
  });

  it("falls back to identifier when label is null", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "myid",
          url: "https://example.com",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 25, offset: 24 },
          },
        } as Definition,
      ],
    };

    // No references in source, so the definition should be flagged
    const diagnostics = noUnusedDefs("", mdast, EMPTY_INDEX);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].messageParams.ref).toBe("myid");
  });

  it("falls back to empty string when both label and identifier are null", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "",
          url: "https://example.com",
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 25, offset: 24 },
          },
        } as Definition,
      ],
    };

    const diagnostics = noUnusedDefs("", mdast, EMPTY_INDEX);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].messageParams.ref).toBe("");
  });

  it("uses offset fallback when position.start.offset is undefined", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://example.com",
          position: {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 25 },
          },
        } as unknown as Definition,
      ],
    };

    const diagnostics = noUnusedDefs("", mdast, EMPTY_INDEX);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(0);
  });
});
