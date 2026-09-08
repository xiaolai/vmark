// @vitest-environment node
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
    // Audit 20260907 round 2 — an INLINE link is not a shortcut reference.
    {
      name: "flagged: [foo](url) is an inline link, not a use of [foo]: …",
      input: "[foo](https://example.com)\n\n[foo]: https://other.com",
      expected: 1,
    },
    {
      name: "flagged: ![foo](url) is an inline image, not a use of [foo]: …",
      input: "![foo](image.png)\n\n[foo]: https://other.com",
      expected: 1,
    },
    {
      name: "clean: a space breaks the inline form, so [foo] (url) IS a shortcut",
      input: "[foo] (https://example.com)\n\n[foo]: https://other.com",
      expected: 0,
    },
    // Audit 20260907 round 2 — a definition must not count as its own usage,
    // wherever the parser found it.
    {
      name: "flagged: a definition inside a blockquote is not its own usage",
      input: "> [ref]: https://example.com",
      expected: 1,
    },
    {
      name: "flagged: an escaped bracket is a literal, not a use of [foo]: …",
      input: "Write \\[foo] to show brackets\n\n[foo]: https://other.com",
      expected: 1,
    },
    {
      name: "flagged: a title on a continuation line is not a usage",
      input: '[text][foo]\n\n[foo]: /url\n  "see [bar]"\n\n[bar]: /other',
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

  // Audit R2 (#854): the fallback was a literal 0, so a definition anywhere but
  // the first character underlined the START OF THE DOCUMENT — someone else's
  // text. The engine's own line index says where each line begins.
  it("derives the missing offset from the line index, not from zero", () => {
    const source = "para\n\n  [ref]: https://example.com";
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "definition",
          identifier: "ref",
          label: "ref",
          url: "https://example.com",
          position: { start: { line: 3, column: 3 }, end: { line: 3, column: 29 } },
        } as unknown as Definition,
      ],
    };
    const index = { lines: source.split("\n"), lineOffsets: [0, 5, 6] };

    const diagnostics = noUnusedDefs(source, mdast, index);
    expect(diagnostics[0].offset).toBe(8);
    expect(source.slice(diagnostics[0].offset, diagnostics[0].offset + 5)).toBe("[ref]");
  });
});

// Audit R2 (#847/#850): the fence tracker only recognises a fence that starts
// its own line, and CommonMark does not resolve references inside a raw HTML
// block — so bracket text in either place counted as a USAGE and silenced this
// rule for a definition nothing actually references.
describe("W03 — bracket text that is not markdown", () => {
  it.each([
    {
      name: "fenced code inside a blockquote",
      input: "> ```\n> [ref]\n> ```\n\n[ref]: https://example.com",
    },
    {
      name: "fenced code inside a list item",
      input: "- item\n\n  ```\n  [ref]\n  ```\n\n[ref]: https://example.com",
    },
    {
      name: "an indented code block",
      input: "para\n\n    [ref]\n\n[ref]: https://example.com",
    },
    {
      name: "a raw HTML block",
      input: "<div>\n[ref]\n</div>\n\n[ref]: https://example.com",
    },
  ])("$name does not count as a usage", ({ input }) => {
    expect(lintMarkdown(input).filter((d) => d.ruleId === "W03")).toHaveLength(1);
  });

  // The opposite mistake, and the louder one: masking the LINE of an inline
  // `<b>` would take a real reference beside it with it.
  it("still sees a reference on a line that also carries inline HTML", () => {
    const input = "See <b>this</b> [ref] here\n\n[ref]: https://example.com";
    expect(lintMarkdown(input).filter((d) => d.ruleId === "W03")).toHaveLength(0);
  });
});

// Audit 20260907 round 3 (#849): the reference scan stripped `` `…` `` only —
// same line, single backtick — so a definition "used" only inside a wider or a
// multi-line code span was never reported. E01 and W03 share `sourceMask` now,
// so they cannot disagree about which text is code.
describe("W03 — a usage inside a code span is not a usage", () => {
  it.each([
    { name: "a double-backtick span", input: "Use ``[ref]`` here\n\n[ref]: https://example.com" },
    { name: "a span across a line ending", input: "Use `x\n[ref]` here\n\n[ref]: https://example.com" },
  ])("$name", ({ input }) => {
    expect(lintMarkdown(input).filter((d) => d.ruleId === "W03")).toHaveLength(1);
  });

  it("still sees a real usage beside a code span", () => {
    const input = "Use `code` and [ref] here\n\n[ref]: https://example.com";
    expect(lintMarkdown(input).filter((d) => d.ruleId === "W03")).toHaveLength(0);
  });
});
