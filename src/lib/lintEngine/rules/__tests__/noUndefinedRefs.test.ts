// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";

describe("E01 noUndefinedRefs", () => {
  it.each([
    {
      name: "clean: reference with matching definition",
      input: "See [this][ref]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: linkReference with no definition",
      input: "See [this][broken]",
      expected: 1,
    },
    {
      name: "flagged: imageReference with no definition",
      input: "![alt][missing-img]",
      expected: 1,
    },
    {
      name: "clean: case-insensitive label match",
      input: "See [this][REF]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "clean: whitespace-collapsed label match",
      input: "See [this][my  ref]\n\n[my ref]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: multiple missing refs each produce one diagnostic",
      input: "[first][missing1] and [second][missing2]",
      expected: 2,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
    {
      name: "clean: CJK label matched case-insensitively",
      input: "See [文本][标签]\n\n[标签]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: definition exists for different ref",
      input: "[text][ref-a]\n\n[ref-b]: https://example.com",
      expected: 1,
    },
    {
      name: "clean: inline link (not linkReference) never flagged",
      input: "[text](https://example.com)",
      expected: 0,
    },
    // Issue 5: collapsed and shortcut reference forms
    {
      name: "clean: collapsed reference [label][] with matching definition",
      input: "[ref][]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "flagged: collapsed reference [label][] with no definition",
      input: "[broken][]",
      expected: 1,
    },
    {
      name: "clean: shortcut reference [label] with matching definition",
      input: "[ref]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "clean: shortcut reference with no definition is not flagged (inline text)",
      input: "[notaref]",
      expected: 0,
    },
    // Audit 20260907 round 2 — an escaped bracket is a literal, and a document
    // about markdown is full of them.
    {
      name: "clean: an escaped bracket is not the start of a reference",
      input: "Write \\[text][label] to show brackets",
      expected: 0,
    },
    {
      name: "flagged: an escaped BACKSLASH leaves the bracket real",
      input: "Path \\\\[text][label] here",
      expected: 1,
    },
  ])("$name → $expected E01 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "E01");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity and fields", () => {
    const result = lintMarkdown("[text][broken]");
    const d = result.find((d) => d.ruleId === "E01");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.uiHint).toBe("exact");
    expect(d!.messageKey).toBe("lint.E01");
    expect(d!.messageParams.ref).toBe("broken");
    expect(d!.line).toBe(1);
  });
});

// Audit 20260907 round 3 (#841–#844): E01 carried its own fence tracker, its
// own one-backtick code-span strip and its own definition-line regex, while
// W03 had already moved to the parser's node positions. Every case here is
// text E01 reported and W03 correctly ignored in the SAME document — the
// definition of two rules disagreeing about one file. Both now read
// `sourceMask`.
describe("E01 — text the parser does not read as a reference", () => {
  it.each([
    { name: "a fence a blockquote prefixes", input: "> ```\n> [a][zz]\n> ```\n" },
    { name: "a fence a list item prefixes", input: "- item\n\n  ```\n  [a][zz]\n  ```\n" },
    { name: "an indented code block", input: "para\n\n    [a][zz]\n" },
    { name: "a DOUBLE-backtick code span", input: "Use ``[a][zz]`` here\n" },
    { name: "a code span that crosses a line ending", input: "Use `x\n[a][zz]` here\n" },
    { name: "a raw HTML block", input: "<div>\n[a][zz]\n</div>\n" },
    {
      name: "the continuation title of a definition",
      input: '[r]: https://example.com\n  "title with [a][zz]"\n\nUse [x][r]\n',
    },
    {
      name: "a definition a blockquote prefixes",
      input: "> [zz]: https://example.com\n\nUse [a][zz]\n",
    },
  ])("$name is not an undefined reference", ({ input }) => {
    expect(lintMarkdown(input).filter((d) => d.ruleId === "E01")).toHaveLength(0);
  });

  it("still reports a real undefined reference beside inline HTML", () => {
    expect(lintMarkdown("See <b>x</b> [a][zz] here\n").filter((d) => d.ruleId === "E01")).toHaveLength(1);
  });

  it("still reports one on the line after a fenced block closes", () => {
    expect(lintMarkdown("```\ncode\n```\n\n[a][zz]\n").filter((d) => d.ruleId === "E01")).toHaveLength(1);
  });
});
